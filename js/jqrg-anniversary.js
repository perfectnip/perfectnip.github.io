/* jqrg-anniversary.js — First Anniversary experience
 * Slideshow of old site versions + dreamcore music -> Rules -> Quiz -> Results.
 * Self-contained; exposes window.JqrgAnniversary.launch().
 *
 * Anti-cheat: the correct answers are NOT in this file. The client only sends
 * the user's answers to the worker, which scores them server-side and returns
 * only the total score + reward (never which answers were right/wrong).
 */
(function () {
  'use strict';
  if (window.JqrgAnniversary) return;

  /* Pending gate. Flip to false on release day (keep in sync with the
   * worker's ANNIVERSARY_RELEASED flag). While pending, only jimmyqrg can
   * open the experience and he can try infinitely (test mode). */
  var ANNIV_PENDING = true;
  var OWNER_USERNAMES = ['jimmyqrg'];

  /* ------------------------------------------------------------------ *
   * Quiz data — questions + options ONLY. No correct answers here.
   * ------------------------------------------------------------------ */
  // pin = last option is "None of the above" and must stay pinned at D.
  // trap = option text that blocks progress (Q12 "No").
  var QUIZ = [
    { q: "What is the first game ever made by JimmyQrg and is still living on the website today?",
      o: ["Bridd Jump", "Wordle Remake", "Worlds' Most Confusing Button Game", "Catgun Island"] },
    { q: "How many official admins (except me) are there?",
      o: ["1", "2", "3", "99999999"] },
    { q: "What is the name of the first official user?",
      o: ["Davin", "Bella", "Felix", "Elizabeth"] },
    { q: "Which game did JimmyQrg spend most time playing?",
      o: ["Hollow Knight", "Undertale", "Eaglercraft", "None of the above"], pin: true },
    { q: "How old is JimmyQrg?",
      o: ["13", "16", "21", "None of the above"], pin: true },
    { q: "What class was the first user in when they tested it?",
      o: ["Math", "English", "Science", "None of the above"], pin: true },
    { q: "What were the first three games played by the official users?",
      o: ["Wordle & Undertale & Bridd Jump", "Bridd Jump & Aqua Park & Parkoreen", "Wordle & Aqua Park & FNAF", "None of the Above"], pin: true },
    { q: "How many times did the main site switch link?",
      o: ["2", "3", "4", "None of the Above"], pin: true },
    { q: "How many times have JimmyQrg been through economic difficulty?",
      o: ["1", "2", "3", "4"] },
    { q: "How many Google Docs and Google Forms were created for JimmyQrg?",
      o: ["3, 3 Forms", "3, 2 Forms, 1 Doc", "4, 3 Forms, 1 Doc", "4, 4 Forms"] },
    { q: "How many countries of users are in the website? (The users with their school mail registered)",
      o: ["4", "9", "14", "None of the Above"], pin: true },
    { q: "Would you support this website?",
      o: ["Yes", "No"], trap: "No" }
  ];

  var TRAP_MESSAGE = "For the heaven's sake please accept the free point!";

  /* ------------------------------------------------------------------ *
   * Reward rules (best-tier-wins ladder)
   * ------------------------------------------------------------------ */
  var RULES = [
    { head: "First 5", body: "score 9+ → PERMANENT PREMIUM PLUS" },
    { head: "First 20", body: "score 9+ → 30-day Premium Plus, then permanent Premium" },
    { head: "First 20", body: "score 8 (not all 12) → 1-year Premium" },
    { head: "First 50", body: "score 6–7 → 4-month Premium" },
    { head: "First 100", body: "exactly 5 correct → 2-month Premium" },
    { head: "Everyone else", body: "1-month Premium" }
  ];
  var RULES_NOTE = "Rewards stack — buying something never overwrites a reward you already earned. When a Plus lapses, the rest of your other reward keeps running.";

  /* ------------------------------------------------------------------ *
   * Content: old site versions + music
   * ------------------------------------------------------------------ */
  var OLD_VERSIONS = [
    { label: "The very first version", url: "https://web.archive.org/web/2025/http://jimmyqrg.github.io/" }
  ];
  var MUSIC_URL = null; // set when a royalty-free dreamcore loop is sourced

  var WORKER_URL = (function () {
    try {
      var m = document.querySelector && document.querySelector('meta[name="jqrg-aichat-worker"]');
      if (m && m.content) return m.content.replace(/\/+$/, '');
    } catch (_) {}
    return 'https://deepseek-proxy.ikunbeautiful.workers.dev';
  })();

  /* ------------------------------------------------------------------ *
   * Helpers
   * ------------------------------------------------------------------ */
  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  // Shuffle a question's options; keep the pinned "None of the above" last.
  function prepareQuestion(q) {
    var opts = q.o.map(function (text) { return text; });
    if (q.pin) {
      var head = opts.slice(0, opts.length - 1);
      var tail = opts.slice(opts.length - 1);
      opts = shuffle(head).concat(tail);
    } else {
      opts = shuffle(opts);
    }
    return { q: q.q, options: opts, trap: q.trap || null };
  }

  function buildQuiz() {
    return shuffle(QUIZ.map(prepareQuestion));
  }

  function currentUsername() {
    try {
      var raw = localStorage.getItem('__jqrg_auth_v1');
      if (!raw) return null;
      var auth = JSON.parse(raw);
      return (auth && auth.user && auth.user.username) || null;
    } catch (_) { return null; }
  }

  function isOwner() {
    var u = (currentUsername() || '').toLowerCase();
    return OWNER_USERNAMES.indexOf(u) !== -1;
  }

  function getToken() {
    try {
      if (window.JqrgCloud && typeof window.JqrgCloud.getToken === 'function') {
        var t = window.JqrgCloud.getToken();
        if (t) return t;
      }
      var raw = localStorage.getItem('__jqrg_auth_v1');
      if (!raw) return null;
      var auth = JSON.parse(raw);
      return (auth && auth.token) || null;
    } catch (_) { return null; }
  }

  function getDoneFlag() {
    try { return JSON.parse(localStorage.getItem('jqrgAnnivDone') || 'null'); } catch (_) { return null; }
  }
  function setDoneFlag(data) {
    try { localStorage.setItem('jqrgAnnivDone', JSON.stringify(data)); } catch (_) {}
  }

  /* ------------------------------------------------------------------ *
   * DOM / render
   * ------------------------------------------------------------------ */
  var root = null;
  var audio = null;
  var state = null;

  function ensureRoot() {
    if (root) return root;

    // Retro arcade fonts (self-contained injection).
    var fontLink = document.createElement('link');
    fontLink.rel = 'stylesheet';
    fontLink.href = 'https://fonts.googleapis.com/css2?family=Press+Start+2P&family=VT323&display=swap';
    document.head.appendChild(fontLink);

    root = document.createElement('div');
    root.id = 'anniv-root';
    document.body.appendChild(root);

    var style = document.createElement('style');
    style.textContent = [
      '#anniv-root{position:fixed;inset:0;z-index:9999;background:#07030f;background-image:linear-gradient(rgba(168,85,247,.05) 1px,transparent 1px),linear-gradient(90deg,rgba(168,85,247,.05) 1px,transparent 1px);background-size:44px 44px;color:#ece6ff;font-family:"VT323",monospace;font-size:19px;display:flex;flex-direction:column;overflow:hidden}',
      '#anniv-root *{box-sizing:border-box}',
      '#anniv-root::before{content:"";position:absolute;inset:0;pointer-events:none;z-index:99998;background:repeating-linear-gradient(0deg,rgba(0,0,0,.16) 0 2px,transparent 2px 4px)}',
      '#anniv-root::after{content:"";position:absolute;inset:0;pointer-events:none;z-index:99998;background:radial-gradient(ellipse at center,transparent 55%,rgba(0,0,0,.6) 100%)}',
      '#anniv-root .anniv-top{display:flex;align-items:center;justify-content:space-between;padding:14px 20px;border-bottom:1px solid rgba(168,85,247,.3);z-index:1}',
      '#anniv-root .anniv-brand{font-family:"Press Start 2P",monospace;font-size:11px;color:#ffc14d;text-shadow:0 0 8px rgba(255,193,77,.7);letter-spacing:.05em}',
      '#anniv-root .anniv-close{background:none;border:0;color:rgba(255,255,255,.55);font-size:24px;cursor:pointer;line-height:1;padding:4px 8px;border-radius:8px;font-family:"Press Start 2P",monospace}',
      '#anniv-root .anniv-close:hover{color:#fff;background:rgba(255,255,255,.08)}',
      '#anniv-root .anniv-stage{flex:1;overflow-y:auto;padding:30px 20px;z-index:1}',
      '#anniv-root .anniv-inner{max-width:780px;margin:0 auto}',
      '#anniv-root .anniv-stage-label{font-family:"Press Start 2P",monospace;font-size:10px;color:#ff4dd5;text-shadow:0 0 8px rgba(255,77,213,.6);letter-spacing:.12em;margin-bottom:16px}',
      '#anniv-root .anniv-title{font-family:"Press Start 2P",monospace;font-size:22px;line-height:1.6;color:#fff;text-shadow:0 0 14px rgba(178,107,255,.85),0 0 28px rgba(255,77,213,.4);text-align:center;margin:0 0 10px}',
      '#anniv-root .anniv-sub{font-size:20px;color:rgba(236,230,255,.78);text-align:center;margin:0 0 22px;line-height:1.4}',
      '#anniv-root .anniv-btn{font-family:"Press Start 2P",monospace;font-size:11px;padding:15px 22px;border:2px solid #a855f7;border-radius:8px;background:rgba(168,85,247,.14);color:#fff;cursor:pointer;letter-spacing:.05em;text-shadow:0 0 6px rgba(255,255,255,.4);box-shadow:0 0 12px rgba(168,85,247,.4),inset 0 0 12px rgba(168,85,247,.2);transition:transform .08s,box-shadow .15s,background .15s}',
      '#anniv-root .anniv-btn:hover{background:rgba(168,85,247,.3);box-shadow:0 0 18px rgba(168,85,247,.7),inset 0 0 14px rgba(168,85,247,.35);transform:translateY(-1px)}',
      '#anniv-root .anniv-btn:active{transform:translateY(1px) scale(.98)}',
      '#anniv-root .anniv-btn.ghost{background:rgba(255,255,255,.05);border-color:rgba(255,255,255,.25);box-shadow:none;text-shadow:none}',
      '#anniv-root .anniv-foot{display:flex;justify-content:space-between;gap:12px;padding:16px 20px;border-top:1px solid rgba(168,85,247,.3);z-index:1}',
      '#anniv-root .anniv-crt{border:10px solid #1a0f2e;border-radius:14px;box-shadow:0 0 0 2px #a855f7,0 0 26px rgba(168,85,247,.5),inset 0 0 30px rgba(0,0,0,.7);background:#000;overflow:hidden;margin:0 auto 14px;max-width:640px}',
      '#anniv-root .anniv-crt iframe{display:block;width:100%;height:56vh;border:0;background:#000}',
      '#anniv-root .anniv-slide-label{font-size:16px;color:rgba(236,230,255,.65);text-align:center;margin-bottom:18px}',
      '#anniv-root .anniv-rule{display:flex;align-items:center;gap:14px;padding:12px 16px;background:rgba(168,85,247,.08);border:1px solid rgba(168,85,247,.25);border-radius:10px;margin-bottom:10px}',
      '#anniv-root .anniv-rule .trophy{font-family:"Press Start 2P",monospace;font-size:15px;color:#ffc14d;text-shadow:0 0 8px rgba(255,193,77,.6);flex-shrink:0}',
      '#anniv-root .anniv-rule .r-head{font-family:"Press Start 2P",monospace;font-size:9px;color:#ff4dd5;margin-bottom:3px}',
      '#anniv-root .anniv-rule .r-body{font-size:17px;color:rgba(236,230,255,.9);line-height:1.3}',
      '#anniv-root .anniv-rules-note{margin-top:16px;font-size:16px;color:rgba(236,230,255,.6);line-height:1.4}',
      '#anniv-root .quiz-counter{font-family:"Press Start 2P",monospace;font-size:10px;color:#ffc14d;margin-bottom:16px;letter-spacing:.08em}',
      '#anniv-root .quiz-q{font-size:22px;font-weight:400;margin:0 0 18px;line-height:1.4;color:#fff}',
      '#anniv-root .quiz-opts{display:flex;flex-direction:column;gap:10px}',
      '#anniv-root .quiz-opt{display:flex;align-items:center;gap:12px;padding:13px 15px;background:rgba(255,255,255,.04);border:1px solid rgba(168,85,247,.35);border-radius:10px;cursor:pointer;transition:background .15s,border-color .15s,box-shadow .15s;font-size:19px}',
      '#anniv-root .quiz-opt:hover{background:rgba(255,255,255,.08)}',
      '#anniv-root .quiz-opt.selected{border-color:#ffc14d;background:rgba(255,193,77,.12);box-shadow:0 0 12px rgba(255,193,77,.4)}',
      '#anniv-root .quiz-opt .letter{display:inline-flex;width:28px;height:28px;align-items:center;justify-content:center;border-radius:8px;background:rgba(168,85,247,.25);font-family:"Press Start 2P",monospace;font-size:12px;flex-shrink:0;color:#fff}',
      '#anniv-root .trap-msg{margin-top:14px;padding:12px 14px;border-radius:10px;background:rgba(251,191,36,.12);border:1px solid rgba(251,191,36,.4);color:#ffc14d;font-family:"Press Start 2P",monospace;font-size:10px;line-height:1.6}',
      '#anniv-root .anniv-score{font-family:"Press Start 2P",monospace;font-size:42px;color:#ffc14d;text-shadow:0 0 18px rgba(255,193,77,.85);text-align:center;margin:16px 0 6px}',
      '#anniv-root .anniv-score-label{font-size:19px;color:rgba(236,230,255,.7);text-align:center;margin-bottom:22px}',
      '#anniv-root .anniv-reward{text-align:center;padding:16px;border-radius:14px;background:rgba(168,85,247,.14);border:1px solid rgba(168,85,247,.4);font-size:20px;margin-bottom:8px;color:#fff;box-shadow:0 0 16px rgba(168,85,247,.3)}',
      '#anniv-root .anniv-clear{font-family:"Press Start 2P",monospace;font-size:26px;color:#4ade80;text-shadow:0 0 16px rgba(74,222,128,.7);text-align:center;margin-bottom:6px}'
    ].join('\n');
    document.head.appendChild(style);
    return root;
  }

  function el(html) {
    var d = document.createElement('div');
    d.innerHTML = html.trim();
    return d.firstElementChild;
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function stageLabel(text) {
    return el('<div class="anniv-stage-label">' + esc(text) + '</div>');
  }

  function setStage(node) {
    var stage = root.querySelector('.anniv-stage');
    stage.innerHTML = '';
    stage.appendChild(node);
    stage.scrollTop = 0;
  }

  function setFoot(buttons) {
    var foot = root.querySelector('.anniv-foot');
    foot.innerHTML = '';
    buttons.forEach(function (b) { foot.appendChild(b); });
  }

  function startMusic() {
    if (!MUSIC_URL || audio) return;
    try {
      audio = new Audio(MUSIC_URL);
      audio.loop = true;
      audio.volume = 0.5;
      var p = audio.play();
      if (p && p.catch) p.catch(function () {});
    } catch (_) {}
  }

  function stopMusic() {
    if (audio) { try { audio.pause(); } catch (_) {} audio = null; }
  }

  function close() {
    stopMusic();
    if (root) { root.remove(); root = null; }
  }

  function shell(title) {
    var top = el('<div class="anniv-top"><span class="anniv-brand">' + esc(title) + '</span><button class="anniv-close" title="Close">&times;</button></div>');
    top.querySelector('.anniv-close').onclick = close;
    var stage = el('<div class="anniv-stage"></div>');
    var foot = el('<div class="anniv-foot"></div>');
    root.innerHTML = '';
    root.appendChild(top);
    root.appendChild(stage);
    root.appendChild(foot);
  }

  /* ------------------------------------------------------------------ *
   * Steps
   * ------------------------------------------------------------------ */
  function renderSlideshow() {
    var slide = state.slide || 0;
    var v = OLD_VERSIONS[slide] || OLD_VERSIONS[0];

    var inner = el('<div class="anniv-inner"></div>');
    inner.appendChild(stageLabel('STAGE 1 — THE ARCHIVE'));
    inner.appendChild(el('<div class="anniv-title">FIRST<br>ANNIVERSARY</div>'));
    inner.appendChild(el('<div class="anniv-sub">A look back at where it all began.</div>'));
    inner.appendChild(el('<div class="anniv-crt"><iframe src="' + esc(v.url) + '" allowfullscreen loading="lazy"></iframe></div>'));
    inner.appendChild(el('<div class="anniv-slide-label">' + esc(v.label) + (OLD_VERSIONS.length > 1 ? ' · ' + (slide + 1) + ' / ' + OLD_VERSIONS.length : '') + '</div>'));
    setStage(inner);

    var nextLabel = (slide + 1 < OLD_VERSIONS.length) ? 'NEXT ▶' : 'PRESS START ▶';
    var btn = el('<button class="anniv-btn">' + nextLabel + '</button>');
    btn.onclick = function () {
      if (slide + 1 < OLD_VERSIONS.length) { state.slide = slide + 1; renderSlideshow(); }
      else renderRules();
    };
    setFoot([btn]);
    startMusic();
  }

  function renderRules() {
    var inner = el('<div class="anniv-inner"></div>');
    inner.appendChild(stageLabel('STAGE 2 — REWARDS'));
    inner.appendChild(el('<div class="anniv-title">HOW TO WIN</div>'));
    inner.appendChild(el('<div class="anniv-sub">Read the prize table — your reward depends on your score and how early you finish.</div>'));

    RULES.forEach(function (r) {
      var row = el('<div class="anniv-rule"><span class="trophy">★</span><span><div class="r-head">' + esc(r.head) + '</div><div class="r-body">' + esc(r.body) + '</div></span></div>');
      inner.appendChild(row);
    });
    inner.appendChild(el('<div class="anniv-rules-note">' + esc(RULES_NOTE) + '</div>'));
    setStage(inner);

    var btn = el('<button class="anniv-btn">START THE QUIZ ▶</button>');
    btn.onclick = function () { startQuiz(); };
    setFoot([btn]);
  }

  function startQuiz() {
    if (!ANNIV_PENDING && getDoneFlag()) { renderAlreadyDone(getDoneFlag()); return; }
    state.questions = buildQuiz();
    state.answers = new Array(state.questions.length).fill(null);
    state.qIndex = 0;
    state.trapped = false;
    renderQuiz();
  }

  function renderQuiz() {
    var i = state.qIndex;
    var q = state.questions[i];
    var total = state.questions.length;

    var inner = el('<div class="anniv-inner"></div>');
    inner.appendChild(stageLabel('STAGE 3 — THE QUIZ'));
    inner.appendChild(el('<div class="quiz-counter">QUESTION ' + (i + 1) + ' / ' + total + '</div>'));
    inner.appendChild(el('<div class="quiz-q">' + esc(q.q) + '</div>'));

    var opts = el('<div class="quiz-opts"></div>');
    var letters = ['A', 'B', 'C', 'D', 'E', 'F'];
    q.options.forEach(function (text, idx) {
      var o = el('<div class="quiz-opt"><span class="letter">' + letters[idx] + '</span><span>' + esc(text) + '</span></div>');
      o.onclick = function () {
        if (q.trap != null && text === q.trap) {
          state.trapped = true;
          var t = root.querySelector('.trap-msg');
          if (!t) { t = el('<div class="trap-msg">' + esc(TRAP_MESSAGE) + '</div>'); opts.parentNode.appendChild(t); }
          return;
        }
        state.trapped = false;
        state.answers[i] = text;
        var prev = opts.querySelector('.selected');
        if (prev) prev.classList.remove('selected');
        o.classList.add('selected');
      };
      opts.appendChild(o);
    });
    inner.appendChild(opts);
    setStage(inner);

    var back = el('<button class="anniv-btn ghost">◀ BACK</button>');
    back.onclick = function () {
      if (i === 0) { renderRules(); } else { state.qIndex = i - 1; state.trapped = false; renderQuiz(); }
    };

    var next = el('<button class="anniv-btn">' + (i + 1 === total ? 'FINISH ▶' : 'NEXT ▶') + '</button>');
    next.onclick = function () {
      if (state.trapped) return;
      if (state.answers[i] == null) {
        next.textContent = 'PICK ONE';
        setTimeout(function () { if (next.parentNode) next.textContent = (i + 1 === total ? 'FINISH ▶' : 'NEXT ▶'); }, 1400);
        return;
      }
      if (i + 1 < total) { state.qIndex = i + 1; state.trapped = false; renderQuiz(); }
      else finish();
    };
    setFoot([back, next]);
  }

  function finish() {
    renderLoading();
    submitAnswers();
  }

  function renderLoading() {
    var inner = el('<div class="anniv-inner"></div>');
    inner.appendChild(stageLabel('CALCULATING'));
    inner.appendChild(el('<div class="anniv-title">SCORING…</div>'));
    inner.appendChild(el('<div class="anniv-sub">Contacting the leaderboard…</div>'));
    setStage(inner);
    var done = el('<button class="anniv-btn">EXIT</button>');
    done.onclick = close;
    setFoot([done]);
  }

  function renderAlreadyDone(done) {
    var inner = el('<div class="anniv-inner"></div>');
    inner.appendChild(stageLabel('GAME CLEAR'));
    inner.appendChild(el('<div class="anniv-clear">YOU ALREADY PLAYED</div>'));
    inner.appendChild(el('<div class="anniv-score">' + done.score + ' / ' + QUIZ.length + '</div>'));
    inner.appendChild(el('<div class="anniv-score-label">correct answers</div>'));
    inner.appendChild(el('<div class="anniv-reward">' + esc(done.reward) + '</div>'));
    setStage(inner);
    var b = el('<button class="anniv-btn">EXIT</button>');
    b.onclick = close;
    setFoot([b]);
  }

  function renderResult(data) {
    var inner = el('<div class="anniv-inner"></div>');
    if (data.error === 'auth_required') {
      inner.appendChild(stageLabel('LOCKED'));
      inner.appendChild(el('<div class="anniv-title">SIGN IN TO CLAIM</div>'));
      inner.appendChild(el('<div class="anniv-sub">You need an account to earn an anniversary reward.</div>'));
    } else if (data.error === 'not_released') {
      inner.appendChild(stageLabel('SOON'));
      inner.appendChild(el('<div class="anniv-title">COMING SOON</div>'));
      inner.appendChild(el('<div class="anniv-sub">The anniversary game is not open yet.</div>'));
    } else if (data.error === 'not_configured') {
      inner.appendChild(stageLabel('SETUP'));
      inner.appendChild(el('<div class="anniv-title">NOT READY YET</div>'));
      inner.appendChild(el('<div class="anniv-sub">The quiz is still being set up.</div>'));
    } else if (data.error) {
      inner.appendChild(stageLabel('ERROR'));
      inner.appendChild(el('<div class="anniv-title">SOMETHING BROKE</div>'));
      inner.appendChild(el('<div class="anniv-sub">Please try again later.</div>'));
    } else {
      var already = data.result === 'already_submitted';
      inner.appendChild(stageLabel('GAME CLEAR'));
      inner.appendChild(el('<div class="anniv-clear">' + (already ? 'YOU ALREADY PLAYED' : 'CONGRATULATIONS!') + '</div>'));
      inner.appendChild(el('<div class="anniv-score">' + data.score + ' / ' + QUIZ.length + '</div>'));
      inner.appendChild(el('<div class="anniv-score-label">correct answers</div>'));
      var rewardText = data.reward;
      if (data.rank) rewardText += ' · YOU WERE #' + data.rank;
      if (data.mode === 'test') rewardText += ' · TEST MODE';
      inner.appendChild(el('<div class="anniv-reward">' + esc(rewardText) + '</div>'));
      if (!ANNIV_PENDING && !already) setDoneFlag({ score: data.score, reward: data.reward, rank: data.rank });
    }
    setStage(inner);
    var b = el('<button class="anniv-btn">EXIT</button>');
    b.onclick = close;
    setFoot([b]);
  }

  /* ------------------------------------------------------------------ *
   * Backend submission
   * ------------------------------------------------------------------ */
  function submitAnswers() {
    var answers = [];
    for (var i = 0; i < state.questions.length; i++) {
      answers.push({ q: state.questions[i].q, a: state.answers[i] });
    }
    var headers = { 'Content-Type': 'application/json' };
    var tok = getToken();
    if (tok) headers['Authorization'] = 'Bearer ' + tok;
    fetch(WORKER_URL + '/v1/anniversary-submit', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({ answers: answers })
    }).then(function (r) { return r.json().catch(function () { return { error: 'network' }; }); })
      .then(renderResult)
      .catch(function () { renderResult({ error: 'network' }); });
  }

  /* ------------------------------------------------------------------ *
   * Public API
   * ------------------------------------------------------------------ */
  window.JqrgAnniversary = {
    launch: function () {
      if (ANNIV_PENDING && !isOwner()) {
        ensureRoot();
        shell('FIRST ANNIVERSARY');
        var inner = el('<div class="anniv-inner"></div>');
        inner.appendChild(stageLabel('SOON'));
        inner.appendChild(el('<div class="anniv-title">COMING SOON</div>'));
        inner.appendChild(el('<div class="anniv-sub">The celebration opens on September 20 — check back then!</div>'));
        setStage(inner);
        var b = el('<button class="anniv-btn">GOT IT</button>');
        b.onclick = close;
        setFoot([b]);
        return;
      }
      ensureRoot();
      shell('FIRST ANNIVERSARY');
      state = { slide: 0, questions: null, answers: null, qIndex: 0, trapped: false };
      renderSlideshow();
    }
  };
})();
