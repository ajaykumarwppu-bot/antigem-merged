/* ================================================================
   FEATURES / SUBJECT TRACKER / ERROR.JS  (PDF tree wala naam)
   ----------------------------------------------------------------
   ERROR BOOK — user apni test-galtiyan yahan record karta hai :
     • Subject screen ke neeche "Error Book" book-card se khulti hai
     • Pehle TEST choose karo (jo tests Test Book mein feed hue hain)
       — mistake test ke andar hi pata chalti hai isliye test pehle
     • Test choose karte hi uske neeche :
         - subjects ke chips (Math / Physics / Chemistry ...)
         - "Test Details" collapsible : click par chapters ki list
           (subject-wise), warna seedha question numbers
         - question numbers ke boxes (1 se total questions tak)
           screen par hi (popup mein nahi)
         - jin questions ki error record hai unke box par mark
     • Kisi question par click → popup :
         - description (apni detail : quiz tha, trap tha etc.)
         - mistake type : Conceptual / Calculation / Reading /
           Memory / Careless-Silly / Time-Pressure (single select)
         - Save → error record (state.errors), dobara kholne par
           purani entry prefill hoti hai aur update ho sakti hai
     • Neeche "Recorded Errors" list : us test ki saari errors
   Data state.errors mein (list.js bridge ke through) :
   core/storage.js se persist.
   ================================================================ */

