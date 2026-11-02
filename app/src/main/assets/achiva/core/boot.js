/* ================================================================
   CORE / BOOT.JS — backend boot (sabse aakhri script)
   ----------------------------------------------------------------
   Pehle index.html ke end mein inline <script> tha — IndexedDB
   migration (v3) mein loader-manifest ki aakhri entry ban gayi.
   LOGIC BILKUL UNCHANGED.
   Pehle Firestore ready, phir login gate chalu.
   (Gate ka HTML upar #authGate mein hai, isliye scripts load
   hote waqt app dikhta hi nahi.)
   ================================================================ */
    (function () {
      'use strict';
      if (window.AchivaCloud) window.AchivaCloud.init();
      if (window.AchivaAuth) {
        window.AchivaAuth.boot();
        /* sign out hote hi login gate wapas — app bina login nahi chalegi */
        window.AchivaAuth.onSignOut(function () { window.AchivaAuth.showGate(); });
      }
    })();
