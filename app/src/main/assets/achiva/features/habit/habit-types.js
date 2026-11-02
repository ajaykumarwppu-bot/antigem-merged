/* ================================================================
   FEATURES / HABIT / HABIT-TYPES.JS  —  habit "done" karne ke 3 tareeke
   ----------------------------------------------------------------
   Good habits ke liye 3 types :

     'one'    One click            — tap karo, rep +1  (purana behaviour)

     'time'   Specific time+range  — din ke N fix slots. Har slot ki apni
                                     window  [time - minus , time + plus]
                                     (har side max 2h). Window ke BAHAR
                                     tick BLOCK (strict). Window 23:59 par
                                     clip hoti hai — midnight cross NAHI.
                                     Ek slot = ek rep, ek hi baar tick.

     'timer'  Timer                — duration ka session actually chalana
                                     padta hai. Har rep ke liye ALAG session
                                     zaroori (pooling NAHI). Adhoora session
                                     = proportional credit  (20/30m = 0.67).

   ----------------------------------------------------------------
   SCORING NAHI BADLI : GoodSystem.compute() sirf logs[date].done padhta
   hai. Is file ka kaam hai kisi bhi tareeke se sahi `done` maintain karna
   — isliye green box / streak / formation graph teeno types mein same.

   STORAGE good-list.js ka kaam hai. Ye file sirf DECISIONS leti hai aur
   likhne ke liye runtime par window.GoodList.addCredit() call karti hai.

   TIMER ENGINE : existing study-timer (subject tracker) REUSE hota hai.
   Completion detect karne ke liye window.ST.recordStudy ko wrap kiya gaya
   hai — wo SINGLE funnel hai jisse saare 6 save paths guzarte hain
   (native finished, manual stop, reconcile, reload-recovery, pending,
   zombie). Isliye app restart ke baad bhi credit nahi khota.
   ================================================================ */

