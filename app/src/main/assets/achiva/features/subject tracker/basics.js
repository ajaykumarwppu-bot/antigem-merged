/* ================================================================
   FEATURES / SUBJECT TRACKER / BASICS.JS
   ----------------------------------------------------------------
   Chapter ke andar ka content (chapter view screen):
     • PRIORITY selector  : Low / Medium / High
     • STATUS selector    : Not Started / In Progress / Completed
       (ye values chapter card ki status line mein bhi dikhti hain)
     • START DATE / END DATE : click par mid-screen calendar popup —
       year, month aur date choose kar sakte hain
       (start date default = aaj)
     • COMPLETE ROADMAP   : Add Step se steps add karo, round mark
       se done karo — jaise-jaise step done hoti hai agli step show
       hoti hai, 3-dot box se Edit / Delete (do-click confirm)
     • MASTERY ROADMAP    : bilkul waisa hi step system (koi lock
       nahi — dono roadmaps hamesha editable)
   Step ka poora text hamesha dikhta hai (kitna bhi lamba ho).
   Styling ke liye style/ ke chaar CSS files + minimal inline styles.
   Data chapter object mein save hota hai aur core/storage.js
   (window.AppStorage) ke through persist hota hai.
   Screen container list.js deta hai (window.Basics.renderChapterView).
   ================================================================ */

