/* ================================================================
   FEATURES / TASK / TASK.JS — extra tasks (one-time ya repeating)
   ----------------------------------------------------------------
   FAB → TASKS screen : user yahan apne extra tasks add karta hai —
   kisi specific din ka kaam, ya repetitive kaam (har N din /
   daily / weekly / monthly). Har task mein :
     • name (zaroori) + optional description
     • date  : app ka saanjha custom calendar (AchivaCalendar)
     • time  : scroll wheels (hour / minute / AM-PM)
     • repeat: date ke just neeche — Off / Daily / Weekly / Monthly /
               Every N days (N seedha likho, ya "Pick next date" se
               agli occurrence chuno — period apne aap nikal jata hai)
               / Specific days (multi-date calendar — task sirf unhi
               chuni hui dates par dikhega, koi pattern nahi)
     • priority : High / Medium / Low
   List mein tasks 3 groups mein dikhte hain : TODAY / UPCOMING /
   PASSED. Gol tick us din ki occurrence ko done karta hai.
   Storage : AppStorage.loadAt/saveAt('achiva.tasks.v1')
   Depends on : UI, AchivaCalendar (basics.js), SubjectListBridge

   DASHBOARD BRIDGE : features/dashboard (dashboard-today.js ka
   "Tasks" section) isi file ka chhota public API use karta hai —
   all / occursOn / nextFrom / repeatLabel / fmtTime / priorityCss /
   toggleDone. In-memory `data` hi single source of truth hai,
   isliye dashboard seedha storage likhne ke bajaye toggleDone()
   call karta hai (warna task.js ka purana cache dashboard ke
   write ko overwrite kar deta).
   ================================================================ */