(function () {
  'use strict';

  if (window.__achivaErrorLoaded) return;
  window.__achivaErrorLoaded = true;

  var el = UI.el, esc = UI.esc, uid = UI.uid;
  var ICON_BACK = UI.icons.back;

  var MISTAKE_TYPES = [
    'Conceptual Mistake',
    'Calculation Mistake',
    'Reading Mistake',
    'Memory Mistake',
    'Careless / Silly Mistake',
    'Time Pressure Mistake'
  ];

  function bridge() { return window.SubjectListBridge; }
  function state() { return bridge().getState(); }

  var selTestId = null;
  var detailsOpen = false;

  var screen = el('section', 'screen');
  screen.style.paddingTop = '58px';
  document.getElementById('app').appendChild(screen);

  /* popup modal (description + mistake type) */
  var errModal = UI.modal({ zScrim: 90, zWrap: 91 });

  function openBook() {
    render();
    bridge().show(screen, true);
  }

  function testById(id) {
    var t = null;
    state().tests.forEach(function (x) { if (x.id === id) t = x; });
    return t;
  }

  function errorsOf(testId) {
    return state().errors.filter(function (e) { return e.testId === testId; });
  }

  function errorFor(testId, q) {
    var e = null;
    state().errors.forEach(function (x) {
      if (x.testId === testId && x.q === q) e = x;
    });
    return e;
  }

  /* purani entries (single type string) ko array mein badlo */
  function typesOf(e) {
    if (!e) return [];
    if (Array.isArray(e.types)) return e.types;
    if (e.type) return [e.type];
    return [];
  }

  /* multi-select chips : 1 se 6 tak mistake types chun sakte ho */
  function multiChips(options, initialArr) {
    var sel = (initialArr || []).slice();
    var wrap = el('div');
    wrap.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap';
    var btns = {};
    function paint() {
      options.forEach(function (o) {
        var on = sel.indexOf(o) > -1;
        btns[o].style.cssText = 'padding:8px 14px;border-radius:99px;cursor:pointer;font:inherit;' +
          'font-size:11.5px;font-weight:600;transition:.15s;' +
          (on
            ? 'background:var(--ink);color:var(--paper);border:1px solid var(--line-strong)'
            : 'background:var(--chip-bg);color:var(--slate);border:1px solid var(--s2)');
      });
    }
    options.forEach(function (o) {
      var b = el('button', null, o);
      b.type = 'button';
      b.addEventListener('click', function () {
        var i = sel.indexOf(o);
        if (i > -1) sel.splice(i, 1);
        else sel.push(o);
        paint();
      });
      btns[o] = b;
      wrap.appendChild(b);
    });
    paint();
    return {
      wrap: wrap,
      get: function () { return sel.slice(); }
    };
  }

  /* ================================================================
     RENDER
  ================================================================ */
  function render() {
    screen.innerHTML = '';

    var head = el('div');
    head.style.cssText = 'display:flex;align-items:center;gap:12px;padding:12px 18px 4px';
    var back = el('button', 'icon-btn', ICON_BACK);
    back.type = 'button';
    back.setAttribute('aria-label', 'Back');
    back.addEventListener('click', function () {
      bridge().show(bridge().subjectScreen(), false);
    });
    var tw = el('div', 'sub-title-wrap');
    tw.appendChild(el('h2', null, 'Error Book'));
    tw.appendChild(el('div', 'sub-meta', 'Apni galatiyan yahan record karo'));
    head.appendChild(back);
    head.appendChild(tw);
    screen.appendChild(head);

    var wrap = el('div', 'scroll');

    if (!state().tests.length) {
      var empty = el('div', 'empty',
        'Koi test nahi mila.<br>Pehle Test Book mein test add karo, phir uski errors yahan record karo.');
      empty.style.margin = '12px 18px';
      wrap.appendChild(empty);
      screen.appendChild(wrap);
      return;
    }

    /* ---- choose test ---- */
    var tp = UI.panel();
    tp.appendChild(UI.panelTitle('Choose Test'));
    state().tests.slice().reverse().forEach(function (t) {
      var sel = t.id === selTestId;
      var c = el('div');
      c.style.cssText = 'display:flex;align-items:center;gap:8px;padding:10px 12px;margin-bottom:8px;' +
        'border-radius:12px;cursor:pointer;font-size:12.5px;font-weight:600;transition:.15s;' +
        (sel
          ? 'background:var(--ink);color:var(--paper);border:1px solid var(--line-strong)'
          : 'background:var(--chip-bg);color:var(--slate);border:1px solid var(--s2)');
      c.appendChild(el('span', null, esc(t.name)));
      var cnt = errorsOf(t.id).length;
      var badge = el('span', null, cnt ? cnt + ' errors' : esc(t.type));
      badge.style.cssText = 'margin-left:auto;font-size:10px;opacity:.85';
      c.appendChild(badge);
      c.addEventListener('click', function () {
        /* dobara usi test par click → collapse (band) */
        selTestId = (selTestId === t.id) ? null : t.id;
        detailsOpen = false;
        render();
      });
      tp.appendChild(c);
    });
    wrap.appendChild(tp);

    var t = selTestId ? testById(selTestId) : null;
    if (!t) {
      screen.appendChild(wrap);
      return;
    }

    /* ---- test info + subjects ---- */
    var ip = UI.panel();
    var ttl = el('div');
    ttl.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:8px';
    ttl.appendChild(el('h3', null, esc(t.name)));
    ttl.appendChild(UI.chip(t.type));
    ip.appendChild(ttl);
    ip.appendChild(UI.label('Subjects:'));
    var schips = el('div');
    schips.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap';
    t.subjects.forEach(function (s) { schips.appendChild(UI.chip(esc(s.name))); });
    ip.appendChild(schips);

    /* collapsible test details (chapters) */
    var dToggle = UI.pillBtn('Test Details');
    dToggle.style.marginTop = '10px';
    dToggle.addEventListener('click', function () {
      detailsOpen = !detailsOpen;
      render();
    });
    ip.appendChild(dToggle);
    if (detailsOpen) {
      var dWrap = el('div');
      dWrap.style.marginTop = '10px';
      var bySub = {};
      t.chapters.forEach(function (c) {
        if (!bySub[c.subjectName]) bySub[c.subjectName] = [];
        bySub[c.subjectName].push(c.name);
      });
      Object.keys(bySub).forEach(function (sn) {
        dWrap.appendChild(UI.label(sn + ':'));
        var chips = el('div');
        chips.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px';
        bySub[sn].forEach(function (cn) { chips.appendChild(UI.chip(esc(cn))); });
        dWrap.appendChild(chips);
      });
      if (!t.chapters.length) dWrap.appendChild(el('div', 'sub-meta', 'Koi chapter nahi chuna tha.'));
      ip.appendChild(dWrap);
    }
    wrap.appendChild(ip);

    /* ---- question numbers (screen par hi) ---- */
    var qp = UI.panel();
    qp.appendChild(UI.panelTitle('Questions'));
    qp.appendChild(el('div', 'sub-meta',
      'Question par click karo → description + mistake type record karo.'));
    var grid = el('div');
    grid.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;margin-top:10px';
    for (var q = 1; q <= t.totalQ; q++) {
      (function (num) {
        var has = errorFor(t.id, num);
        var b = el('button');
        b.type = 'button';
        b.setAttribute('aria-label', 'Error record karo Q' + num);
        b.style.cssText = 'position:relative;min-width:40px;height:40px;padding:0 10px;border-radius:10px;' +
          'cursor:pointer;font:inherit;font-size:12.5px;font-weight:700;transition:.15s;' +
          'display:flex;align-items:center;justify-content:center;' +
          (has
            ? 'background:var(--hl);color:var(--ink);border:1.5px solid var(--ink)'
            : 'background:var(--chip-bg);color:var(--slate);border:1px solid var(--s2)');
        b.textContent = 'Q' + num;
        if (has) {
          b.insertAdjacentHTML('beforeend',
            '<span style="position:absolute;top:-7px;right:-7px;width:16px;height:16px;border-radius:50%;' +
            'background:var(--ink);color:var(--paper);display:flex;align-items:center;justify-content:center;' +
            'border:1.5px solid var(--paper);font-size:10px;font-weight:700">!</span>');
        }
        b.addEventListener('click', function () { openErrorModal(t, num); });
        grid.appendChild(b);
      })(q);
    }
    qp.appendChild(grid);
    wrap.appendChild(qp);

    /* ---- recorded errors list ---- */
    var errs = errorsOf(t.id);
    if (errs.length) {
      var rp = UI.panel();
      rp.appendChild(UI.panelTitle('Recorded Errors'));
      errs.forEach(function (e) {
        var row = UI.rowBox();
        row.appendChild(el('span', 'chap-num', 'Q' + e.q));
        var body = el('div');
        body.style.cssText = 'flex:1;min-width:0';
        body.appendChild(el('div', null, esc(typesOf(e).join(' · ')))).style.cssText =
          'font-size:12.5px;font-weight:600;color:var(--ink2)';
        if (e.desc) {
          body.appendChild(el('div', 'sub-meta', esc(e.desc)));
        }
        row.appendChild(body);
        row.appendChild(UI.chip(e.date));
        rp.appendChild(row);
      });
      wrap.appendChild(rp);
    }

    screen.appendChild(wrap);
  }

  /* ================================================================
     ERROR POPUP : description + mistake type
  ================================================================ */
  function openErrorModal(t, q) {
    var existing = errorFor(t.id, q);
    errModal.open('Error — ' + t.name + ' · Q' + q, function (body) {
      var lab = UI.label('Description (kya hua, kya trap tha etc.):');
      body.appendChild(lab);
      var ta = el('textarea');
      ta.rows = 4;
      ta.placeholder = 'Is question mein meri ye galti hui...';
      ta.style.cssText = UI.fieldCss + ';resize:vertical;line-height:1.6;margin-bottom:12px';
      if (existing) ta.value = existing.desc || '';
      body.appendChild(ta);

      body.appendChild(UI.label('Mistake types (ek ya multiple chuno):'));
      var typeRow = multiChips(MISTAKE_TYPES, typesOf(existing));
      body.appendChild(typeRow.wrap);
      var msg = el('div', 'sub-meta', '');
      msg.style.marginTop = '8px';
      body.appendChild(msg);

      body._get = function () {
        return { desc: ta.value.trim(), types: typeRow.get() };
      };
      body._msg = function (s) { msg.textContent = s; };
    }, function () {
      var v = errModal.body._get();
      if (!v.types.length) {
        errModal.body._msg('Kam se kam ek mistake type chuno.');
        return;
      }
      if (existing) {
        existing.types = v.types;
        existing.desc = v.desc;
        delete existing.type;
      } else {
        state().errors.push({
          id: uid(),
          testId: t.id,
          q: q,
          types: v.types,
          desc: v.desc,
          date: UI.fmtDate(UI.todayISO())
        });
      }
      bridge().persist();
      errModal.close();
      render();
    });
  }

  window.ErrorBook = { open: openBook };
})();
