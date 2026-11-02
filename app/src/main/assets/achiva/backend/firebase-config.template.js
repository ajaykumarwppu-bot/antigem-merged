// TEMPLATE — copy to backend/firebase-config.js and fill real values from Firebase console.
// The real firebase-config.js is git-ignored; never commit it.
/* ================================================================
   BACKEND / FIREBASE-CONFIG.JS — aapke Firebase project ki chaabi
   ----------------------------------------------------------------
   Responsibility:
     • Sirf CONFIG rakhti hai (koi logic nahi, koi UI nahi).
     • Firebase Console → Project settings → "Your apps" → Web app
       → SDK setup and configuration se mila hua object yahan
       paste karna hai.
     • Jab tak niche diye gaye "PASTE-YOUR-..." values replace nahi
       hoti, tab tak login / backup band rehta hai aur app pehle
       jaisa (bina login) chalta hai — isse app kabhi "tuti hui"
       nahi dikhti.
     • Setup ke step-by-step instructions: backend/FIREBASE_SETUP.md

   Load order (backend): 1/5
     firebase-config → cloud → auth → backup → settings
   ================================================================ */

(function () {
  'use strict';

  /* ---- Firebase se mila hua config object ----
     Example (real values FIREBASE_SETUP.md se copy karein):
       {
         apiKey: "YOUR_API_KEY",
         authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
         projectId: "YOUR_PROJECT_ID",
         storageBucket: "YOUR_PROJECT_ID.appspot.com",
         messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
         appId: "YOUR_APP_ID"
       }                                                        */
  var CONFIG = {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_PROJECT_ID.appspot.com",
    messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
    appId: "YOUR_APP_ID"
  };

  /* ---- config bhara gaya hai ya nahi? ---- */
  function isFilled(c) {
    if (!c) return false;
    var need = ['apiKey', 'authDomain', 'projectId', 'appId'];
    for (var i = 0; i < need.length; i++) {
      var v = c[need[i]];
      if (!v || typeof v !== 'string') return false;
      if (v.indexOf('PASTE-YOUR') === 0) return false;
    }
    return true;
  }

  /* window.ACHIVA_FIREBASE_CONFIG :
       null  → backend band (app bina login chalegi)
       {...} → backend chalu

     Agar config pehle se kisi aur jagah se set ho chuki ho (jaise
     testing harness) to use override NAHI karte.                */
  var pre = window.ACHIVA_FIREBASE_CONFIG;
  if (pre && typeof pre === 'object' && pre.projectId) {
    /* pehle se bhari hui config — wahi chalegi */
  } else {
    window.ACHIVA_FIREBASE_CONFIG = isFilled(CONFIG) ? CONFIG : null;
  }
})();
