/* ================================================================
   FEATURES / SUBJECT TRACKER / STUDY-TIMER.JS — timer + complete-alarm
   ----------------------------------------------------------------
   Countdown + stopwatch (native TimerService + browser fallback),
   timer-complete alarm (WebAudio beep + in-app modal), aur
   window.AchivaStudySave native save-hook.

   TIMER-SAVE FIXES (Batch 41):
     • RUNNING-STATE PERSISTENCE (Bug B): chalta hua timer + context
       'achiva.timer.running.v1' mein persist hota hai — page reload /
       tab-discard / app-restart ke baad session resume ya complete-save
       hota hai (pehle: memory-only → sab lost).
     • BOOT/VISIBILITY RECONCILE (Bug A): app khulte hi aur foreground
       par lautne par native ki finished/pending/zombie session check
       hoti hai aur save hoti hai — AlarmActivity block ho ya WebView
       reload ho gaya ho tab bhi session nahi khota.
     • SESSION-ID DEDUPE (Bug C): ±3s startMs heuristic ki jagah exact
       sessionId match (+ sirf bina-id wali legacy saves ke liye tight
       heuristic) — jaayaz sessions ab drop nahi hote.
     • ELAPSED CAP (Bug E): countdown mode mein recorded ms kabhi
       countdownMs se zyada nahi (freeze ke baad inflation band).

   SESSION-CAT (category tagging):
     • Countdown START par 5-category popup (bina category start nahi).
     • Stopwatch STOP+SAVE par popup (skip → bina category save).
     • Category session record (`cat`) + RUN_KEY mein persist — reload/
       native-save/reconcile ke baad bhi sahi category ke saath save.
  ================================================================ */

