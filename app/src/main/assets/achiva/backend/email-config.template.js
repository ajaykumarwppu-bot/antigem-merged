// TEMPLATE — copy to backend/email-config.js and fill real EmailJS values.
/* ================================================================
   BACKEND / EMAIL-CONFIG.JS — email verification code service (EmailJS)
   ----------------------------------------------------------------
   • Signup step-1 ka ONE-TIME code EmailJS REST se bheja jaata hai.
   • EmailJS template mein variables : {{to_email}} {{code}} {{app_name}}
   • publicKey = EmailJS → Account → API Keys → PUBLIC KEY.
   • Values fill na hon to email-code signup band (Google + login chalte hain).
   • Secret key kabhi yahan NA daalein.
   ================================================================ */

(function () {
  'use strict';

  var CONFIG = {
    publicKey: "YOUR_EMAILJS_PUBLIC_KEY",
    serviceId: "YOUR_SERVICE_ID",
    templateId: "YOUR_TEMPLATE_ID"
  };

  function isFilled(c) {
    if (!c) return false;
    var need = ['publicKey', 'serviceId', 'templateId'];
    for (var i = 0; i < need.length; i++) {
      var v = c[need[i]];
      if (!v || typeof v !== 'string') return false;
      if (v.indexOf('YOUR_') === 0) return false;
    }
    return true;
  }

  var pre = window.ACHIVA_EMAIL_CONFIG;
  if (pre && typeof pre === 'object' && pre.publicKey) {
    /* wahi chalegi */
  } else {
    window.ACHIVA_EMAIL_CONFIG = isFilled(CONFIG) ? CONFIG : null;
  }
})();
