/* ================================================================
   BACKEND / AUTH.JS — compulsory login + login gate (UI)
   ----------------------------------------------------------------
   • App khulte hi #authGate dikha kar poora app dhak dena
     (z-index 400 — header 35, FAB 55, modals 95 se upar).
   • LOGIN : email + password (existing users, server-verified).
     Unverified email se login BLOCK hai — pehle email verify karo.
   • NAYA ACCOUNT (2-step Firebase native verification):
       1) email + naam + password (min 8 chars, strength meter)
          → createUserWithEmailAndPassword + displayName set
          + sendEmailVerification() → su-verify view.
       2) user email ka link click kare → "Maine verify kar liya"
          → reload() → emailVerified==true to entry.
     Koi custom OTP / EmailJS NAHI — sab Firebase server-side.
   • SIGN IN WITH GOOGLE : popup → Google verify → agar pehli baar
     hai to naam + password (min 8, meter, eye) set karwao aur
     password credential LINK karo (taaki email+pass se bhi login
     ho sake); existing Google user seedha andar.
     (Google emails pehle se verified maani jaati hain.)
   • Firebase auth ka session yaad rakhna:
       achiva.account.v1 → {uid, email, at}
       achiva.offline.v1 → '1'  (offline mode chalu hai)
   • Net na ho + purana session ho → "Bina internet chalu rakhein".
   • Login ke baad backup.js ka firstRunFlow() (kabhi auto nahi).
   • Auth ki har Firebase galti ka Hinglish message.

   SECURITY (2026-10 fix):
     • EmailJS OTP hata diya — su.code console se padha ja sakta tha.
     • Test backdoor (__ACHIVA_TEST_PROVIDER / setTestProvider /
       _internal) hata diya — gate bypass hota tha.
     • Email enumeration (fetchSignInMethodsForEmail) hata diya —
       ab sirf auth/email-already-in-use error se uniform message.
     • Unverified users Firestore rules + client dono par blocked.

   UI note: CSS files FROZEN hain, isliye gate ka poora design
   inline styles se bana hai (koi naya CSS rule nahi).

   Load order (backend): 3/5
   ================================================================ */

