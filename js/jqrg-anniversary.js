/* jqrg-anniversary.js — First Anniversary experience
 * Cinematic fullscreen "archive trailer" -> Rules -> Quiz -> Results.
 * Self-contained; exposes window.JqrgAnniversary.launch().
 *
 * Anti-cheat: the correct answers are NOT in this file. The client only sends
 * the user's answers to the jchat server, which scores them server-side and
 * returns only the total score + reward (never which answers were right/wrong).
 */
(function () {
  'use strict';
  if (window.JqrgAnniversary) return;

  /* Pending gate. Flip to false on release day (keep in sync with the
   * server's ANNIVERSARY_RELEASED flag). While pending, only jimmyqrg can
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
      o: ["1", "2", "3", "99999999999 (Hmm......)"] },
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
    { head: "First 20", body: "score 8 → 1-year Premium" },
    { head: "First 50", body: "score 6–7 → 4-month Premium" },
    { head: "First 100", body: "exactly 5 correct → 2-month Premium" },
    { head: "Everyone else", body: "1-month Premium" }
  ];
  var RULES_NOTE = "Rewards stack — buying something never overwrites a reward you already earned. When a Plus lapses, the rest of your other reward keeps running.";

  /* ------------------------------------------------------------------ *
   * Content: old site versions + music
   * ------------------------------------------------------------------ */
  // Old versions of the site, shown as iframed pages, oldest -> newest.
  var OLD_VERSIONS = [
    { label: "V0.0 — Home", url: "/anniversary/versions/v0.0-home.html" },
    { label: "V0.0 — Games", url: "/anniversary/versions/v0.0-games.html" },
    { label: "V0.1 — Home", url: "/anniversary/versions/v0.1-home.html" },
    { label: "V0.1 — Games", url: "/anniversary/versions/v0.1-games.html" }
  ];
  var MUSIC_URL = '/music/comfort-chain.mp3';
  // comfort-chain.mp3 opens with ~2.15 s of digital silence. The track starts on
  // its first audible frame so the music arrives with the intro text rather
  // than a beat after it.
  var MUSIC_SKIP_MS = 2150;
  // If the soundtrack stops advancing (blocked autoplay, stalled stream), the
  // show falls back to the wall clock instead of waiting on it forever.
  var AUDIO_STALL_MS = 2000;

  // Music BPM (comfort-chain.mp3 = 110). The archive is cut on the beat.
  var MUSIC_BPM = 110;
  var BEAT_MS = 60000 / MUSIC_BPM;              // 545.45 ms

  /* Cinematic timings (all in ms of "game time") */
  var LAG_MS = 5000;                            // minimum glitch before the game
  // The lag doubles as the loading gate: it holds (at most this long) until the
  // soundtrack and the four archived pages are actually ready, so the archive can
  // never play over a half-loaded page and miss its beats.
  var LAG_MAX_MS = 14000;
  var PRE_BLACK_MS = 1000;                      // hard blackout before music
  var TEXT_MS = 19600;                          // "let's see where it all began" is on screen 19.6 s
  var MAIN_START_MS = TEXT_MS;                  // archive starts the instant the text is gone (≈ beat 36)
  var PAGE_BEATS = 8;                           // 7 on-screen + blackout beat
  var ARCHIVE_MS = OLD_VERSIONS.length * PAGE_BEATS * BEAT_MS;  // 32 beats
  var MAX_AUDIO_WAIT_MS = 6000;                 // hold the blackout for the music
  // Text phases are fractions of TEXT_MS: the same appear -> bloom up -> bloom
  // down -> fade shape as before, so changing TEXT_MS is the only edit needed.
  var TEXT_APPEAR_MS = TEXT_MS * 0.2426;        // "slowly appear": opacity 0 -> 1
  var BLOOM_UP_MS = TEXT_MS * 0.5391;           // bloom 0 -> 1
  var BLOOM_DOWN_MS = TEXT_MS * 0.8086;         // bloom 1 -> 0, then fade out

  var WORKER_URL = (function () {
    try {
      var m = document.querySelector && document.querySelector('meta[name="jqrg-aichat-worker"]');
      if (m && m.content) return m.content.replace(/\/+$/, '');
    } catch (_) {}
    return 'https://deepseek-proxy.ikunbeautiful.workers.dev';
  })();

  // Anniversary quiz backend lives on the jchat server (not the Worker).
  var ANNIV_URL = 'https://discord.jimmyqrg.com/api/anniversary/submit';

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

  function rnd(a, b) { return a + Math.random() * (b - a); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  /* ------------------------------------------------------------------ *
   * DOM / render
   * ------------------------------------------------------------------ */
  var root = null;
  var audio = null;
  var state = null;
  var cine = null;      // archive-trailer clock
  var lagCine = null;   // glitch clock
  var actx = null;      // WebAudio context for lag sounds
  var fsBound = false;
  var audioFailed = false;  // the track never loaded / cannot be decoded

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
      '#anniv-root .anniv-foot{display:flex;justify-content:flex-end;gap:12px;padding:16px 20px;border-top:1px solid rgba(168,85,247,.3);z-index:1}',
      /* Post-trailer (rules + questions) drops the leftover trailer dressing. */
      '#anniv-root.clean{background-image:none}',
      '#anniv-root.clean::before,#anniv-root.clean::after{display:none}',
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
      '#anniv-root .anniv-clear{font-family:"Press Start 2P",monospace;font-size:26px;color:#4ade80;text-shadow:0 0 16px rgba(74,222,128,.7);text-align:center;margin-bottom:6px}',

      /* ---- cinematic trailer ------------------------------------------ */
      '#anniv-root.cine-on .anniv-top,#anniv-root.cine-on .anniv-stage,#anniv-root.cine-on .anniv-foot{display:none}',
      '#anniv-root .anniv-filtersvg{position:absolute;width:0;height:0;overflow:hidden}',
      '#anniv-root .anniv-cine{position:absolute;inset:0;z-index:50;background:#000;overflow:hidden}',
      /* old-clip grade over the archived pages */
      '#anniv-root .cine-pages{position:absolute;inset:0;opacity:0;visibility:hidden;filter:saturate(.68) contrast(1.07) brightness(.94) sepia(.14);transition:filter .08s linear}',
      '#anniv-root .cine-pages.on{opacity:1;visibility:visible}',
      '#anniv-root .cine-pages.beat{filter:saturate(.85) contrast(1.18) brightness(1.14) sepia(.06)}',
      '#anniv-root .cine-page{position:absolute;inset:0;opacity:0;transition:opacity .04s linear}',
      '#anniv-root .cine-page.on{opacity:1}',
      '#anniv-root .cine-page iframe{display:block;width:100%;height:100%;border:0;background:#fff}',
      /* VHS / old-tape overlay */
      '#anniv-root .cine-vhs{position:absolute;inset:0;opacity:0;visibility:hidden;pointer-events:none;z-index:6}',
      '#anniv-root .cine-vhs.on{opacity:1;visibility:visible}',
      '#anniv-root .vhs-scan{position:absolute;inset:0;background:repeating-linear-gradient(0deg,rgba(0,0,0,.42) 0 1px,transparent 1px 3px);opacity:.6}',
      '#anniv-root .vhs-roll{position:absolute;left:0;right:0;height:13%;background:linear-gradient(180deg,transparent,rgba(255,255,255,.13),transparent);animation:vhsRoll 6.5s linear infinite}',
      '#anniv-root .vhs-noise{position:absolute;inset:-40%;background-image:repeating-conic-gradient(from 0deg,rgba(255,255,255,.07) 0deg 1deg,transparent 1deg 2.4deg);animation:vhsNoise .26s steps(3) infinite;opacity:.45}',
      '#anniv-root .vhs-tint{position:absolute;inset:0;background:linear-gradient(180deg,rgba(255,214,150,.14),rgba(110,170,255,.14));mix-blend-mode:overlay}',
      '#anniv-root .vhs-hud{position:absolute;top:20px;left:26px;display:flex;gap:18px;align-items:center;font-family:"VT323",monospace;font-size:24px;color:#fff;text-shadow:0 0 10px rgba(255,255,255,.8),0 0 2px rgba(0,0,0,.9);letter-spacing:.09em}',
      '#anniv-root .vhs-rec{color:#ff3b3b;animation:vhsBlink 1.15s steps(2) infinite}',
      /* the warp layer (glitch) + intro text */
      '#anniv-root .cine-warp{position:absolute;inset:0;z-index:4;transform-origin:center center}',
      /* Pre-roll: the lag plays on the page itself, so the overlay goes
         see-through and the glitch is applied to the real site underneath. */
      '#anniv-root.cine-site{background-color:transparent;background-image:none}',
      '#anniv-root.cine-site .anniv-cine{background:transparent}',
      '#anniv-root .cine-text{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;padding:0 8vw;font-family:"VT323",monospace;font-size:min(7.4vw,70px);line-height:1.25;color:#fff;letter-spacing:.03em;opacity:0;filter:blur(calc(var(--bloom,0) * 2.4px)) brightness(calc(1 + var(--bloom,0) * .55)) drop-shadow(0 0 calc(var(--bloom,0) * 18px) rgba(178,107,255,.95))}',
      '#anniv-root .cine-text.hide{display:none}',
      '#anniv-root .cine-tear{position:absolute;left:0;right:0;z-index:5;pointer-events:none}',
      '#anniv-root .cine-roll{position:absolute;left:0;right:0;top:-20%;height:18%;z-index:5;pointer-events:none;background:linear-gradient(180deg,transparent,rgba(170,225,255,.18),transparent);animation:cineRoll .85s linear infinite}',
      '#anniv-root .cine-static{position:absolute;inset:0;background-image:repeating-linear-gradient(0deg,rgba(255,255,255,.055) 0 2px,transparent 2px 5px),repeating-linear-gradient(90deg,rgba(255,255,255,.04) 0 3px,transparent 3px 7px);animation:cineStatic .18s steps(2) infinite;opacity:.55}',
      '#anniv-root .cine-black{position:absolute;inset:0;z-index:9;background:#000;opacity:0;pointer-events:none;transition:opacity .06s linear}',
      '#anniv-root .cine-black.on{opacity:1}',
      '#anniv-root .cine-wait{position:absolute;left:0;right:0;bottom:13vh;text-align:center;z-index:11;pointer-events:none;font-family:"VT323",monospace;font-size:min(3.2vw,22px);letter-spacing:.26em;color:#9fe4ff;opacity:0;transition:opacity .4s ease;text-shadow:0 0 12px rgba(120,200,255,.8)}',
      '#anniv-root .cine-wait.on{opacity:.75}',
      /* pause overlay */
      '#anniv-root .anniv-pause{position:absolute;inset:0;z-index:99999;display:none;align-items:center;justify-content:center;background:rgba(4,2,10,.72);-webkit-backdrop-filter:blur(14px) saturate(.75);backdrop-filter:blur(14px) saturate(.75)}',
      '#anniv-root .anniv-pause.on{display:flex}',
      '#anniv-root .pause-card{text-align:center;padding:36px 44px;border:2px solid rgba(168,85,247,.55);border-radius:18px;background:rgba(12,4,24,.9);box-shadow:0 0 46px rgba(168,85,247,.45)}',
      '#anniv-root .pause-title{font-family:"Press Start 2P",monospace;font-size:20px;color:#fff;text-shadow:0 0 16px rgba(178,107,255,.95);margin-bottom:10px}',
      '#anniv-root .pause-sub{font-size:20px;color:rgba(236,230,255,.75);margin-bottom:24px}',
      '#anniv-root .pause-actions{display:flex;gap:14px;justify-content:center;flex-wrap:wrap}',
      /* fullscreen prompt */
      '#anniv-root .anniv-fs-prompt{position:absolute;inset:0;z-index:100000;display:none;align-items:center;justify-content:center;background:rgba(4,2,10,.88);-webkit-backdrop-filter:blur(7px);backdrop-filter:blur(7px);padding:20px}',
      '#anniv-root .anniv-fs-prompt.on{display:flex}',
      '#anniv-root .fs-card{max-width:560px;width:100%;text-align:center;padding:38px 36px;border:2px solid rgba(255,193,77,.45);border-radius:20px;background:radial-gradient(120% 90% at 50% 0%,#2a1140 0%,#14071f 55%,#0a0312 100%);box-shadow:0 0 44px rgba(255,77,184,.35)}',
      '#anniv-root .fs-title{font-family:"Press Start 2P",monospace;font-size:16px;line-height:1.6;color:#fff;text-shadow:0 0 16px rgba(255,193,77,.85),0 0 32px rgba(255,77,184,.4);margin:0 0 20px}',
      '#anniv-root .fs-body{font-size:21px;line-height:1.45;color:rgba(236,230,255,.88);margin:0 0 12px}',
      '#anniv-root .fs-body b{color:#ffc14d;font-weight:400}',
      '#anniv-root .fs-actions{display:flex;gap:16px;justify-content:center;margin-top:26px;flex-wrap:wrap}',
      '@keyframes vhsRoll{0%{top:-15%}100%{top:105%}}',
      '@keyframes vhsNoise{0%{transform:translate(0,0)}50%{transform:translate(-3%,2%)}100%{transform:translate(2%,-2%)}}',
      '@keyframes vhsBlink{0%,49%{opacity:1}50%,100%{opacity:.12}}',
      '@keyframes cineStatic{0%{transform:translate(0,0)}50%{transform:translate(-2px,1px)}100%{transform:translate(1px,-2px)}}',
      '@keyframes cineRoll{0%{top:-20%}100%{top:110%}}'
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
   * Fullscreen plumbing
   * ------------------------------------------------------------------ */
  function fsElement() {
    return document.fullscreenElement || document.webkitFullscreenElement ||
           document.mozFullScreenElement || document.msFullscreenElement || null;
  }

  function requestFs() {
    if (!root) return Promise.resolve(false);
    var fn = root.requestFullscreen || root.webkitRequestFullscreen ||
             root.mozRequestFullScreen || root.msRequestFullscreen;
    if (!fn) return Promise.resolve(false);
    try {
      var p = fn.call(root);
      if (p && typeof p.then === 'function') {
        return p.then(function () { return true; }, function () { return false; });
      }
      return Promise.resolve(true);
    } catch (_) { return Promise.resolve(false); }
  }

  function exitFs() {
    try {
      var fn = document.exitFullscreen || document.webkitExitFullscreen ||
               document.mozCancelFullScreen || document.msExitFullscreen;
      if (fn && fsElement()) fn.call(document);
    } catch (_) {}
  }

  function bindFsChange() {
    if (fsBound) return;
    fsBound = true;
    var handler = function () {
      if (!state || !state.started || state.closing) return;
      var inFs = !!fsElement();
      var showRunning = (cine && cine.running) || (lagCine && lagCine.running);
      if (!inFs && state.fsWas && showRunning) pauseExperience();
      state.fsWas = inFs;
    };
    document.addEventListener('fullscreenchange', handler);
    document.addEventListener('webkitfullscreenchange', handler);
  }

  /* ------------------------------------------------------------------ *
   * Audio: music + lag glitch sounds
   * ------------------------------------------------------------------ */
  function ensureAudio() {
    if (audio) return audio;
    try {
      audio = new Audio(MUSIC_URL);
      audio.loop = true;
      audio.preload = 'auto';
      audio.volume = 0;
      audio.muted = true;   // the pre-roll is a buffer warm-up, never audible
      try { audio.load(); } catch (_) {}
      audio.addEventListener('error', function () { audioFailed = true; });
    } catch (_) { audio = null; }
    return audio;
  }

  // Fetch the archived pages while the prompt is on screen: they are what the
  // trailer shows, and on a slow link every second of head start counts.
  function warmArchive() {
    try {
      for (var i = 0; i < OLD_VERSIONS.length; i++) {
        var l = document.createElement('link');
        l.rel = 'prefetch'; l.href = OLD_VERSIONS[i].url;
        document.head.appendChild(l);
      }
    } catch (_) {}
  }

  // Start fetching the track the moment the prompt appears (and warm a second
  // copy through a preload hint), so the blackout rarely has to wait at all.
  function warmAudio() {
    try {
      var l = document.createElement('link');
      l.rel = 'preload'; l.as = 'audio'; l.type = 'audio/mpeg'; l.href = MUSIC_URL;
      document.head.appendChild(l);
    } catch (_) {}
    ensureAudio();
  }

  function ensureCtx() {
    if (actx) return actx;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (AC) actx = new AC();
    } catch (_) { actx = null; }
    if (actx && actx.state === 'suspended' && actx.resume) { try { actx.resume(); } catch (_) {} }
    return actx;
  }

  // Sample-and-hold noise burst -> bit-crushed digital crunch.
  function lagNoise(dur, gain, freq) {
    var ctx = actx; if (!ctx) return;
    var n = Math.max(1, Math.floor(ctx.sampleRate * dur));
    var buf = ctx.createBuffer(1, n, ctx.sampleRate);
    var d = buf.getChannelData(0);
    var hold = 0;
    for (var i = 0; i < n; i++) {
      if (i % 24 === 0) hold = Math.random() * 2 - 1;
      d[i] = hold;
    }
    var src = ctx.createBufferSource(); src.buffer = buf;
    var bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = 0.9 + Math.random() * 3.4;
    var g = ctx.createGain();
    var t = ctx.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp); bp.connect(g); g.connect(ctx.destination);
    try { src.start(t); src.stop(t + dur + 0.02); } catch (_) {}
  }

  // Stuttering square/saw tone -> "buffering" grind.
  function lagTone() {
    var ctx = actx; if (!ctx) return;
    var t = ctx.currentTime;
    var o = ctx.createOscillator();
    o.type = Math.random() < 0.55 ? 'square' : 'sawtooth';
    var steps = 3 + Math.floor(Math.random() * 6);
    o.frequency.setValueAtTime(40 + Math.random() * 700, t);
    for (var i = 1; i < steps; i++) {
      o.frequency.setValueAtTime(40 + Math.random() * 980, t + i * 0.021);
    }
    var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2200 + Math.random() * 1800;
    var g = ctx.createGain();
    var dur = 0.09 + Math.random() * 0.11;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.055, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(lp); lp.connect(g); g.connect(ctx.destination);
    try { o.start(t); o.stop(t + dur + 0.02); } catch (_) {}
  }

  function lagSound() {
    if (Math.random() < 0.62) lagNoise(0.04 + Math.random() * 0.13, 0.07 + Math.random() * 0.10, 300 + Math.random() * 2600);
    else lagTone();
  }

  function closeAudio() {
    if (actx) { try { actx.close(); } catch (_) {} actx = null; }
  }

  function stopMusic() {
    if (audio) { try { audio.pause(); } catch (_) {} audio = null; }
  }

  /* ------------------------------------------------------------------ *
   * Pausable clock
   * ------------------------------------------------------------------ */
  function Cine(duration) {
    this.duration = duration;
    this.t = 0;
    this.running = false;
    this.paused = false;
    this._last = 0;
    this._raf = null;
    this.onTick = null;
    this.onDone = null;
  }
  Cine.prototype.start = function () {
    if (this.running) return;
    this.running = true;
    this.paused = false;
    this._last = performance.now();
    var self = this;
    function loop() {
      if (!self.running) return;
      self._raf = requestAnimationFrame(loop);
      var now = performance.now();
      var dt = now - self._last;
      self._last = now;
      if (self.paused) return;
      self.t += dt;
      if (self.onTick) self.onTick(self.t);
      if (self.t >= self.duration) { self.stop(); if (self.onDone) self.onDone(); }
    }
    this._raf = requestAnimationFrame(loop);
  };
  Cine.prototype.pause = function () { this.paused = true; };
  Cine.prototype.resume = function () {
    if (!this.running) return;
    this.paused = false;
    this._last = performance.now();
  };
  Cine.prototype.stop = function () {
    this.running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
  };

  /* ------------------------------------------------------------------ *
   * Cinematic: prompt -> lag -> blackout -> intro -> archive
   * ------------------------------------------------------------------ */
  function showFsPrompt() {
    if (!root.querySelector('.anniv-fs-prompt')) {
      root.insertAdjacentHTML('beforeend',
        '<div class="anniv-fs-prompt">' +
          '<div class="fs-card">' +
            '<div class="fs-title">FIRST ANNIVERSARY</div>' +
            '<p class="fs-body">It is recommended to play this <b>at home</b>.</p>' +
            '<p class="fs-body">This game requires <b>fullscreen</b>.</p>' +
            '<div class="fs-actions">' +
              '<button class="anniv-btn fs-go">Play</button>' +
              '<button class="anniv-btn ghost fs-no">Cancel</button>' +
            '</div>' +
          '</div>' +
        '</div>');
    }
    var prompt = root.querySelector('.anniv-fs-prompt');
    prompt.classList.add('on');
    root.querySelector('.fs-go').onclick = startExperience;
    root.querySelector('.fs-no').onclick = close;
  }

  function removeFsPrompt() {
    var p = root && root.querySelector('.anniv-fs-prompt');
    if (p) p.remove();
  }

  function buildCine() {
    if (root.querySelector('.anniv-cine')) return;
    var pages = OLD_VERSIONS.map(function (v, i) {
      return '<div class="cine-page" data-i="' + i + '"><iframe src="' + esc(v.url) +
             '" loading="eager" allowfullscreen scrolling="no"></iframe></div>';
    }).join('');
    root.insertAdjacentHTML('beforeend',
      '<div class="anniv-cine">' +
        '<svg class="anniv-filtersvg" width="0" height="0" aria-hidden="true"><defs>' +
          '<filter id="anniv-warp" x="-25%" y="-25%" width="150%" height="150%">' +
            '<feTurbulence id="anniv-warp-turb" type="fractalNoise" baseFrequency="0.0008 0.02" numOctaves="1" seed="7" result="n"/>' +
            '<feDisplacementMap id="anniv-warp-disp" in="SourceGraphic" in2="n" scale="6" xChannelSelector="R" yChannelSelector="G"/>' +
          '</filter>' +
        '</defs></svg>' +
        '<div class="cine-pages">' + pages + '</div>' +
        '<div class="cine-vhs">' +
          '<div class="vhs-noise"></div>' +
          '<div class="vhs-tint"></div>' +
          '<div class="vhs-roll"></div>' +
          '<div class="vhs-scan"></div>' +
          '<div class="vhs-hud"><span class="vhs-rec">&#9679; REC</span><span class="vhs-time">00:00:00</span></div>' +
        '</div>' +
        '<div class="cine-warp">' +
          '<div class="cine-static"></div>' +
          '<div class="cine-roll"></div>' +
          '<div class="cine-text hide">let\u2019s see where it all began</div>' +
        '</div>' +
        '<div class="cine-black on"></div>' +
        '<div class="cine-wait">BUFFERING&hellip;</div>' +
      '</div>');

    // Every archived page is part of the show, so the pre-roll waits for each
    // one to be in the document. A page that fails still counts, so a broken URL
    // can never stall the trailer.
    var frames = root.querySelectorAll('.cine-page iframe');
    for (var i = 0; i < frames.length; i++) {
      var idx = parseInt(frames[i].parentNode.getAttribute('data-i'), 10);
      if (isNaN(idx)) idx = i;
      frames[i].addEventListener('load', markPageReady(idx), { once: true });
      frames[i].addEventListener('error', markPageReady(idx), { once: true });
    }
  }

  function markPageReady(idx) {
    return function () {
      if (!state || state.pagesReady[idx]) return;
      state.pagesReady[idx] = true;
      state.pagesLoaded++;
    };
  }

  // The pre-roll hands over to the music only when the show's assets are here.
  function preRollReady() {
    if (!state) return true;
    var pages = state.pagesLoaded >= OLD_VERSIONS.length;
    var music = !!audioFailed || !!(audio && audio.readyState >= 3);
    return pages && music;
  }

  // Reveal the intro text: the blackout lifts on the very frame the soundtrack
  // becomes audible, so the music and the words arrive together.
  function beginIntro() {
    setBlack(false);
    hideWait();
    var txt = root && root.querySelector('.cine-text');
    if (txt) txt.classList.remove('hide');
  }

  function startExperience() {
    if (!state) return;
    removeFsPrompt();
    state.started = true;
    state.fsWas = !!fsElement();
    root.classList.add('cine-on');

    // Unlock audio inside the click gesture (silent until the game starts).
    ensureCtx();
    ensureAudio();
    if (audio) {
      audio.volume = 0;
      audio.muted = true;
      try { var pr = audio.play(); if (pr && pr.catch) pr.catch(function () {}); } catch (_) {}
    }

    bindFsChange();
    buildCine();
    // The lag plays on the page itself: the overlay goes see-through so the
    // website the visitor is already on is what appears to break.
    root.classList.add('cine-site');
    requestFs().then(function () { runLag(); });
  }

  // The glitch, applied to the real page: the site warps, tears and colour-shifts
  // while its own assets finish loading behind it. The cheap filter chain runs
  // every frame; the SVG displacement (which re-rasterises the whole page) only
  // in short bursts, so the pre-roll cannot starve the media pipeline.
  function glitchSite(t) {
    var site = document.getElementById('app');
    if (!site) return;
    var turb = document.getElementById('anniv-warp-turb');
    var disp = document.getElementById('anniv-warp-disp');
    var burst = (t % 900) < 260;
    if (burst) {
      if (disp) disp.setAttribute('scale', (8 + Math.random() * 46).toFixed(2));
      if (turb) {
        turb.setAttribute('baseFrequency',
          (0.001 + Math.random() * 0.05).toFixed(5) + ' ' + (0.01 + Math.random() * 0.09).toFixed(4));
      }
    }
    var inv = Math.random() < 0.035 ? ' invert(1)' : '';
    site.style.filter = (burst ? 'url(#anniv-warp) ' : '') + 'hue-rotate(' + rnd(-60, 60).toFixed(0) +
      'deg) saturate(' + rnd(1, 3.4).toFixed(2) + ') contrast(' + rnd(1.1, 2).toFixed(2) + ')' + inv;
    site.style.transform = 'translate(' + rnd(-18, 18).toFixed(1) + 'px,' + rnd(-14, 14).toFixed(1) +
      'px) skewX(' + rnd(-6, 6).toFixed(2) + 'deg) scale(' + (1 + rnd(-0.05, 0.05)).toFixed(3) + ')';
  }

  function unglitchSite() {
    var site = document.getElementById('app');
    if (site) { site.style.filter = ''; site.style.transform = ''; }
    if (root) root.classList.remove('cine-site');
  }

  function runLag() {
    if (!root) return;
    root.classList.add('cine-on');
    setBlack(false);
    var cineEl = root.querySelector('.anniv-cine');

    var tearTimer = setInterval(function () {
      if (!root || !lagCine || !lagCine.running) return;
      for (var i = 0; i < 2; i++) if (Math.random() < 0.6) spawnTear(cineEl);
    }, 130);

    lagCine = new Cine(LAG_MS);
    lagCine.onTick = function (t) {
      // There is no loading bar: the lag IS the loading screen. It holds until
      // the soundtrack and the archived pages are actually here, and gives up
      // after LAG_MAX_MS so a broken asset can never trap the visitor.
      if (!preRollReady() && t < LAG_MAX_MS) {
        if (t >= lagCine.duration) lagCine.duration = t + 400;
        if (t > 3000) showWaitText('LOADING\u2026');
      }
      glitchSite(t);
      if (actx && t - state.lastGlitch > 55 + Math.random() * 140) { state.lastGlitch = t; lagSound(); }
    };
    lagCine.onDone = function () {
      clearInterval(tearTimer);
      hideWait();
      unglitchSite();
      var te = cineEl ? cineEl.querySelectorAll('.cine-tear') : [];
      for (var i = 0; i < te.length; i++) te[i].remove();
      setBlack(true);
      startGame();
    };
    lagCine.start();
  }

  function spawnTear(cineEl) {
    if (!cineEl) return;
    var d = document.createElement('div');
    d.className = 'cine-tear';
    d.style.top = rnd(1, 95).toFixed(1) + '%';
    d.style.height = rnd(1, 9).toFixed(1) + '%';
    var r = Math.random();
    if (r < 0.42) { d.style.background = 'rgba(255,255,255,.30)'; d.style.mixBlendMode = 'screen'; }
    else if (r < 0.68) { d.style.background = 'rgba(125,235,255,.30)'; d.style.mixBlendMode = 'screen'; }
    else if (r < 0.86) { d.style.background = 'rgba(255,80,170,.26)'; d.style.mixBlendMode = 'screen'; }
    else { d.style.background = 'rgba(0,0,0,.85)'; }
    d.style.transform = 'translateX(' + rnd(-16, 16).toFixed(1) + '%)';
    cineEl.appendChild(d);
    setTimeout(function () { if (d.parentNode) d.remove(); }, 80);
  }

  function setBlack(on) {
    var b = root && root.querySelector('.cine-black');
    if (b) b.classList.toggle('on', !!on);
  }

  function startGame() {
    // The music itself is the clock (see gameTime), so this cine is only a
    // pausable ticker; the end of the archive is detected inside tickGame.
    cine = new Cine(Infinity);
    cine.onTick = tickGame;
    cine.start();
  }

  function tickGame(t) {
    if (!state || state.finished) return;
    if (!state.gameStarted) {
      if (t < PRE_BLACK_MS) return;      // hard blackout first
      if (!armGameAudio(t)) { showWait(t); return; }  // then wait for the first real sample
    }
    var g = gameTime(t);
    if (g < 0) return;
    if (g >= MAIN_START_MS + ARCHIVE_MS) { endCine(); return; }    if (!state.archStarted && g >= MAIN_START_MS) {
      state.archStarted = true;
      onArchiveStart();
    }
    if (state.archStarted) updateArchive(g - MAIN_START_MS, g);
    else updateIntro(g);
  }

  /* The soundtrack IS the clock: game time is read straight off the audio
   * element, so a slow load can never leave the visuals running ahead of the
   * music. The blackout simply holds until the first sample actually plays.
   *
   * The music has to be audible in the same frame as the intro text, so the
   * pre-roll is parked on the track's first audible frame while it is still
   * muted — raising the volume any earlier plays the tail of the warm-up. */
  function armGameAudio(t) {
    var startS = MUSIC_SKIP_MS / 1000;
    if (!state.audioArmed) {
      state.audioArmed = true;
      state.audioArmedAt = t;
      if (!audio || audioFailed) { state.audioSilent = true; return false; }
      // Rewind to the first audible frame while still muted (the pre-roll has
      // been playing silently, so the element is buffered, decoded and already
      // allowed to autoplay). Seek while it is playing — a paused element cannot
      // land the seek.
      try { audio.currentTime = startS; } catch (_) {}
      return false;
    }
    // The track is unusable: run the rest silently on the wall clock (the cine
    // still freezes with us), and measure from the real start, not the blackout.
    if (state.audioSilent || audioFailed) { return giveUpOnAudio(t); }
    var at = audioTime();
    if (!state.audioSeeked) {
      // Anything that is not the seek target is still the pre-roll position.
      if (Math.abs(at - startS) > 0.25) {
        if (t - state.audioArmedAt > MAX_AUDIO_WAIT_MS) { return giveUpOnAudio(t); }
        return false;
      }
      state.audioSeeked = true;
      state.audioT0 = startS;
      state.gameT0 = t;
      state.lastAudioAt = at;
      state.lastAudioAdvance = t;
      state.gameStarted = true;
      if (audio) {
        audio.muted = false;
        audio.volume = 0.55;
        try { var p = audio.play(); if (p && p.catch) p.catch(function () {}); } catch (_) {}
      }
      beginIntro();
    }
    return true;
  }

  function giveUpOnAudio(t) {
    state.audioSilent = true;
    state.gameT0 = t;
    state.gameStarted = true;
    if (audio) { try { audio.pause(); audio.muted = true; audio.volume = 0; } catch (_) {} }
    beginIntro();
    return true;
  }

  function showWaitText(text) {
    var w = root && root.querySelector('.cine-wait');
    if (!w) return;
    if (text) w.textContent = text;
    w.classList.add('on');
  }

  // Only surface the loading hint if the wait is long enough to notice.
  function showWait(t) {
    if (t - state.audioArmedAt > 700) showWaitText('BUFFERING\u2026');
  }

  function hideWait() {
    var w = root && root.querySelector('.cine-wait');
    if (w) w.classList.remove('on');
  }

  function audioTime() {
    try { return audio ? audio.currentTime : 0; } catch (_) { return 0; }
  }

  // Game time is the soundtrack position (or the wall clock if there is no
  // soundtrack), measured from the moment the game actually began. A track that
  // stops moving hands over to the wall clock at the position it reached, so a
  // blocked autoplay or a stalled stream can only cost the music, never the show.
  function gameTime(t) {
    if (state.audioSilent) return t - state.gameT0;
    var at = audioTime();
    if (at > state.lastAudioAt + 0.001) {
      state.lastAudioAt = at;
      state.lastAudioAdvance = t;
    } else if (t - state.lastAudioAdvance > AUDIO_STALL_MS) {
      var stalled = Math.max(0, (at > 0 ? at - state.audioT0 : 0) * 1000);
      // An element can come out of a seek without resuming (a starving frame can
      // take the media clock with it). While the intro is still at its very
      // start, restart the music once from the target rather than silently
      // playing the rest of the show without it.
      if (!state.audioRescued && stalled < 1500) {
        state.audioRescued = true;
        state.lastAudioAt = 0;
        state.lastAudioAdvance = t;
        try {
          if (audio) {
            audio.currentTime = state.audioT0;
            var p = audio.play(); if (p && p.catch) p.catch(function () {});
          }
        } catch (_) {}
        return stalled;
      }
      state.audioSilent = true;
      state.gameT0 = t - stalled;
      if (audio) { try { audio.pause(); audio.muted = true; audio.volume = 0; } catch (_) {} }
      return stalled;
    }
    return at > 0 ? (at - state.audioT0) * 1000 : -1;
  }

  function updateIntro(g) {
    var txt = root.querySelector('.cine-text');
    if (!txt) return;
    var op, bloom;
    if (g < TEXT_APPEAR_MS) {
      op = g / TEXT_APPEAR_MS; bloom = 0;
    } else if (g < BLOOM_UP_MS) {
      op = 1; bloom = (g - TEXT_APPEAR_MS) / (BLOOM_UP_MS - TEXT_APPEAR_MS);
    } else if (g < BLOOM_DOWN_MS) {
      op = 1; bloom = 1 - (g - BLOOM_UP_MS) / (BLOOM_DOWN_MS - BLOOM_UP_MS);
    } else {
      bloom = 0; op = 1 - (g - BLOOM_DOWN_MS) / (MAIN_START_MS - BLOOM_DOWN_MS);
    }
    txt.style.opacity = Math.max(0, Math.min(1, op)).toFixed(3);
    root.style.setProperty('--bloom', Math.max(0, Math.min(1, bloom)).toFixed(3));
  }

  function onArchiveStart() {
    var txt = root.querySelector('.cine-text');
    if (txt) { txt.style.opacity = '1'; txt.classList.add('hide'); }
    root.style.setProperty('--bloom', '0');
    var pages = root.querySelector('.cine-pages');
    var vhs = root.querySelector('.cine-vhs');
    if (pages) pages.classList.add('on');
    if (vhs) vhs.classList.add('on');
    setPage(0);
    pulseBeat();
  }

  function setPage(i) {
    if (!state || state.pageIdx === i) return;
    state.pageIdx = i;
    var pages = root.querySelectorAll('.cine-page');
    for (var k = 0; k < pages.length; k++) pages[k].classList.toggle('on', k === i);
  }

  function pulseBeat() {
    var p = root && root.querySelector('.cine-pages');
    if (!p) return;
    p.classList.add('beat');
    setTimeout(function () { if (p.parentNode) p.classList.remove('beat'); }, 130);
  }

  // Beat-accurate and cheap: the visual state is a pure function of the music
  // clock, and the DOM is only touched when a beat actually turns — so a dropped
  // frame skips nothing and cannot push the pages off the beat.
  function updateArchive(a, g) {
    var beatIdx = Math.floor(a / BEAT_MS);
    var total = OLD_VERSIONS.length * PAGE_BEATS;
    if (beatIdx >= total) {
      if (state.lastBeat !== total) { state.lastBeat = total; setBlack(true); }
      return;
    }
    if (beatIdx === state.lastBeat) return;
    state.lastBeat = beatIdx;
    var pageIdx = Math.floor(beatIdx / PAGE_BEATS);
    var bIn = beatIdx % PAGE_BEATS;

    setPage(pageIdx);
    // 8th beat of every page = sudden blackout; next beat shows the next page.
    setBlack(bIn === PAGE_BEATS - 1);
    pulseBeat();

    var hud = root.querySelector('.vhs-time');
    if (hud) {
      var s = Math.floor(g / 1000);
      hud.textContent = pad2(Math.floor(s / 3600)) + ':' + pad2(Math.floor(s / 60) % 60) + ':' + pad2(s % 60);
    }
  }

  function endCine() {
    if (state) state.finished = true;
    if (cine) { cine.stop(); cine = null; }
    if (lagCine) { lagCine.stop(); lagCine = null; }
    unglitchSite();
    var c = root && root.querySelector('.anniv-cine');
    if (c) c.remove();
    if (root) {
      root.classList.remove('cine-on');
      root.style.removeProperty('--bloom');
    }
    renderRules();
  }

  /* ------------------------------------------------------------------ *
   * Pause / resume (fullscreen exit)
   * ------------------------------------------------------------------ */
  function pauseExperience() {
    if (!state || state.paused) return;
    state.paused = true;
    if (cine) cine.pause();
    if (lagCine) lagCine.pause();
    if (audio) { try { audio.pause(); } catch (_) {} }
    showPause();
  }

  function resumeExperience() {
    if (!state || !state.paused) return;
    hidePause();
    state.paused = false;
    state.fsWas = !!fsElement();
    if (audio) { try { var p = audio.play(); if (p && p.catch) p.catch(function () {}); } catch (_) {} }
    if (cine) cine.resume();
    if (lagCine) lagCine.resume();
  }

  function showPause() {
    if (!root) return;
    if (!root.querySelector('.anniv-pause')) {
      root.insertAdjacentHTML('beforeend',
        '<div class="anniv-pause">' +
          '<div class="pause-card">' +
            '<div class="pause-title">PAUSED</div>' +
            '<div class="pause-sub">Fullscreen was left.</div>' +
            '<div class="pause-actions">' +
              '<button class="anniv-btn resume-go">Continue</button>' +
              '<button class="anniv-btn ghost resume-quit">Exit</button>' +
            '</div>' +
          '</div>' +
        '</div>');
    }
    var ov = root.querySelector('.anniv-pause');
    ov.classList.add('on');
    root.querySelector('.resume-go').onclick = function () {
      requestFs().then(function () { resumeExperience(); });
    };
    root.querySelector('.resume-quit').onclick = close;
  }

  function hidePause() {
    var ov = root && root.querySelector('.anniv-pause');
    if (ov) ov.classList.remove('on');
  }

  /* ------------------------------------------------------------------ *
   * Steps: rules -> quiz -> result
   * ------------------------------------------------------------------ */
  function close() {
    var particlesWere = !!(state && state.particlesWere);
    if (state) state.closing = true;
    if (cine) { cine.stop(); cine = null; }
    if (lagCine) { lagCine.stop(); lagCine = null; }
    unglitchSite();
    stopMusic();
    closeAudio();
    try {
      if (window.JqrgParticles && window.JqrgParticles.setPaused && !particlesWere) {
        window.JqrgParticles.setPaused(false);
      }
    } catch (_) {}
    exitFs();
    if (root) { root.remove(); root = null; }
    state = null;
  }

  function renderRules() {
    // The trailer dressing (CRT scanlines, vignette, purple grid) belongs to the
    // trailer: the reward table is the first clean screen.
    if (root) root.classList.add('clean');
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

    var btn = el('<button class="anniv-btn">Start</button>');
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

    var back = el('<button class="anniv-btn ghost">Back</button>');
    back.onclick = function () {
      if (i === 0) { renderRules(); } else { state.qIndex = i - 1; state.trapped = false; renderQuiz(); }
    };

    var next = el('<button class="anniv-btn">' + (i + 1 === total ? 'Finish' : 'Next') + '</button>');
    next.onclick = function () {
      if (state.trapped) return;
      if (state.answers[i] == null) {
        next.textContent = 'Pick';
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
    inner.appendChild(stageLabel('CALCULATING'));
    inner.appendChild(el('<div class="anniv-title">SCORING…</div>'));
    inner.appendChild(el('<div class="anniv-sub">Contacting the leaderboard…</div>'));
    setStage(inner);
    var done = el('<button class="anniv-btn">Exit</button>');
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
    var b = el('<button class="anniv-btn">Exit</button>');
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
    var b = el('<button class="anniv-btn">Exit</button>');
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
    fetch(ANNIV_URL, {
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
        var b = el('<button class="anniv-btn">Ok</button>');
        b.onclick = close;
        setFoot([b]);
        return;
      }
      ensureRoot();
      shell('FIRST ANNIVERSARY');
      state = {
        started: false, paused: false, fsWas: false, closing: false,
        gameStarted: false, archStarted: false, pageIdx: -1, lastBeat: -1, lastGlitch: 0,
        audioArmed: false, audioArmedAt: 0, audioSeeked: false, audioSilent: false, finished: false,
        gameT0: 0, audioT0: 0, particlesWere: false, lastAudioAt: 0, lastAudioAdvance: 0,
        pagesLoaded: 0, pagesReady: [false, false, false, false], audioRescued: false,
        questions: null, answers: null, qIndex: 0, trapped: false
      };
      // The site's particle field keeps animating behind this overlay; none of
      // it is visible, and on a school laptop it is pure dropped frames.
      try {
        if (window.JqrgParticles && window.JqrgParticles.setPaused) {
          state.particlesWere = !!(window.JqrgParticles.isGamePaused && window.JqrgParticles.isGamePaused());
          window.JqrgParticles.setPaused(true);
        }
      } catch (_) {}
      warmArchive();
      warmAudio();
      showFsPrompt();
    }
  };
})();