(function () {
  'use strict';

  if (window.__achivaBasicsLoaded) return;
  window.__achivaBasicsLoaded = true;

  var hooks = null;    /* { persist, refreshCards } — list.js se */
  var chapter = null;  /* jis chapter ka view render ho raha hai */

  /* ================================================================
     HELPERS
  ================================================================ */
  /* core/ui.js ke saanjhe tools (naam wahi → baaki code untouched) */
  var el = UI.el, esc = UI.esc, uid = UI.uid;

  var MONTHS_FULL = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  var toISO = UI.toISO, fromISO = UI.fromISO, fmtDate = UI.fmtDate;

  /* chapter object mein naye fields ke defaults */
  function ensure(ch) {
    if (!ch.priority) ch.priority = 'Low';
    if (!ch.status) ch.status = 'Not Started';
    if (ch.startDate == null) ch.startDate = null;
    if (ch.endDate == null) ch.endDate = null;
    if (!Array.isArray(ch.steps)) ch.steps = [];
    if (!Array.isArray(ch.masterySteps)) ch.masterySteps = [];
  }

  function commit() {
    if (!hooks) return;
    hooks.persist();
    if (hooks.refreshCards) hooks.refreshCards();
  }

  /* inline SVG icons */
  var ICON_CAL = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="3"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>';
  var ICON_KEBAB = UI.icons.kebab;
  var ICON_CHECK = UI.icons.check;
  var ICON_CLIP = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M9 12h6M9 16h6"/></svg>';
  var ICON_STAR = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8-6.2-3.2-6.2 3.2L7 14.2 2 9.3l6.9-1z"/></svg>';
  var ICON_EDIT = UI.icons.edit;
  var ICON_TRASH = UI.icons.trash;

  var app = document.getElementById('app');

  /* ================================================================
     POPOVER (3-dot) : Edit / Delete (do-click confirm)
  ================================================================ */
  var closePops = UI.closePops, togglePop = UI.togglePop;

  function makePop(onEdit, onDelete) {
    return UI.makeKebabPop(onEdit, onDelete);
  }

  /* ================================================================
     SHARED UI BUILDERS
  ================================================================ */
  var panel = UI.panel;

  function grid2() {
    var g = el('div');
    g.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:12px';
    return g;
  }

  var label = UI.label;

  function selector(value, options, onChange) {
    var s = el('select');
    s.style.cssText = 'width:100%;padding:10px 12px;border-radius:12px;border:1px solid var(--s2);' +
      'background:var(--input-bg);font:inherit;font-size:13px;font-weight:500;color:var(--ink);outline:none';
    options.forEach(function (o) {
      var op = el('option');
      op.value = o;
      op.textContent = o;
      if (o === value) op.selected = true;
      s.appendChild(op);
    });
    s.addEventListener('change', function () { onChange(s.value); });
    return s;
  }

  var pillBtn = UI.pillBtn;

  /* ============ STEP ADD/EDIT MODAL (core/ui.js factory) ============ */
  var stepModal = UI.modal({ zScrim: 79, zWrap: 80 });

  function openStepSheet(mode) {
    stepModal.open(mode.type === 'add' ? 'Add Step' : 'Edit Step', function (body) {
      body.appendChild(label('Step'));
      var inp = el('input');
      inp.type = 'text';
      inp.autocomplete = 'off';
      inp.placeholder = 'e.g. Overview of the chapter.';
      inp.style.cssText = UI.fieldCss;
      if (mode.type === 'edit') inp.value = mode.step.text;
      body.appendChild(inp);
      body._get = function () { return inp.value.trim(); };
      window.setTimeout(function () {
        if (stepModal.isOpen()) { inp.focus(); inp.select(); }
      }, 260);
    }, function () {
      var text = stepModal.body._get();
      if (!text) return;
      if (mode.type === 'add') mode.list.push({ id: uid(), text: text, done: false });
      else mode.step.text = text;
      stepModal.close();
      commit();
      rerender();
    });
  }

  function closeStepSheet() { stepModal.close(); }

  /* ============ CALENDAR MODAL (core/ui.js factory) ============
     NOTE : z-index sab modal sheets se UPAR rakha hai (96/97) taaki
     ye kisi bhi khule popup (jaise goal Detail modal 85/86) ke
     UPAR khule aur date-pick click kabhi block na ho. */
  var calModal = UI.modal({
    zScrim: 96, zWrap: 97,
    width: 'min(320px, calc(100% - 44px))',
    saveLabel: 'Today'
  });
  var calPick = null;
  var calSelected = null;
  var calView = { y: new Date().getFullYear(), m: 0 };

  function paintCalendar(grid) {
    grid.innerHTML = '';
    var first = new Date(calView.y, calView.m, 1);
    var offset = first.getDay();
    var days = new Date(calView.y, calView.m + 1, 0).getDate();
    var today = todayISO();
    for (var i = 0; i < offset; i++) grid.appendChild(el('span'));
    for (var d = 1; d <= days; d++) {
      (function (day) {
        var iso = calView.y + '-' + String(calView.m + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0');
        var state = iso === calSelected ? 'sel' : (iso === today ? 'today' : '');
        var b = el('button', null, String(day));
        b.type = 'button';
        b.style.cssText = 'height:34px;border-radius:50%;cursor:pointer;font:inherit;font-size:12.5px;' +
          'display:flex;align-items:center;justify-content:center;transition:.15s;' +
          (state === 'sel'
            ? 'background:var(--ink);color:var(--paper);border:1px solid var(--ink);font-weight:700'
            : state === 'today'
              ? 'background:none;color:var(--ink2);border:1px solid var(--s3);font-weight:600'
              : 'background:none;color:var(--ink2);border:1px solid transparent');
        b.addEventListener('click', function () {
          var cb = calPick;
          calModal.close();
          if (cb) cb(iso);
        });
        grid.appendChild(b);
      })(d);
    }
  }

  function openCalendar(title, initialISO, onPick) {
    calPick = onPick;
    var base = initialISO ? fromISO(initialISO) : new Date();
    calSelected = initialISO || null;
    calView = { y: base.getFullYear(), m: base.getMonth() };
    calModal.open(title, function (body) {
      var head = el('div');
      head.style.cssText = 'display:flex;gap:10px;margin-bottom:10px';
      var mSel = el('select');
      var ySel = el('select');
      [mSel, ySel].forEach(function (sl) {
        sl.style.cssText = 'flex:1;padding:9px 10px;border-radius:12px;border:1px solid var(--s2);' +
          'background:var(--input-bg);font:inherit;font-size:12.5px;font-weight:600;color:var(--ink);outline:none';
      });
      MONTHS_FULL.forEach(function (m, i) {
        var op = el('option'); op.value = i; op.textContent = m; mSel.appendChild(op);
      });
      var thisYear = new Date().getFullYear();
      for (var y = thisYear - 10; y <= thisYear + 10; y++) {
        var yop = el('option'); yop.value = y; yop.textContent = y; ySel.appendChild(yop);
      }
      mSel.value = calView.m;
      ySel.value = calView.y;
      var week = el('div');
      week.style.cssText = 'display:grid;grid-template-columns:repeat(7,1fr);gap:4px;margin-bottom:4px';
      ['S', 'M', 'T', 'W', 'T', 'F', 'S'].forEach(function (d) {
        var sp = el('span', 'eyebrow', d);
        sp.style.textAlign = 'center';
        week.appendChild(sp);
      });
      var grid = el('div');
      grid.style.cssText = 'display:grid;grid-template-columns:repeat(7,1fr);gap:4px';
      mSel.addEventListener('change', function () { calView.m = +mSel.value; paintCalendar(grid); });
      ySel.addEventListener('change', function () { calView.y = +ySel.value; paintCalendar(grid); });
      head.appendChild(mSel);
      head.appendChild(ySel);
      body.appendChild(head);
      body.appendChild(week);
      body.appendChild(grid);
      paintCalendar(grid);
    }, function () {
      var cb = calPick;
      calModal.close();
      if (cb) cb(todayISO());
    });
  }

  function closeCalendar() { calModal.close(); }

  var todayISO = UI.todayISO;

  /* ================================================================
     ROADMAP PANEL (Complete / Mastery)
  ================================================================ */
  var roundCheck = UI.roundCheck;

  function stepRow(step, onToggle, onEdit, onDelete) {
    return UI.stepRow(step.text, step.done, onToggle, onEdit, onDelete);
  }

  function roadmapPanel(icon, title, steps) {
    var p = panel();

    var head = el('div');
    head.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px';
    var t = el('div');
    t.style.cssText = 'display:flex;align-items:center;gap:8px;font-family:var(--f-disp);' +
      'font-size:14px;font-weight:700;color:var(--ink)';
    t.innerHTML = '<span style="color:var(--slate);display:flex">' + icon + '</span>' + esc(title);
    var add = pillBtn('+ Add Step');
    add.addEventListener('click', function () { openStepSheet({ type: 'add', list: steps }); });
    head.appendChild(t);
    head.appendChild(add);
    p.appendChild(head);

    /* sequential display : done steps + pehli not-done step dikhe */
    var firstUndone = -1;
    for (var i = 0; i < steps.length; i++) {
      if (!steps[i].done) { firstUndone = i; break; }
    }
    var visible = firstUndone === -1 ? steps.slice() : steps.slice(0, firstUndone + 1);

    if (!steps.length) {
      var hint = el('div', null, 'No steps yet — + Add Step se pehli step add karo.');
      hint.style.cssText = 'font-size:12px;color:var(--ash);padding:4px 2px';
      p.appendChild(hint);
    }

    visible.forEach(function (step) {
      p.appendChild(stepRow(
        step,
        function () { step.done = !step.done; commit(); rerender(); },
        function () { openStepSheet({ type: 'edit', step: step }); },
        function () {
          var arr = steps.filter(function (s) { return s !== step; });
          if (steps === chapter.steps) chapter.steps = arr;
          else chapter.masterySteps = arr;
          commit();
          rerender();
        }
      ));
    });

    return p;
  }

  /* ================================================================
     CHAPTER VIEW RENDER
  ================================================================ */
  var container = null;

  function rerender() {
    if (container && chapter) renderChapterView(container, chapter, hooks);
  }

  function renderChapterView(cont, ch, hk) {
    container = cont;
    chapter = ch;
    hooks = hk || hooks;
    ensure(ch);

    var scrollTop = cont.scrollTop;
    cont.innerHTML = '';

    /* ---------- panel 1 : priority / status / dates ---------- */
    var p1 = panel();

    var g1 = grid2();
    var priWrap = el('div');
    priWrap.appendChild(label('Priority:'));
    priWrap.appendChild(selector(ch.priority, ['Low', 'Medium', 'High'], function (v) {
      ch.priority = v;
      commit();
    }));
    var stWrap = el('div');
    stWrap.appendChild(label('Status:'));
    stWrap.appendChild(selector(ch.status, ['Not Started', 'In Progress', 'Completed'], function (v) {
      ch.status = v;
      commit();
    }));
    g1.appendChild(priWrap);
    g1.appendChild(stWrap);
    g1.style.marginBottom = '12px';
    p1.appendChild(g1);

    var g2 = grid2();
    var sdWrap = el('div');
    sdWrap.appendChild(label('Start Date:'));
    var sdBtn = el('button');
    sdBtn.type = 'button';
    sdBtn.style.cssText = 'display:flex;align-items:center;gap:8px;width:100%;padding:10px 12px;' +
      'border-radius:12px;border:1px solid var(--s2);background:var(--input-bg);font:inherit;' +
      'font-size:12.5px;font-weight:600;color:var(--ink2);cursor:pointer';
    sdBtn.innerHTML = ICON_CAL + '<span></span>';
    sdBtn.querySelector('span').textContent = ch.startDate ? fmtDate(ch.startDate) : 'Add Start Date';
    sdBtn.addEventListener('click', function () {
      openCalendar('Start Date', ch.startDate || toISO(new Date()), function (iso) {
        ch.startDate = iso;
        commit();
        rerender();
      });
    });
    sdWrap.appendChild(sdBtn);
    var edWrap = el('div');
    edWrap.appendChild(label('End Date:'));
    var edBtn = el('button');
    edBtn.type = 'button';
    edBtn.style.cssText = sdBtn.style.cssText;
    edBtn.innerHTML = ICON_CAL + '<span></span>';
    edBtn.querySelector('span').textContent = ch.endDate ? fmtDate(ch.endDate) : 'Add End Date';
    edBtn.addEventListener('click', function () {
      /* year-month default : start date (ya aaj), date user chune */
      var base = ch.endDate || ch.startDate || toISO(new Date());
      openCalendar('End Date', ch.endDate || base, function (iso) {
        ch.endDate = iso;
        commit();
        rerender();
      });
    });
    edWrap.appendChild(edBtn);
    g2.appendChild(sdWrap);
    g2.appendChild(edWrap);
    p1.appendChild(g2);

    cont.appendChild(p1);

    /* ---------- panel 2 : Complete Roadmap ---------- */
    cont.appendChild(roadmapPanel(ICON_CLIP, 'Complete Roadmap', ch.steps));

    /* ---------- panel 3 : Mastery Roadmap ---------- */
    cont.appendChild(roadmapPanel(ICON_STAR, 'Mastery Roadmap', ch.masterySteps));

    cont.scrollTop = scrollTop;
  }

  window.Basics = { renderChapterView: renderChapterView };
  /* shared custom calendar (goals etc. bhi use karte hain) */
  window.AchivaCalendar = { open: openCalendar };
})();