(function () {
  'use strict';

  var ACCOUNT_KEY = 'achiva.account.v1';
  var OFFLINE_KEY = 'achiva.offline.v1';

  /* Firebase native verification — koi client-side OTP state nahi. */
  var MIN_PASS = 8;                    /* naye accounts ke liye */

  var gate = null;
  var gTitle = null, gSub = null, gTabs = null, gErr = null;
  var gNote = null, gOffline = null, googleWrap = null, closedBtn = null;
  var vLogin = null, vSuForm = null, vSuVerify = null, vGSetup = null;
  var gEmail = null, gPass = null, gMain = null, gForgot = null, gAlt = null;
  var suEmailIn = null, suNameIn = null, suPass = null, createBtn = null, suMeter = null;
  var verifyInfo = null, verifyEmailLbl = null, verifyDoneBtn = null, resendLink = null, changeLink = null;
  var gSetupEmail = null, gSetupName = null, gSetupPass = null, gSetupSave = null, gSetupMeter = null;
  var googleBtn = null;

  var mode = 'login';            /* login | sign */
  var view = 'login';            /* login | su-form | su-verify | g-setup */
  var busy = false;
  var bootDone = false;
  var user = null;
  var resendTimer = null;

  /* signup flow state — sirf email yaad rakhte hain, koi secret nahi */
  var su = { email: '' };
  var googleUser = null;

  var signInHandlers = [];
  var signOutHandlers = [];

  /* ================================================================
     AUTH PROVIDER
  ================================================================ */
  function realProvider() {
    var fa = window.firebase.auth();
    try { fa.setPersistence(window.firebase.auth.Auth.Persistence.LOCAL); } catch (e) { /* ignore */ }
    return {
      ready: function () { return true; },
      currentUser: function () { return fa.currentUser; },
      onAuth: function (cb) { return fa.onAuthStateChanged(cb, function () { cb(null); }); },
      signIn: function (email, pass) { return fa.signInWithEmailAndPassword(email, pass); },
      signUp: function (email, pass) { return fa.createUserWithEmailAndPassword(email, pass); },
      sendVerification: function (u) { return u.sendEmailVerification(); },
      reloadUser: function (u) { return u.reload().then(function () { return fa.currentUser; }); },
      reset: function (email) { return fa.sendPasswordResetEmail(email); },
      signOut: function () { return fa.signOut(); },
      /* Google OAuth popup */
      signInGoogle: function () {
        var pr = new window.firebase.auth.GoogleAuthProvider();
        return fa.signInWithPopup(pr);
      },
      /* Google OAuth redirect — WebView mein popup block hota hai,
         isliye full-page consent (app ke andar) */
      signInGoogleRedirect: function () {
        var pr = new window.firebase.auth.GoogleAuthProvider();
        try { pr.setCustomParameters({ prompt: 'select_account' }); } catch (e) { /* ignore */ }
        return fa.signInWithRedirect(pr);
      },
      /* GOOGLE-FIX (native): Credential Manager se mila ID token → Firebase session.
         WebView ke bahar system account chooser se aata hai, isliye phone ke
         existing accounts dikhte hain (laptop jaisa). */
      signInGoogleWithIdToken: function (idToken) {
        var cred = window.firebase.auth.GoogleAuthProvider.credential(idToken);
        return fa.signInWithCredential(cred);
      },
      getRedirectResult: function () { return fa.getRedirectResult(); }
    };
  }

  /* PRODUCTION provider — koi test override nahi (gate bypass rokne ke liye). */
  function provider() {
    return (window.firebase && window.firebase.auth ? realProvider() : null);
  }

  function authAvailable() {
    return !!(window.firebase && window.firebase.auth && window.ACHIVA_FIREBASE_CONFIG);
  }

  /* ================================================================
     LOCAL SESSION (localStorage)
  ================================================================ */
  function lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { window.localStorage.setItem(k, v); } catch (e) { /* ignore */ } }
  function lsDel(k) { try { window.localStorage.removeItem(k); } catch (e) { /* ignore */ } }

  function getAccount() {
    try {
      var raw = lsGet(ACCOUNT_KEY);
      if (!raw) return null;
      var a = JSON.parse(raw);
      return (a && a.uid) ? a : null;
    } catch (e) { return null; }
  }

  function setAccount(u) {
    if (!u) { lsDel(ACCOUNT_KEY); return; }
    lsSet(ACCOUNT_KEY, JSON.stringify({ uid: u.uid, email: u.email || '', at: Date.now() }));
  }

  function isOffline() { return lsGet(OFFLINE_KEY) === '1'; }

  function session() {
    if (user) return { uid: user.uid, email: user.email || '', offline: false };
    if (isOffline()) {
      var a = getAccount();
      if (a) return { uid: a.uid, email: a.email, offline: true };
    }
    return null;
  }

  function currentUser() { return user; }

  /* ================================================================
     HINGLISH ERROR MAP
  ================================================================ */
  function authMsg(err) {
    var code = (err && (err.code || '')) || '';
    var raw = String((err && err.message) || err || '');
    if (/invalid-email|email-already-in-use|operation-not-allowed/i.test(raw) && !code) {
      code = 'auth/' + raw.toLowerCase().replace(/[^a-z-]/g, '');
    }
    var M = {
      'auth/invalid-email': 'Email sahi format mein nahi hai (jaise naam@gmail.com).',
      'auth/user-disabled': 'Ye account band kar diya gaya hai.',
      'auth/user-not-found': 'Is email se koi account nahi mila. Pehle "Naya account" banayein.',
      'auth/wrong-password': 'Password galat hai. Dobara koshish karein.',
      'auth/invalid-credential': 'Email ya password galat hai.',
      'auth/email-already-in-use': 'Is email par account ho sakta hai — Login tab se sign in karein ya "Password bhool gaye?" use karein.',
      'auth/credential-already-in-use': 'Is email par pehle se password login juda hai — Login try karein.',
      'auth/weak-password': 'Password kam se kam ' + MIN_PASS + ' characters ka hona chahiye.',
      'auth/too-many-requests': 'Bahut baar galat koshish hui. Thodi der baad dobara karein.',
      'auth/network-request-failed': 'Internet connection nahi mil raha. Net check karein.',
      'auth/operation-not-allowed': 'Firebase Console mein Email/Password sign-in ON karna zaroori hai (FIREBASE_SETUP.md step 4).',
      'auth/requires-recent-login': 'Security ke liye ek baar dobara login karein.',
      'auth/popup-blocked': 'Popup block ho gaya. Browser mein popup allow karein.',
      'auth/cancelled-popup-request': 'Pehla popup band ho gaya. Dobara koshish karein.',
      'auth/web-storage-unsupported': 'Browser storage allow nahi kar raha (WebView settings check karein).'
    };
    if (M[code]) return M[code];
    if (/entity state|missing entity/i.test(raw)) {
      return 'Google redirect adhoora reh gaya (WebView ne OAuth state storage block kar diya thi). ' +
        'App update ke baad dobara try karein; phir bhi aaye to app data clear karke ek baar kholein.';
    }
    if (/invalid-credential|wrong-password|user-not-found/i.test(raw)) return M['auth/invalid-credential'];
    if (/network|offline|fetch/i.test(raw)) return M['auth/network-request-failed'];
    if (/weak-password/i.test(raw)) return M['auth/weak-password'];
    if (/email-already-in-use/i.test(raw)) return M['auth/email-already-in-use'];
    if (/credential-already-in-use/i.test(raw)) return M['auth/credential-already-in-use'];
    return 'Login nahi ho paya: ' + (code || raw || 'unknown error');
  }

  /* ================================================================
     PASSWORD STRENGTH + EYE TOGGLE
  ================================================================ */
  function strengthScore(p) {
    var s = 0;
    if (p.length >= 8) s++;
    if (p.length >= 12) s++;
    if (/[a-z]/.test(p) && /[A-Z]/.test(p)) s++;
    if (/\d/.test(p)) s++;
    if (/[^A-Za-z0-9]/.test(p)) s++;
    return Math.min(4, s);
  }
  var STRENGTH_LABEL = ['Bahut weak', 'Weak', 'Theek', 'Strong', 'Bahut strong'];
  var STRENGTH_COLOR = ['#c0392b', '#e67e22', '#f1c40f', '#2ea043', '#187f2e'];

  function paintMeter(meterEl, p) {
    if (!meterEl) return;
    var sc = p ? strengthScore(p) : 0;
    var bars = meterEl.querySelectorAll('i');
    Array.prototype.forEach.call(bars, function (b, i) {
      b.style.background = (p && i < sc) ? STRENGTH_COLOR[sc] : 'var(--s2)';
    });
    var lab = meterEl.querySelector('span');
    if (lab) {
      lab.textContent = p ? STRENGTH_LABEL[sc] : '';
      lab.style.color = p ? STRENGTH_COLOR[sc] : 'var(--ash)';
    }
  }

  function meterEl() {
    var m = document.createElement('div');
    m.style.cssText = 'display:flex;align-items:center;gap:4px;margin-top:6px';
    for (var i = 0; i < 4; i++) {
      var b = document.createElement('i');
      b.style.cssText = 'flex:1;height:4px;border-radius:99px;background:var(--s2);transition:background .2s';
      m.appendChild(b);
    }
    var lab = document.createElement('span');
    lab.style.cssText = 'flex:none;font-size:9.5px;font-weight:700;letter-spacing:.06em;margin-left:6px;min-width:70px;text-align:right';
    m.appendChild(lab);
    return m;
  }

  var EYE_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
  var EYE_OFF_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><path d="M1 1l22 22"/></svg>';

  /* password field with eye toggle (+ optional meter) */
  function passwordField(labelText, ph, withMeter) {
    var w = document.createElement('div');
    var l = document.createElement('div');
    l.style.cssText = LBL_CSS();
    l.textContent = labelText;
    var box = document.createElement('div');
    box.style.cssText = 'position:relative';
    var i = document.createElement('input');
    i.type = 'password';
    i.placeholder = ph || '';
    i.autocomplete = 'new-password';
    i.style.cssText = INPUT_CSS() + ';padding-right:42px';
    var b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('aria-label', 'Password dekhein/chhupayein');
    b.style.cssText = 'position:absolute;right:8px;top:50%;transform:translateY(-50%);width:30px;height:30px;' +
      'border:0;background:transparent;cursor:pointer;display:flex;align-items:center;justify-content:center;' +
      'color:var(--slate);border-radius:8px';
    b.innerHTML = EYE_SVG;
    b.addEventListener('click', function () {
      var show = i.type === 'password';
      i.type = show ? 'text' : 'password';
      b.innerHTML = show ? EYE_OFF_SVG : EYE_SVG;
    });
    box.appendChild(i);
    box.appendChild(b);
    w.appendChild(l);
    w.appendChild(box);
    var m = null;
    if (withMeter) { m = meterEl(); w.appendChild(m); i.addEventListener('input', function () { paintMeter(m, i.value); }); }
    return { wrap: w, input: i, meter: m };
  }

  /* ================================================================
     GATE UI (sab inline styles — CSS frozen)
  ================================================================ */
  function CARD_CSS() {
    return 'position:relative;width:min(340px,calc(100% - 44px));padding:22px 20px 20px;' +
      'border:1px solid var(--line);border-radius:24px;background:var(--sheet-bg);' +
      'box-shadow:0 30px 60px -24px rgba(10,12,16,.55),inset 0 1px 0 var(--hl-soft);' +
      'display:flex;flex-direction:column;gap:12px';
  }
  function INPUT_CSS() {
    return 'width:100%;padding:13px 14px;border-radius:12px;border:1px solid var(--s2);' +
      'background:var(--input-bg);font:inherit;font-size:14px;color:var(--ink);outline:none;box-sizing:border-box';
  }
  function LBL_CSS() {
    return 'font-size:9.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--ash);font-weight:600;margin:0 0 6px';
  }
  function LINK_CSS() {
    return 'border:0;background:transparent;font:inherit;font-size:12px;color:var(--slate);cursor:pointer;padding:6px;text-decoration:underline';
  }
  function SOLID_CSS() {
    return 'flex:none;width:100%;margin-top:2px;padding:12px;border-radius:12px;border:0;background:var(--ink);' +
      'color:var(--paper);font:inherit;font-weight:600;font-size:13px;cursor:pointer';
  }

  var BRAND_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>';
  var GOOGLE_SVG = '<svg width="16" height="16" viewBox="0 0 24 24"><path fill="#4285F4" d="M23.5 12.3c0-.9-.1-1.5-.3-2.2H12v4.1h6.5c-.1 1.1-.8 2.7-2.4 3.8l3.7 2.9c2.2-2 3.7-5 3.7-8.6z"/><path fill="#34A853" d="M12 24c3.2 0 6-1.1 7.9-2.9l-3.7-2.9c-1 .7-2.4 1.2-4.2 1.2-3.2 0-6-2.1-7-5.1l-3.9 3C3.1 21.3 7.2 24 12 24z"/><path fill="#FBBC05" d="M5 14.3c-.2-.7-.4-1.5-.4-2.3s.1-1.6.4-2.3l-3.9-3C.4 8.2 0 10 0 12s.4 3.8 1.1 5.3l3.9-3z"/><path fill="#EA4335" d="M12 4.7c1.8 0 3 .8 3.7 1.4l3.3-3.2C17 1.1 14.2 0 12 0 7.2 0 3.1 2.7 1.1 6.7l3.9 3c1-3 3.8-5 7-5z"/></svg>';

  function field(labelText, type, placeholder, id) {
    var w = document.createElement('div');
    var l = document.createElement('div');
    l.style.cssText = LBL_CSS();
    l.textContent = labelText;
    var i = document.createElement('input');
    i.type = type;
    i.placeholder = placeholder || '';
    i.style.cssText = INPUT_CSS();
    i.autocomplete = type === 'password' ? 'current-password' : 'email';
    if (id) i.id = id;
    w.appendChild(l);
    w.appendChild(i);
    return { wrap: w, input: i };
  }

  function tabBtn(text, key) {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = text;
    b.setAttribute('data-mode', key);
    /* margin-based gap : purane WebView mein flex-gap support nahi,
       isliye LOGIN / New Account kabhi chipkenge nahi */
    b.style.cssText = 'flex:1;margin:0 3px;padding:9px 4px;border-radius:99px;border:1px solid transparent;' +
      'background:transparent;font:inherit;font-size:11.5px;font-weight:700;color:var(--ash);cursor:pointer;' +
      'text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
    return b;
  }

  function buildGate() {
    if (!gate) gate = document.getElementById('authGate');
    if (!gate) return;
    gate.innerHTML = '';

    var card = document.createElement('div');
    card.style.cssText = CARD_CSS();

    /* brand */
    var brand = document.createElement('div');
    brand.style.cssText = 'display:flex;align-items:center;gap:9px;justify-content:center';
    brand.innerHTML = '<span class="brand-mark">' + BRAND_SVG + '</span>';
    var bt = document.createElement('div');
    bt.innerHTML = '<div class="brand-name">ACHIVA</div><div class="brand-sub" style="text-align:center">Study OS</div>';
    brand.appendChild(bt);
    card.appendChild(brand);

    gTitle = document.createElement('div');
    gTitle.style.cssText = 'font-family:var(--f-disp);font-size:19px;font-weight:700;color:var(--ink);text-align:center;margin-top:4px';
    gTitle.textContent = 'Welcome back';
    card.appendChild(gTitle);

    gSub = document.createElement('div');
    gSub.style.cssText = 'font-size:12px;color:var(--ash);text-align:center;line-height:1.6';
    gSub.textContent = 'Apne account se login karein';
    card.appendChild(gSub);

    /* tabs */
    gTabs = document.createElement('div');
    gTabs.style.cssText = 'display:flex;gap:6px;padding:4px 6px;border:1px solid var(--line);border-radius:99px;background:var(--mi-bg);margin-top:2px';
    gTabs.appendChild(tabBtn('LOGIN', 'login'));
    gTabs.appendChild(tabBtn('New Account', 'sign'));
    gTabs.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('button[data-mode]') : null;
      if (b) setMode(b.getAttribute('data-mode'));
    });
    card.appendChild(gTabs);

    /* error line */
    gErr = document.createElement('div');
    gErr.id = 'gateError';
    gErr.style.cssText = 'display:none;font-size:11.5px;line-height:1.5;color:#c0392b;' +
      'background:rgba(192,57,43,.08);border:1px solid rgba(192,57,43,.22);border-radius:10px;padding:8px 10px';
    card.appendChild(gErr);

    /* ---------- VIEW : LOGIN ---------- */
    vLogin = document.createElement('div');
    var f1 = field('EMAIL', 'email', 'aapka@email.com', 'gateEmail');
    gPass = passwordField('PASSWORD', 'aapka password', false);
    gEmail = f1.input;
    vLogin.appendChild(f1.wrap);
    vLogin.appendChild(gPass.wrap);
    gMain = document.createElement('button');
    gMain.type = 'button';
    gMain.className = 'btn-solid';
    gMain.id = 'gateMain';
    gMain.style.cssText = SOLID_CSS();
    gMain.textContent = 'LOGIN';
    gMain.addEventListener('click', submitLogin);
    vLogin.appendChild(gMain);
    gForgot = document.createElement('button');
    gForgot.type = 'button';
    gForgot.id = 'gateForgot';
    gForgot.style.cssText = LINK_CSS();
    gForgot.textContent = 'Password bhool gaye?';
    gForgot.addEventListener('click', forgotFlow);
    vLogin.appendChild(gForgot);
    gAlt = document.createElement('button');
    gAlt.type = 'button';
    gAlt.id = 'gateAlt';
    gAlt.style.cssText = LINK_CSS();
    gAlt.textContent = 'Naya account banana hai?';
    gAlt.addEventListener('click', function () { setMode('sign'); });
    vLogin.appendChild(gAlt);
    card.appendChild(vLogin);

    /* ---------- VIEW : SIGNUP form (email + naam + password ek saath) ---------- */
    vSuForm = document.createElement('div');
    var info1 = document.createElement('div');
    info1.style.cssText = 'font-size:11.5px;color:var(--ash);line-height:1.6';
    info1.textContent = 'Email + naam + password se account banega. Phir email par verification link jayega — link click karke wapas aayein.';
    vSuForm.appendChild(info1);

    suEmailIn = field('EMAIL', 'email', 'aapka@email.com', 'suEmail').input;
    vSuForm.appendChild(suEmailIn.parentNode);
    suNameIn = field('AAPKA NAAM', 'text', 'e.g. Rahul Sharma', 'suName').input;
    vSuForm.appendChild(suNameIn.parentNode);
    suPass = passwordField('PASSWORD (min 8 characters)', 'naya password (min 8)', true);
    suMeter = suPass.meter;
    vSuForm.appendChild(suPass.wrap);
    createBtn = document.createElement('button');
    createBtn.type = 'button';
    createBtn.style.cssText = SOLID_CSS();
    createBtn.textContent = 'Account banayein + verification bhejo';
    createBtn.addEventListener('click', signupWithVerification);
    vSuForm.appendChild(createBtn);
    var altBack1 = document.createElement('button');
    altBack1.type = 'button';
    altBack1.style.cssText = LINK_CSS();
    altBack1.textContent = 'Pehle se account hai? Login karein';
    altBack1.addEventListener('click', function () { setMode('login'); });
    vSuForm.appendChild(altBack1);
    card.appendChild(vSuForm);

    /* ---------- VIEW : SIGNUP verify (Firebase email link) ---------- */
    vSuVerify = document.createElement('div');
    verifyInfo = document.createElement('div');
    verifyInfo.style.cssText = 'font-size:11.5px;color:var(--ink2);line-height:1.6';
    vSuVerify.appendChild(verifyInfo);
    verifyEmailLbl = document.createElement('div');
    verifyEmailLbl.style.cssText = 'font-size:12px;font-weight:700;color:var(--ink2);word-break:break-all';
    vSuVerify.appendChild(verifyEmailLbl);
    var spamNote = document.createElement('div');
    spamNote.style.cssText = 'font-size:11px;color:var(--ash);line-height:1.6';
    spamNote.textContent = 'Inbox me na mile to Spam / Promotions folder dekhein. Link ek baar click karna hai.';
    vSuVerify.appendChild(spamNote);
    verifyDoneBtn = document.createElement('button');
    verifyDoneBtn.type = 'button';
    verifyDoneBtn.style.cssText = SOLID_CSS();
    verifyDoneBtn.textContent = 'Maine verify kar liya — andar jaayein';
    verifyDoneBtn.addEventListener('click', checkFreshVerification);
    vSuVerify.appendChild(verifyDoneBtn);
    var linkRow = document.createElement('div');
    linkRow.style.cssText = 'display:flex;justify-content:space-between;gap:8px';
    resendLink = document.createElement('button');
    resendLink.type = 'button';
    resendLink.style.cssText = LINK_CSS();
    resendLink.textContent = 'Dobara bhejein';
    resendLink.addEventListener('click', resendVerification);
    changeLink = document.createElement('button');
    changeLink.type = 'button';
    changeLink.style.cssText = LINK_CSS();
    changeLink.textContent = 'Email badlein';
    changeLink.addEventListener('click', function () { resetSignup(); showView('su-form'); });
    linkRow.appendChild(resendLink);
    linkRow.appendChild(changeLink);
    vSuVerify.appendChild(linkRow);
    card.appendChild(vSuVerify);

    /* ---------- VIEW : GOOGLE setup (name + password) ---------- */
    vGSetup = document.createElement('div');
    var gInfo = document.createElement('div');
    gInfo.style.cssText = 'font-size:11.5px;color:#2ea043;line-height:1.6';
    gInfo.textContent = '✔ Google se email verify ho gaya. Ab account ke liye naam aur password set karein (isse email+password se bhi login ho sakega).';
    vGSetup.appendChild(gInfo);
    gSetupEmail = document.createElement('div');
    gSetupEmail.style.cssText = 'font-size:12px;font-weight:600;color:var(--ink2);word-break:break-all';
    vGSetup.appendChild(gSetupEmail);
    gSetupName = field('AAPKA NAAM', 'text', 'e.g. Rahul Sharma', 'gName').input;
    vGSetup.appendChild(gSetupName.parentNode);
    gSetupPass = passwordField('PASSWORD (min 8 characters)', 'naya password', true);
    gSetupMeter = gSetupPass.meter;
    vGSetup.appendChild(gSetupPass.wrap);
    gSetupSave = document.createElement('button');
    gSetupSave.type = 'button';
    gSetupSave.style.cssText = SOLID_CSS();
    gSetupSave.textContent = 'Save karein aur andar jaayein';
    gSetupSave.addEventListener('click', googleSetupSave);
    vGSetup.appendChild(gSetupSave);
    card.appendChild(vGSetup);

    /* ---------- Google button (login + signup-email views) ---------- */
    googleWrap = document.createElement('div');
    var div1 = document.createElement('div');
    div1.style.cssText = 'display:flex;align-items:center;gap:10px;margin-top:4px';
    div1.innerHTML = '<i style="flex:1;height:1px;background:var(--s2)"></i>' +
      '<span style="font-size:10px;font-weight:700;letter-spacing:.14em;color:var(--ash)">YA</span>' +
      '<i style="flex:1;height:1px;background:var(--s2)"></i>';
    googleWrap.appendChild(div1);
    googleBtn = document.createElement('button');
    googleBtn.type = 'button';
    googleBtn.id = 'gateGoogle';
    googleBtn.style.cssText = 'display:flex;align-items:center;justify-content:center;gap:10px;width:100%;' +
      'padding:12px;border-radius:12px;border:1px solid var(--s2);background:var(--chip-bg);' +
      'font:inherit;font-size:13px;font-weight:600;color:var(--ink2);cursor:pointer;margin-top:8px';
    googleBtn.innerHTML = GOOGLE_SVG + '<span>Sign in with Google</span>';
    googleBtn.addEventListener('click', googleSignIn);
    googleWrap.appendChild(googleBtn);
    card.appendChild(googleWrap);

    /* offline entry */
    gOffline = document.createElement('button');
    gOffline.type = 'button';
    gOffline.id = 'gateOffline';
    gOffline.className = 'btn-ghost';
    gOffline.style.cssText = 'flex:none;width:100%;display:none;padding:12px;border-radius:12px;' +
      'border:1px solid var(--s2);background:transparent;font:inherit;font-weight:600;color:var(--slate);cursor:pointer';
    gOffline.textContent = 'Bina internet chalu rakhein';
    gOffline.addEventListener('click', offlineEnter);
    card.appendChild(gOffline);

    /* closed-mode button (config missing) */
    closedBtn = document.createElement('button');
    closedBtn.type = 'button';
    closedBtn.style.cssText = SOLID_CSS() + ';display:none';
    closedBtn.textContent = 'APP KHALEIN (bina login)';
    closedBtn.addEventListener('click', function () { hideGate(); });
    card.appendChild(closedBtn);

    gNote = document.createElement('div');
    gNote.id = 'gateNote';
    gNote.style.cssText = 'font-size:10.5px;color:var(--ash);text-align:center;line-height:1.6';
    gNote.textContent = 'Aapka data sirf aapke account mein save hota hai.';
    card.appendChild(gNote);

    gate.appendChild(card);
    paintTabs();
  }

  /* ---------- view switching ---------- */
  function showView(v) {
    view = v;
    if (vLogin) vLogin.style.display = (v === 'login') ? '' : 'none';
    if (vSuForm) vSuForm.style.display = (v === 'su-form') ? '' : 'none';
    if (vSuVerify) vSuVerify.style.display = (v === 'su-verify') ? '' : 'none';
    if (vGSetup) vGSetup.style.display = (v === 'g-setup') ? '' : 'none';
    if (googleWrap) googleWrap.style.display = (v === 'login' || v === 'su-form') ? '' : 'none';
    showError('');
  }

  function paintTabs() {
    if (!gTabs) return;
    var bs = gTabs.querySelectorAll('button[data-mode]');
    Array.prototype.forEach.call(bs, function (b) {
      var on = b.getAttribute('data-mode') === mode;
      b.style.background = on ? 'var(--chip-bg)' : 'transparent';
      b.style.borderColor = on ? 'var(--s2)' : 'transparent';
      b.style.color = on ? 'var(--ink)' : 'var(--ash)';
      b.style.boxShadow = on ? 'inset 0 1px 0 var(--hl-soft)' : 'none';
    });
  }

  function resetSignup() {
    su.email = '';
    if (resendTimer) { window.clearInterval(resendTimer); resendTimer = null; }
  }

  function setMode(m) {
    mode = (m === 'sign') ? 'sign' : 'login';
    showError('');
    paintTabs();
    if (!gTitle) return;
    if (mode === 'sign') {
      resetSignup();
      gTitle.textContent = 'Account banayein';
      gSub.textContent = 'Step 1/2 — details bharein, phir email verify karein';
      showView('su-form');
    } else {
      gTitle.textContent = 'Welcome back';
      gSub.textContent = 'Apne account se login karein';
      showView('login');
    }
  }

  function showError(msg) {
    if (!gErr) return;
    if (!msg) { gErr.style.display = 'none'; gErr.textContent = ''; return; }
    gErr.textContent = msg;
    gErr.style.display = 'block';
  }

  function setBusy(on, label) {
    busy = !!on;
    var btns = [gMain, createBtn, verifyDoneBtn, gSetupSave, googleBtn];
    btns.forEach(function (b) {
      if (!b) return;
      b.disabled = busy;
      b.style.opacity = busy ? '.6' : '1';
    });
    if (gMain) gMain.textContent = busy ? (label || 'Please wait...') : 'LOGIN';
  }

  function setBusyText(t) { if (gMain) { gMain.disabled = true; gMain.textContent = t; } }

  function showGate() {
    if (!gate) gate = document.getElementById('authGate');
    if (!gate) return;
    gate.style.display = 'flex';
    gate.style.opacity = '1';
    gate.style.pointerEvents = 'auto';
    gate.style.visibility = 'visible';
  }

  function hideGate() {
    if (!gate) gate = document.getElementById('authGate');
    if (!gate) return;
    gate.style.opacity = '0';
    gate.style.pointerEvents = 'none';
    window.setTimeout(function () {
      if (!gate) return;
      if (gate.style.opacity === '0') {
        gate.style.display = 'none';
        gate.style.visibility = 'hidden';
      }
    }, 240);
  }

  function gateVisible() {
    if (!gate) gate = document.getElementById('authGate');
    return !!gate && gate.style.display !== 'none';
  }

  /* ================================================================
     SIGNUP — Firebase native email verification (koi OTP nahi)
  ================================================================ */
  function isVerifiedUser(u) {
    return !!u && !!u.uid && (u.emailVerified === true || hasGoogleCred(u));
  }

  function showVerifyView(email) {
    su.email = email || su.email || '';
    if (verifyInfo) verifyInfo.textContent = 'Verification link bheja gaya. Email kholkar link par click karein, phir neeche button dabayein.';
    if (verifyEmailLbl) verifyEmailLbl.textContent = su.email;
    if (gTitle) gTitle.textContent = 'Email verify karein';
    if (gSub) gSub.textContent = 'Step 2/2 — email ka link click karein';
    showView('su-verify');
  }

  function signupWithVerification() {
    if (busy) return;
    var p = provider();
    if (!p) { showError('Login abhi chalu nahi hai (Firebase config missing).'); return; }
    var email = (suEmailIn && suEmailIn.value || '').trim();
    var name = (suNameIn && suNameIn.value || '').trim();
    var pass = (suPass && suPass.input.value) || '';
    showError('');
    if (!email || email.indexOf('@') < 0) { showError('Sahi email daalein (jaise naam@gmail.com).'); return; }
    if (!name) { showError('Apna naam likhein.'); return; }
    if (pass.length < MIN_PASS) { showError('Password kam se kam ' + MIN_PASS + ' characters ka hona chahiye.'); return; }
    setBusy(true, 'Account ban raha hai...');
    var created = null;
    Promise.resolve(p.signUp(email, pass)).then(function (cred) {
      created = (cred && cred.user) || p.currentUser();
      if (created.updateProfile) {
        return Promise.resolve(created.updateProfile({ displayName: name })).then(function () { return created; });
      }
      return created;
    }).then(function (u) {
      if (p.sendVerification) return Promise.resolve(p.sendVerification(u)).then(function () { return u; });
      return u;
    }).then(function (u) {
      setBusy(false);
      if (!u || !u.uid) { showError('Account confirm nahi hua. Dobara koshish karein.'); return; }
      showVerifyView(u.email || email);
    }).catch(function (e) {
      setBusy(false);
      if (e && (e.code === 'auth/email-already-in-use' || /already-in-use/i.test(String((e && e.message) || '')))) {
        showError('Is email par account ho sakta hai — Login tab se sign in karein ya "Password bhool gaye?" use karein.');
        return;
      }
      showError(authMsg(e));
    });
  }

  function checkFreshVerification() {
    if (busy) return;
    var p = provider();
    if (!p) { showError('Login abhi chalu nahi hai (Firebase config missing).'); return; }
    var u = p.currentUser ? p.currentUser() : null;
    if (!u || !u.uid) { showError('Pehle "Account banayein" se account banayein.'); showView('su-form'); return; }
    setBusy(true, 'Verify check ho raha hai...');
    var done = function (fresh) {
      setBusy(false);
      var f = fresh || u;
      try {
        if (f.emailVerified === true || hasGoogleCred(f)) { onSignedIn(f); return; }
      } catch (e) { /* ignore */ }
      showVerifyView(f.email || su.email);
      showError('Abhi verify nahi hua — email ka link click karke phir dabayein. Spam folder bhi dekhein.');
    };
    try {
      if (p.reloadUser) Promise.resolve(p.reloadUser(u)).then(done, function () { done(u); });
      else if (u.reload) Promise.resolve(u.reload()).then(function () { done(p.currentUser ? p.currentUser() : u); }, function () { done(u); });
      else done(u);
    } catch (e) { done(u); }
  }

  function resendVerification() {
    if (busy) return;
    var p = provider();
    if (!p) { showError('Login abhi chalu nahi hai (Firebase config missing).'); return; }
    var u = p.currentUser ? p.currentUser() : null;
    if (!u || !u.uid) { showError('Pehle account banayein.'); showView('su-form'); return; }
    showError('');
    setBusy(true, 'Link dobara bheja ja raha hai...');
    var ok = function () {
      setBusy(false);
      showVerifyView(u.email || su.email);
      showError('');
      if (verifyInfo) verifyInfo.textContent = 'Naya link bheja gaya — inbox + Spam dono dekhein.';
    };
    var fail = function (e) { setBusy(false); showError(authMsg(e)); };
    try {
      if (p.sendVerification) Promise.resolve(p.sendVerification(u)).then(ok, fail);
      else if (u.sendEmailVerification) Promise.resolve(u.sendEmailVerification()).then(ok, fail);
      else fail(null);
    } catch (e) { fail(e); }
  }

  /* ================================================================
     GOOGLE SIGN-IN + SETUP
  ================================================================ */
  function hasPasswordCred(u) {
    var pd = (u && u.providerData) || [];
    for (var i = 0; i < pd.length; i++) if (pd[i].providerId === 'password') return true;
    return false;
  }

  function hasGoogleCred(u) {
    var pd = (u && u.providerData) || [];
    for (var i = 0; i < pd.length; i++) if (pd[i].providerId === 'google.com') return true;
    return false;
  }

  /* naya Google user jisne abhi password link nahi kiya → setup chahiye */
  function needsGoogleSetup(u) {
    return !!u && hasGoogleCred(u) && !hasPasswordCred(u);
  }

  /* Android WebView UA mein "; wv)" hota hai — lekin MainActivity
     (GOOGLE-FIX) wo flag hata deta hai, isliye UA akela kaafi nahi.
     Sabse pakka signal : APK ke andar native bridge "AchivaNative"
     maujood hota hai (Bridge.kt). */
  function isWebView() {
    try { if (window.AchivaNative) return true; } catch (e) { /* ignore */ }
    try {
      var nav = (typeof window !== 'undefined' && window.navigator) ? window.navigator : null;
      var ua = (nav && nav.userAgent) || '';
      return ua.indexOf('; wv)') !== -1 || ua.indexOf('wv)') !== -1;
    } catch (e) { return false; }
  }

  /* GOOGLE-FIX: native bridge available? (Credential Manager wala APK) */
  function nativeGoogleAvailable() {
    try {
      if (!window.AchivaNative) return false;
      if (typeof window.AchivaNative.googleNativeAvailable === 'function') {
        return String(window.AchivaNative.googleNativeAvailable()) === '1';
      }
      // Purana APK (bridge mein method nahi) → googleSignIn() hi signal hai.
      return typeof window.AchivaNative.googleSignIn === 'function';
    } catch (e) { return false; }
  }

  /* GOOGLE-FIX: native ID-token flow (ek baar listeners install karo) */
  var nativeListenersOn = false;
  function ensureNativeListeners(p) {
    if (nativeListenersOn) return;
    nativeListenersOn = true;
    try {
      // Success: native account chooser se ID token aaya → Firebase login.
      window.__onNativeGoogleToken = function (idToken) {
        try {
          if (!idToken) { setBusy(false); return; }
          if (!p || !p.signInGoogleWithIdToken) { setBusy(false); return; }
          Promise.resolve(p.signInGoogleWithIdToken(idToken)).then(function (cred) {
            setBusy(false);
            handleGoogleUser((cred && cred.user) || (p.currentUser && p.currentUser()));
          }).catch(function (e) {
            setBusy(false);
            showError(authMsg(e));
          });
        } catch (e) { try { setBusy(false); } catch (x) { /* ignore */ } }
      };
      // Config missing / cancel: purana web flow (redirect/popup) chalao.
      window.__onNativeGoogleError = function (code) {
        try {
          var c = String(code || '');
          if (c === 'CANCELLED') { setBusy(false); return; }  // user ne chooser band kiya
          setBusy(false);
          fallbackWebGoogle(p);
        } catch (e) { try { setBusy(false); } catch (x) { /* ignore */ } }
      };
      // Custom-Tab fallback khula: spinner text badlo, session wapas aane par onAuth sambhalega.
      window.__onNativeGoogleCustomTab = function () {
        try { setBusy(true, 'Chrome mein Google khul raha hai...'); } catch (e) { /* ignore */ }
      };
      window.__onNativeGoogleRedirect = function () {
        try { setBusy(false); } catch (e) { /* ignore */ }
      };
    } catch (e) { /* ignore */ }
  }

  /* GOOGLE-FIX: purana web flow (WebView redirect / desktop popup) */
  function fallbackWebGoogle(p) {
    showError('');
    if (isWebView() && p.signInGoogleRedirect) {
      setBusy(true, 'Google khul raha hai...');
      Promise.resolve(p.signInGoogleRedirect()).catch(function (e) {
        setBusy(false);
        showError(authMsg(e));
      });
      return;
    }
    setBusy(true, 'Google khul raha hai...');
    Promise.resolve(p.signInGoogle()).then(function (cred) {
      setBusy(false);
      handleGoogleUser((cred && cred.user) || p.currentUser());
    }).catch(function (e) {
      setBusy(false);
      var raw = String((e && e.message) || e || '');
      if (/disallowed_useragent|webview|popup-blocked|popup-closed/i.test(raw) && p.signInGoogleRedirect) {
        setBusy(true, 'Google khul raha hai...');
        Promise.resolve(p.signInGoogleRedirect()).catch(function (e2) {
          setBusy(false);
          showError(authMsg(e2));
        });
        return;
      }
      showError(authMsg(e));
    });
  }

  /* Google sign-in ka result (popup YA redirect) — setup ya entry */
  function handleGoogleUser(u) {
    if (!u || !u.uid) return;
    if (user === u && !gateVisible()) return;   /* pehle se andar */
    if (googleUser === u) return;               /* setup pehle se khula */
    if (needsGoogleSetup(u)) {
      googleUser = u;
      showGate();
      if (gTitle) gTitle.textContent = 'Account setup';
      if (gSub) gSub.textContent = 'Google email verify ho gaya';
      if (gSetupEmail) gSetupEmail.textContent = u.email || '';
      if (gSetupName) gSetupName.value = u.displayName || '';
      if (gSetupPass) { gSetupPass.input.value = ''; paintMeter(gSetupMeter, ''); }
      showView('g-setup');
      setBusy(false);
      return;
    }
    onSignedIn(u);
  }

  function googleSignIn() {
    if (busy) return;
    var p = provider();
    if (!p) { showError('Login abhi chalu nahi hai (Firebase config missing).'); return; }
    if (!p.signInGoogle) { showError('Google login is environment mein available nahi hai.'); return; }
    showError('');
    /* GOOGLE-FIX: APK mein native bridge ho → pehle SYSTEM account chooser
       (Credential Manager) try karo — phone ke existing accounts dikhenge.
       Fail / purana APK → neeche wala purana web flow (redirect/popup). */
    try {
      ensureNativeListeners(p);
      if (nativeGoogleAvailable() && window.AchivaNative.googleSignIn) {
        setBusy(true, 'Google khul raha hai...');
        window.AchivaNative.googleSignIn();
        return;
      }
    } catch (e) { /* ignore → web fallback */ }
    fallbackWebGoogle(p);
  }

  function googleSetupSave() {
    if (busy || !googleUser) return;
    var name = (gSetupName.value || '').trim();
    var pass = gSetupPass.input.value || '';
    showError('');
    if (!name) { showError('Apna naam likhein.'); gSetupName.focus(); return; }
    if (pass.length < MIN_PASS) { showError('Password kam se kam ' + MIN_PASS + ' characters ka hona chahiye.'); return; }
    setBusy(true, 'Save ho raha hai...');
    var cred = null;
    try {
      cred = window.firebase.auth.EmailAuthProvider.credential(googleUser.email, pass);
    } catch (e) { cred = null; }
    Promise.resolve(googleUser.updateProfile({ displayName: name })).then(function () {
      if (!cred) return googleUser;
      return googleUser.linkWithCredential(cred).then(function () { return googleUser; });
    }).then(function (u) {
      setBusy(false);
      var uu = u || googleUser;
      googleUser = null;
      onSignedIn(uu);
    }).catch(function (e) {
      setBusy(false);
      showError(authMsg(e));
    });
  }

  /* ================================================================
     LOGIN (existing users) — unverified emails BLOCKED
  ================================================================ */
  function submitLogin() {
    if (busy) return;
    var p = provider();
    if (!p) { showError('Login abhi chalu nahi hai (Firebase config missing).'); return; }
    var email = (gEmail && gEmail.value || '').trim();
    var pass = (gPass && gPass.input.value || '');
    showError('');
    if (!email || email.indexOf('@') < 0) { showError('Sahi email daalein (jaise naam@gmail.com).'); return; }
    if (!pass || pass.length < 6) { showError('Password kam se kam 6 characters ka hona chahiye.'); return; }
    setBusy(true, 'Login ho raha hai...');
    Promise.resolve(p.signIn(email, pass)).then(function (cred) {
      var u = (cred && cred.user) || p.currentUser();
      setBusy(false);
      if (!u || !u.uid) { showError('Login confirm nahi hua. Dobara koshish karein.'); return; }
      /* Email+password users ke liye verification LAZMI — warna signOut + verify view */
      if (u.emailVerified !== true && !hasGoogleCred(u)) {
        try { if (p.sendVerification) p.sendVerification(u).catch(function () { }); } catch (e) { /* ignore */ }
        showVerifyView(u.email || email);
        showError('Email verify nahi hai — verification link bheja gaya. Link click karke phir "Maine verify kar liya" dabayein.');
        try { if (p.signOut) p.signOut().catch(function () { }); } catch (e) { /* ignore */ }
        return;
      }
      onSignedIn(u);
    }).catch(function (e) {
      setBusy(false);
      showError(authMsg(e));
    });
  }

  /* ================================================================
     SESSION FLOWS (resume / signout / offline)
     ----------------------------------------------------------------
     FIX #2 (reload-loop): pehle fresh login par resume() bina kuch
     bataye poora page reload kar deta tha — gate visible rehta,
     account session save nahi hota tha, aur flush FAIL hone par bhi
     reload ho jata tha (data-loss + "screen atak gayi" feel). Ab:
       • session (achiva.account.v1) reload se PEHLE save hota hai
         → reload/crash ke baad bhi offline-entry button available
       • user ko status text dikhta hai ("Login ho raha hai…")
       • flush fail → reload NAHI; gate par saaf Hinglish error
       • flush hang → 2.5s baad reload (storage.js ka LS-resync
         agle boot par miss-hue writes wapas la deta hai)
       • firstRunFlow (backup/restore prompt) reload mein marta tha
         → ab pending-flag se reload ke BAAD boot par chalta hai
  ================================================================ */
  var FIRST_RUN_KEY = 'achiva.firstrun.pending.v1';

  /* reload ke baad boot se call hota hai — pending flag ho to
     firstRunFlow (backup/restore prompt) tab chalao */
  function maybeFirstRun(u) {
    try {
      if (!u || lsGet(FIRST_RUN_KEY) !== u.uid) return;
      lsDel(FIRST_RUN_KEY);
      if (window.AchivaBackup && window.AchivaBackup.firstRunFlow) {
        window.AchivaBackup.firstRunFlow(session());
      }
    } catch (e) { /* ignore */ }
  }

  /* Verified gate: unverified email+password user andar NAHI aayega.
     Google users pehle se verified maane jaate hain. */
  function requireVerified(u) {
    if (!u || !u.uid) return null;
    if (u.emailVerified === true || hasGoogleCred(u)) return u;
    var p = provider();
    try { if (p && p.sendVerification) p.sendVerification(u).catch(function () { }); } catch (e) { /* ignore */ }
    showGate();
    if (gTitle) gTitle.textContent = 'Email verify karein';
    showVerifyView(u.email || su.email);
    showError('Email verify nahi hai — link bheja gaya. Click karke phir "Maine verify kar liya" dabayein.');
    try { if (p && p.signOut) p.signOut().catch(function () { }); } catch (e) { /* ignore */ }
    return null;
  }

  /* return true = page reload SCHEDULE hua (caller firstRunFlow skip kare) */
  function resume(u) {
    user = u;
    if (window.AppStorage) {
      var prev = window.AppStorage.ns();
      window.AppStorage.setNamespace(u.uid);
      window.AppStorage.adoptLegacy();
      /* session PEHLE record karo (pehle ye reload ke baad hota tha —
         fresh login par account save hi nahi hota tha) */
      lsDel(OFFLINE_KEY);
      setAccount(u);
      if (prev !== u.uid) {
        /* Namespace switch → feature caches purane ns ke hain → reload
           zaroori hai (data consistency ke liye ye behaviour JAAN-BOOJH
           kar rakha gaya hai) */
        lsSet(FIRST_RUN_KEY, u.uid);
        setBusyText('Login ho raha hai… app dobara khul raha hai');
        var done = false;
        var go = function () { if (!done) { done = true; window.location.reload(); } };
        var fail = function () {
          if (done) return;
          done = true;
          lsDel(FIRST_RUN_KEY);
          setBusy(false);
          showGate();
          showError('Login data save nahi ho paya (storage busy). Thodi der mein dobara login karein.');
        };
        if (window.AppStorage.flush) {
          Promise.resolve(window.AppStorage.flush()).then(go, fail);
          window.setTimeout(go, 2500);   /* flush hang → safe reload */
        } else { go(); }
        return true;
      }
    }
    lsDel(OFFLINE_KEY);
    setAccount(u);
    hideGate();
    return false;
  }

  function onSignedIn(u) {
    var v = requireVerified(u);
    if (!v) return;
    var reloading = resume(v);
    /* reload schedule hai to firstRunFlow abhi NAHI — modal adhoora mar
       jata. Reload ke baad boot → maybeFirstRun() ise chalata hai. */
    if (!reloading && window.AchivaBackup && window.AchivaBackup.firstRunFlow) {
      window.AchivaBackup.firstRunFlow(session());
    }
    signInHandlers.forEach(function (fn) { try { fn(session()); } catch (e) { /* ignore */ } });
  }

  function forgotFlow() {
    var p = provider();
    if (!p) { showError('Login abhi chalu nahi hai (Firebase config missing).'); return; }
    if (!window.UI || !UI.modal) { showError('Password reset abhi uplabdh nahi hai.'); return; }
    var m = UI.modal({ zWrap: 420, zScrim: 419, saveLabel: 'Link bhejo' });
    var msg = null;
    m.open('Password reset', function (body) {
      var f = UI.inputField('EMAIL', 'jis email se account banaya tha', 'email');
      if (gEmail && gEmail.value) f.input.value = gEmail.value.trim();
      body.appendChild(f.wrap);
      msg = UI.el('div');
      msg.style.cssText = 'font-size:11.5px;color:var(--ash);line-height:1.6;margin-top:4px';
      msg.textContent = 'Reset link aapke email par aayega. Link APK mein khud browser mein khul jayega.';
      body.appendChild(msg);
      f.input.id = 'resetEmail';
    }, function () {
      var inp = document.getElementById('resetEmail');
      var email = (inp && inp.value || '').trim();
      if (!email || email.indexOf('@') < 0) { msg.textContent = 'Sahi email daalein.'; return; }
      msg.textContent = 'Bhej rahe hain...';
      Promise.resolve(p.reset(email)).then(function () {
        msg.textContent = 'Reset link bhej diya gaya hai. Email check karein (spam folder bhi).';
        window.setTimeout(function () { m.close(); }, 1400);
      }).catch(function (e) { msg.textContent = authMsg(e); });
    });
  }

  function offlineEnter() {
    var a = getAccount();
    if (!a) return;
    lsSet(OFFLINE_KEY, '1');
    hideGate();
    if (window.AchivaSettings && window.AchivaSettings.setBanner) {
      window.AchivaSettings.setBanner('Offline mode — backup / restore abhi band hai');
    }
  }

  function signOut() {
    var p = provider();
    var done = function () {
      user = null;
      googleUser = null;
      setAccount(null);
      lsDel(OFFLINE_KEY);
      if (window.AppStorage) window.AppStorage.setNamespace(null);
      signOutHandlers.forEach(function (fn) { try { fn(); } catch (e) { /* ignore */ } });
    };
    if (isOffline() || !p) { done(); return Promise.resolve(true); }
    return Promise.resolve(p.signOut()).then(done, done);
  }

  /* ================================================================
     BOOT
  ================================================================ */
  function boot() {
    if (bootDone) return;
    bootDone = true;
    buildGate();
    showGate();

    if (!authAvailable()) {
      mode = 'login';
      if (gTitle) gTitle.textContent = 'Login abhi band hai';
      if (gSub) gSub.textContent = 'Firebase setup complete nahi hua.';
      if (gTabs) gTabs.style.display = 'none';
      if (vLogin) vLogin.style.display = 'none';
      if (vSuForm) vSuForm.style.display = 'none';
      if (vSuVerify) vSuVerify.style.display = 'none';
      if (vGSetup) vGSetup.style.display = 'none';
      if (googleWrap) googleWrap.style.display = 'none';
      if (gOffline) gOffline.style.display = 'none';
      if (closedBtn) closedBtn.style.display = '';
      if (gNote) {
        gNote.innerHTML = 'backend/firebase-config.js mein apni Firebase config daalein ' +
          'aur Firestore rules deploy karein — uske baad login apne aap chalu ho jayega.<br>' +
          '(guide: backend/FIREBASE_SETUP.md)';
      }
      return;
    }

    setMode('login');
    var p = provider();
    if (!p) { showError('Auth module load nahi hua. Page reload karein.'); return; }
    setBusyText('Connect ho raha hai...');

    var settled = false;
    var finish = function (u) {
      if (settled) return;
      settled = true;
      setBusy(false);
      if (u && u.uid) {
        /* naya Google user (password link nahi) → setup view, warna resume.
           Email+password par verified gate LAZMI — unverified wapas verify view. */
        if (needsGoogleSetup(u)) handleGoogleUser(u);
        else if (!requireVerified(u)) { /* verify view already shown */ }
        else if (!resume(u)) maybeFirstRun(u);
      }
      else { user = null; showLoginUI(); }
    };
    var guard = window.setTimeout(function () {
      finish(p.currentUser ? p.currentUser() : null);
    }, 7000);
    try {
      p.onAuth(function (u) {
        window.clearTimeout(guard);
        finish(u);
      });
    } catch (e) {
      window.clearTimeout(guard);
      finish(null);
    }
    /* redirect flow se wapas aaye hon → pending Google result uthao */
    try {
      if (p.getRedirectResult) {
        Promise.resolve(p.getRedirectResult()).then(function (cred) {
          if (cred && cred.user) handleGoogleUser(cred.user);
        }, function () { /* ignore */ });
      }
    } catch (e) { /* ignore */ }
  }

  function showLoginUI() {
    if (gTabs) gTabs.style.display = '';
    if (closedBtn) closedBtn.style.display = 'none';
    setMode('login');
    if (gOffline) gOffline.style.display = getAccount() ? '' : 'none';
    if (gNote) {
      gNote.textContent = getAccount()
        ? 'Net na chale to niche wale button se app offline bhi khol sakte hain.'
        : 'Aapka data sirf aapke account mein save hota hai.';
    }
    if (gEmail) { try { gEmail.blur(); } catch (e) { /* ignore */ } }
  }

  /* ================================================================
     EXPORT — sirf production API, koi test backdoor / _internal nahi
  ================================================================ */
  window.AchivaAuth = {
    ACCOUNT_KEY: ACCOUNT_KEY,
    OFFLINE_KEY: OFFLINE_KEY,
    boot: boot,
    showGate: showGate,
    hideGate: hideGate,
    gateVisible: gateVisible,
    showError: showError,
    authMsg: authMsg,
    session: session,
    currentUser: currentUser,
    getAccount: getAccount,
    setAccount: setAccount,
    isOffline: isOffline,
    signOut: signOut,
    authAvailable: authAvailable,
    onSignIn: function (fn) { signInHandlers.push(fn); },
    onSignOut: function (fn) { signOutHandlers.push(fn); }
  };
})();
