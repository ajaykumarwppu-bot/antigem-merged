/* ================================================================
   CORE / FORM-FACTOR.JS — screen-type detection + per-device prefs
   ----------------------------------------------------------------
   Kaam :
     1. <html> par do attributes set karta hai (live, resize par flip) :
          data-form  = "phone" | "tablet" | "wide"
          data-input = "touch" | "mouse"
        CSS inhi se gate hoti hai (desktop.css inhi par depend karta hai).
     2. Features ke liye simple API : FormFactor.isWide() etc. — taaki
        STRUCTURAL (JS wale) changes bhi width/input check ke saath hon.
     3. Per-form LAYOUT prefs : FormFactor.layoutGet/layoutSet
          phone  → achiva.layout.phone.v1
          tablet → achiva.layout.tablet.v1
          wide   → achiva.layout.wide.v1
        Isliye desktop par save kiya hua layout phone par kabhi nahi aata.
        (Theme prefs achiva.prefs.v1 mein hi rehti hain — wo global hain.)

   Detection kaise : CSS media queries (matchMedia) — koi UA-sniffing
   nahi, isliye future devices par bhi sahi chalta hai.
   ================================================================ */

(function () {
  'use strict';

  if (window.__achivaFormFactorLoaded) return;
  window.__achivaFormFactorLoaded = true;

  var Q_WIDE = '(min-width: 821px)';
  var Q_TABLET = '(min-width: 481px) and (max-width: 820px)';
  var Q_COARSE = '(pointer: coarse)';

  function mq(q) {
    try { return !!(window.matchMedia && window.matchMedia(q).matches); }
    catch (e) { return false; }
  }
  function form() {
    if (mq(Q_WIDE)) return 'wide';
    if (mq(Q_TABLET)) return 'tablet';
    return 'phone';
  }
  function input() { return mq(Q_COARSE) ? 'touch' : 'mouse'; }

  function apply() {
    var h = document.documentElement;
    if (!h) return;
    h.setAttribute('data-form', form());
    h.setAttribute('data-input', input());
  }

  function listen() {
    try {
      var list = [Q_WIDE, Q_TABLET, Q_COARSE].map(function (q) { return window.matchMedia(q); });
      list.forEach(function (m) {
        if (!m) return;
        if (m.addEventListener) m.addEventListener('change', apply);
        else if (m.addListener) m.addListener(apply);
      });
    } catch (e) { /* ignore */ }
    window.addEventListener('resize', apply);
    window.addEventListener('orientationchange', apply);
  }

  /* ---------- per-form layout prefs ---------- */
  function lpKey() { return 'achiva.layout.' + form() + '.v1'; }
  function lpLoad() {
    try { return window.AppStorage.loadAt(lpKey()) || {}; } catch (e) { return {}; }
  }
  function layoutGet(key, dflt) {
    var o = lpLoad();
    return (o && (key in o)) ? o[key] : dflt;
  }
  function layoutSet(key, val) {
    var o = lpLoad() || {};
    o[key] = val;
    try { window.AppStorage.saveAt(lpKey(), o); } catch (e) { /* ignore */ }
  }

  apply();
  listen();

  window.FormFactor = {
    get: form,
    input: input,
    isWide: function () { return form() === 'wide'; },
    isTablet: function () { return form() === 'tablet'; },
    isPhone: function () { return form() === 'phone'; },
    isTouch: function () { return input() === 'touch'; },
    apply: apply,
    layoutGet: layoutGet,
    layoutSet: layoutSet,
    lpKey: lpKey
  };
})();
