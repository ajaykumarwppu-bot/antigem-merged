/* ================================================================
   FEATURES / HABIT / STUDY-HABIT.JS  —  default "Study" habit card
   ----------------------------------------------------------------
   Goals wale STUDY-GOALS bridge ka exact mirror pattern, lekin
   subject-wise NAHI — ek hi SINGLE card jo saare subjects + chapters
   ka poora padhai-time aggregate karta hai.

   ── CARD KA RULE (user requirement) ──
     • Default hai, apne aap banta hai
     • DELETE nahi ho sakta
     • DISABLE nahi ho sakta — compulsory hai
     • Sirf EDIT allowed (daily target + start date + strict level)

   ── TIME KA SOURCE ──
     exam-widget.js (Subject screen ka top card) jis tarah
     "total study hours" nikaalta hai — BILKUL WAHI:
         ST.studyStore() ke saare entries ka `ms` jod, koi filter nahi.
     Isliye Study card ka total aur exam-widget ka total HAMESHA exactly
     barabar rahenge. Yahan hum usi ko startMs se DAY-wise group karte hain.

   ── SCORING (GoodSystem.js untouched) ──
     repsPerDay = 1
     done       = min(dayMinutes / studyTargetMin, 1)
     → target poora  = 'done'    (streak +1, poora gain)
     → adhoora       = 'minimum' (streak +1, 45% gain)
     → zero          = 'missed'  (grace / penalty)
     Ye GoodSystem ke existing 3-state design mein exactly fit hota hai.

   ── DERIVE, NA KI INCREMENTAL ──
     logs har baar studyStore se FRESH compute hote hain (incremental add
     nahi), isliye double-count / dedupe ka sawal hi nahi uthta.

   Subject Tracker ki KOI file chhui nahi — sirf data read + wrap
   (study-goals.js jaisa hi).
   ================================================================ */

