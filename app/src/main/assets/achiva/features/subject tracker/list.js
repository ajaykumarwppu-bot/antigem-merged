/* ================================================================
   FEATURES / SUBJECT TRACKER / LIST.JS — thin orchestrator + bridge
   ----------------------------------------------------------------
   Ab sirf : load-order ke baad screens init karna aur
   window.SubjectListBridge expose karna (doosri features isi se
   screen-transition + state access karti hain).
   Baaki sab logic alag files mein :
     subject-store.js  → data + study-store
     study-timer.js    → timer + complete-alarm
     subject-screens.js→ screens + render + nav + modal + delete
   ================================================================ */

(function () {
  'use strict';
  if (window.__achivaListLoaded) return;
  window.__achivaListLoaded = true;

  var ST = window.ST;

  window.SubjectListBridge = {
    show: function (screenEl, forward) { ST.showScreen(screenEl, forward); },
    subjectScreen: function () { return ST.subjectScreen(); },
    getState: function () { return ST.getState(); },
    persist: ST.persist,
    openChapterViewTab: function (key) { ST.openChapterViewTab(key); }
  };

  ST.initScreens();

  /* app khulte hi DIRECT dashboard khule */
  if (window.Dashboard) { try { window.Dashboard.open(); } catch (e) { } }
})();
