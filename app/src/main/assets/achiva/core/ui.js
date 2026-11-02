/* ================================================================
   CORE / UI.JS — saanjha toolbox (shared UI toolbox)
   ----------------------------------------------------------------
   Ye file wo saari "auzaar" cheezein ek jagah rakhti hai jo pehle
   har feature file mein alag-alag copy thi :
     • chhote helpers   : el, esc, uid, sorted, sortedUnique
     • date helpers     : toISO, fromISO, fmtDate, addDays,
                          todayISO, nowTime, MONTHS
     • icons            : plus, back, kebab, edit, trash, check
     • popover system   : closePops, togglePop, makeKebabPop
                          (Edit / Delete — optional do-click confirm)
     • mid-screen modal : UI.modal() factory (scrim + centered
                          sheet + Save/Cancel)
     • UI builders      : panel, panelTitle, label, pillBtn,
                          solidBtn, miniBtn, inputField, chipRow,
                          chipEditor, numberPicker, roundCheck,
                          stepRow, rowBox, tile, chip
   Koi feature logic yahan NAHI hai — sirf reusable UI pieces.
   Features (list/basics/topic/sources/sources-detail/rivision)
   is file ko use karti hain, isliye har cheez ek jagah maintain
   hoti hai.
   ================================================================ */