(function () {
  'use strict';

  if (window.__achivaStudyHabitLoaded) return;
  window.__achivaStudyHabitLoaded = true;

  var el = UI.el, esc = UI.esc;

  var STUDY_ID = 'study-auto';
  var NAME = 'Study';
  var DEFAULT_TARGET = (window.HabitTypes && window.HabitTypes.DEFAULT_STUDY_TARGET) || 60;
  var TARGET_PRESETS = (window.HabitTypes && window.HabitTypes.STUDY_TARGET_PRESETS) || [30, 60, 90, 120, 180, 240];
  var MAX_DAYS = 5000;                 /* guard: infinite loop se bachao */

  function HT() { return window.HabitTypes || null; }
  function GL() { return window.GoodList || null; }

  /* ---------- date helpers ---------- */
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  /* local din ka ISO — study-goals.js wala hi tareeka, taaki grouping
     goals aur habits mein consistent rahe */
  /* DAY-CLOCK : session ka din app ke apne din se (raat 12 ke baad ka kaam
     pichhle din mein). Purana data DayClock ke enabledAt cutoff se untouched. */
  function localISO(ms) {
    if (window.DayClock && window.DayClock.dayOf) return window.DayClock.dayOf(ms);
    var d = new Date(ms);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  function appToday() {
    return window.DayClock ? window.DayClock.today() : UI.todayISO();
  }

  /* ---------- study store read ---------- */
  function entries() {
    try {
      return (window.ST && typeof window.ST.studyStore === 'function')
        ? (window.ST.studyStore() || []) : [];
    } catch (e) { return []; }
  }

  /* exam-widget.js ke totalHours() jaisa hi — koi filter NAHI */
  function totalMs() {
    var ms = 0, e = entries();
    for (var i = 0; i < e.length; i++) ms += (e[i] && e[i].ms) || 0;
    return ms;
  }
  /* exam-widget.js ke fmtHM() se EXACTLY same format */
  function fmtHM(ms) {
    var t = Math.floor((ms || 0) / 60000);
    var h = Math.floor(t / 60), m = t % 60;
    return h + ' hr ' + m + ' min';
  }
  function totalText() { return fmtHM(totalMs()); }

  /* day-wise minutes (fractional minutes bhi, round display par) */
  function minutesByDate() {
    var map = {}, e = entries();
    for (var i = 0; i < e.length; i++) {
      var s = e[i];
      if (!s) continue;
      var t = s.startMs || s.endMs || Date.now();
      var d = localISO(t);
      map[d] = (map[d] || 0) + Math.max(0, (s.ms || 0) / 60000);
    }
    return map;
  }

  /* ---------- card identify ---------- */
  function isStudyCard(hOrId) {
    if (!hOrId) return false;
    if (typeof hOrId === 'string') return hOrId === STUDY_ID;
    return hOrId.id === STUDY_ID || hOrId.type === 'study';
  }
  function getCard() {
    var g = GL();
    return g ? g.get(STUDY_ID) : null;
  }

  /* ---------- ensure: card na ho to banao ---------- */
  function ensure() {
    var g = GL();
    if (!g) return null;
    var h = g.get(STUDY_ID);
    if (!h) {
      h = {
        id: STUDY_ID,
        name: NAME,
        desc: 'Subject Tracker ka poora padhai-time — saare subjects aur chapters ka jod. ' +
              'Ye default card hai, delete nahi ho sakta.',
        type: 'study',
        repsPerDay: 1,
        studyTargetMin: DEFAULT_TARGET,
        startDate: appToday(),
        strict: 3,
        studyLinked: Date.now(),
        system: true,          /* delete-protection + AUTO badge ka flag */
        startAuto: true,       /* startDate auto-set hua (user ne nahi chuna) */
        logs: {}
      };
      g.addHabit(h);           /* addHabit khud normalize + persist karta hai */
      h = g.get(STUDY_ID) || h;
    }
    if (HT()) HT().normalize(h);
    /* normalize ke baad bhi system flag pakka rakho (purane data ke liye) */
    if (!h.system) { h.system = true; g.persist(); }
    if (h.name !== NAME) { h.name = NAME; }
    return h;
  }

  /* ---------- sync: logs ko studyStore se FRESH derive karo ---------- */
  function sync() {
    var h = ensure();
    if (!h) return null;
    var g = GL();

    var map = minutesByDate();
    var target = h.studyTargetMin || DEFAULT_TARGET;
    var today = appToday();
    var start = h.startDate || today;
    /* BUG-FIX (DayClock): agar setting raat 12 ke baad enable hui to app-aaj
       PURANA din hota hai, jabki auto startDate naya tha → range khaali ho kar
       card 8 baje tak khaali dikhta. Auto start date ko app-aaj se aage mat
       jaane do. User ne khud start date chuni ho (startAuto:false) to unki
       choice respect hoti hai. */
    if (h.startAuto !== false && start > today) start = today;

    if (!h.logs || typeof h.logs !== 'object') h.logs = {};

    /* startDate se aaj tak har din materialize karo */
    var d = start, guard = 0;
    while (d <= today && guard < MAX_DAYS) {
      var mins = map[d] || 0;
      var L = h.logs[d] || (h.logs[d] = { done: 0, times: [] });
      if (!Array.isArray(L.times)) L.times = [];
      L.minutes = Math.round(mins * 10) / 10;
      L.done = Math.max(0, Math.min(1, mins / target));
      d = UI.addDays(d, 1);
      guard++;
    }

    /* startDate badalne par range se bahar ke stale logs hata do —
       warna good-list ka bestStreak() purane din bhi gin lega.
       (ISO date strings lexicographically compare ho sakti hain.) */
    var keys = Object.keys(h.logs);
    for (var i = 0; i < keys.length; i++) {
      if (keys[i] < start || keys[i] > today) delete h.logs[keys[i]];
    }

    g.persist();
    return h;
  }

  /* ---------- display helpers ---------- */
  function minutesOn(h, date) {
    h = h || getCard();
    if (!h) return 0;
    var L = (h.logs || {})[date || appToday()];
    return L ? (L.minutes || 0) : 0;
  }
  function fmtMin(m) {
    m = Math.round((Number(m) || 0) * 10) / 10;
    return (Math.round(m) === m) ? String(Math.round(m)) : m.toFixed(1);
  }
  /* list card ki line : "today 42/60 min" */
  function lineText(h) {
    h = h || getCard();
    if (!h) return '';
    var mins = minutesOn(h);
    return 'today ' + fmtMin(mins) + '/' + (h.studyTargetMin || DEFAULT_TARGET) + ' min';
  }
  /* aaj kitna % target poora hua (0..100) */
  function todayPct(h) {
    h = h || getCard();
    if (!h) return 0;
    var t = h.studyTargetMin || DEFAULT_TARGET;
    return Math.max(0, Math.min(100, Math.round((minutesOn(h) / t) * 100)));
  }

  /* ---------- UI refresh ---------- */
  function afterChange() {
    try { if (GL() && GL().refreshList) GL().refreshList(); } catch (e) { }
    try { if (window.GoodDetail && window.GoodDetail.refresh) window.GoodDetail.refresh(); } catch (e) { }
  }

  /* ================================================================
     EDIT MODAL — sirf target / start date / strict level
     (naam locked, type locked, delete/disable NAHI)
     ================================================================ */
  function openEditor(h) {
    h = h || sync() || ensure();
    if (!h) return;

    var m = UI.modal({ zScrim: 85, zWrap: 86 });
    m.sheet.style.maxHeight = 'calc(100% - 26px)';
    m.sheet.style.boxSizing = 'border-box';
    m.sheet.style.display = 'flex';
    m.sheet.style.flexDirection = 'column';
    m.body.style.overflowY = 'auto';
    m.body.style.flex = '1 1 auto';
    m.body.style.minHeight = '0';

    var startISO = h.startDate || appToday();
    var targetMin = h.studyTargetMin || DEFAULT_TARGET;
    var targetCustom = TARGET_PRESETS.indexOf(targetMin) === -1;

    /* --- locked info note --- */
    var note = el('div');
    note.style.cssText = 'margin-bottom:12px;padding:10px 12px;border:1px dashed var(--s2);' +
      'border-radius:12px;font-size:11px;line-height:1.55;color:var(--slate)';
    note.innerHTML = '<b style="color:var(--ink)">Study</b> ek default card hai — ' +
      'delete ya disable nahi ho sakta. Padhai ka time Subject Tracker se ' +
      '<b style="color:var(--ink)">apne aap</b> aata hai (saare subjects + chapters ka jod). ' +
      'Yahan sirf daily target, start date aur strict level badal sakte ho.';

    /* --- daily target --- */
    var tLabel = UI.label('Daily target (kitni der padhai)');
    var labels = TARGET_PRESETS.map(function (x) { return HT() ? HT().durLabel(x) : (x + 'm'); });
    labels.push('Custom');
    var initIdx = targetCustom ? labels.length - 1 : TARGET_PRESETS.indexOf(targetMin);
    if (initIdx < 0) initIdx = 1;
    var tChips = HT() ? HT().miniChips(labels, labels[initIdx], null) : null;

    var customWrap = el('div');
    customWrap.style.marginTop = '8px';
    customWrap.style.display = targetCustom ? '' : 'none';
    var customIn = el('input');
    customIn.type = 'number';
    customIn.min = '1';
    customIn.placeholder = 'custom minutes (e.g. 45)';
    customIn.value = targetCustom ? targetMin : '';
    customIn.style.cssText = UI.fieldCss;
    customWrap.appendChild(customIn);

    if (tChips) {
      tChips.row.addEventListener('click', function () {
        var sel = tChips.get();
        if (sel === 'Custom') {
          targetCustom = true;
          customWrap.style.display = '';
          customIn.focus();
        } else {
          targetCustom = false;
          targetMin = TARGET_PRESETS[labels.indexOf(sel)];
          customWrap.style.display = 'none';
        }
      });
    }

    /* --- start date --- */
    var startB = UI.pillBtn('Start: ' + UI.fmtDate(startISO));
    startB.style.cssText += ';width:100%;justify-content:flex-start;margin:4px 0 12px';
    startB.addEventListener('click', function () {
      if (!window.AchivaCalendar) return;
      window.AchivaCalendar.open('Study start date', startISO, function (iso) {
        startISO = iso;
        startB.innerHTML = 'Start: ' + UI.fmtDate(iso);
      });
    });

    /* --- strict level --- */
    var strictR = UI.chipRow(['1', '2', '3', '4', '5'], String(h.strict || 3));

    /* --- error --- */
    var errBox = el('div');
    errBox.style.cssText = 'display:none;margin:4px 0 10px;padding:9px 11px;border-radius:11px;' +
      'font-size:11.5px;line-height:1.45;background:rgba(208,74,74,.11);color:#c2453f;' +
      'border:1px solid rgba(208,74,74,.28)';

    m.open('Study card', function (body) {
      body.appendChild(note);
      body.appendChild(tLabel);
      if (tChips) body.appendChild(tChips.row);
      body.appendChild(customWrap);
      body.appendChild(UI.label('Start date'));
      body.appendChild(startB);
      body.appendChild(UI.label('Strict level (1 = strictest, 5 = lenient)'));
      body.appendChild(strictR.row);
      strictR.row.style.margin = '6px 0 12px';
      body.appendChild(errBox);
    }, function () {
      var tm = targetCustom
        ? parseInt(customIn.value, 10)
        : targetMin;
      if (isNaN(tm) || tm < 1) {
        errBox.textContent = 'Daily target set karo — kam se kam 1 minute.';
        errBox.style.display = 'block';
        return;
      }
      tm = Math.max(1, Math.min(1440, tm));

      h.studyTargetMin = tm;
      h.startDate = startISO;
      h.startAuto = false;     /* user ne khud chuni — ab clamp mat karo */
      h.strict = parseInt(strictR.get(), 10) || 3;
      h.name = NAME;                       /* naam locked */
      h.type = 'study';                    /* type locked */
      h.repsPerDay = 1;
      if (HT()) HT().normalize(h);

      sync();                              /* naye target/date se logs recompute */
      afterChange();
      m.close();
      if (window.GoodDetail) window.GoodDetail.open(h.id);
    });
  }

  /* ================================================================
     ST.recordStudy WRAP  —  live sync
     (chain mein TEESRA wrapper: study-goals → habit-types → ye.
      teeno orig ko call karte hain, isliye sab saath chalte hain.)
     ================================================================ */
  function wrapRecord() {
    if (!window.ST || window.ST.__studyHabitWrap) return;
    var orig = window.ST.recordStudy;
    if (typeof orig !== 'function') return;
    var wrapped = function (ms, startMs, sessionId, cat) {
      var out = orig.apply(this, arguments);
      try { sync(); afterChange(); } catch (e) { }
      /* FOCUS SHIELD : target-mode rules ko live state bhejo
         (studyMinutes / targetDone) — block tabhi khulta hai jab target ho */
      try {
        if (window.AchivaFocus && window.AchivaFocus.pushState) window.AchivaFocus.pushState();
      } catch (e2) { }
      return out;
    };
    wrapped.__studyHabitWrap = true;
    window.ST.recordStudy = wrapped;
    window.ST.__studyHabitWrap = true;
  }

  /* ---------- boot ---------- */
  wrapRecord();
  try { sync(); } catch (e) { /* GoodList ready na ho to ignore */ }
  try {
    if (window.AchivaFocus && window.AchivaFocus.syncAll) window.AchivaFocus.syncAll();
  } catch (e2) { /* ignore */ }

  window.StudyHabit = {
    ID: STUDY_ID, NAME: NAME,
    DEFAULT_TARGET: DEFAULT_TARGET, TARGET_PRESETS: TARGET_PRESETS,

    isStudyCard: isStudyCard,
    getCard: getCard,
    ensure: ensure,
    sync: sync,

    /* time */
    entries: entries, totalMs: totalMs, fmtHM: fmtHM, totalText: totalText,
    minutesByDate: minutesByDate, minutesOn: minutesOn,

    /* display */
    lineText: lineText, fmtMin: fmtMin, todayPct: todayPct,

    /* ui */
    openEditor: openEditor,
    isWrapped: function () { return !!(window.ST && window.ST.__studyHabitWrap); }
  };
})();
