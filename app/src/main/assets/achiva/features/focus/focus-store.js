/* ================================================================
   FEATURES / FOCUS / FOCUS-STORE.JS — Focus Shield (Tier-1) data+sync
   ----------------------------------------------------------------
   Rules/settings web mein author hote hain (Settings → Focus Shield)
   aur native FocusService ko push kiye jaate hain (Bridge), taaki
   blocking WebView band hone par bhi chale.

   Storage : 'achiva.focus.v1' = { rules:[], settings:{}, log:[] }
     rules    : [{id,name,apps[],mode:'time'|'target'|'timer',
                  days[],start,end,timerMin,active}]
     settings : {cooldownMin, strictLevel:'normal'|'strict'|'ultra',
                 bootStart, overlayText}
     log      : unlock attempts + mode changes (native state se sync)

   Native mirror : FocusRules.kt (same semantics). JS evaluateRule()
   sirf UI-preview ke liye hai (asal enforcement native karti hai).

   Days convention : 1=Sunday … 7=Saturday (Calendar.DAY_OF_WEEK).
   Time-windows REAL clock par (jaise habit slots) ; 'target' mode
   DayClock-aware study-minutes use karta hai (web push karta hai).
   ================================================================ */

(function () {
  'use strict';

  if (window.__achivaFocusStoreLoaded) return;
  window.__achivaFocusStoreLoaded = true;

  var KEY = 'achiva.focus.v1';

  function def() {
    return {
      rules: [],
      settings: {
        cooldownMin: 5,
        /* STRICT-LEVELS (3-tier) :
           'normal' = emergency unlock ek tap par (cooldown + log)
           'strict' = unlock sirf 5-sec LONG-PRESS par + 2× cooldown + log
           'ultra'  = emergency unlock NAHI (overlay par sirf [Achiva kholo]
                      aur [Back]; settings ka "Abhi unlock" bhi disabled) —
                      nikalne ka raasta sirf rule OFF / mode change (logged)
                      ya app uninstall */
        strictLevel: 'normal',
        bootStart: true,
        overlayText: ''
      },
      log: []
    };
  }
  function load() {
    var d = null;
    try { d = window.AppStorage.loadAt(KEY); } catch (e) { d = null; }
    if (!d || typeof d !== 'object') d = def();
    if (!Array.isArray(d.rules)) d.rules = [];
    if (!d.settings || typeof d.settings !== 'object') d.settings = def().settings;
    if (!Array.isArray(d.log)) d.log = [];
    /* MIGRATION: purana strict:boolean → strictLevel (3-level system).
       Purana strict-toggle cooldownMin ko DOUBLE store karta tha — base
       wapas laao (2× ab native 'strict' level khud lagata hai, isliye
       effective cooldown pehle jaisa hi rehta hai). */
    var s = d.settings;
    if (s.strictLevel !== 'normal' && s.strictLevel !== 'strict' && s.strictLevel !== 'ultra') {
      if (s.strict === true) {
        s.strictLevel = 'strict';
        s.cooldownMin = Math.max(1, Math.round((s.cooldownMin || 10) / 2));
      } else {
        s.strictLevel = 'normal';
      }
      delete s.strict;
      try { window.AppStorage.saveAt(KEY, d); } catch (e) { /* ignore */ }
    }
    return d;
  }
  function save(d) {
    /* log ko hamesha 100 entries par cap rakho (kahin se bhi likha jaaye) */
    if (d && Array.isArray(d.log) && d.log.length > 100) d.log = d.log.slice(-100);
    try { window.AppStorage.saveAt(KEY, d); } catch (e) { /* ignore */ }
  }

  function native() {
    var n = window.AchivaNative || null;
    try { return (n && n.isReady && n.isReady() === '1') ? n : null; }
    catch (e) { return null; }
  }
  function hasNative() { return !!native(); }

  /* ---------- rules CRUD ---------- */
  function rules() { return load().rules; }
  function settings() { return load().settings; }

  function addRule(r) {
    var d = load();
    r.id = r.id || ('f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
    if (!Array.isArray(r.apps)) r.apps = [];
    if (!Array.isArray(r.days)) r.days = [];
    r.active = r.active !== false;
    d.rules.push(r);
    save(d); syncAll();
    return r;
  }
  function updateRule(id, patch) {
    var d = load();
    d.rules.forEach(function (r) {
      if (r.id !== id) return;
      for (var k in patch) if (Object.prototype.hasOwnProperty.call(patch, k)) r[k] = patch[k];
    });
    save(d); syncAll();
  }
  function removeRule(id) {
    var d = load();
    d.rules = d.rules.filter(function (r) { return r.id !== id; });
    save(d); syncAll();
  }
  function toggleRule(id) {
    var d = load();
    d.rules.forEach(function (r) { if (r.id === id) r.active = !r.active; });
    save(d); syncAll();
  }
  function setSettings(patch) {
    var d = load();
    for (var k in patch) if (Object.prototype.hasOwnProperty.call(patch, k)) d.settings[k] = patch[k];
    save(d); syncAll();
  }

  /* ---------- JS mirror of FocusRules.isActive (UI preview) ---------- */
  function toMin(hhmm) {
    var p = String(hhmm || '00:00').split(':');
    return (parseInt(p[0], 10) || 0) * 60 + (parseInt(p[1], 10) || 0);
  }
  function evaluateRule(r, nowMs, st) {
    st = st || currentState();
    if (!r || r.active === false) return false;
    if (st.unlockUntil > nowMs) return false;
    var d = new Date(nowMs);
    if (r.days && r.days.length) {
      if (r.days.indexOf(d.getDay() + 1) === -1) return false;   /* 1=Sun */
    }
    var m = r.mode || 'time';
    if (m === 'time') {
      var now = d.getHours() * 60 + d.getMinutes();
      var s = toMin(r.start), e = toMin(r.end);
      return (s <= e) ? (now >= s && now < e) : (now >= s || now < e);
    }
    if (m === 'target') return !st.targetDone;
    if (m === 'timer') return !!st.timerRunning;
    return false;
  }

  /* ---------- live state (study target + timer) ---------- */
  function currentState() {
    var st = { targetDone: false, studyMinutes: 0, targetMinutes: 60,
               timerRunning: false, unlockUntil: 0, unlockCount: 0, lastUnlockAt: 0 };
    try {
      var SH = window.StudyHabit;
      if (SH && SH.getCard && SH.minutesOn) {
        var c = SH.getCard();
        if (c) {
          st.studyMinutes = Math.round(SH.minutesOn(c) || 0);
          st.targetMinutes = c.studyTargetMin || 60;
          st.targetDone = st.studyMinutes >= st.targetMinutes;
        }
      }
      if (window.ST && window.ST.timerState) {
        var t = window.ST.timerState();
        st.timerRunning = !!(t && t.running);
      }
      var n = native();
      if (n && n.focusGetAll) {
        var all = JSON.parse(n.focusGetAll() || '{}');
        var ns = JSON.parse(all.state || '{}');
        st.unlockUntil = ns.unlockUntil || 0;
        st.unlockCount = ns.unlockCount || 0;
        st.lastUnlockAt = ns.lastUnlockAt || 0;
      }
    } catch (e) { /* ignore */ }
    return st;
  }

  /* ---------- native sync ---------- */
  function syncAll() {
    var n = native();
    if (!n) return;
    var d = load();
    try {
      if (n.focusSetRules) n.focusSetRules(JSON.stringify(d.rules));
      if (n.focusSetSettings) n.focusSetSettings(JSON.stringify(d.settings));
      pushState();
      /* service ko settings ke mutabik chalo/rokо */
      var anyActive = d.rules.some(function (r) { return r.active !== false; });
      if (anyActive && n.focusStart) n.focusStart();
      else if (!anyActive && n.focusStop) n.focusStop();
    } catch (e) { /* ignore */ }
  }
  function pushState() {
    var n = native();
    if (!n || !n.focusPushState) return;
    try { n.focusPushState(JSON.stringify(currentState())); } catch (e) { /* ignore */ }
  }

  /* ---------- permissions / service ---------- */
  function permissions() {
    var n = native();
    if (!n) return { usage: false, overlay: false, native: false };
    return {
      native: true,
      usage: n.focusHasUsage ? n.focusHasUsage() === '1' : false,
      overlay: n.focusHasOverlay ? n.focusHasOverlay() === '1' : false
    };
  }
  function running() {
    var n = native();
    return !!(n && n.focusRunning && n.focusRunning() === '1');
  }
  function start() { var n = native(); if (n && n.focusStart) n.focusStart(); }
  function stop() { var n = native(); if (n && n.focusStop) n.focusStop(); }
  function listApps() {
    var n = native();
    if (!n || !n.focusListApps) return [];
    try {
      var a = JSON.parse(n.focusListApps() || '[]');
      a.sort(function (x, y) { return String(x.label).localeCompare(String(y.label)); });
      return a;
    } catch (e) { return []; }
  }
  function unlock(minutes) {
    /* ULTRA STRICT : emergency unlock exist hi nahi karta — settings ka
       "Abhi unlock" pill bhi disabled hai, ye guard uska backup hai. */
    if (settings().strictLevel === 'ultra') return false;
    var n = native();
    if (n && n.focusUnlock) n.focusUnlock(minutes || settings().cooldownMin || 5);
    var d = load();
    d.log.push({ at: Date.now(), type: 'unlock', min: minutes || settings().cooldownMin || 5 });
    if (d.log.length > 100) d.log = d.log.slice(-100);
    save(d);
    return true;
  }
  function strictLevel() {
    var l = settings().strictLevel;
    return (l === 'strict' || l === 'ultra') ? l : 'normal';
  }
  function setStrictLevel(level) {
    var from = strictLevel();
    var to = (level === 'strict' || level === 'ultra') ? level : 'normal';
    if (from === to) return false;
    setSettings({ strictLevel: to });
    /* mode-change ka AUDIT LOG — ultra se nikalna bhi record hota hai */
    var d = load();
    d.log.push({ at: Date.now(), type: 'mode', from: from, to: to });
    if (d.log.length > 100) d.log = d.log.slice(-100);
    save(d);
    return true;
  }
  function log() { return load().log; }

  /* ---------- timer start/stop par state push (wrap) ---------- */
  function wrapTimer() {
    if (!window.ST || window.ST.__focusWrap) return;
    var os = window.ST.studyStart, op = window.ST.studyStop;
    if (typeof os === 'function') {
      window.ST.studyStart = function () {
        var out = os.apply(this, arguments);
        try { pushState(); } catch (e) { }
        return out;
      };
    }
    if (typeof op === 'function') {
      window.ST.studyStop = function () {
        var out = op.apply(this, arguments);
        try { pushState(); } catch (e) { }
        return out;
      };
    }
    window.ST.__focusWrap = true;
  }

  wrapTimer();

  /* ---------- boot sync ----------
     focus-store.js study-habit.js ke BAAD load hota hai, isliye study-habit ka
     boot-hook (AchivaFocus.syncAll) us waqt no-op hota hai. Isliye store khud
     boot par rules/settings/state native ko bhejta hai — warna phone par app
     kholne ke baad purane rules enforce hi na hote. */
  try { syncAll(); } catch (e) { /* ignore */ }

  /* app wapas foreground mein aaye (ya page visible ho) to state refresh —
     study-minutes/target native ke paas fresh rahe */
  function onVisible() {
    try {
      if (document && document.hidden) return;
      syncAll();
    } catch (e) { /* ignore */ }
  }
  try {
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
  } catch (e) { /* ignore */ }

  window.AchivaFocus = {
    KEY: KEY,
    load: load, save: save,
    rules: rules, settings: settings,
    addRule: addRule, updateRule: updateRule, removeRule: removeRule, toggleRule: toggleRule,
    setSettings: setSettings,
    evaluateRule: evaluateRule, currentState: currentState,
    syncAll: syncAll, pushState: pushState,
    permissions: permissions, running: running, start: start, stop: stop,
    listApps: listApps, unlock: unlock, log: log,
    strictLevel: strictLevel, setStrictLevel: setStrictLevel,
    hasNative: hasNative, toMin: toMin
  };
})();