(function () {
  'use strict';

  if (window.__achivaUiLoaded) return;
  window.__achivaUiLoaded = true;

  /* ================================================================
     HELPERS
  ================================================================ */
  function el(tag, cls, html) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (html != null) node.innerHTML = html;
    return node;
  }

  function esc(text) {
    return String(text).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function sorted(nums) {
    return nums.slice().sort(function (a, b) { return a - b; });
  }

  function sortedUnique(nums) {
    var out = [];
    nums.forEach(function (n) { if (out.indexOf(n) === -1) out.push(n); });
    return out.sort(function (a, b) { return a - b; });
  }

  /* ---------- date helpers ---------- */
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];

  function toISO(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') +
      '-' + String(d.getDate()).padStart(2, '0');
  }

  function fromISO(iso) {
    var p = iso.split('-');
    return new Date(+p[0], +p[1] - 1, +p[2]);
  }

  function fmtDate(iso) {
    var d = fromISO(iso);
    return d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear();
  }

  function addDays(iso, n) {
    var d = fromISO(iso);
    d.setDate(d.getDate() + n);
    return toISO(d);
  }

  function todayISO() { return toISO(new Date()); }

  function nowTime() {
    var n = new Date();
    return String(n.getHours()).padStart(2, '0') + ':' + String(n.getMinutes()).padStart(2, '0');
  }

  /* ---------- shared icons ---------- */
  var icons = {
    plus: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    plusBig: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    back: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
    kebab: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.9"/><circle cx="12" cy="12" r="1.9"/><circle cx="12" cy="19" r="1.9"/></svg>',
    edit: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/></svg>',
    trash: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>',
    check: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>'
  };

  /* ================================================================
     POPOVER SYSTEM (3-dot menus)
  ================================================================ */
  function closePops() {
    Array.prototype.forEach.call(document.querySelectorAll('.pop[data-open]'), function (p) {
      p.style.opacity = '';
      p.style.transform = '';
      p.style.pointerEvents = '';
      /* card/row ki unchi layer wapas normal karo */
      if (p.parentElement) p.parentElement.style.zIndex = '';
      delete p.dataset.open;
    });
  }

  function togglePop(pop) {
    var wasOpen = pop.hasAttribute('data-open');
    closePops();
    if (!wasOpen) {
      pop.style.opacity = '1';
      pop.style.transform = 'none';
      pop.style.pointerEvents = 'auto';
      pop.dataset.open = '1';
      /* popover agle card/row ke peeche na chhupe : parent ki layer upar */
      if (pop.parentElement) pop.parentElement.style.zIndex = '40';
    }
  }

  /* Edit / Delete popover : opts.confirm = true → do-click confirm */
  /* Kebab popover (Edit / Delete + optional extra items)
     ----------------------------------------------------------------
     opts.confirm   : false → Delete par do-click confirm nahi (default: confirm ON)
     opts.top/right : popover position
     STUDY-HABIT (additive — purane saare calls par ZERO asar, defaults wahi):
     opts.editLabel : Edit button ka text badalna ho to
     opts.noDelete  : true → Delete item banega hi nahi (Study card compulsory
                      hai, delete nahi ho sakta)
     opts.extra     : [{label, icon, danger, onClick}] — Edit ke baad aur Delete
                      se pehle insert hote hain */
  function makeKebabPop(onEdit, onDelete, opts) {
    opts = opts || {};
    var confirm = opts.confirm !== false;
    var pop = el('div', 'pop');
    pop.style.top = opts.top || '38px';
    pop.style.right = opts.right || '6px';

    var editBtn = el('button', null, icons.edit + '<span>' + esc(opts.editLabel || 'Edit') + '</span>');
    editBtn.type = 'button';
    var armed = false;
    editBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      closePops();
      onEdit();
    });
    pop.appendChild(editBtn);

    (opts.extra || []).forEach(function (it) {
      if (!it) return;
      var b = el('button', it.danger ? 'danger' : null,
        (it.icon || '') + '<span>' + esc(it.label || '') + '</span>');
      b.type = 'button';
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        closePops();
        if (typeof it.onClick === 'function') it.onClick();
      });
      pop.appendChild(b);
    });

    if (!opts.noDelete) {
      var delBtn = el('button', 'danger', icons.trash + '<span>Delete</span>');
      delBtn.type = 'button';
      delBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        if (confirm && !armed) {
          armed = true;
          delBtn.querySelector('span').textContent = 'Confirm Delete';
          return;
        }
        closePops();
        onDelete();
      });
      pop.appendChild(delBtn);
    }

    pop.addEventListener('click', function (e) { e.stopPropagation(); });
    return pop;
  }

  document.addEventListener('click', closePops);

  /* ================================================================
     MID-SCREEN MODAL FACTORY
     modal = UI.modal({zScrim, zWrap})
     modal.open(title, build(body), saveFn)  — saveFn null → no Save
  ================================================================ */
  var FIELD_CSS = 'width:100%;padding:12px 14px;border-radius:12px;border:1px solid var(--s2);' +
    'background:var(--input-bg);font:inherit;font-size:14px;color:var(--ink);outline:none';

  function modal(opts) {
    opts = opts || {};
    var zWrap = opts.zWrap || 90;
    var zScrim = opts.zScrim || (zWrap - 1);
    var app = document.getElementById('app');

    var scrim = el('div');
    scrim.style.cssText = 'position:absolute;inset:0;z-index:' + zScrim +
      ';background:rgba(20,22,26,.45);opacity:0;pointer-events:none;transition:opacity .22s ease';
    app.appendChild(scrim);

    var wrap = el('div');
    wrap.style.cssText = 'position:absolute;inset:0;z-index:' + zWrap + ';display:flex;' +
      'align-items:center;justify-content:center;pointer-events:none;visibility:hidden;' +
      'opacity:0;transition:opacity .22s ease';

    var sheet = el('div', 'sheet');
    sheet.style.position = 'relative';
    sheet.style.left = 'auto';
    sheet.style.right = 'auto';
    sheet.style.bottom = 'auto';
    sheet.style.width = opts.width || 'min(380px, calc(100% - 44px))';
    sheet.style.transform = 'none';
    sheet.appendChild(el('div', 'sheet-grab'));
    var title = el('h3', null, '');
    var body = el('div');
    var actions = el('div', 'sheet-actions');
    var cancel = el('button', 'btn-ghost', 'Cancel');
    var save = el('button', 'btn-solid', opts.saveLabel || 'Save');
    cancel.type = 'button';
    save.type = 'button';
    actions.appendChild(cancel);
    actions.appendChild(save);
    sheet.appendChild(title);
    sheet.appendChild(body);
    sheet.appendChild(actions);
    wrap.appendChild(sheet);
    app.appendChild(wrap);

    var openFlag = false;
    var saveFn = null;
    var hideTimer = null;
    /* RESPONSIVE/a11y : Esc se modal band + wide screens par focus modal mein
       (mobile par auto-focus NAHI — warna keyboard pop ho jata). */
    var lastFocus = null;
    function wideScreen() {
      try { return !!(window.matchMedia && window.matchMedia('(min-width: 821px)').matches); }
      catch (e) { return false; }
    }
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && openFlag) { e.stopPropagation(); close(); }
    });

    function open(t, build, fn) {
      title.textContent = t;
      body.innerHTML = '';
      saveFn = fn || null;
      save.style.display = fn ? '' : 'none';
      if (build) build(body);
      lastFocus = document.activeElement || null;
      if (wideScreen()) {
        window.setTimeout(function () {
          if (!openFlag) return;
          var f = sheet.querySelector('input, select, textarea, button.btn-solid, button');
          if (f && f.focus) f.focus();
        }, 80);
      }
      if (hideTimer) { window.clearTimeout(hideTimer); hideTimer = null; }
      openFlag = true;
      wrap.style.visibility = 'visible';
      wrap.style.pointerEvents = 'auto';
      /* box + andar ka content EK SAATH fade in ho (scrim ke saath) */
      window.requestAnimationFrame(function () {
        if (openFlag) wrap.style.opacity = '1';
      });
      scrim.style.opacity = '1';
      scrim.style.pointerEvents = 'auto';
    }

    function close() {
      if (!openFlag) return;
      openFlag = false;
      saveFn = null;
      /* RESPONSIVE/a11y : focus wapas us element par jo modal se pehle tha */
      if (lastFocus && lastFocus.focus) {
        try {
          if (!document.body || document.body.contains(lastFocus)) lastFocus.focus();
        } catch (e) { /* ignore */ }
      }
      lastFocus = null;
      wrap.style.pointerEvents = 'none';
      /* poora modal (box + numbers sab) ek saath fade out,
         phir visibility hidden — koi alag-alag timing nahi */
      wrap.style.opacity = '0';
      scrim.style.opacity = '0';
      scrim.style.pointerEvents = 'none';
      hideTimer = window.setTimeout(function () {
        hideTimer = null;
        if (!openFlag) wrap.style.visibility = 'hidden';
      }, 240);
    }

    cancel.addEventListener('click', close);
    scrim.addEventListener('click', close);
    save.addEventListener('click', function () {
      if (saveFn) saveFn();
    });

    return {
      open: open,
      close: close,
      isOpen: function () { return openFlag; },
      body: body,
      sheet: sheet
    };
  }

  /* ================================================================
     UI BUILDERS
  ================================================================ */
  function panel() {
    var p = el('div');
    p.style.cssText = 'margin:0 18px 12px;padding:14px;border:1px solid var(--line);' +
      'border-radius:18px;background:var(--tile-bg);box-shadow:inset 0 1px 0 var(--hl-soft)';
    return p;
  }

  function panelTitle(text, noMargin) {
    var t = el('div', null, text);
    t.style.cssText = 'font-family:var(--f-disp);font-size:14px;font-weight:700;color:var(--ink)' +
      (noMargin ? '' : ';margin-bottom:10px');
    return t;
  }

  function label(text) {
    var l = el('div', 'eyebrow', text);
    l.style.margin = '0 0 6px';
    return l;
  }

  function pillBtn(html) {
    var b = el('button', null, html);
    b.type = 'button';
    b.style.cssText = 'display:inline-flex;align-items:center;gap:7px;padding:9px 16px;' +
      'border-radius:99px;border:1px solid var(--s2);background:var(--chip-bg);font:inherit;' +
      'font-size:12.5px;font-weight:600;color:var(--ink2);cursor:pointer;' +
      'box-shadow:inset 0 1px 0 var(--hl-soft)';
    return b;
  }

  function solidBtn(text) {
    var b = el('button', 'btn-solid', text);
    b.type = 'button';
    b.style.flex = 'none';
    b.style.width = '100%';
    return b;
  }

  /* chhota border-less icon button (26px) */
  function miniBtn(html, ariaLabel) {
    var b = el('button', null, html);
    b.type = 'button';
    if (ariaLabel) b.setAttribute('aria-label', ariaLabel);
    b.style.cssText = 'width:26px;height:26px;border-radius:8px;border:0;background:transparent;' +
      'box-shadow:none;flex:none;cursor:pointer;display:flex;align-items:center;' +
      'justify-content:center;color:var(--slate);transition:.15s';
    return b;
  }

  function chip(text, extraCls) {
    return el('span', 'chip-st' + (extraCls ? ' ' + extraCls : ''), text);
  }

  function tile(value, caption) {
    var t = el('div', 'tile');
    t.appendChild(el('b', null, String(value)));
    t.appendChild(el('span', null, caption));
    return t;
  }

  function inputField(labelText, placeholder, type) {
    var wrap = el('div');
    wrap.style.marginBottom = '12px';
    wrap.appendChild(label(labelText));
    var inp = el('input');
    inp.type = type || 'text';
    inp.placeholder = placeholder || '';
    inp.autocomplete = 'off';
    inp.style.cssText = FIELD_CSS;
    wrap.appendChild(inp);
    return { wrap: wrap, input: inp };
  }

  /* single-select chip row (category / attempts waghaira) */
  function chipRow(options, initial) {
    var row = el('div');
    row.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap';
    var current = initial;
    var btns = {};
    function paint() {
      options.forEach(function (o) {
        var b = btns[o];
        var sel = o === current;
        b.style.cssText = 'padding:8px 16px;border-radius:99px;cursor:pointer;font:inherit;font-size:12px;' +
          'font-weight:600;transition:.18s;' +
          (sel
            ? 'background:var(--ink);color:var(--paper);border:1px solid var(--line-strong)'
            : 'background:var(--chip-bg);color:var(--slate);border:1px solid var(--s2)');
      });
    }
    options.forEach(function (o) {
      var b = el('button', null, o);
      b.type = 'button';
      b.addEventListener('click', function () { current = o; paint(); });
      btns[o] = b;
      row.appendChild(b);
    });
    paint();
    return { row: row, get: function () { return current; } };
  }

  /* multi-value chip editor : Enter ya + se chip add, chip click se remove */
  function chipEditor(labelText, placeholder, isNumber) {
    var wrap = el('div');
    wrap.style.marginBottom = '12px';
    wrap.appendChild(label(labelText));
    var chips = el('div');
    chips.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px';
    var list = [];
    function paint() {
      chips.innerHTML = '';
      list.forEach(function (v, i) {
        var c = chip(esc(String(v)) + ' ×');
        c.style.cursor = 'pointer';
        c.title = 'Hatane ke liye click karo';
        c.addEventListener('click', function () { list.splice(i, 1); paint(); });
        chips.appendChild(c);
      });
    }
    var row = el('div');
    row.style.cssText = 'display:flex;gap:8px';
    var inp = el('input');
    inp.type = isNumber ? 'number' : 'text';
    inp.placeholder = placeholder || '';
    inp.autocomplete = 'off';
    inp.style.cssText = 'flex:1;min-width:0;padding:10px 12px;border-radius:12px;border:1px solid var(--s2);' +
      'background:var(--input-bg);font:inherit;font-size:13px;color:var(--ink);outline:none';
    var addB = pillBtn('+');
    function add() {
      var v = isNumber ? parseInt(inp.value, 10) : inp.value.trim();
      if (isNumber ? isNaN(v) : !v) return;
      if (list.indexOf(v) === -1) list.push(v);
      inp.value = '';
      paint();
      inp.focus();
    }
    addB.addEventListener('click', add);
    inp.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); add(); }
    });
    row.appendChild(inp);
    row.appendChild(addB);
    wrap.appendChild(chips);
    wrap.appendChild(row);
    paint();
    return {
      wrap: wrap,
      get: function () { return list.slice(); },
      set: function (v) { list = v.slice(); paint(); }
    };
  }

  /* 1..total number picker (multi ya single, optional guard) */
  function numberPicker(total, initialSel, multi, guard) {
    var wrap = el('div');
    wrap.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;max-height:220px;overflow-y:auto';
    var sel = {};
    (initialSel || []).forEach(function (n) { sel[n] = true; });
    var single = null;
    var btns = {};
    function paint() {
      for (var n = 1; n <= total; n++) {
        var b = btns[n];
        var on = multi ? !!sel[n] : single === n;
        b.style.cssText = 'min-width:36px;height:36px;padding:0 8px;border-radius:12px;cursor:pointer;' +
          'font:inherit;font-size:12.5px;font-weight:600;transition:.15s;' +
          (on
            ? 'background:var(--ink);color:var(--paper);border:1px solid var(--ink)'
            : 'background:var(--chip-bg);color:var(--slate);border:1px solid var(--s2)');
      }
    }
    for (var n = 1; n <= total; n++) {
      (function (num) {
        var b = el('button', null, String(num));
        b.type = 'button';
        b.addEventListener('click', function () {
          if (guard && !guard()) return;
          if (multi) sel[num] = !sel[num];
          else single = num;
          paint();
        });
        btns[num] = b;
        wrap.appendChild(b);
      })(n);
    }
    paint();
    return {
      wrap: wrap,
      get: function () {
        if (multi) {
          var out = [];
          for (var k in sel) if (sel[k]) out.push(+k);
          return sorted(out);
        }
        return single;
      }
    };
  }

  /* gol tick button (listener caller lagata hai) */
  function roundCheck(done) {
    var b = el('button');
    b.type = 'button';
    b.setAttribute('aria-label', done ? 'Untick' : 'Tick');
    b.style.cssText = 'width:22px;height:22px;border-radius:50%;flex:none;cursor:pointer;margin-top:1px;' +
      'display:flex;align-items:center;justify-content:center;transition:.15s;' +
      (done
        ? 'background:var(--ink);border:1.5px solid var(--ink);color:var(--paper)'
        : 'background:transparent;border:1.5px solid var(--s3);color:transparent');
    b.innerHTML = icons.check;
    return b;
  }

  /* step / item row : optional tick + optional kebab(Edit/Delete) */
  function stepRow(text, done, onTick, onEdit, onDelete) {
    var row = rowBox();
    if (onTick) {
      var tick = roundCheck(done);
      tick.addEventListener('click', onTick);
      row.appendChild(tick);
    }
    var t = el('div', null, esc(text));
    t.style.cssText = 'flex:1;min-width:0;font-size:13px;line-height:1.55;color:var(--ink2);' +
      'white-space:pre-wrap;word-break:break-word;' +
      (done ? 'text-decoration:line-through;color:var(--ash)' : '');
    row.appendChild(t);
    if (onEdit && onDelete) {
      var pop = makeKebabPop(onEdit, onDelete);
      var k = miniBtn(icons.kebab, 'Edit or delete');
      k.addEventListener('click', function (e) {
        e.stopPropagation();
        togglePop(pop);
      });
      row.appendChild(k);
      row.appendChild(pop);
    }
    return row;
  }

  function rowBox() {
    var row = el('div');
    row.style.cssText = 'position:relative;display:flex;align-items:flex-start;gap:10px;' +
      'padding:10px 12px;border:1px solid var(--line);border-radius:12px;' +
      'background:var(--chap-bg);margin-bottom:8px';
    return row;
  }

  /* ================================================================
     EXPORT
  ================================================================ */
  window.UI = {
    el: el, esc: esc, uid: uid, sorted: sorted, sortedUnique: sortedUnique,
    MONTHS: MONTHS, toISO: toISO, fromISO: fromISO, fmtDate: fmtDate,
    addDays: addDays, todayISO: todayISO, nowTime: nowTime,
    icons: icons,
    closePops: closePops, togglePop: togglePop, makeKebabPop: makeKebabPop,
    modal: modal, fieldCss: FIELD_CSS,
    panel: panel, panelTitle: panelTitle, label: label, pillBtn: pillBtn,
    solidBtn: solidBtn, miniBtn: miniBtn, chip: chip, tile: tile,
    inputField: inputField, chipRow: chipRow, chipEditor: chipEditor,
    numberPicker: numberPicker, roundCheck: roundCheck, stepRow: stepRow,
    rowBox: rowBox
  };
})();
