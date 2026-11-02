/* ================================================================
   FEATURES / TIMER / TIMER-BRIDGE.JS  —  native bridge adapter
   ----------------------------------------------------------------
   • Detect karta hai ki APK ka native bridge (window.AchivaNative)
     maujood hai ya nahi (WebView shell mein injected hota hai)
   • Hai  → phone ka REAL usage data (total screen time, per-app
            sessions) on-demand fetch hota hai (battery-safe)
   • Nahi → timer.js MANUAL fallback mode chalaata hai
   • Koi background service/polling NAHIN — sirf call par query
   ================================================================ */

(function () {
  'use strict';

  if (window.__achivaTimerBridgeLoaded) return;
  window.__achivaTimerBridgeLoaded = true;

  function native() {
    return window.AchivaNative || null;
  }

  window.TimerBridge = {
    /* native shell maujood hai? */
    available: function () {
      var n = native();
      try {
        return !!(n && n.isReady && n.isReady() === '1');
      } catch (e) {
        return false;
      }
    },

    /* usage-access permission on hai? */
    hasPermission: function () {
      var n = native();
      try {
        return this.available() && n.hasUsagePermission() === '1';
      } catch (e) {
        return false;
      }
    },

    /* phone ki Usage-Access settings kholo (permission lene ke liye) */
    requestPermission: function () {
      var n = native();
      try {
        if (this.available()) n.openUsageSettings();
      } catch (e) { /* ignore */ }
    },

    /* aaj ka poora usage : { granted, totalMs, apps:[{name,totalMs,
       sessions:[{startMs,endMs}]}] }  — na milne par null */
    fetchToday: function (cb) {
      var n = native();
      if (!this.available()) { cb(null); return; }
      try {
        cb(JSON.parse(n.getTodayUsage()));
      } catch (e) {
        cb(null);
      }
    }
  };
})();
