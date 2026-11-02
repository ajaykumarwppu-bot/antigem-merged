/* ================================================================
   FEATURES / GOALS / GOAL-DETAIL.JS — goal ke andar ki screen
   ----------------------------------------------------------------
   • HEAD : circular back button (app jaisa) + goal name +
            neeche category + right mein "Detail" button
   • DETAIL BUTTON → modal :
       - description (poora notes)
       - Start date  → click par custom calendar (basics.js wala)
       - neeche do option (arrow ke saath) :
           left  : Total days  (kitne din mein khatam karna hai)
           right : End date / Deadline → click par calendar
         dono auto-sync : days bharo → deadline calculate;
         deadline chuno → total days calculate
   • BAHAR DO BOX (side-by-side) :
       left  : Remaining days (dark text) + LIVE countdown timer
               (hh:mm:ss, har second tick, deadline 23:59 tak)
       right : Start → Total days → Deadline chain (arrows ke saath)
   • Data GoalStore (goal-list.js) se; save par GoalList.refresh
   ================================================================ */

(function () {
  'use strict';

  if (window.__achivaGoalDetailLoaded) return;
  window.__achivaGoalDetailLoaded = true;

  var el = UI.el, esc = UI.esc;
  var screen = el('section', 'screen');
  screen.style.paddingTop = '58px';
  document.getElementById('app').appendChild(screen);

  var detailModal = UI.modal({ zScrim: 85, zWrap: 86 });
  var curId = null;
  var tickId = null;

  function bridge() { return window.SubjectListBridge; }
  function store() { return window.GoalStore; }
  function stopTick() { if (tickId) { window.clearInterval(tickId); tickId = null; } }

  function pad(n) { return String(n).padStart(2, '0'); }
  /* DAY-CLOCK : 'aaj' app ke apne din se (Settings → Mera Din) */
  function appToday() { return window.DayClock ? window.DayClock.today() : UI.todayISO(); }


  /* deadline date ke din ke end (23:59:59) tak ka live countdown */
  function deadlineMs(g) {
    var e = store().endDate(g);
    if (!e) return null;
    return new Date(e + 'T23:59:59').getTime();
  }

  /* ================================================================
     RENDER
  ================================================================ */
  function open(id) {
    curId = id;
    render();
    bridge().show(screen, true);
  }

  function render() {
    stopTick();
    var g = store().get(curId);
    if (!g) { window.GoalList.showList(); return; }
    screen.innerHTML = '';
    var scroll = el('div', 'scroll');

    /* ---------- head : circular back + title/category + Detail ---------- */
    var head = el('div');
    head.style.cssText = 'display:flex;align-items:center;gap:10px;padding:12px 16px 6px';

    var back = UI.miniBtn(UI.icons.back, 'Back');
    back.style.cssText += ';width:34px;height:34px;border-radius:50%;border:1px solid var(--s2);' +
      'background:var(--chip-bg);box-shadow:inset 0 1px 0 var(--hl-soft)';
    back.addEventListener('click', function () { stopTick(); window.GoalList.showList(); });
    head.appendChild(back);

    var tcol = el('div');
    tcol.style.cssText = 'flex:1;min-width:0';
    var tt = el('b', null, esc(g.title));
    tt.style.cssText = 'display:block;font-family:var(--f-disp);font-size:16px;font-weight:700;' +
      'color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
    var tc = el('span', null, esc(g.category || 'Other'));
    tc.style.cssText = 'display:block;font-size:10.5px;color:var(--slate);margin-top:1px';
    tcol.appendChild(tt); tcol.appendChild(tc);
    head.appendChild(tcol);

    var detBtn = UI.pillBtn('Detail');
    detBtn.style.cssText += ';padding:7px 12px;font-size:11px;flex:none';
    detBtn.addEventListener('click', function () { openDetailEdit(g); });
    head.appendChild(detBtn);
    var cvBtn = UI.pillBtn('Canvas');
    cvBtn.style.cssText += ';padding:7px 12px;font-size:11px;flex:none';
    cvBtn.addEventListener('click', function () { window.GoalTask.openCanvas(g); });
    head.appendChild(cvBtn);
    scroll.appendChild(head);

    /* ---------- do box : timer (left) + date chain (right) ---------- */
    var row = el('div');
    row.style.cssText = 'display:flex;gap:10px;margin:10px 18px 12px';

    /* left : pre-start countdown YA goal countdown + status badge */
    var left = el('div');
    left.style.cssText = 'flex:1;padding:14px;border:1px solid var(--line);border-radius:18px;' +
      'background:var(--tile-bg);box-shadow:inset 0 1px 0 var(--hl-soft);text-align:center;' +
      'display:flex;flex-direction:column;justify-content:center';
    var today = appToday();
    var preStart = !!g.startDate && today < g.startDate;
    var target = null, capVal = '—', capLab = 'days remaining';
    if (preStart) {
      capVal = String(Math.round((new Date(g.startDate) - new Date(today)) / 86400000));
      capLab = 'days to start';
      target = new Date(g.startDate + 'T00:00:00').getTime();
    } else {
      var dl = store().daysLeft(g);
      capVal = dl === null ? '—' : (dl < 0 ? '0' : String(dl));
      capLab = dl !== null && dl < 0 ? 'days overdue' : 'days remaining';
      target = deadlineMs(g);
    }
    var remCap = el('div', null, capVal);
    remCap.style.cssText = 'font-family:var(--f-disp);font-size:30px;font-weight:700;line-height:1.1;' +
      'color:' + (!preStart && store().daysLeft(g) !== null && store().daysLeft(g) < 0 ? '#c0392b' : 'var(--ink2)');
    var remLab = el('div', null, capLab);
    remLab.style.cssText = 'font-size:9.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;' +
      'color:var(--slate);margin:2px 0 10px';
    left.appendChild(remCap); left.appendChild(remLab);

    var clock = el('div', null, '--:--:--');
    clock.style.cssText = 'font-family:var(--f-mono);font-size:20px;font-weight:700;color:var(--ink)';
    left.appendChild(clock);

    /* status badge (Upcoming / Active / Completed / Overdue) box ke neeche */
    var badge = el('span', null, store().autoStatus(g));
    var BST = {
      'Active': 'background:var(--ink);color:var(--paper);border:1px solid var(--line-strong)',
      'Completed': 'background:rgba(46,160,67,.16);color:#2ea043;border:1px solid rgba(46,160,67,.45)',
      'Upcoming': 'background:rgba(160,106,0,.12);color:#a06a00;border:1px solid rgba(160,106,0,.4)',
      'Overdue': 'background:rgba(192,57,43,.12);color:#c0392b;border:1px solid rgba(192,57,43,.4)'
    };
    badge.style.cssText = 'display:inline-block;margin-top:12px;padding:5px 12px;border-radius:99px;' +
      'font-size:10px;font-weight:700;letter-spacing:.05em;' + BST[store().autoStatus(g)];
    left.appendChild(badge);
    row.appendChild(left);

    /* right : start → total days → deadline chain */
    var right = el('div');
    right.style.cssText = 'flex:1;padding:14px;border:1px solid var(--line);border-radius:18px;' +
      'background:var(--tile-bg);box-shadow:inset 0 1px 0 var(--hl-soft);display:flex;' +
      'flex-direction:column;justify-content:center;gap:7px';
    function chainRow(label, value, arrowAfter) {
      var r = el('div');
      r.style.cssText = 'display:flex;align-items:baseline;justify-content:space-between;gap:6px';
      var l = el('span', null, label);
      l.style.cssText = 'font-size:9.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--slate)';
      var v = el('b', null, value);
      v.style.cssText = 'font-size:12px;font-weight:700;color:var(--ink);text-align:right';
      r.appendChild(l); r.appendChild(v);
      right.appendChild(r);
      if (arrowAfter) {
        var a = el('div', null, '↓');
        a.style.cssText = 'font-size:11px;color:var(--ash);text-align:center;line-height:1';
        right.appendChild(a);
      }
    }
    var e = store().endDate(g);
    var totalDays = (g.startDate && e)
      ? Math.round((new Date(e) - new Date(g.startDate)) / 86400000) + 1
      : (g.targetDays || null);
    chainRow('Start', g.startDate ? UI.fmtDate(g.startDate) : '—', true);
    chainRow('Total days', totalDays ? totalDays + ' d' : '—', true);
    chainRow('Deadline', e ? UI.fmtDate(e) : '—', false);
    row.appendChild(right);
    scroll.appendChild(row);

    /* ---------- heat-map (goal-heat.js) : boxes ke just neeche ---------- */
    if (window.GoalHeat) scroll.appendChild(window.GoalHeat.panel(g));

    /* ---------- task system (goal-task.js) : heat ke neeche ---------- */
    if (window.GoalTask) scroll.appendChild(window.GoalTask.tasksPanel(g));

    /* ---------- live countdown (pre-start → start tak, warna deadline tak) ---------- */
    function tick() {
      if (target === null) { clock.textContent = '--:--:--'; return; }
      var diff = Math.max(0, target - Date.now());
      var rem = Math.floor((diff % 86400000) / 1000);
      var h = Math.floor(rem / 3600), m = Math.floor((rem % 3600) / 60), s2 = rem % 60;
      /* sirf hh:mm:ss — days upar caption mein already hain (double nahi) */
      clock.textContent = pad(h) + ':' + pad(m) + ':' + pad(s2);
    }
    tick();
    if (target !== null) tickId = window.setInterval(tick, 1000);

    screen.appendChild(scroll);
  }

  /* ================================================================
     DETAIL EDIT MODAL
  ================================================================ */
  function openDetailEdit(g) {
    var startISO = g.startDate || null;
    var endISO = g.deadline || store().endDate(g) || null;

    var noteWrap = el('div');
    noteWrap.style.marginBottom = '12px';
    noteWrap.appendChild(UI.label('Description'));
    var noteIn = el('textarea');
    noteIn.placeholder = 'Write the full description of this goal...';
    noteIn.style.cssText = 'width:100%;min-height:96px;resize:vertical;border:1px solid var(--s2);border-radius:12px;' +
      'background:var(--input-bg);padding:10px 12px;font:inherit;font-size:13px;color:var(--ink);box-sizing:border-box';
    noteIn.value = g.note || '';
    noteWrap.appendChild(noteIn);

    function datePill(current, label, onPick) {
      var b = UI.pillBtn(current ? label + ': ' + UI.fmtDate(current) : label + ': set');
      b.style.cssText += ';width:100%;justify-content:flex-start';
      b.addEventListener('click', function () {
        window.AchivaCalendar.open(label, current, function (iso) {
          current = iso;
          b.innerHTML = label + ': ' + UI.fmtDate(iso);
          if (onPick) onPick();
        });
      });
      b.get = function () { return current; };
      b.set = function (iso) {
        current = iso;
        b.innerHTML = iso ? label + ': ' + UI.fmtDate(iso) : label + ': set';
      };
      return b;
    }

    function diffDays(s, e) { return Math.max(1, Math.round((new Date(e) - new Date(s)) / 86400000) + 1); }

    /* START badlo : end set hai to days recalc; warna days bhare hain to end recalc */
    function onStartChange() {
      var s = startB.get(), e = endB.get(), d = parseInt(daysF.input.value, 10);
      if (s && e) daysF.input.value = diffDays(s, e);
      else if (s && d > 0) endB.set(UI.addDays(s, d - 1));
    }
    /* END badlo : hamesha allowed — days recalc (end hi source of truth) */
    function onEndChange() {
      var s = startB.get(), e = endB.get();
      if (s && e) daysF.input.value = diffDays(s, e);
    }
    /* DAYS badlo : end recalc (days source of truth jab user type kare) */
    function onDaysChange() {
      var s = startB.get(), d = parseInt(daysF.input.value, 10);
      if (s && d > 0) endB.set(UI.addDays(s, d - 1));
    }

    var startB = datePill(startISO, 'Start date', onStartChange);
    var endB = datePill(endISO, 'End date', onEndChange);
    var daysF = UI.inputField('Total days', 'e.g. 97', 'number');
    if (g.targetDays) daysF.input.value = g.targetDays;
    else if (startISO && endISO) daysF.input.value = diffDays(startISO, endISO);
    daysF.input.addEventListener('input', onDaysChange);

    detailModal.open('Goal detail', function (body) {
      body.appendChild(noteWrap);
      body.appendChild(startB);
      var arrow = el('div', null, '↓');
      arrow.style.cssText = 'font-size:12px;color:var(--ash);text-align:center;margin:8px 0';
      body.appendChild(arrow);
      var two = el('div');
      two.style.cssText = 'display:flex;gap:10px;align-items:flex-end';
      var leftW = el('div'); leftW.style.flex = '1';
      leftW.appendChild(daysF.wrap);
      daysF.wrap.style.marginBottom = '0';
      var midA = el('div', null, 'OR');
      midA.style.cssText = 'font-size:10px;font-weight:700;letter-spacing:.06em;color:var(--ash);padding-bottom:12px;flex:none';
      var rightW = el('div'); rightW.style.flex = '1';
      rightW.appendChild(endB);
      two.appendChild(leftW); two.appendChild(midA); two.appendChild(rightW);
      body.appendChild(two);

      /* ---------- daily work time (heat-map intensity ke liye) ---------- */
      var sep = el('div');
      sep.style.cssText = 'height:1px;background:var(--line);margin:14px 0';
      body.appendChild(sep);
      body.appendChild(UI.label('Daily work time'));
      var plan = g.dailyPlan || {};
      var modeR = UI.chipRow(['Fixed', 'Min–Max'], plan.mode === 'range' ? 'Min–Max' : 'Fixed');
      body.appendChild(modeR.row);
      modeR.row.style.margin = '6px 0 10px';
      var fixF = UI.inputField('Fixed minutes per day', 'e.g. 30', 'number');
      if (plan.mode !== 'range' && plan.fixed) fixF.input.value = plan.fixed;
      var minF = UI.inputField('Minimum minutes', 'e.g. 20', 'number');
      var maxF = UI.inputField('Maximum minutes', 'e.g. 45', 'number');
      if (plan.mode === 'range') {
        minF.input.value = plan.min || '';
        maxF.input.value = plan.max || '';
      }
      body.appendChild(fixF.wrap);
      body.appendChild(minF.wrap);
      body.appendChild(maxF.wrap);
      /* jo mode nahi chuna uske inputs dim */
      function paintPlan() {
        var isFix = modeR.get() === 'Fixed';
        fixF.wrap.style.display = isFix ? '' : 'none';
        minF.wrap.style.display = isFix ? 'none' : '';
        maxF.wrap.style.display = isFix ? 'none' : '';
      }
      modeR.row.addEventListener('click', paintPlan);
      paintPlan();
      detailModal._planGet = function () {
        if (modeR.get() === 'Fixed') {
          var f = parseInt(fixF.input.value, 10);
          return f > 0 ? { mode: 'fixed', fixed: f } : (g.dailyPlan || null);
        }
        var mn = parseInt(minF.input.value, 10), mx = parseInt(maxF.input.value, 10);
        return mn > 0 ? { mode: 'range', min: mn, max: Math.max(mn, mx || mn) } : (g.dailyPlan || null);
      };
    }, function () {
      g.note = noteIn.value.trim();
      if (detailModal._planGet) g.dailyPlan = detailModal._planGet();
      g.startDate = startB.get();
      var days = parseInt(daysF.input.value, 10) || 0;
      var end = endB.get();
      if (days > 0 && g.startDate) {
        g.mode = 'days';
        g.targetDays = days;
        g.deadline = UI.addDays(g.startDate, days - 1);
      } else if (end) {
        g.mode = 'deadline';
        g.deadline = end;
        g.targetDays = g.startDate
          ? Math.max(1, Math.round((new Date(end) - new Date(g.startDate)) / 86400000) + 1)
          : null;
      }
      store().upsert(g);
      store().persist();
      detailModal.close();
      render();
    });
  }

  window.GoalDetail = {
    open: open,
    refresh: function () { if (screen.classList.contains('active')) render(); },
    isActive: function () { return screen.classList.contains('active'); }
  };
})();
