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
    root = document.createElement('div');
    root.id = 'anniv-root';
    document.body.appendChild(root);

    var style = document.createElement('style');
    style.textContent = [
      '#anniv-root{position:fixed;inset:0;z-index:9999;background:rgba(8,5,16,.97);color:#e8e8f0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;display:flex;flex-direction:column;overflow:hidden}',
      '#anniv-root *{box-sizing:border-box}',
      '#anniv-root .anniv-top{display:flex;align-items:center;justify-content:space-between;padding:14px 20px;border-bottom:1px solid rgba(255,255,255,.08)}',
      '#anniv-root .anniv-brand{font-weight:700;letter-spacing:.04em}',
      '#anniv-root .anniv-close{background:none;border:0;color:rgba(255,255,255,.55);font-size:24px;cursor:pointer;line-height:1;padding:4px 8px;border-radius:8px}',
      '#anniv-root .anniv-close:hover{color:#fff;background:rgba(255,255,255,.08)}',
      '#anniv-root .anniv-stage{flex:1;overflow-y:auto;padding:28px 20px}',
      '#anniv-root .anniv-inner{max-width:760px;margin:0 auto}',
      '#anniv-root h1{font-size:26px;margin:0 0 6px}',
      '#anniv-root h2{font-size:20px;margin:0 0 12px}',
      '#anniv-root p.lead{opacity:.72;margin:0 0 18px;line-height:1.55}',
      '#anniv-root .anniv-btn{display:inline-flex;align-items:center;justify-content:center;padding:12px 22px;border:0;border-radius:12px;background:linear-gradient(135deg,#7c3aed,#a855f7);color:#fff;font-size:15px;font-weight:600;cursor:pointer;transition:filter .2s,transform .1s}',
      '#anniv-root .anniv-btn:hover{filter:brightness(1.12)}',
      '#anniv-root .anniv-btn:active{transform:scale(.97)}',
      '#anniv-root .anniv-btn.ghost{background:rgba(255,255,255,.08);color:#e8e8f0}',
      '#anniv-root .anniv-foot{display:flex;justify-content:space-between;gap:12px;padding:16px 20px;border-top:1px solid rgba(255,255,255,.08)}',
      '#anniv-root .rules-list{display:flex;flex-direction:column;gap:10px;margin:16px 0}',
      '#anniv-root .rule{display:flex;justify-content:space-between;gap:14px;padding:12px 14px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.09);border-radius:12px}',
      '#anniv-root .rule .r-head{font-weight:700;white-space:nowrap;color:#c4b5fd}',
      '#anniv-root .rule .r-body{text-align:right;opacity:.85}',
      '#anniv-root .rules-note{margin-top:14px;font-size:13px;opacity:.6;line-height:1.5}',
      '#anniv-root .quiz-counter{font-size:13px;opacity:.6;margin-bottom:14px}',
      '#anniv-root .quiz-q{font-size:19px;font-weight:600;margin:0 0 18px;line-height:1.45}',
      '#anniv-root .quiz-opts{display:flex;flex-direction:column;gap:10px}',
      '#anniv-root .quiz-opt{display:flex;align-items:center;gap:12px;padding:13px 15px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);border-radius:12px;cursor:pointer;transition:background .15s,border-color .15s;font-size:15px}',
      '#anniv-root .quiz-opt:hover{background:rgba(255,255,255,.09)}',
      '#anniv-root .quiz-opt.selected{border-color:#a855f7;background:rgba(168,85,247,.14)}',
      '#anniv-root .quiz-opt .letter{display:inline-flex;width:26px;height:26px;align-items:center;justify-content:center;border-radius:8px;background:rgba(255,255,255,.1);font-weight:700;font-size:13px;flex-shrink:0}',
      '#anniv-root .trap-msg{margin-top:14px;padding:12px 14px;border-radius:12px;background:rgba(251,191,36,.12);border:1px solid rgba(251,191,36,.35);color:#fbbf24;font-weight:600}',
      '#anniv-root .result-score{font-size:44px;font-weight:800;text-align:center;margin:14px 0 4px}',
      '#anniv-root .result-label{text-align:center;opacity:.7;margin-bottom:20px}',
      '#anniv-root .result-reward{text-align:center;padding:16px;border-radius:14px;background:rgba(168,85,247,.12);border:1px solid rgba(168,85,247,.3);font-size:17px;font-weight:600;margin-bottom:8px}',
      '#anniv-root .slide-frame{width:100%;height:62vh;border:1px solid rgba(255,255,255,.12);border-radius:14px;background:#000;margin-bottom:14px}',
      '#anniv-root .slide-label{font-size:13px;opacity:.7;margin-bottom:16px}'
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
    inner.appendChild(el('<h1>First Anniversary</h1>'));
    inner.appendChild(el('<p class="lead">A look back at where it all began.</p>'));
    inner.appendChild(el('<iframe class="slide-frame" src="' + esc(v.url) + '" allowfullscreen loading="lazy"></iframe>'));
    inner.appendChild(el('<div class="slide-label">' + esc(v.label) + (OLD_VERSIONS.length > 1 ? ' · ' + (slide + 1) + ' / ' + OLD_VERSIONS.length : '') + '</div>'));
    setStage(inner);

    var nextLabel = (slide + 1 < OLD_VERSIONS.length) ? 'Next →' : 'Continue';
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
    inner.appendChild(el('<h1>Rules of the rewards</h1>'));
    inner.appendChild(el('<p class="lead">Read carefully — your reward depends on how many you get right and how early you finish.</p>'));

    var list = el('<div class="rules-list"></div>');
    RULES.forEach(function (r) {
      list.appendChild(el('<div class="rule"><span class="r-head">' + esc(r.head) + '</span><span class="r-body">' + esc(r.body) + '</span></div>'));
    });
    inner.appendChild(list);
    inner.appendChild(el('<div class="rules-note">' + esc(RULES_NOTE) + '</div>'));
    setStage(inner);

    var btn = el('<button class="anniv-btn">I understand — start the quiz</button>');
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
    inner.appendChild(el('<div class="quiz-counter">Question ' + (i + 1) + ' of ' + total + '</div>'));
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

    var back = el('<button class="anniv-btn ghost">Back</button>');
    back.onclick = function () {
      if (i === 0) { renderRules(); } else { state.qIndex = i - 1; state.trapped = false; renderQuiz(); }
    };

    var next = el('<button class="anniv-btn">' + (i + 1 === total ? 'Finish' : 'Next') + '</button>');
    next.onclick = function () {
      if (state.trapped) return;
      if (state.answers[i] == null) {
        next.textContent = 'Pick an answer';
        setTimeout(function () { if (next.parentNode) next.textContent = (i + 1 === total ? 'Finish' : 'Next'); }, 1400);
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
    inner.appendChild(el('<h1 style="text-align:center">Finishing up…</h1>'));
    inner.appendChild(el('<div class="result-reward">Checking your result…</div>'));
    setStage(inner);
    var done = el('<button class="anniv-btn">Done</button>');
    done.onclick = close;
    setFoot([done]);
  }

  function renderAlreadyDone(done) {
    var inner = el('<div class="anniv-inner"></div>');
    inner.appendChild(el('<h1 style="text-align:center">You already participated</h1>'));
    inner.appendChild(el('<div class="result-score">' + done.score + ' / ' + QUIZ.length + '</div>'));
    inner.appendChild(el('<div class="result-label">correct answers</div>'));
    inner.appendChild(el('<div class="result-reward">Your reward: ' + esc(done.reward) + '</div>'));
    setStage(inner);
    var b = el('<button class="anniv-btn">Done</button>');
    b.onclick = close;
    setFoot([b]);
  }

  function renderResult(data) {
    var inner = el('<div class="anniv-inner"></div>');
    if (data.error === 'auth_required') {
      inner.appendChild(el('<h1 style="text-align:center">Sign in to claim your reward</h1>'));
      inner.appendChild(el('<p class="lead" style="text-align:center">You need an account to earn an anniversary reward.</p>'));
    } else if (data.error === 'not_released') {
      inner.appendChild(el('<h1 style="text-align:center">Coming soon</h1>'));
      inner.appendChild(el('<p class="lead" style="text-align:center">The anniversary game is not open yet.</p>'));
    } else if (data.error === 'not_configured') {
      inner.appendChild(el('<h1 style="text-align:center">Not ready yet</h1>'));
      inner.appendChild(el('<p class="lead" style="text-align:center">The quiz is still being set up.</p>'));
    } else if (data.error) {
      inner.appendChild(el('<h1 style="text-align:center">Something went wrong</h1>'));
      inner.appendChild(el('<p class="lead" style="text-align:center">Please try again later.</p>'));
    } else {
      var already = data.result === 'already_submitted';
      inner.appendChild(el('<h1 style="text-align:center">' + (already ? 'You already participated' : 'You finished!') + '</h1>'));
      inner.appendChild(el('<div class="result-score">' + data.score + ' / ' + QUIZ.length + '</div>'));
      inner.appendChild(el('<div class="result-label">correct answers</div>'));
      var rewardText = 'Your reward: ' + data.reward;
      if (data.rank) rewardText += ' — you were #' + data.rank + ' to finish';
      if (data.mode === 'test') rewardText += ' (test mode)';
      inner.appendChild(el('<div class="result-reward">' + esc(rewardText) + '</div>'));
      if (!ANNIV_PENDING && !already) setDoneFlag({ score: data.score, reward: data.reward, rank: data.rank });
    }
    setStage(inner);
    var b = el('<button class="anniv-btn">Done</button>');
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
        inner.appendChild(el('<h1>First Anniversary</h1>'));
        inner.appendChild(el('<p class="lead">The celebration is coming soon — check back on September 20!</p>'));
        setStage(inner);
        var b = el('<button class="anniv-btn">Got it</button>');
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