(function () {
  'use strict';

  if (window.__achivaHabitTypesLoaded) return;
  window.__achivaHabitTypesLoaded = true;

  var el = UI.el, esc = UI.esc;

  /* ---------- constants ---------- */
  var MAX_PM = 2;                                  /* har side max 2 hour */
  var PM_STEPS = [0, 0.5, 1, 1.5, 2];              /* chip options */
  var DUR_PRESETS = [30, 60, 120, 180, 240];       /* minutes */
  var DEFAULT_DUR = 30;
  var DEFAULT_STUDY_TARGET = 60;                   /* STUDY-HABIT: daily target */
  var STUDY_TARGET_PRESETS = [30, 60, 90, 120, 180, 240];
  var CAT = 'habit';                               /* study-timer category id */
  var PEND_KEY = 'achiva.habitTimer.pending.v1';
  var MATCH_TOLERANCE_MS = 8000;                   /* session↔habit matching */
  var DAY_END_MIN = 23 * 60 + 59;                  /* 23:59 — midnight clip */

  var TYPES = [
    { id: 'one',   label: 'One click',
      desc: 'Tap karo, ho gaya — din mein kabhi bhi.' },
    { id: 'time',  label: 'Specific time & range',
      desc: 'Din ke fix time par, thodi pehle/baad ki chhoot ke saath.' },
    { id: 'timer', label: 'Timer',
      desc: 'Itni der tak kaam karo — session poora hone par hi count hoga.' }
  ];

  /* STUDY-HABIT: 4th type — sirf auto "Study" card ke liye.
     JAAN-BOOJH kar TYPES array mein NAHI hai, isliye type-chooser mein
     kabhi nahi dikhta (user ise khud nahi chun sakta). */
  var STUDY_TYPE = {
    id: 'study', label: 'Study', internal: true,
    desc: 'Subject Tracker ka poora padhai-time apne aap judta hai.'
  };

  var TYPE_IDS = TYPES.map(function (t) { return t.id; }).concat([STUDY_TYPE.id]);

  /* ================================================================
     TIME HELPERS
     ================================================================ */
  function toMin(hhmm) {
    var p = String(hhmm == null ? '' : hhmm).split(':');
    var h = parseInt(p[0], 10); if (isNaN(h)) h = 0;
    var m = parseInt(p[1], 10); if (isNaN(m)) m = 0;
    return Math.max(0, Math.min(23, h)) * 60 + Math.max(0, Math.min(59, m));
  }
  function toHHMM(min) {
    min = Math.max(0, Math.min(DAY_END_MIN, Math.round(min)));
    return String(Math.floor(min / 60)).padStart(2, '0') + ':' +
           String(min % 60).padStart(2, '0');
  }
  function nowMin(d) {
    d = d || new Date();
    return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
  }
  function clampPM(v) {
    v = parseFloat(v); if (isNaN(v)) v = 0;
    return Math.max(0, Math.min(MAX_PM, v));
  }
  function todayISO() { return window.DayClock ? window.DayClock.today() : UI.todayISO(); }   /* DAY-CLOCK: din ka hisaab; slot-times asli ghadi par */

  /* ================================================================
     HABIT SHAPE / MIGRATION
     ================================================================ */
  function typeOf(h) {
    var t = h && h.type;
    /* purane habits (bina type) → 'one' : behaviour 100% same rahega */
    return (t && TYPE_IDS.indexOf(t) !== -1) ? t : 'one';
  }
  function typeObj(id) {
    for (var i = 0; i < TYPES.length; i++) if (TYPES[i].id === id) return TYPES[i];
    if (id === STUDY_TYPE.id) return STUDY_TYPE;   /* internal 4th type */
    return TYPES[0];
  }
  function labelOf(h) { return typeObj(typeOf(h)).label; }
  function reps(h) { return Math.max(1, parseInt(h && h.repsPerDay, 10) || 1); }

  function normSlot(s) {
    s = s || {};
    return {
      t: /^\d{1,2}:\d{2}$/.test(String(s.t || '')) ? toHHMM(toMin(s.t)) : '',
      minus: clampPM(s.minus),
      plus: clampPM(s.plus)
    };
  }

  /* purane/incomplete habits ko safe shape mein laao (destructive nahi) */
  function normalize(h) {
    if (!h || typeof h !== 'object') return h;
    h.type = typeOf(h);
    h.repsPerDay = reps(h);
    if (h.type === 'time') {
      if (!Array.isArray(h.slots)) h.slots = [];
      h.slots = h.slots.map(normSlot);
    }
    if (h.type === 'timer') {
      var dm = parseInt(h.durationMin, 10);
      h.durationMin = (isNaN(dm) || dm < 1) ? DEFAULT_DUR : dm;
    }
    if (h.type === 'study') {
      /* STUDY-HABIT: daily target minutes. done = min(dayMinutes/target, 1),
         isliye repsPerDay hamesha 1 rahega — GoodSystem ke 3-state design
         (done / minimum / missed) mein ye exactly fit hota hai. */
      var tm = parseInt(h.studyTargetMin, 10);
      h.studyTargetMin = (isNaN(tm) || tm < 1) ? DEFAULT_STUDY_TARGET : tm;
      h.repsPerDay = 1;
    }
    if (!h.logs || typeof h.logs !== 'object') h.logs = {};
    return h;
  }

  function ensureLog(h, date) {
    date = date || todayISO();
    if (!h.logs) h.logs = {};
    if (!h.logs[date]) h.logs[date] = { done: 0, times: [] };
    var L = h.logs[date];
    if (!Array.isArray(L.times)) L.times = [];
    return L;
  }

  function logOf(h, date) { return (h && h.logs && h.logs[date || todayISO()]) || null; }
  function repsDone(h, date) {
    var L = logOf(h, date);
    return L ? (L.done || 0) : 0;
  }

  /* ================================================================
     TYPE 'time' — SLOT WINDOW MATH
     ================================================================ */
  function slots(h) {
    return Array.isArray(h && h.slots) ? h.slots.map(normSlot) : [];
  }

  /* window = [t - minus , t + plus], 00:00..23:59 par CLIP (midnight cross nahi) */
  function slotWindow(slot) {
    var base = toMin(slot && slot.t);
    var start = Math.max(0, base - Math.round(clampPM(slot && slot.minus) * 60));
    var end = Math.min(DAY_END_MIN, base + Math.round(clampPM(slot && slot.plus) * 60));
    if (end < start) end = start;
    return { start: start, end: end };
  }

  function windowText(slot) {
    var w = slotWindow(slot);
    return toHHMM(w.start) + '–' + toHHMM(w.end);
  }

  function slotTickedOn(h, date, index) {
    var L = logOf(h, date);
    return !!(L && L.slotTicks && L.slotTicks[index] != null);
  }
  function tickedCount(h, date) {
    var L = logOf(h, date);
    return (L && L.slotTicks) ? Object.keys(L.slotTicks).length : 0;
  }

  /* abhi kaunsa unticked slot apni window mein hai? (pehla match) */
  function activeSlot(h, atMs) {
    if (typeOf(h) !== 'time') return null;
    var date = todayISO();
    var m = nowMin(atMs ? new Date(atMs) : new Date());
    var ss = slots(h);
    for (var i = 0; i < ss.length; i++) {
      if (!ss[i].t) continue;
      if (slotTickedOn(h, date, i)) continue;
      var w = slotWindow(ss[i]);
      if (m >= w.start && m <= w.end) return { index: i, slot: ss[i], win: w };
    }
    return null;
  }

  /* agla unticked slot (hint ke liye) */
  function nextUnticked(h, atMs) {
    if (typeOf(h) !== 'time') return null;
    var date = todayISO();
    var m = nowMin(atMs ? new Date(atMs) : new Date());
    var ss = slots(h), best = null;
    for (var i = 0; i < ss.length; i++) {
      if (!ss[i].t || slotTickedOn(h, date, i)) continue;
      var w = slotWindow(ss[i]);
      if (w.start > m && (!best || w.start < best.win.start)) {
        best = { index: i, slot: ss[i], win: w };
      }
    }
    return best;
  }

  /* save-time validation : exactly N slots, har ek ka time set */
  function validateSlots(slotList, wantReps) {
    if (!Array.isArray(slotList)) slotList = [];
    if (slotList.length !== wantReps) {
      return {
        ok: false,
        msg: wantReps + ' repetition ke liye exactly ' + wantReps +
             ' time-slot chahiye (abhi ' + slotList.length + ' hain).'
      };
    }
    for (var i = 0; i < slotList.length; i++) {
      if (!slotList[i].t) {
        return { ok: false, msg: 'Slot ' + (i + 1) + ' ka time set karo.' };
      }
    }
    return { ok: true };
  }

  /* ================================================================
     TYPE 'timer' — DURATION + CREDIT
     ================================================================ */
  function durationMin(h) {
    var dm = parseInt(h && h.durationMin, 10);
    return (isNaN(dm) || dm < 1) ? DEFAULT_DUR : dm;
  }
  function durationMs(h) { return durationMin(h) * 60000; }

  function durLabel(mins) {
    mins = Math.max(1, Math.round(mins));
    if (mins < 60) return mins + 'm';
    var h = Math.floor(mins / 60), m = mins % 60;
    return m ? (h + 'h ' + m + 'm') : (h + 'h');
  }

  /* ek session ka credit : poora duration = 1, adhoora = proportional, cap 1 */
  function sessionCredit(h, elapsedMs) {
    var d = durationMs(h);
    if (!(d > 0)) return 0;
    var c = (Math.max(0, Number(elapsedMs) || 0)) / d;
    return Math.max(0, Math.min(1, c));
  }

  function sessionsOn(h, date) {
    var L = logOf(h, date);
    return (L && Array.isArray(L.sessions)) ? L.sessions : [];
  }

  /* ---------- study-timer state (ek line export add ki gayi hai) ---------- */
  function timerState() {
    try {
      if (window.ST && typeof window.ST.timerState === 'function') return window.ST.timerState();
    } catch (e) { /* ignore */ }
    return null;
  }
  function timerBusy() {
    var st = timerState();
    return !!(st && st.running);
  }

  /* ---------- pending session (reload/crash se bachane ke liye persisted) ---------- */
  function savePending(p) {
    try { window.AppStorage.saveAt(PEND_KEY, p); } catch (e) { /* ignore */ }
  }
  function loadPending() {
    try { return window.AppStorage.loadAt(PEND_KEY) || null; } catch (e) { return null; }
  }
  function clearPending() {
    try { window.AppStorage.saveAt(PEND_KEY, null); } catch (e) { /* ignore */ }
  }
  function pendingFor(habitId) {
    var p = loadPending();
    return (p && p.habitId === habitId) ? p : null;
  }

  /* timer start karo — category pass karne se popup SKIP ho jata hai */
  function startTimer(h, atMs) {
    if (typeOf(h) !== 'timer') return { ok: false, msg: 'Ye timer-type habit nahi hai.' };
    if (!window.ST || typeof window.ST.studyStart !== 'function') {
      return { ok: false, msg: 'Timer engine load nahi hua.' };
    }
    var date = todayISO();
    if (repsDone(h, date) >= reps(h)) {
      return { ok: false, msg: 'Aaj ke saare reps ho chuke.' };
    }
    if (timerBusy()) {
      var mine = pendingFor(h.id);
      return {
        ok: false,
        msg: mine ? 'Is habit ka timer pehle se chal raha hai.'
                  : 'Ek timer pehle se chal raha hai — pehle use khatam karo.',
        running: true,
        mine: !!mine
      };
    }
    var dur = durationMs(h);
    var startMs = Date.now();
    savePending({ habitId: h.id, durationMs: dur, startMs: startMs, date: date });
    try {
      window.ST.studyStart('count', dur, CAT);
    } catch (e) {
      clearPending();
      return { ok: false, msg: 'Timer start nahi ho paya.' };
    }
    return { ok: true, startMs: startMs, durationMs: dur };
  }

  /* ================================================================
     TICK — teeno types ka single entry point
     (good-list.js isi ko call karta hai, phir khud persist karta hai)
     ================================================================ */
  function applyTick(h, atMs) {
    var t = typeOf(h);
    var date = todayISO();
    var total = reps(h);

    /* STUDY-HABIT: manual tick allowed nahi — logs study-habit.js derive karta hai */
    if (t === 'study') {
      return { ok: false, type: t,
               msg: 'Study time Subject Tracker se apne aap aata hai — manual tick nahi hota.' };
    }

    var L = ensureLog(h, date);

    if ((L.done || 0) >= total) return { ok: false, msg: 'Aaj ke saare reps ho chuke.' };

    if (t === 'one') {
      L.done = Math.min(total, (L.done || 0) + 1);
      L.times.push(Date.now());
      return { ok: true, done: L.done, type: t };
    }

    if (t === 'time') {
      var a = activeSlot(h, atMs);
      if (!a) return { ok: false, msg: 'Abhi koi time-slot window active nahi hai.' };
      if (!L.slotTicks) L.slotTicks = {};
      if (L.slotTicks[a.index] != null) return { ok: false, msg: 'Ye slot pehle hi tick ho chuka.' };
      L.slotTicks[a.index] = Date.now();
      L.done = Math.min(total, Object.keys(L.slotTicks).length);
      L.times.push(Date.now());
      return { ok: true, done: L.done, type: t, slot: a.index };
    }

    /* timer : tap = timer start, credit session complete hone par */
    var r = startTimer(h, atMs);
    r.type = t;
    return r;
  }

  /* timer sessions se `done` dobara calculate karo (cap = reps) */
  function recomputeTimerDone(h, date) {
    var L = logOf(h, date); if (!L) return 0;
    var ss = Array.isArray(L.sessions) ? L.sessions : [];
    var sum = 0;
    ss.forEach(function (s) { sum += (Number(s.credit) || 0); });
    L.done = Math.max(0, Math.min(reps(h), sum));
    return L.done;
  }

  /* ================================================================
     DISPLAY HELPERS
     ================================================================ */
  /* fraction ho to decimal (1.7), warna integer (2) */
  function fmtReps(x) {
    x = Number(x) || 0;
    if (Math.abs(x - Math.round(x)) < 0.005) return String(Math.round(x));
    return (Math.round(x * 10) / 10).toFixed(1);
  }
  function repsText(h, date) {
    return 'today ' + fmtReps(repsDone(h, date)) + '/' + reps(h) + ' reps';
  }

  /* round button ki state — good-list.js ka "smart" button isi se chalta hai */
  function buttonState(h, atMs) {
    var t = typeOf(h);
    var date = todayISO();
    var done = repsDone(h, date), total = reps(h);
    var st = { type: t, done: done, total: total, enabled: false,
               complete: false, running: false, hint: '', label: '' };

    /* STUDY-HABIT: ye card DISPLAY-ONLY hai — time Subject Tracker se apne aap
       aata hai, manual tick ka koi matlab nahi. Isliye enabled hamesha false;
       good-list.js ka click handler toast dikha dega. */
    if (t === 'study') {
      st.displayOnly = true;
      st.complete = done >= total;
      st.hint = st.complete ? 'aaj ka study target poora'
                            : 'Study time Subject Tracker se apne aap aata hai';
      return st;
    }

    if (done >= total) {
      st.complete = true; st.hint = 'aaj poora ho gaya';
      return st;
    }
    if (t === 'one') {
      st.enabled = true; st.hint = 'tap → +1 rep';
      return st;
    }
    if (t === 'time') {
      var a = activeSlot(h, atMs);
      if (a) {
        st.enabled = true;
        st.activeIndex = a.index;
        st.hint = 'slot ' + (a.index + 1) + ' · ' + windowText(a.slot);
        return st;
      }
      var n = nextUnticked(h, atMs);
      /* hint thoda descriptive rakha — "next 07:00" se "agla slot 07:00" zyada
         samajh aata hai, aur button ke aria-label mein bhi yahi jata hai */
      st.hint = n ? ('agla slot ' + n.slot.t) : 'aaj ke slots khatam';
      return st;
    }
    /* timer */
    var p = pendingFor(h.id);
    if (timerBusy()) {
      st.running = true;
      var ts = timerState();
      st.remainingMs = ts ? ts.remainingMs : 0;
      st.hint = (p ? 'timer chal raha hai' : 'doosra timer chal raha hai');
      return st;
    }
    st.enabled = true;
    st.label = durLabel(durationMin(h));
    st.hint = durLabel(durationMin(h)) + ' timer start karo';
    return st;
  }

  /* ================================================================
     SAVE-PATH HOOK  —  ST.recordStudy ko wrap karna
     (ye SINGLE funnel hai : native finished, manual stop, reconcile,
      reload-recovery, pending, zombie — sab isi se guzarte hain)
     ================================================================ */
  var installed = false;
  var onChange = null;      /* UI refresh callback (good-list.js set karta hai) */

  function alreadyCredited(L, sid, startMs) {
    var ss = Array.isArray(L.sessions) ? L.sessions : [];
    for (var i = 0; i < ss.length; i++) {
      if (sid && ss[i].sid && ss[i].sid === sid) return true;
      if (!sid && startMs && Math.abs((ss[i].startMs || 0) - startMs) <= 3000) return true;
    }
    return false;
  }

  function onRecordStudy(ms, startMs, sid) {
    var p = loadPending();
    if (!p || !p.habitId) return;

    var stNum = Math.floor(Number(startMs) || 0);
    /* session hamara hi hai? startMs tolerance se match karo */
    if (stNum && Math.abs(stNum - p.startMs) > MATCH_TOLERANCE_MS) return;

    /* ORDERING-FIX: GoodList ready na ho to pending CLEAR mat karo — warna
       record kho jayega aur credit kabhi nahi milega. Pending rakho; good-list.js
       load hote hi reconcilePending() dobara koshish karega. */
    var GL = window.GoodList;
    if (!GL || typeof GL.addCredit !== 'function' || typeof GL.get !== 'function') return;
    var h = GL.get(p.habitId);
    if (!h) { clearPending(); return; }        /* habit delete ho chuka */

    clearPending();

    var date = p.date || todayISO();
    var L = ensureLog(h, date);
    if (alreadyCredited(L, sid, stNum)) return;

    var msNum = Math.max(0, Math.floor(Number(ms) || 0));
    var credit = sessionCredit(h, msNum);
    if (!(credit > 0)) return;

    GL.addCredit(h.id, credit, { ms: msNum, startMs: stNum, sid: sid || null, date: date });
  }

  /* ================================================================
     BOOT RECONCILE  —  "app timer chalte hue band ho gayi" wala case
     ----------------------------------------------------------------
     ORDERING PROBLEM: study-timer.js apna reconcile() khud LOAD hote hi
     chalata hai (index.html mein wo habit-types.js se PEHLE hai). Wo finished
     session ko ST.recordStudy se study-store mein save kar deta hai — lekin
     hamara wrapper tab tak install nahi hua hota, isliye habit ko credit
     milna chhoot jata.

     ISLIYE: wall-clock se elapsed guess NAHI karte (app 5 ghante baad khuli ho
     to galat full-credit mil jata). Uske bajaye study-store se ASLI saved ms
     uthate hain, startMs tolerance-match karke. Session na mile → koi credit
     nahi (guess karne se yahi behtar hai).
     ================================================================ */
  function reconcilePending() {
    var p = loadPending();
    if (!p || !p.habitId) return;

    var GL = window.GoodList;
    if (!GL || typeof GL.addCredit !== 'function' || typeof GL.get !== 'function') return;
    var h = GL.get(p.habitId);
    if (!h) { clearPending(); return; }

    /* timer abhi bhi chal raha hai? → recordStudy khud aayega, kuch mat karo */
    var ts = timerState();
    if (ts && ts.running) return;

    var found = null;
    try {
      var st = (window.ST && typeof window.ST.studyStore === 'function') ? window.ST.studyStore() : [];
      for (var i = st.length - 1; i >= 0; i--) {
        var e = st[i];
        if (!e || !e.startMs) continue;
        if (Math.abs(e.startMs - p.startMs) <= MATCH_TOLERANCE_MS) { found = e; break; }
      }
    } catch (e2) { found = null; }

    if (found) { onRecordStudy(found.ms, found.startMs, found.sessionId || null); return; }

    /* session mila hi nahi: ya 1s se chhota tha (recordStudy ka guard), ya save
       hi nahi hua. Pending ko hamesha ke liye atka kar rakhna galat hai. */
    clearPending();
  }

  function install() {
    if (installed) return;
    if (!window.ST || typeof window.ST.recordStudy !== 'function') return;
    installed = true;

    var orig = window.ST.recordStudy;
    window.ST.recordStudy = function (ms, startMs, sessionId, cat) {
      var out;
      try { out = orig.apply(this, arguments); }
      catch (e) { out = undefined; }
      try { onRecordStudy(ms, startMs, sessionId); }
      catch (e2) { /* habit credit kabhi study-save ko todna nahi chahiye */ }
      return out;
    };

    /* boot par bachi hui session ka hisaab (GoodList ready ho tabhi kuch hoga,
       warna pending safe rahega aur good-list.js dobara try karega) */
    try { reconcilePending(); } catch (e) { /* ignore */ }
  }

  /* ================================================================
     FORM UI — Add/Edit habit modal ka "Habit type" section
     (good-list.js sirf isko mount karta hai aur collect() se value leta hai)
     ================================================================ */
  function miniChips(values, initial, onChange) {
    var row = el('div');
    row.style.cssText = 'display:flex;gap:4px;flex-wrap:wrap';
    var cur = values.indexOf(initial) !== -1 ? initial : values[0];
    var btns = [];
    function paint() {
      values.forEach(function (v, i) {
        var sel = v === cur;
        btns[i].style.cssText = 'min-width:34px;padding:5px 7px;border-radius:9px;cursor:pointer;' +
          'font:inherit;font-size:11px;font-weight:700;transition:.15s;' +
          (sel ? 'background:var(--ink);color:var(--paper);border:1px solid var(--ink)'
               : 'background:var(--chip-bg);color:var(--slate);border:1px solid var(--s2)');
      });
    }
    values.forEach(function (v, i) {
      var b = el('button', null, String(v));
      b.type = 'button';
      b.addEventListener('click', function () { cur = v; paint(); if (onChange) onChange(v); });
      btns.push(b); row.appendChild(b);
    });
    paint();
    return { row: row, get: function () { return cur; } };
  }

  function smallLabel(txt) {
    var l = el('div', null, txt);
    l.style.cssText = 'font-size:9px;font-weight:700;letter-spacing:.11em;text-transform:' +
      'uppercase;color:var(--ash);margin:8px 0 4px';
    return l;
  }

  function buildTypeEditor(initial) {
    var state = {
      type: initial ? typeOf(initial) : 'one',
      reps: initial ? reps(initial) : 1,
      slots: (initial && Array.isArray(initial.slots)) ? initial.slots.map(normSlot) : [],
      durMin: initial ? durationMin(initial) : DEFAULT_DUR
    };
    state.durCustom = DUR_PRESETS.indexOf(state.durMin) === -1;

    /* STUDY-HABIT: study card ka apna editor hota hai (StudyHabit.openEditor),
       kyunki usme type-chooser hi nahi hota. Ye editor sirf 3 user-selectable
       types ke liye hai — defensive fallback. */
    if (state.type === 'study') state.type = 'one';

    var wrap = el('div');

    /* --- label + choose button --- */
    wrap.appendChild(UI.label('Habit type'));
    var btn = UI.pillBtn(typeObj(state.type).label + ' <span style="opacity:.55">▾</span>');
    btn.style.cssText += ';width:100%;justify-content:space-between;margin-bottom:8px';
    wrap.appendChild(btn);

    /* --- chooser : 3 options (button tap par khulte hain) --- */
    var chooser = el('div');
    chooser.style.cssText = 'display:none;flex-direction:column;gap:6px;margin-bottom:10px';
    var optBtns = [];
    TYPES.forEach(function (t, i) {
      var o = el('button');
      o.type = 'button';
      o.style.cssText = 'text-align:left;padding:10px 12px;border-radius:13px;cursor:pointer;' +
        'font:inherit;border:1px solid var(--s2);background:var(--chip-bg);transition:.15s';
      var nm = el('div', null, t.label);
      nm.style.cssText = 'font-size:13px;font-weight:700;color:var(--ink)';
      var ds = el('div', null, t.desc);
      ds.style.cssText = 'font-size:10.5px;line-height:1.45;color:var(--slate);margin-top:2px';
      o.appendChild(nm); o.appendChild(ds);
      o.addEventListener('click', function () {
        state.type = t.id;
        btn.innerHTML = t.label + ' <span style="opacity:.55">▾</span>';
        chooser.style.display = 'none';
        syncSlots();
        renderType();
      });
      optBtns.push(o);
      chooser.appendChild(o);
    });
    wrap.appendChild(chooser);

    function paintChooser() {
      optBtns.forEach(function (o, i) {
        var sel = TYPES[i].id === state.type;
        o.style.borderColor = sel ? 'var(--ink)' : 'var(--s2)';
        o.style.background = sel ? 'var(--chip-bg)' : 'var(--chip-bg)';
        o.style.boxShadow = sel ? 'inset 0 0 0 1px var(--ink)' : 'none';
      });
    }
    btn.addEventListener('click', function () {
      var open = chooser.style.display !== 'none';
      chooser.style.display = open ? 'none' : 'flex';
      if (!open) paintChooser();
    });

    /* --- type-specific fields --- */
    var typeBox = el('div');
    wrap.appendChild(typeBox);

    /* --- inline error --- */
    var errBox = el('div');
    errBox.style.cssText = 'display:none;margin:4px 0 10px;padding:9px 11px;border-radius:11px;' +
      'font-size:11.5px;line-height:1.45;background:rgba(208,74,74,.11);color:#c2453f;' +
      'border:1px solid rgba(208,74,74,.28)';
    wrap.appendChild(errBox);

    /* ---------- reps field (teeno types mein common) ---------- */
    var repsCtrl = null;
    function buildReps() {
      var f = UI.inputField('Repetition per day', 'e.g. 1, 2, 10', 'number');
      f.input.value = state.reps;
      f.input.addEventListener('input', function () {
        var n = parseInt(f.input.value, 10);
        state.reps = isNaN(n) ? 1 : Math.max(1, Math.min(50, n));
        if (state.type === 'time') { syncSlots(); renderSlots(); }
      });
      repsCtrl = f;
      return f.wrap;
    }

    /* slots ki length = reps (existing values preserve) */
    function syncSlots() {
      if (state.type !== 'time') return;
      while (state.slots.length < state.reps) {
        state.slots.push({ t: '', minus: 0, plus: 1 });
      }
      if (state.slots.length > state.reps) state.slots.length = state.reps;
    }

    /* ---------- 'time' : slot rows ---------- */
    var slotsBox = el('div');
    function renderSlots() {
      slotsBox.innerHTML = '';
      state.slots.forEach(function (slot, i) {
        var box = el('div');
        box.style.cssText = 'border:1px solid var(--s2);border-radius:14px;padding:9px 11px 10px;' +
          'margin-bottom:8px;background:var(--chip-bg)';

        var hd = el('div', null, 'Slot ' + (i + 1));
        hd.style.cssText = 'font-size:9px;font-weight:700;letter-spacing:.12em;' +
          'text-transform:uppercase;color:var(--ash);margin-bottom:6px';
        box.appendChild(hd);

        /* time */
        box.appendChild(smallLabel('Time'));
        var tIn = el('input');
        tIn.type = 'time';
        tIn.value = slot.t || '';
        tIn.style.cssText = UI.fieldCss;
        tIn.addEventListener('input', function () {
          slot.t = tIn.value ? toHHMM(toMin(tIn.value)) : '';
          paintWin();
        });
        box.appendChild(tIn);

        /* window preview */
        var win = el('div');
        win.style.cssText = 'font-size:10.5px;color:var(--slate);margin-top:7px;font-weight:600';
        box.appendChild(win);
        function paintWin() {
          win.innerHTML = slot.t
            ? ('Allowed window: <b style="color:var(--ink)">' + esc(windowText(slot)) + '</b>')
            : 'Allowed window: —';
        }

        /* minus */
        box.appendChild(smallLabel('Pehle kitna (− hour)'));
        var mC = miniChips(PM_STEPS, slot.minus, function (v) { slot.minus = v; paintWin(); });
        box.appendChild(mC.row);

        /* plus */
        box.appendChild(smallLabel('Baad mein kitna (+ hour)'));
        var pC = miniChips(PM_STEPS, slot.plus, function (v) { slot.plus = v; paintWin(); });
        box.appendChild(pC.row);

        paintWin();
        slotsBox.appendChild(box);
      });
      if (!state.slots.length) {
        var hint = el('div', null, 'Repetition set karo — utne hi slot ban jayenge.');
        hint.style.cssText = 'font-size:11px;color:var(--slate);margin-bottom:8px';
        slotsBox.appendChild(hint);
      }
    }

    /* ---------- 'timer' : duration ---------- */
    var durBox = el('div');
    function renderDur() {
      durBox.innerHTML = '';
      durBox.appendChild(smallLabel('Duration (kitni der ka session)'));
      var labels = DUR_PRESETS.map(durLabel).concat(['Custom']);
      var initIdx = state.durCustom ? labels.length - 1 : DUR_PRESETS.indexOf(state.durMin);
      if (initIdx < 0) { initIdx = 0; state.durMin = DUR_PRESETS[0]; state.durCustom = false; }
      var dC = miniChips(labels, labels[initIdx], function (v) {
        if (v === 'Custom') { state.durCustom = true; customWrap.style.display = ''; customIn.focus(); }
        else {
          state.durCustom = false;
          state.durMin = DUR_PRESETS[labels.indexOf(v)];
          customWrap.style.display = 'none';
        }
      });
      durBox.appendChild(dC.row);

      var customWrap = el('div');
      customWrap.style.marginTop = '8px';
      customWrap.style.display = state.durCustom ? '' : 'none';
      var customIn = el('input');
      customIn.type = 'number';
      customIn.min = '1';
      customIn.placeholder = 'custom minutes (e.g. 45)';
      customIn.value = state.durCustom ? state.durMin : '';
      customIn.style.cssText = UI.fieldCss;
      customIn.addEventListener('input', function () {
        var n = parseInt(customIn.value, 10);
        state.durMin = isNaN(n) ? 0 : Math.max(0, Math.min(1440, n));
      });
      customWrap.appendChild(customIn);
      durBox.appendChild(customWrap);
    }

    /* ---------- type ke hisaab se fields ---------- */
    function renderType() {
      typeBox.innerHTML = '';
      hideError();
      if (state.type === 'one') {
        typeBox.appendChild(buildReps());
      } else if (state.type === 'time') {
        syncSlots();
        typeBox.appendChild(buildReps());
        typeBox.appendChild(smallLabel('Time slots — har repetition ka apna slot'));
        renderSlots();
        typeBox.appendChild(slotsBox);
        var note = el('div', null,
          'Har slot sirf apni window ke andar tick hoga. Window raat 12 baje cross nahi karti ' +
          '(23:59 par clip). Ek slot = ek rep.');
        note.style.cssText = 'font-size:10.5px;line-height:1.5;color:var(--ash);margin:2px 0 10px';
        typeBox.appendChild(note);
      } else if (state.type === 'timer') {
        renderDur();
        typeBox.appendChild(durBox);
        typeBox.appendChild(buildReps());
        var note2 = el('div', null,
          'Har rep ke liye alag session zaroori hai — ' + durLabel(state.durMin) +
          ' ka timer poora chalao. Adhoora session proportional credit deta hai.');
        note2.style.cssText = 'font-size:10.5px;line-height:1.5;color:var(--ash);margin:2px 0 10px';
        typeBox.appendChild(note2);
      }
    }

    function showError(msg) {
      errBox.textContent = msg;
      errBox.style.display = 'block';
    }
    function hideError() { errBox.style.display = 'none'; }

    /* ---------- Save par value nikaalo ---------- */
    function collect() {
      hideError();
      var out = { type: state.type };
      var r = Math.max(1, parseInt(repsCtrl ? repsCtrl.input.value : state.reps, 10) || 1);
      out.repsPerDay = r;

      if (state.type === 'time') {
        syncSlots();
        var v = validateSlots(state.slots, r);
        if (!v.ok) { showError(v.msg); return { ok: false, msg: v.msg }; }
        out.slots = state.slots.map(normSlot);
        return { ok: true, value: out };
      }
      if (state.type === 'timer') {
        if (!(state.durMin >= 1)) {
          showError('Duration set karo — kam se kam 1 minute.');
          return { ok: false, msg: 'Duration set karo.' };
        }
        out.durationMin = state.durMin;
        return { ok: true, value: out };
      }
      return { ok: true, value: out };
    }

    renderType();
    return { wrap: wrap, collect: collect, showError: showError, state: state };
  }

  /* ================================================================
     PUBLIC API
     ================================================================ */
  window.HabitTypes = {
    /* constants */
    TYPES: TYPES, MAX_PM: MAX_PM, PM_STEPS: PM_STEPS,
    DUR_PRESETS: DUR_PRESETS, DEFAULT_DUR: DEFAULT_DUR, CAT: CAT,
    /* STUDY-HABIT */
    STUDY_TYPE: STUDY_TYPE, DEFAULT_STUDY_TARGET: DEFAULT_STUDY_TARGET,
    STUDY_TARGET_PRESETS: STUDY_TARGET_PRESETS,

    /* shape / migration */
    typeOf: typeOf, typeObj: typeObj, labelOf: labelOf,
    normalize: normalize, normSlot: normSlot, slots: slots,
    reps: reps, repsDone: repsDone, logOf: logOf, ensureLog: ensureLog,

    /* time slots */
    toMin: toMin, toHHMM: toHHMM, nowMin: nowMin, clampPM: clampPM,
    slotWindow: slotWindow, windowText: windowText,
    activeSlot: activeSlot, nextUnticked: nextUnticked,
    slotTickedOn: slotTickedOn, tickedCount: tickedCount,
    validateSlots: validateSlots,

    /* timer */
    durationMin: durationMin, durationMs: durationMs, durLabel: durLabel,
    sessionCredit: sessionCredit, sessionsOn: sessionsOn,
    timerState: timerState, timerBusy: timerBusy,
    startTimer: startTimer, pendingFor: pendingFor,

    /* tick + display */
    applyTick: applyTick, recomputeTimerDone: recomputeTimerDone,
    fmtReps: fmtReps, repsText: repsText, buttonState: buttonState,

    /* form UI */
    buildTypeEditor: buildTypeEditor, miniChips: miniChips,

    /* hooks */
    install: install, reconcilePending: reconcilePending,
    setOnChange: function (fn) { onChange = fn; },
    notifyChange: function () { try { if (onChange) onChange(); } catch (e) { } }
  };

  install();
})();