(function () {
  'use strict';
  if (window.__achivaTaskLoaded) return;
  window.__achivaTaskLoaded = true;

  var el = UI.el, esc = UI.esc;

  /* ---------- store ---------- */
  var KEY = 'achiva.tasks.v1';
  var data = window.AppStorage.loadAt(KEY) || { tasks: [] };
  if (!Array.isArray(data.tasks)) data.tasks = [];
  function persist() { window.AppStorage.saveAt(KEY, data); }
  function bridge() { return window.SubjectListBridge; }
  function today() { return window.DayClock ? window.DayClock.today() : UI.todayISO(); }   /* DAY-CLOCK */

  /* ---------- date / time helpers ---------- */
  function diffDays(a, b) { return Math.round((UI.fromISO(b) - UI.fromISO(a)) / 86400000); }

  /* "HH:MM" (24h) → "7:05 PM" */
  function fmtTime(hm) {
    var p = (hm || '09:00').split(':');
    var h = +p[0], m = +p[1];
    var ap = h >= 12 ? 'PM' : 'AM';
    var h12 = h % 12; if (h12 === 0) h12 = 12;
    return h12 + ':' + String(m).padStart(2, '0') + ' ' + ap;
  }

  /* ---------- repeat logic ---------- */
  function occursOn(t, iso) {
    var r = t.repeat || { mode: 'none' };
    /* "Specific days" : sirf chuni hui dates par (koi pattern nahi) */
    if (r.mode === 'dates') return (r.dates || []).indexOf(iso) !== -1;
    if (iso < t.date) return false;
    if (iso === t.date) return true;
    if (r.mode === 'daily') return true;
    var d = diffDays(t.date, iso);
    if (r.mode === 'weekly') return d % 7 === 0;
    if (r.mode === 'monthly') return UI.fromISO(iso).getDate() === UI.fromISO(t.date).getDate();
    if (r.mode === 'every') return (r.days > 0) && (d % r.days === 0);
    return false;
  }

  /* from+1 se aage ki pehli occurrence (400 din tak dhundo) */
  function nextFrom(t, from) {
    for (var i = 1; i <= 400; i++) {
      var iso = UI.addDays(from, i);
      if (occursOn(t, iso)) return iso;
    }
    return null;
  }

  function repeatLabel(t) {
    var r = t.repeat || { mode: 'none' };
    if (r.mode === 'daily') return 'Daily';
    if (r.mode === 'weekly') return 'Weekly';
    if (r.mode === 'monthly') return 'Monthly';
    if (r.mode === 'every') return 'Every ' + r.days + 'd';
    if (r.mode === 'dates') return (r.dates || []).length + ' dates';
    return 'One-time';
  }

  function priorityCss(p) {
    if (p === 'High') return ';background:var(--ink);color:var(--paper);border:1px solid var(--ink)';
    if (p === 'Low') return ';background:var(--chip-bg);color:var(--ash);border:1px solid var(--s2)';
    return ';background:var(--chip-bg);color:var(--ink2);border:1px solid var(--line-strong)';
  }

  /* ---------- screen ---------- */
  var screen = el('section', 'screen');
  screen.style.paddingTop = '58px';
  document.getElementById('app').appendChild(screen);

  var ICON_CAL = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="4" width="18" height="18" rx="3"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>';
  var ICON_CLK = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';

  function groupHead(text) {
    var h = el('div', 'eyebrow', text);
    h.style.margin = '14px 18px 6px';
    return h;
  }

  function sortByTime(list) {
    list.sort(function (a, b) { return (a.time || '').localeCompare(b.time || ''); });
  }

  function taskRow(t, iso) {
    var row = UI.rowBox();
    var done = !!(t.done && t.done[iso]);
    var tick = UI.roundCheck(done);
    tick.addEventListener('click', function () { toggleDone(t.id, iso); });
    row.appendChild(tick);

    var mid = el('div');
    mid.style.cssText = 'flex:1;min-width:0';
    var nm = el('div', null, esc(t.name));
    nm.style.cssText = 'font-size:13.5px;font-weight:600;color:var(--ink);' +
      (done ? 'text-decoration:line-through;color:var(--ash);' : '');
    mid.appendChild(nm);
    if (t.desc) {
      var ds = el('div', null, esc(t.desc));
      ds.style.cssText = 'font-size:11.5px;color:var(--ash);margin-top:2px;white-space:pre-wrap;word-break:break-word';
      mid.appendChild(ds);
    }
    var chips = el('div');
    chips.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin-top:7px';
    chips.appendChild(UI.chip(UI.fmtDate(iso)));
    if ((t.repeat || {}).mode !== 'none') chips.appendChild(UI.chip(repeatLabel(t)));
    chips.appendChild(UI.chip(fmtTime(t.time)));
    var pc = UI.chip(t.priority || 'Medium');
    pc.style.cssText += priorityCss(t.priority);
    chips.appendChild(pc);
    mid.appendChild(chips);
    row.appendChild(mid);

    var pop = UI.makeKebabPop(function () { openForm(t); }, function () {
      data.tasks = data.tasks.filter(function (x) { return x.id !== t.id; });
      persist();
      render();
    });
    var k = UI.miniBtn(UI.icons.kebab, 'Edit or delete');
    k.addEventListener('click', function (e) {
      e.stopPropagation();
      UI.togglePop(pop);
    });
    row.appendChild(k);
    row.appendChild(pop);
    return row;
  }

  function render() {
    screen.innerHTML = '';
    var head = el('div');
    head.style.cssText = 'display:flex;align-items:center;gap:10px;padding:12px 16px 6px';
    var tw = el('div', 'sub-title-wrap');
    tw.style.flex = '1';
    tw.appendChild(el('h2', null, 'Tasks'));
    tw.appendChild(el('div', 'sub-meta', data.tasks.length + ' task' + (data.tasks.length === 1 ? '' : 's')));
    head.appendChild(tw);
    var addB = UI.pillBtn(UI.icons.plusBig + '<span>Task</span>');
    addB.addEventListener('click', function () { openForm(null); });
    head.appendChild(addB);
    screen.appendChild(head);

    var scroll = el('div', 'scroll');
    var tdy = today();
    var todayL = [], upL = [], pastL = [];
    data.tasks.forEach(function (t) {
      if (occursOn(t, tdy)) todayL.push(t);
      else if (nextFrom(t, tdy)) upL.push(t);
      else pastL.push(t);
    });
    sortByTime(todayL); sortByTime(upL); sortByTime(pastL);

    if (!data.tasks.length) {
      var e = el('div', 'empty', 'No tasks yet<br>Upar + Task se pehla task add karo.');
      e.style.margin = '12px 18px';
      scroll.appendChild(e);
    } else {
      if (todayL.length) {
        scroll.appendChild(groupHead('Today'));
        todayL.forEach(function (t) { scroll.appendChild(taskRow(t, tdy)); });
      }
      if (upL.length) {
        scroll.appendChild(groupHead('Upcoming'));
        upL.forEach(function (t) { scroll.appendChild(taskRow(t, nextFrom(t, tdy) || t.date)); });
      }
      if (pastL.length) {
        scroll.appendChild(groupHead('Passed'));
        pastL.forEach(function (t) { scroll.appendChild(taskRow(t, t.date)); });
      }
    }
    screen.appendChild(scroll);
  }

  function open() {
    render();
    bridge().show(screen, true);
  }

  /* ---------- scroll time wheel (hour / minute / AM-PM) ---------- */
  var ITEM_H = 34;

  function wheelCol(values, initial, label) {
    var box = el('div');
    box.style.cssText = 'width:62px;height:' + (ITEM_H * 3) + 'px;overflow-y:auto;border:1px solid var(--s2);' +
      'border-radius:12px;background:var(--input-bg);scrollbar-width:thin';
    var list = el('div');
    list.appendChild(el('div')).style.height = ITEM_H + 'px';
    var items = [];
    var col = { value: initial, timer: null };
    values.forEach(function (v, i) {
      var it = el('div', null, v);
      it.style.cssText = 'height:' + ITEM_H + 'px;display:flex;align-items:center;justify-content:center;' +
        'font-family:var(--f-mono);font-size:13px;color:var(--slate);cursor:pointer';
      it.addEventListener('click', function () { select(i); });
      list.appendChild(it);
      items.push(it);
    });
    list.appendChild(el('div')).style.height = ITEM_H + 'px';
    box.appendChild(list);
    function paint() {
      items.forEach(function (it, idx) {
        var on = idx === col.value;
        it.style.color = on ? 'var(--ink)' : 'var(--slate)';
        it.style.fontWeight = on ? '700' : '400';
        it.style.background = on ? 'var(--chip-bg)' : 'transparent';
        it.style.borderRadius = on ? '8px' : '0';
      });
    }
    function select(i) {
      col.value = Math.max(0, Math.min(values.length - 1, i));
      try { box.scrollTop = col.value * ITEM_H; } catch (e) { /* jsdom */ }
      paint();
    }
    box.addEventListener('scroll', function () {
      if (col.timer) window.clearTimeout(col.timer);
      col.timer = window.setTimeout(function () {
        select(Math.round(box.scrollTop / ITEM_H));
      }, 70);
    });
    var unit = el('div');
    unit.style.cssText = 'display:flex;flex-direction:column;align-items:center';
    unit.appendChild(box);
    var lab = el('div', null, label);
    lab.style.cssText = 'font-size:9px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;' +
      'color:var(--ash);margin-top:3px';
    unit.appendChild(lab);
    select(initial);
    return { node: unit, get: function () { return col.value; } };
  }

  function timeWheel(hm) {
    var p = (hm || '09:00').split(':');
    var h = +p[0], m = +p[1];
    var h12 = h % 12; if (h12 === 0) h12 = 12;
    var hrs = []; for (var i = 1; i <= 12; i++) hrs.push(String(i));
    var mins = []; for (var j = 0; j < 60; j++) mins.push(String(j).padStart(2, '0'));
    var wrap = el('div');
    wrap.style.cssText = 'display:flex;gap:10px;justify-content:center;margin:8px 0 2px';
    var cH = wheelCol(hrs, h12 - 1, 'hour');
    var cM = wheelCol(mins, m, 'min');
    var cA = wheelCol(['AM', 'PM'], h >= 12 ? 1 : 0, 'am/pm');
    wrap.appendChild(cH.node);
    wrap.appendChild(cM.node);
    wrap.appendChild(cA.node);
    wrap.get = function () {
      var h12v = cH.get() + 1;
      var h24 = (cA.get() === 1) ? (h12v % 12) + 12 : h12v % 12;
      return String(h24).padStart(2, '0') + ':' + String(cM.get()).padStart(2, '0');
    };
    return wrap;
  }

  var twModal = UI.modal({ zScrim: 92, zWrap: 93, saveLabel: 'Set' });
  function openTimeWheel(hm, onSet) {
    var wheel = null;
    twModal.open('Time', function (body) {
      wheel = timeWheel(hm);
      body.appendChild(wheel);
    }, function () {
      var v = wheel.get();
      twModal.close();
      onSet(v);
    });
  }

  /* ---------- multi-date calendar ("Specific days") ----------
     App wala custom calendar hi, par multi-select : click = toggle,
     Save/Done par chuni hui saari dates wapas milti hain. */
  var mdModal = UI.modal({ zScrim: 94, zWrap: 95, saveLabel: 'Done' });
  function openDatesPicker(initial, onDone) {
    var sel = {};
    (initial || []).forEach(function (d) { sel[d] = true; });
    var base = UI.fromISO((initial && initial[0]) || today());
    var view = { y: base.getFullYear(), m: base.getMonth() };
    mdModal.open('Specific days', function (body) {
      var hint = el('div', null, 'Jitni dates chunoge, task sirf unhi dinon dikhega.');
      hint.style.cssText = 'font-size:11px;color:var(--ash);margin-bottom:10px';
      body.appendChild(hint);
      var head = el('div');
      head.style.cssText = 'display:flex;gap:10px;margin-bottom:10px';
      var mSel = el('select'), ySel = el('select');
      [mSel, ySel].forEach(function (sl) {
        sl.style.cssText = 'flex:1;padding:9px 10px;border-radius:12px;border:1px solid var(--s2);' +
          'background:var(--input-bg);font:inherit;font-size:12.5px;font-weight:600;color:var(--ink);outline:none';
      });
      UI.MONTHS.forEach(function (m, i) {
        var op = el('option'); op.value = i; op.textContent = m; mSel.appendChild(op);
      });
      var thisYear = new Date().getFullYear();
      for (var y = thisYear - 10; y <= thisYear + 10; y++) {
        var yo = el('option'); yo.value = y; yo.textContent = y; ySel.appendChild(yo);
      }
      mSel.value = view.m;
      ySel.value = view.y;
      head.appendChild(mSel);
      head.appendChild(ySel);
      body.appendChild(head);
      var week = el('div');
      week.style.cssText = 'display:grid;grid-template-columns:repeat(7,1fr);gap:4px;margin-bottom:4px';
      ['S', 'M', 'T', 'W', 'T', 'F', 'S'].forEach(function (d) {
        var sp = el('span', 'eyebrow', d);
        sp.style.textAlign = 'center';
        week.appendChild(sp);
      });
      body.appendChild(week);
      var grid = el('div');
      grid.style.cssText = 'display:grid;grid-template-columns:repeat(7,1fr);gap:4px';
      body.appendChild(grid);
      function paint() {
        grid.innerHTML = '';
        var offset = new Date(view.y, view.m, 1).getDay();
        var daysIn = new Date(view.y, view.m + 1, 0).getDate();
        var tdy = today();
        for (var i = 0; i < offset; i++) grid.appendChild(el('span'));
        for (var d = 1; d <= daysIn; d++) {
          (function (day) {
            var iso = view.y + '-' + String(view.m + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0');
            var on = !!sel[iso];
            var b = el('button', null, String(day));
            b.type = 'button';
            b.style.cssText = 'height:34px;border-radius:50%;cursor:pointer;font:inherit;font-size:12.5px;' +
              'display:flex;align-items:center;justify-content:center;transition:.15s;' +
              (on
                ? 'background:var(--ink);color:var(--paper);border:1px solid var(--ink);font-weight:700'
                : iso === tdy
                  ? 'background:none;color:var(--ink2);border:1px solid var(--s3);font-weight:600'
                  : 'background:none;color:var(--ink2);border:1px solid transparent');
            b.addEventListener('click', function () {
              if (sel[iso]) delete sel[iso]; else sel[iso] = true;
              paint();
            });
            grid.appendChild(b);
          })(d);
        }
      }
      mSel.addEventListener('change', function () { view.m = +mSel.value; paint(); });
      ySel.addEventListener('change', function () { view.y = +ySel.value; paint(); });
      paint();
    }, function () {
      var out = Object.keys(sel).sort();
      mdModal.close();
      onDone(out);
    });
  }

  /* ---------- add / edit form ---------- */
  var REP_OPTS = ['Off', 'Daily', 'Weekly', 'Monthly', 'Every N days', 'Specific days'];
  function repToLabel(r) {
    r = r || { mode: 'none' };
    if (r.mode === 'daily') return 'Daily';
    if (r.mode === 'weekly') return 'Weekly';
    if (r.mode === 'monthly') return 'Monthly';
    if (r.mode === 'every') return 'Every N days';
    if (r.mode === 'dates') return 'Specific days';
    return 'Off';
  }

  var formModal = UI.modal({ saveLabel: 'Save' });

  function openForm(task) {
    var editing = !!task;
    var src = task || {};
    var date = src.date || today();
    var time = src.time || '09:00';
    var days = (src.repeat && src.repeat.days) || 7;
    var picked = (src.repeat && src.repeat.mode === 'dates' && src.repeat.dates)
      ? src.repeat.dates.slice() : [];

    formModal.open(editing ? 'Edit Task' : 'New Task', function (body) {
      /* name (zaroori) */
      var nameF = UI.inputField('Task name', 'e.g. Physics revision');
      nameF.input.value = src.name || '';
      body.appendChild(nameF.wrap);

      /* description (optional) */
      body.appendChild(UI.label('Description (optional)'));
      var desc = el('textarea');
      desc.rows = 2;
      desc.placeholder = 'Kya karna hai — chhota sa note';
      desc.style.cssText = UI.fieldCss + ';resize:none;margin-bottom:12px';
      desc.value = src.desc || '';
      body.appendChild(desc);

      /* date & time : dono pills parallel — calendar + scroll wheels */
      body.appendChild(UI.label('Date & Time'));
      var dtRow = el('div');
      dtRow.style.cssText = 'display:flex;gap:8px;align-items:center;margin-bottom:12px;flex-wrap:wrap';
      var datePill = UI.pillBtn(ICON_CAL + '<span></span>');
      var timePill = UI.pillBtn(ICON_CLK + '<span></span>');
      function paintPills() {
        datePill.querySelector('span').textContent = UI.fmtDate(date);
        timePill.querySelector('span').textContent = fmtTime(time);
      }
      paintPills();
      datePill.addEventListener('click', function () {
        window.AchivaCalendar.open('Task Date', date, function (iso) { date = iso; paintPills(); });
      });
      timePill.addEventListener('click', function () {
        openTimeWheel(time, function (hm) { time = hm; paintPills(); });
      });
      dtRow.appendChild(datePill);
      dtRow.appendChild(timePill);
      body.appendChild(dtRow);

      /* repeat — date ke just neeche */
      body.appendChild(UI.label('Repeat'));
      var repChips = UI.chipRow(REP_OPTS, repToLabel(src.repeat));
      body.appendChild(repChips.row);
      var custRow = el('div');
      custRow.style.cssText = 'display:flex;gap:8px;align-items:center;margin:10px 0 12px;flex-wrap:wrap';
      var evLab = el('span', null, 'Every');
      evLab.style.cssText = 'font-size:12px;font-weight:600;color:var(--slate)';
      var numIn = el('input');
      numIn.type = 'number';
      numIn.min = '1';
      numIn.value = days;
      numIn.style.cssText = 'width:64px;padding:9px 10px;border-radius:12px;border:1px solid var(--s2);' +
        'background:var(--input-bg);font:inherit;font-size:13px;color:var(--ink);outline:none';
      var dLab = el('span', null, 'days');
      dLab.style.cssText = 'font-size:12px;font-weight:600;color:var(--slate)';
      var nextPill = UI.pillBtn('Pick next date');
      nextPill.addEventListener('click', function () {
        window.AchivaCalendar.open('Next Occurrence', UI.addDays(date, 1), function (iso) {
          var n = diffDays(date, iso);
          if (n > 0) numIn.value = n;
        });
      });
      custRow.appendChild(evLab);
      custRow.appendChild(numIn);
      custRow.appendChild(dLab);
      custRow.appendChild(nextPill);
      body.appendChild(custRow);
      /* "Specific days" row : multi-date calendar kholne wala pill */
      var datesRow = el('div');
      datesRow.style.cssText = 'display:flex;gap:8px;align-items:center;margin:10px 0 12px;flex-wrap:wrap';
      var datesPill = UI.pillBtn(ICON_CAL + '<span></span>');
      function paintDatesPill() {
        datesPill.querySelector('span').textContent = picked.length
          ? picked.length + ' date' + (picked.length === 1 ? '' : 's') + ' chosen'
          : 'Dates choose karo';
      }
      paintDatesPill();
      datesPill.addEventListener('click', function () {
        openDatesPicker(picked, function (arr) { picked = arr; paintDatesPill(); });
      });
      datesRow.appendChild(datesPill);
      body.appendChild(datesRow);
      function paintCust() {
        custRow.style.display = repChips.get() === 'Every N days' ? 'flex' : 'none';
        datesRow.style.display = repChips.get() === 'Specific days' ? 'flex' : 'none';
      }
      repChips.row.addEventListener('click', paintCust);
      paintCust();

      /* priority category */
      body.appendChild(UI.label('Priority'));
      var priChips = UI.chipRow(['High', 'Medium', 'Low'], src.priority || 'Medium');
      body.appendChild(priChips.row);

      body._collect = function () {
        var rl = repChips.get();
        var repeat = { mode: 'none' };
        if (rl === 'Daily') repeat = { mode: 'daily' };
        else if (rl === 'Weekly') repeat = { mode: 'weekly' };
        else if (rl === 'Monthly') repeat = { mode: 'monthly' };
        else if (rl === 'Every N days') repeat = { mode: 'every', days: Math.max(1, parseInt(numIn.value, 10) || 1) };
        else if (rl === 'Specific days') repeat = { mode: 'dates', dates: picked.slice().sort() };
        return {
          name: nameF.input.value.trim(),
          desc: desc.value.trim(),
          date: date,
          time: time,
          repeat: repeat,
          priority: priChips.get()
        };
      };
    }, function () {
      var v = formModal.body._collect();
      if (!v.name) return;
      /* Specific days : base date = pehli chuni hui date (sorting/grouping ke liye) */
      if (v.repeat.mode === 'dates' && v.repeat.dates.length) v.date = v.repeat.dates[0];
      if (editing) {
        src.name = v.name; src.desc = v.desc; src.date = v.date;
        src.time = v.time; src.repeat = v.repeat; src.priority = v.priority;
      } else {
        data.tasks.push({
          id: UI.uid(), name: v.name, desc: v.desc, date: v.date,
          time: v.time, repeat: v.repeat, priority: v.priority, done: {}
        });
      }
      persist();
      formModal.close();
      render();
    });
  }

  /* ---------- dashboard bridge : public API ----------
     toggleDone = taskRow wala hi tick logic (id se task dhundo,
     us din ki occurrence ulat do, persist + render). Dashboard ka
     "Tasks" section isi ko call karta hai. */
  function toggleDone(id, iso) {
    var t = null;
    data.tasks.forEach(function (x) { if (x.id === id) t = x; });
    if (!t) return;
    t.done = t.done || {};
    t.done[iso] = !t.done[iso];
    persist();
    render();
  }

  window.TaskFeature = {
    open: open,
    all: function () { return data.tasks; },
    occursOn: occursOn,
    nextFrom: nextFrom,
    repeatLabel: repeatLabel,
    fmtTime: fmtTime,
    priorityCss: priorityCss,
    toggleDone: toggleDone
  };

  /* parse-time refresh : boot order mein task.js dashboard scripts
     ke BAAD aata hai — agar dashboard pehle se khula hai (list.js
     ne parse-time par open kiya tha) to Tasks section turant bhar
     do, user ko khali card na dikhe. */
  try {
    if (window.Dashboard && window.Dashboard.isCurrent && window.Dashboard.isCurrent()) {
      window.Dashboard.render();
    }
  } catch (e) { /* ignore */ }
})();
