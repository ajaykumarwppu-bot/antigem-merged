/* ================================================================
   CORE / DAY-CLOCK.JS  —  app ka APNA din ("Mera Din")
   ----------------------------------------------------------------
   PROBLEM : poora app "aaj" ke liye asli raat-12-baje wali tareekh
   use karta tha. Jo user raat 2 baje tak padhta hai uska 12 baje ke
   baad ka kaam "agle din" mein chala jaata tha → task miss/pending
   galat lagte the, streak toot-ti thi.

   SOLUTION : EK setting — "mera din kab shuru hota hai" (dayStart).
     dayStart = '08:00' ka matlab :
        asli 30-Sept 01:20  →  app-din = 29-Sept   (abhi bhi 29!)
        asli 30-Sept 08:00  →  app-din = 30-Sept
     Yani din tab palatta hai jab USER ka din shuru hota hai,
     midnight par nahi. Default '00:00' = purana behaviour (koi
     badlav nahi jab tak user khud na set kare).

   PURANA DATA UNTOUCHED (user ka decision) :
     `enabledAt` wo waqt hai jab user ne pehli baar non-midnight
     dayStart set kiya. is timestamp se PEHLE ke saare timestamps
     purane tareeke (asli tareekh) se hi bucket hote hain. Isliye
     purana hisaab-kitaab bilkul nahi hilta — sirf naya data naye
     rule par chalta hai.

   KYA BADALTA HAI / KYA NAHI :
     BADALTA : "aaj kaunsa din", "ye kaam kis din hua", streaks,
               dashboard "Aaj", habit/study day-logs
     NAHI    : exam countdown, timer ki lambai, habit 'time' type ke
               slot-times (wo asli ghadi par), user ki chuni tareekhen
   ================================================================ */

(function () {
  'use strict';

  if (window.__achivaDayClockLoaded) return;
  window.__achivaDayClockLoaded = true;

  var KEY = 'achiva.dayclock.v1';
  var DEFAULT_START = '00:00';

  var cache = null;

  /* ---------- storage (AppStorage na ho to in-memory fallback) ---------- */
  function load() {
    if (cache) return cache;
    var s = null;
    try {
      if (window.AppStorage && window.AppStorage.loadAt) s = window.AppStorage.loadAt(KEY);
    } catch (e) { s = null; }
    if (!s || typeof s !== 'object') s = { dayStart: DEFAULT_START, enabledAt: null };
    if (!/^\d{1,2}:\d{2}$/.test(String(s.dayStart || ''))) s.dayStart = DEFAULT_START;
    cache = s;
    return cache;
  }
  function save(s) {
    cache = s;
    try {
      if (window.AppStorage && window.AppStorage.saveAt) window.AppStorage.saveAt(KEY, s);
    } catch (e) { /* in-memory hi rahega */ }
  }

  /* ---------- helpers ---------- */
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function toMin(hhmm) {
    var p = String(hhmm || '00:00').split(':');
    var h = parseInt(p[0], 10) || 0, m = parseInt(p[1], 10) || 0;
    return Math.max(0, Math.min(23, h)) * 60 + Math.max(0, Math.min(59, m));
  }
  function realISO(ts) {
    var d = new Date(ts);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  /* ---------- core ---------- */
  function settings() {
    var s = load();
    return { dayStart: s.dayStart, enabledAt: s.enabledAt || null };
  }
  function isCustom() { return settings().dayStart !== DEFAULT_START; }

  /* kisi bhi timestamp ka APP-DIN.
     - dayStart midnight ho        → asli tareekh (purana behaviour)
     - timestamp enabledAt se purana → asli tareekh (purana data untouched)
     - warna                        → agar time-of-day < dayStart to din−1 */
  function dayOf(ts) {
    ts = (typeof ts === 'number' && isFinite(ts)) ? ts : Date.now();
    var s = settings();
    if (s.dayStart === DEFAULT_START) return realISO(ts);
    if (s.enabledAt && ts < s.enabledAt) return realISO(ts);
    var d = new Date(ts);
    if ((d.getHours() * 60 + d.getMinutes()) < toMin(s.dayStart)) {
      d.setDate(d.getDate() - 1);
    }
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  function today() { return dayOf(Date.now()); }

  /* setting set karo ; pehli baar non-midnight par enabledAt lagta hai
     (purana data usi waqt se freeze ho jaata hai) */
  function setDayStart(hhmm) {
    if (!/^\d{1,2}:\d{2}$/.test(String(hhmm || ''))) return false;
    var norm = pad2(toMin(hhmm) / 60 | 0) + ':' + pad2(toMin(hhmm) % 60);
    var s = load();
    s.dayStart = norm;
    if (norm !== DEFAULT_START && !s.enabledAt) s.enabledAt = Date.now();
    save(s);
    return true;
  }

  /* settings screen ke preview ke liye */
  function describe() {
    var now = Date.now();
    return {
      dayStart: settings().dayStart,
      enabledAt: settings().enabledAt,
      isCustom: isCustom(),
      appToday: today(),
      realToday: realISO(now),
      nowLabel: (function () {
        var d = new Date(now);
        return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
      })()
    };
  }

  /* settings ko atomically set karo (tests / migration / restore ke liye).
     setDayStart se alag : ye enabledAt ko bhi explicitly set kar sakta hai. */
  function configure(o) {
    var s = load();
    if (o && typeof o.dayStart === 'string' && /^\d{1,2}:\d{2}$/.test(o.dayStart)) {
      s.dayStart = pad2(toMin(o.dayStart) / 60 | 0) + ':' + pad2(toMin(o.dayStart) % 60);
    }
    if (o && ('enabledAt' in o)) s.enabledAt = o.enabledAt;
    save(s);
    return settings();
  }

  window.DayClock = {
    KEY: KEY,
    DEFAULT_START: DEFAULT_START,
    settings: settings,
    isCustom: isCustom,
    dayOf: dayOf,
    today: today,
    realISO: realISO,
    setDayStart: setDayStart,
    configure: configure,
    describe: describe,
    toMin: toMin
  };
})();
