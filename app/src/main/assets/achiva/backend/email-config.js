/* ================================================================
   BACKEND / EMAIL-CONFIG.JS — DEPRECATED (2026-10)
   ----------------------------------------------------------------
   • EmailJS OTP flow hata diya gaya — signup ab Firebase native
     email verification (sendEmailVerification) se hota hai.
   • Ye file sirf purane cached loaders ke crash rokne ke liye rakhi
     hai — hamesha null export karti hai, koi mail NAHI bhejti.
   • EmailJS account delete kar sakte hain (quota/cost bachao).
   • Naya setup: Firebase Console → Authentication → Templates →
     Email verification customize karein.
   ================================================================ */

(function () {
  'use strict';
  window.ACHIVA_EMAIL_CONFIG = null;
})();