(function () {
  'use strict';
  if (window.__achivaSTTimerLoaded) return;
  window.__achivaSTTimerLoaded = true;
  var el = UI.el, esc = UI.esc, uid = UI.uid;

  var ST = window.ST;
  var ICON_CLOCK = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';

  var studyState = null;   /* { mode:'count'|'stop', countdownMs, startEpoch, accMs, running, cat } */
  var studyTick = null;
  var RUN_KEY = 'achiva.timer.running.v1';   /* TIMER-FIX: chalte timer ka persist point */
  var sessionId = null;                      /* TIMER-FIX: har session ki unique id (dedupe) */

  function nativeTimer() {
    var n = window.AchivaNative;
    try {
      return (n && n.timerAvailable && n.timerAvailable() === '1') ? n : null;
    } catch (e) { return null; }
  }

  function fmtTimer(ms) {
    var t = Math.max(0, Math.round(ms / 1000));
    var h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s2 = t % 60;
    return (h > 0 ? h + ':' : '') + String(m).padStart(2, '0') + ':' + String(s2).padStart(2, '0');
  }

  var studyContext = null;   /* (legacy, unused — context subject-store.js mein hai) */

  /* ================================================================
     SESSION-CAT : CATEGORY PICKER POPUP (5 categories)
     • COUNTDOWN  : Start dabate hi PEHLE category poochhte hain —
                    category chune bina countdown start hi nahi hota.
     • STOPWATCH  : Start par kuch nahi poochhte; "Stop + Save" par
                    popup aata hai (skip bhi kar sakte hain — time to
                    spend ho chuka, isliye bina-category bhi save hota).
     ================================================================ */
  var CAT_ICONS = { learn: '\ud83d\udcd6', practice: '\u270d\ufe0f', revision: '\ud83d\udd01', notes: '\ud83d\uddd2\ufe0f', other: '\ud83d\udccc' };
  var catModal = UI.modal({ zScrim: 93, zWrap: 94 });   /* timer-popup (91/92) ke upar */

  function openCatPicker(opts) {
    /* opts: { title, subtitle, skipLabel, onPick(catId|null), onDismiss() } */
    var done = false;
    function pick(cat) {
      if (done) return; done = true;
      catModal.close();
      try { opts.onPick(cat); } catch (e) { }
    }
    function dismiss() {
      if (done) return; done = true;
      try { if (opts.onDismiss) opts.onDismiss(); } catch (e) { }
    }
    catModal.open(opts.title || 'Category chuno', function (body) {
      if (opts.subtitle) {
        var s = el('div', 'sub-meta', opts.subtitle);
        s.style.marginBottom = '10px';
        body.appendChild(s);
      }
      ((ST && ST.CATS) || []).forEach(function (c) {
        var b = UI.solidBtn((CAT_ICONS[c.id] ? CAT_ICONS[c.id] + '  ' : '') + c.label);
        b.setAttribute('data-cat', c.id);
        b.style.marginBottom = '8px';
        b.addEventListener('click', function () { pick(c.id); });
        body.appendChild(b);
      });
      if (opts.skipLabel) {
        var sk = UI.pillBtn(opts.skipLabel);
        sk.setAttribute('data-cat-skip', '1');
        sk.style.marginTop = '2px';
        sk.addEventListener('click', function () { pick(null); });
        body.appendChild(sk);
      }
    }, null);
    /* scrim / Cancel click = bina category band → dismiss */
    var wrapEl = catModal.sheet.parentElement;
    var scrimEl = wrapEl && wrapEl.previousElementSibling;
    if (scrimEl) scrimEl.addEventListener('click', dismiss);
    var cancelB = catModal.sheet.querySelector('.sheet-actions .btn-ghost');
    if (cancelB) cancelB.addEventListener('click', dismiss);
  }

  /* TIMER-FIX: chalte timer ka state storage mein mirror karo */
  function persistRunning() {
    try {
      if (!studyState) { window.AppStorage.rawDel(RUN_KEY); return; }
      window.AppStorage.saveAt(RUN_KEY, {
        v: 1, sessionId: sessionId,
        mode: studyState.mode, countdownMs: studyState.countdownMs,
        startEpoch: studyState.startEpoch, accMs: studyState.accMs,
        cat: studyState.cat || null,   /* SESSION-CAT: reload ke baad bhi category zinda */
        sessionStart: studyState.sessionStart || studyState.startEpoch,
        running: studyState.running, savedAt: Date.now()
      });
    } catch (e) { /* storage fail — timer phir bhi chalta rahega */ }
  }
  function clearRunning() {
    try { window.AppStorage.rawDel(RUN_KEY); } catch (e) { }
  }
  /* TIMER-FIX: study-timer.js subject-screens.js se PEHLE load hota hai —
     boot-reconcile ke waqt refreshLists exist nahi karta, isliye guard */
  function refreshSafe() {
    try { if (ST.refreshLists) ST.refreshLists(); } catch (e) { }
  }

  /* TIMER-FIX (Bug E): countdown mein elapsed kabhi countdownMs se bada
     record na ho (freeze/resume ke baad wall-clock inflation rokta hai) */
  function capElapsed(st) {
    var ms = st && st.elapsedMs > 0 ? st.elapsedMs : 0;
    if (st && st.mode === 'count' && st.countdownMs > 0 && ms > st.countdownMs) ms = st.countdownMs;
    return ms;
  }

  function studyStatus() {
    var n = nativeTimer();
    if (n) {
      try { return JSON.parse(n.timerStatus()); } catch (e) { /* fall through */ }
    }
    if (!studyState) return { running: false, mode: 'stop', remainingMs: 0, elapsedMs: 0 };
    var el2 = studyState.running ? (Date.now() - studyState.startEpoch) : 0;
    var total = studyState.accMs + el2;
    /* TIMER-FIX: count mode mein elapsed capped + countdownMs/startEpochMs
       status mein expose (native statusJson jaisa hi shape) */
    var elapsedOut = (studyState.mode === 'count' && total > studyState.countdownMs)
      ? studyState.countdownMs : total;
    return {
      running: studyState.running,
      mode: studyState.mode,
      elapsedMs: elapsedOut,
      countdownMs: studyState.countdownMs,
      startEpochMs: studyState.sessionStart || studyState.startEpoch,
      remainingMs: studyState.mode === 'count' ? Math.max(0, studyState.countdownMs - total) : 0,
      finished: studyState.mode === 'count' && total >= studyState.countdownMs
    };
  }

  /* SESSION-CAT: RUN_KEY mein persisted category (reload/native-save ke waqt
     jab web studyState khali ho — best effort, sessionId match par hi) */
  function runKeyCat(forSid) {
    try {
      var rs = window.AppStorage.loadAt(RUN_KEY);
      if (!rs || !rs.cat) return null;
      if (forSid && rs.sessionId && rs.sessionId !== forSid) return null;
      return String(rs.cat);
    } catch (e) { return null; }
  }

  var catPickOpen = false;   /* countdown-start picker dobara na khule */

  function studyStart(mode, countdownMs, cat) {
    /* SESSION-CAT: countdown start par PEHLE 5-category popup —
       category chune bina countdown start nahi hota.
       Stopwatch start par kuch nahi poochhte (Stop+Save par poochenge). */
    if (mode === 'count' && !cat && !catPickOpen) {
      catPickOpen = true;
      openCatPicker({
        title: 'Countdown kis liye hai?',
        subtitle: 'Category chuno — ye session isi mein save hoga.',
        onPick: function (c) {
          catPickOpen = false;
          studyStart('count', countdownMs, c || 'other');
        },
        onDismiss: function () { catPickOpen = false; }   /* cancel = start nahi */
      });
      return;
    }
    doStudyStart(mode, countdownMs, cat || null);
  }

  function doStudyStart(mode, countdownMs, cat) {
    ensureAudio();          /* user-gesture : baad mein alarm-beep autoplay ke liye */
    var n = nativeTimer();
    sessionId = uid();      /* TIMER-FIX: dedupe ab exact id se hoga */
    studyState = {
      mode: mode, countdownMs: countdownMs || 0,
      cat: mode === 'count' ? (cat || null) : null,   /* SESSION-CAT */
      startEpoch: Date.now(), accMs: 0, running: true,
      sessionStart: Date.now()   /* TIMER-FIX: true session start (pause/resume
                                    se change nahi hota; record ka startMs yahi hai) */
    };
    persistRunning();       /* TIMER-FIX: reload/crash ke baad recovery isi se */
    if (n) {
      try { n.timerStart(mode === 'count' ? countdownMs : 0); } catch (e) { /* fallback */ }
      /* naya bridge method — purane APK mein absent ho sakta hai (try/catch) */
      try { if (n.timerSetSession) n.timerSetSession(String(sessionId)); } catch (e) { }
    }
    ensureGlobalTick();
    paintPopup();
  }

  /* popup band ho tab bhi countdown-complete record ho (browser fallback) */
  /* ek hi session do baar save na ho (web + native dono save karte hain)
     TIMER-FIX (Bug C): pehle ±3s startMs heuristic JAAYAZ sessions bhi
     drop kar deta tha. Ab:
       1. dono taraf sessionId hai → SIRF exact id match par dedupe
       2. koi side bina-id (purana APK / legacy record) → tight heuristic:
          startMs ±90s AUR ms ±2s dono match karein tab hi duplicate */
  function alreadyRecorded(ms, startMs, sid) {
    try {
      var d = ST.studyStore() || [];
      for (var i = 0; i < d.length; i++) {
        var r = d[i];
        if (!r) continue;
        if (sid && r.sessionId) {
          if (r.sessionId === sid) return true;
          continue;                       /* dono id-wale: id hi decide karega */
        }
        if (typeof r.startMs === 'number' && typeof r.ms === 'number' &&
            Math.abs(r.startMs - startMs) < 90000 && Math.abs(r.ms - ms) < 2000) return true;
      }
    } catch (e) { }
    return false;
  }

  function ensureGlobalTick() {
    if (studyTick) return;
    var tickCount = 0;
    studyTick = setInterval(function () {
      if (!studyState) return;
      /* TIMER-FIX: ~30s mein ek baar running-state persist — app mar jaye
         to bhi stopwatch ka time (savedAt tak) recover hota hai */
      if ((++tickCount) % 60 === 0) persistRunning();
      var st = studyStatus();
      if (st.finished) {
        /* BUG-#003 fix : web KHUD record karta hai (native par nirbhar nahi).
           TIMER-FIX: capped ms + true startEpoch + sessionId + running-clear */
        var ms = capElapsed(st);
        var startMs = (typeof st.startEpochMs === 'number' && st.startEpochMs > 0)
          ? st.startEpochMs : (Date.now() - ms);
        if (!alreadyRecorded(ms, startMs, sessionId)) {
          /* SESSION-CAT: countdown complete → start waali chuni hui category */
          ST.recordStudy(ms, startMs, sessionId,
            (studyState && studyState.cat) || runKeyCat(sessionId));
        }
        studyState = null; sessionId = null; clearRunning();
        refreshSafe();
        paintPopup();
        var nat = nativeTimer();
        if (!nat) {
          /* Browser : in-app alarm modal + beep (APK mein native AlarmActivity UI deta hai) */
          openWebAlarm(ms);
        }
      }
    }, 500);
  }

  function studyPause() {
    var st = studyStatus();
    var n = nativeTimer();
    if (n) { try { n.timerPause(); } catch (e) { } }
    if (studyState) {
      studyState.accMs = st.elapsedMs;
      studyState.running = false;
      persistRunning();     /* TIMER-FIX */
    }
    paintPopup();
  }

  function studyResume() {
    var n = nativeTimer();
    if (n) { try { n.timerResume(); } catch (e) { } }
    if (studyState) { studyState.startEpoch = Date.now(); studyState.running = true; persistRunning(); }
    paintPopup();
  }

  function studyStop() {
    var st = studyStatus();
    var n = nativeTimer();
    /* TIMER-FIX: capped ms + true startEpoch (pause ke baad bhi sahi) + id */
    var ms = capElapsed(st);
    var startMs = (typeof st.startEpochMs === 'number' && st.startEpochMs > 0)
      ? st.startEpochMs : (Date.now() - ms);
    if (n) { try { n.timerStop(); } catch (e) { } }
    /* SESSION-CAT: stopwatch → Stop+Save par category popup (skip allowed,
       kyunki time spend ho chuka — save to hona hi hai).
       countdown → start par chuni category hi use hoti hai. */
    var sid = sessionId;
    var isStopwatch = !!(studyState && studyState.mode === 'stop');
    var catKnown = (studyState && studyState.cat) || runKeyCat(sid);
    studyState = null; sessionId = null; clearRunning();
    function save(cat) {
      if (!alreadyRecorded(ms, startMs, sid)) ST.recordStudy(ms, startMs, sid, cat);
      refreshSafe();
      paintPopup();
    }
    if (isStopwatch && ms >= 1000) {
      openCatPicker({
        title: 'Session kis category mein save karein?',
        subtitle: 'Stopwatch ka ' + ST.fmtHMS(ms) + ' save ho raha hai.',
        skipLabel: 'Bina category save karo',
        onPick: function (c) { save(c || null); },
        onDismiss: function () { save(null); }   /* scrim/Cancel → bina cat save */
      });
    } else {
      save(catKnown);
    }
  }

  /* ================================================================
     TIMER-COMPLETE ALARM (browser fallback) + native save hook
  ================================================================ */
  var audioCtx = null;
  var beepNodes = null;

  function ensureAudio() {
    /* user-gesture (timer Start) par banaya jaata hai taaki baad mein autoplay ho */
    if (!audioCtx) {
      try {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (AC) audioCtx = new AC();
      } catch (e) { audioCtx = null; }
    }
    if (audioCtx && audioCtx.state === 'suspended') { try { audioCtx.resume(); } catch (e) { } }
  }

  function startBeep() {
    if (!audioCtx) return;
    stopBeep();
    try {
      var osc = audioCtx.createOscillator();
      var gain = audioCtx.createGain();
      var lfo = audioCtx.createOscillator();      /* alarm-jaisa pulsing */
      var lfoGain = audioCtx.createGain();
      osc.type = 'square';
      osc.frequency.value = 880;
      lfo.type = 'sine';
      lfo.frequency.value = 2.2;
      lfoGain.gain.value = 0.4;
      gain.gain.value = 0.5;
      lfo.connect(lfoGain); lfoGain.connect(gain.gain);
      osc.connect(gain); gain.connect(audioCtx.destination);
      osc.start(); lfo.start();
      beepNodes = { osc: osc, gain: gain, lfo: lfo };
    } catch (e) { beepNodes = null; }
  }
  function stopBeep() {
    if (!beepNodes) return;
    try { beepNodes.osc.stop(); beepNodes.lfo.stop(); } catch (e) { }
    try { beepNodes.gain.disconnect(); } catch (e) { }
    beepNodes = null;
  }

  var webAlarmModal = UI.modal({ zScrim: 95, zWrap: 96 });
  function openWebAlarm(elapsedMs) {
    startBeep();
    webAlarmModal.open('⏰ Time khatam!', function (body) {
      var big = el('div', null, ST.fmtHMS(elapsedMs));
      big.style.cssText = 'font-family:var(--f-mono);font-size:34px;font-weight:700;color:#2ea043;margin:2px 0 10px';
      body.appendChild(big);
      body.appendChild(el('div', null, 'Session save ho gaya. Ab extend karein ya band karein.'));
      var row = el('div');
      row.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin:12px 0';
      [3, 5, 60].forEach(function (m) {
        var b = UI.pillBtn('+' + m + ' min');
        b.addEventListener('click', function () {
          stopBeep();
          webAlarmModal.close();
          studyStart('count', m * 60000);
        });
        row.appendChild(b);
      });
      body.appendChild(row);
      var cust = el('div');
      cust.style.cssText = 'display:flex;gap:8px;align-items:center;margin-bottom:12px';
      var inp = el('input');
      inp.type = 'number';
      inp.placeholder = 'custom minutes';
      inp.style.cssText = UI.fieldCss + ';flex:1';
      var ex = UI.pillBtn('Extend');
      ex.addEventListener('click', function () {
        var m = parseInt(inp.value, 10);
        if (!m || m < 1) return;
        stopBeep();
        webAlarmModal.close();
        studyStart('count', m * 60000);
      });
      cust.appendChild(inp); cust.appendChild(ex);
      body.appendChild(cust);
      var stopB = UI.solidBtn('Stop & Save');
      stopB.addEventListener('click', function () {
        stopBeep();
        var n = nativeTimer();
        if (n) { try { n.timerStopAlarm(); } catch (e) { } }
        webAlarmModal.close();
        refreshSafe();
      });
      body.appendChild(stopB);
    }, null);
    var sv = webAlarmModal.sheet.querySelector('.sheet-actions .btn-solid');
    if (sv) sv.style.display = 'none';
  }

  /* native (AlarmActivity) isi ko call karti hai completed session save ke liye.
     TIMER-FIX: teesra arg sessionId (naya bridge bhejta hai; purana nahi →
     undefined → heuristic dedupe). Return '1' = web tak pahuncha aur handle
     hua — MainActivity ka retry-queue isi ack par rukta hai (Bug A4). */
  window.AchivaStudySave = function (ms, startMs, sid) {
    try {
      ms = Math.floor(Number(ms) || 0);
      startMs = Math.floor(Number(startMs) || 0);
      sid = sid ? String(sid) : null;
      /* agar web ne pehle hi ye session record kar liya hai to dobara mat save karo */
      if (!alreadyRecorded(ms, startMs, sid)) {
        /* SESSION-CAT: native ko category nahi pata — web ke RUN_KEY se
           best-effort uthao (countdown web se hi category ke saath start hua tha).
           studyState.cat sirf tab jab wahi session ho (id match). */
        var webCat = (studyState && studyState.cat && (!sid || sessionId === sid))
          ? studyState.cat : null;
        ST.recordStudy(ms, startMs, sid, webCat || runKeyCat(sid));
      }
      refreshSafe();
      try { paintPopup(); } catch (e) { }
      return '1';
    } catch (e) { return '0'; }
  };

  /* ================================================================
     RECONCILE (TIMER-FIX, Bug A/B/F) — app khulte hi, foreground par
     lautne par (visibilitychange/pageshow), aur MainActivity.onResume
     ke native hook (window.AchivaTimerReconcile) se chalta hai:
       1. native ZOMBIE (countdown khatam, service tick mara hua) → save+stop
       2. native FINISHED (alarm ke waqt page dead/reload tha) → save+stop
       3. native PENDING (SharedPreferences — process hi mar gaya tha) → save+clear
       4. web RUNNING-KEY: countdown page-reload mein nikal gaya → capped
          save + alarm modal; adhura hai → LIVE resume (ab timer reload
          jhel ta hai)
       5. native RUNNING hai par web studyState khali (page reload hua) →
          adopt : popup/tick dobara jud jate hain
  ================================================================ */
  function reconcile() {
    try {
      var n = nativeTimer();
      var st = null;
      if (n) { try { st = JSON.parse(n.timerStatus()); } catch (e) { st = null; } }

      /* 1+2) native finished / zombie-countdown */
      if (n && st) {
        var needSave = false, ms = 0, startMs = 0, sid = null;
        if (st.finished) {
          needSave = true; ms = capElapsed(st);
        } else if (st.mode === 'count' && st.running && st.remainingMs <= 0 &&
                   st.countdownMs > 0 && st.elapsedMs >= st.countdownMs) {
          needSave = true; ms = st.countdownMs;      /* zombie: tick mara, countdown nikal gaya */
        }
        if (needSave) {
          startMs = (typeof st.startEpochMs === 'number' && st.startEpochMs > 0)
            ? st.startEpochMs : (Date.now() - ms);
          sid = st.sessionId ? String(st.sessionId) : sessionId;
          if (!alreadyRecorded(ms, startMs, sid)) {
            /* SESSION-CAT: web state / RUN_KEY se best-effort category */
            var nCat = (studyState && studyState.cat && (!sid || sessionId === sid))
              ? studyState.cat : runKeyCat(sid);
            ST.recordStudy(ms, startMs, sid, nCat);
          }
          try { n.timerStop(); } catch (e) { }       /* alarm tone + service band */
          studyState = null; sessionId = null; clearRunning();
          refreshSafe();
          try { paintPopup(); } catch (e) { }
        }
      }

      /* 3) native pending (process-death ke baad SharedPreferences se) */
      if (n && n.timerPendingSession) {
        try {
          var raw = n.timerPendingSession();
          var pend = raw ? JSON.parse(raw) : null;
          if (pend && pend.elapsedMs >= 1000) {
            var psid = pend.sessionId ? String(pend.sessionId) : null;
            if (!alreadyRecorded(pend.elapsedMs, pend.startEpochMs, psid)) {
              ST.recordStudy(pend.elapsedMs, pend.startEpochMs, psid, runKeyCat(psid));
              refreshSafe();
            }
          }
          if (raw) n.timerClearPending();
        } catch (e) { }
      }

      /* fresh native status (upar timerStop ho chuka ho sakta hai) */
      var natBusy = false, s2 = null;
      if (n) { try { s2 = JSON.parse(n.timerStatus()); natBusy = !!(s2 && (s2.running || s2.finished)); } catch (e) { } }

      /* 5) native chal raha hai, web state khali (page reload) → adopt */
      if (!studyState && natBusy && s2 && s2.running) {
        sessionId = (s2.sessionId ? String(s2.sessionId) : uid());
        /* SESSION-CAT: reload se pehle web ne RUN_KEY mein category persist
           ki thi — adopt karte waqt wapas utha lo */
        var adoptCat = null;
        try {
          var rsA = window.AppStorage.loadAt(RUN_KEY);
          if (rsA && rsA.cat) adoptCat = String(rsA.cat);
        } catch (e) { }
        studyState = {
          mode: s2.mode === 'count' ? 'count' : 'stop',
          countdownMs: s2.countdownMs || 0,
          cat: adoptCat,
          startEpoch: (typeof s2.startEpochMs === 'number' && s2.startEpochMs > 0)
            ? s2.startEpochMs : (Date.now() - (s2.elapsedMs || 0)),
          accMs: 0, running: true,
          sessionStart: (typeof s2.startEpochMs === 'number' && s2.startEpochMs > 0)
            ? s2.startEpochMs : Date.now()   /* native startEpoch = true session start */
        };
        try { if (!s2.sessionId && n.timerSetSession) n.timerSetSession(String(sessionId)); } catch (e) { }
        persistRunning();
        ensureGlobalTick();
        try { paintPopup(); } catch (e) { }
        return;
      }

      /* 4) web-only running state restore (browser / dead-native) */
      if (!studyState && !natBusy) {
        var rs = null;
        try { rs = window.AppStorage.loadAt(RUN_KEY); } catch (e) { rs = null; }
        if (rs && rs.v === 1 && typeof rs.startEpoch === 'number') {
          var sStart = rs.sessionStart || rs.startEpoch;
          var acc = rs.accMs || 0;
          var elapsedSoFar;
          if (rs.mode === 'count') {
            /* countdown dead-period mein bhi real-time chalta raha —
               poora wall-clock gino (complete ho gaya to neeche save hoga) */
            elapsedSoFar = acc + (rs.running ? (Date.now() - rs.startEpoch) : 0);
          } else {
            /* TIMER-FIX: stopwatch ka dead-time NAHI ginte — sirf last
               savedAt tak (tick ~30s mein persist karta hai). Warna
               mahino purana running-key mahino ka time record kara deta. */
            var upto = rs.running
              ? Math.max(rs.startEpoch, Math.min(Date.now(), rs.savedAt || Date.now()))
              : rs.startEpoch;
            elapsedSoFar = acc + (rs.running ? upto - rs.startEpoch : 0);
          }
          if (rs.mode === 'count' && rs.countdownMs > 0 && elapsedSoFar >= rs.countdownMs) {
            /* countdown page-reload/freeze mein hi poora ho gaya tha → abhi save */
            if (!alreadyRecorded(rs.countdownMs, sStart, rs.sessionId)) {
              ST.recordStudy(rs.countdownMs, sStart, rs.sessionId, rs.cat || null);
            }
            clearRunning();
            refreshSafe();
            openWebAlarm(rs.countdownMs);   /* user ko pata chale : session safe hai */
          } else {
            /* timer abhi adhura hai → LIVE resume (ab timer reload jhel ta hai) */
            sessionId = rs.sessionId || uid();
            studyState = {
              mode: rs.mode === 'count' ? 'count' : 'stop',
              countdownMs: rs.countdownMs || 0,
              cat: rs.cat || null,   /* SESSION-CAT: chuni hui category wapas */
              startEpoch: rs.mode === 'count' ? rs.startEpoch : Date.now(),
              accMs: rs.mode === 'count' ? acc : elapsedSoFar,
              running: !!rs.running,
              sessionStart: sStart
            };
            persistRunning();
            ensureGlobalTick();
            try { paintPopup(); } catch (e) { }
          }
        }
      }
    } catch (e) { /* reconcile fail — app chalti rahe */ }
  }
  window.AchivaTimerReconcile = reconcile;   /* MainActivity.onResume isi ko call karti hai */

  var timerModal = UI.modal({ zScrim: 91, zWrap: 92 });
  var popupTick = null;
  var popupRefs = null;

  /* chhota popup : countdown / stopwatch / controls */
  function openTimerPopup() {
    timerModal.open('Study Timer', function (body) {
      var disp = el('div', null, '00:00');
      disp.style.cssText = 'font-family:var(--f-mono);font-size:32px;font-weight:700;' +
        'color:var(--ink);margin:2px 0 10px';
      body.appendChild(disp);

      body.appendChild(UI.label('Countdown (reverse) :'));
      var crow = el('div');
      crow.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px';
      [['25m', 25], ['45m', 45], ['90m', 90], ['1h', 60], ['1.5h', 90], ['2h', 120]].forEach(function (p, i) {
        var mins = [25, 45, 90, 60, 90, 120][i];
        var b = UI.pillBtn(p[0]);
        b.addEventListener('click', function () { studyStart('count', mins * 60000); });
        crow.appendChild(b);
      });
      body.appendChild(crow);

      var cust = el('div');
      cust.style.cssText = 'display:flex;gap:8px;align-items:center;margin-bottom:12px';
      var minInp = el('input');
      minInp.type = 'number';
      minInp.placeholder = 'minutes (1-120)';
      minInp.style.cssText = UI.fieldCss + ';flex:1';
      var cstart = UI.pillBtn('Start');
      cstart.addEventListener('click', function () {
        var m2 = parseInt(minInp.value, 10);
        if (!m2 || m2 < 1) return;
        studyStart('count', m2 * 60000);
      });
      cust.appendChild(minInp);
      cust.appendChild(cstart);
      body.appendChild(cust);

      body.appendChild(UI.label('Stopwatch :'));
      var swBtn = UI.pillBtn('Start Stopwatch');
      swBtn.style.marginBottom = '12px';
      swBtn.addEventListener('click', function () { studyStart('stop', 0); });
      body.appendChild(swBtn);

      var ctrl = el('div');
      ctrl.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap';
      var pauseB = UI.solidBtn('Pause');
      pauseB.addEventListener('click', studyPause);
      var resumeB = UI.solidBtn('Resume');
      resumeB.addEventListener('click', studyResume);
      var stopB = UI.solidBtn('Stop + Save');
      stopB.addEventListener('click', studyStop);
      ctrl.appendChild(pauseB); ctrl.appendChild(resumeB); ctrl.appendChild(stopB);
      body.appendChild(ctrl);

      var note = el('div', 'sub-meta', '');
      note.style.marginTop = '8px';
      body.appendChild(note);

      popupRefs = { disp: disp, pauseB: pauseB, resumeB: resumeB, stopB: stopB, note: note };
      paintPopup();
    }, null);

    if (popupTick) clearInterval(popupTick);
    popupTick = setInterval(function () {
      if (!timerModal.isOpen()) {
        clearInterval(popupTick); popupTick = null; return;
      }
      paintPopup();   /* completion record global tick karta hai */
    }, 500);
  }

  function paintPopup() {
    if (!popupRefs) return;
    var st = studyStatus();
    popupRefs.disp.textContent =
      st.mode === 'count' ? fmtTimer(st.remainingMs) : fmtTimer(st.elapsedMs);
    popupRefs.pauseB.style.opacity = st.running ? '1' : '.4';
    popupRefs.resumeB.style.opacity = (!st.running && studyState) ? '1' : '.4';
    popupRefs.stopB.style.opacity = studyState ? '1' : '.4';
    popupRefs.note.textContent = nativeTimer()
      ? (st.running ? 'Timer background mein chal raha hai - notification mein live.' : 'Timer ready.')
      : 'Browser mode : timer chalega, notification APK version mein.';
  }

  /* ================================================================
     BOOT + FOREGROUND-WAPASI RECONCILE (TIMER-FIX)
     Loader is file ko AppStorage.open() ke BAAD inject karta hai,
     isliye storage padhna safe hai. subject-screens baad mein load
     hota hai — refreshSafe() guard isi liye hai.
  ================================================================ */
  try {
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) reconcile();     /* app/tab foreground par lauta */
    });
    window.addEventListener('pageshow', function () { reconcile(); });
  } catch (e) { }
  reconcile();                               /* boot turant */

  window.ST.openTimerPopup = openTimerPopup;
  window.ST.paintTimerPopup = paintPopup;
  window.ST.studyStart = studyStart;
  window.ST.studyStop = studyStop;
  /* HABIT-TYPES: timer ki live state bahar se padhne ke liye (additive —
     study-timer ka apna behaviour bilkul nahi badla). habit-types.js isi se
     pata karta hai ki timer busy hai ya nahi, aur button par remaining time. */
  window.ST.timerState = studyStatus;
})();
