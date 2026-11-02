/* ================================================================
   FEATURES / GOALS / GOAL-HEAT.JS — month-wise heat-map + sessions
   ----------------------------------------------------------------
   • MAIN panel (detail mein) : sirf **3 month** ka rolling window
       windowStart = max(goal start month, current month - 2)
       → today Sept : Sept, Oct, Nov
       → today Dec  : Oct, Nov, Dec (Sept apne aap gayab)
       → today Jan  : Nov, Dec, Jan   (month badalte hi slide)
   • Head chips : plan chip + Today chip + **arrow button** →
     FULL heat screen (poora heat-map ek saath, scroll ke saath)
   • Har box (main ya full) par CLICK → **day toolkit popup** :
     us din ke saare sessions — kab shuru, kab khatam, kitne min
     (manual entries bhi, "Manual entry" likha ke)
   • Continuous per-minute intensity (fixed ÷ ramp, min-max green→gold)
   • Panel ke andar neeche : [▶ Start session][min][+ Manual timing]
     Start session popup : Count Up direct / Countdown scroll-wheels
   ================================================================ */

(function () {
  'use strict';

  if (window.__achivaGoalHeatLoaded) return;
  window.__achivaGoalHeatLoaded = true;

  var el = UI.el;
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];
  var ITEM_H = 28;
  var ICON_EXPAND = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';

  var run = null;

  function planOf(g) {
    var p = g.dailyPlan;
    if (p && p.mode === 'range' && p.min > 0) return { mode: 'range', min: p.min, max: Math.max(p.min, p.max || p.min) };
    if (p && p.mode === 'fixed' && p.fixed > 0) return { mode: 'fixed', fixed: p.fixed };
    return { mode: 'fixed', fixed: 30 };
  }

  /* DAY-CLOCK : session ka din startMs se (app-day); startMs na ho to stored date.
     Purana data (startMs ke bina) stored date par hi rahega. */
  function sessionDay(s) {
    if (s && s.startMs && window.DayClock && window.DayClock.dayOf) return window.DayClock.dayOf(s.startMs);
    return s && s.date;
  }
  function appToday() { return window.DayClock ? window.DayClock.today() : UI.todayISO(); }

  function minutesByDate(g) {
    var m = {};
    (g.sessions || []).forEach(function (s) { var d = sessionDay(s); m[d] = (m[d] || 0) + (s.minutes || 0); });
    return m;
  }

  /* ---------- continuous color ---------- */
  function lerp(a, b, t) {
    return [
      Math.round(a[0] + (b[0] - a[0]) * t),
      Math.round(a[1] + (b[1] - a[1]) * t),
      Math.round(a[2] + (b[2] - a[2]) * t)
    ];
  }
  function rgb(c) { return 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')'; }
  function ramps() {
    var dark = document.documentElement.getAttribute('data-theme') === 'dark';
    return dark
      ? { gFrom: [36, 52, 42], gTo: [86, 211, 100], yFrom: [74, 61, 24], yTo: [255, 215, 94] }
      : { gFrom: [207, 230, 207], gTo: [46, 160, 67], yFrom: [246, 227, 180], yTo: [224, 164, 0] };
  }
  function colorFor(g, minutes) {
    if (!minutes || minutes <= 0) return null;
    var p = planOf(g);
    var R = ramps();
    var col;
    if (p.mode === 'range') {
      if (minutes <= p.min) col = lerp(R.gFrom, R.gTo, minutes / p.min);
      else col = lerp(R.gTo, R.yTo, Math.min(1, (minutes - p.min) / Math.max(1, p.max - p.min)));
    } else {
      if (minutes <= p.fixed) col = lerp(R.gFrom, R.gTo, minutes / p.fixed);
      else col = lerp(R.yFrom, R.yTo, Math.min(1, (minutes - p.fixed) / p.fixed));
    }
    return { bg: rgb(col), border: rgb(lerp(col, [20, 20, 20], 0.25)) };
  }

  function pad(n) { return String(n).padStart(2, '0'); }
  function fmtSec(sec) {
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return (h > 0 ? h + ':' : '') + pad(m) + ':' + pad(s);
  }
  function fmtClock(ms) {
    var d = new Date(ms);
    return pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function stopRun() { if (run && run.interval) window.clearInterval(run.interval); run = null; }
  function logAndRefresh(goalId, minutes, times) {
    if (minutes > 0) window.GoalStore.addSession(goalId, minutes, undefined, times);
    stopRun();
    if (window.GoalDetail) window.GoalDetail.refresh();
  }

  /* ---------- month helpers ---------- */
  function monthKey(iso) { return iso.slice(0, 7); }
  function addMonths(mk, n) {
    var y = +mk.slice(0, 4), m = +mk.slice(5, 7) - 1 + n;
    y += Math.floor(m / 12); m = ((m % 12) + 12) % 12;
    return y + '-' + String(m + 1).padStart(2, '0');
  }
  function monthLabel(mk) { return MONTHS[+mk.slice(5, 7) - 1] + ' ' + mk.slice(2, 4); }

  /* ---------- day toolkit popup ---------- */
  function dayModal(g, date) {
    var m = UI.modal({ zScrim: 90, zWrap: 91 });
    var list = (g.sessions || []).filter(function (s) { return s.date === date; });
    var total = 0;
    list.forEach(function (s) { total += s.minutes || 0; });
    m.open(UI.fmtDate(date), function (body) {
      var sum = UI.chip('Total ' + total + ' min · ' + list.length + ' session' + (list.length === 1 ? '' : 's'));
      sum.style.cssText += ';margin-bottom:10px';
      body.appendChild(sum);
      if (!list.length) {
        body.appendChild(el('div', 'empty', 'Is din koi session nahi.'));
        return;
      }
      /* compact toolkit : sessions andar scroll hote hain, sheet chhoti rehti hai */
      var scrollBox = el('div');
      scrollBox.style.cssText = 'max-height:190px;overflow-y:auto;padding-right:2px';
      list.forEach(function (s) {
        var row = el('div');
        row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 10px;margin-bottom:6px;' +
          'border:1px solid var(--line);border-radius:12px;background:var(--chip-bg)';
        var t = el('div');
        t.style.cssText = 'flex:1;font-family:var(--f-mono);font-size:12px;font-weight:600;color:var(--ink)';
        t.textContent = (s.startMs && s.endMs)
          ? fmtClock(s.startMs) + ' → ' + fmtClock(s.endMs)
          : 'Manual entry';
        row.appendChild(t);
        var mn = el('b', null, s.minutes + ' min');
        mn.style.cssText = 'font-size:11.5px;color:var(--slate)';
        row.appendChild(mn);
        scrollBox.appendChild(row);
      });
      body.appendChild(scrollBox);
    }, null);
    var sv = m.sheet.querySelector('.sheet-actions .btn-solid');
    if (sv) sv.style.display = 'none';
  }

  /* ---------- box ---------- */
  function box(g, date, minutes, isFuture) {
    var b = el('div');
    b.className = 'gh-box' + (isFuture ? ' gh-fut' : '');
    var c = (!isFuture && minutes > 0) ? colorFor(g, minutes) : null;
    if (c) { b.style.background = c.bg; b.style.borderColor = c.border; }
    b.title = date || '';
    if (date && !isFuture) {
      b.style.cursor = 'pointer';
      b.addEventListener('click', function () { dayModal(g, date); });
    }
    return b;
  }

  /* ---------- month rows builder ---------- */
  function monthRows(g, fromMK, toMK, m) {
    var frag = el('div');
    var today = appToday();
    var end = window.GoalStore.endDate(g) || today;
    var cur = g.startDate;
    var guard = 0;
    while (cur <= end && guard < 4000) {
      var mk = monthKey(cur);
      if (mk >= fromMK && mk <= toMK) {
        var rowEl = frag.querySelector('[data-mk="' + mk + '"]');
        if (!rowEl) {
          rowEl = el('div');
          rowEl.setAttribute('data-mk', mk);
          rowEl.style.cssText = 'display:flex;align-items:center;gap:8px;margin-top:9px';
          var lab = el('span', null, monthLabel(mk));
          lab.style.cssText = 'flex:none;width:52px;font-size:9.5px;font-weight:700;letter-spacing:.08em;' +
            'text-transform:uppercase;color:var(--slate)';
          rowEl.appendChild(lab);
          var cells = el('div');
          cells.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px';
          rowEl.appendChild(cells);
          frag.appendChild(rowEl);
        }
        rowEl.lastChild.appendChild(box(g, cur, m[cur] || 0, cur > today));
      }
      cur = UI.addDays(cur, 1);
      guard++;
    }
    return frag;
  }

  function legend(g) {
    var pl2 = planOf(g);
    var base = pl2.mode === 'range' ? pl2.min : pl2.fixed;
    var leg = el('div');
    leg.style.cssText = 'display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-top:12px;' +
      'font-size:10px;color:var(--slate)';
    leg.appendChild(el('span', null, 'Less'));
    [0, 0.15, 0.4, 0.7, 1].forEach(function (t) { leg.appendChild(box(g, null, Math.round(base * t), false)); });
    leg.appendChild(el('span', null, 'More'));
    leg.appendChild(box(g, null, Math.round(base * 1.4), false));
    leg.appendChild(box(g, null, base * 2 + 1, false));
    leg.appendChild(el('span', null, 'Excellent'));
    leg.appendChild(box(g, null, 0, true));
    leg.appendChild(el('span', null, 'Upcoming'));
    return leg;
  }

  /* ---------- session wheels + popup + running (pehle jaisa) ---------- */
  function wheelPicker(initialSec) {
    var wrap = el('div');
    wrap.style.cssText = 'display:flex;gap:8px;justify-content:center;margin:10px 0 4px';
    var cols = [];
    function makeCol(max, label, initial) {
      var boxW = el('div');
      boxW.style.cssText = 'width:64px;height:' + (ITEM_H * 3) + 'px;overflow-y:auto;border:1px solid var(--s2);' +
        'border-radius:12px;background:var(--input-bg);position:relative;scrollbar-width:thin';
      var list = el('div');
      list.appendChild(el('div')).style.height = ITEM_H + 'px';
      var items = [];
      for (var i = 0; i <= max; i++) {
        (function (v) {
          var it = el('div', null, String(v).padStart(2, '0'));
          it.style.cssText = 'height:' + ITEM_H + 'px;display:flex;align-items:center;justify-content:center;' +
            'font-family:var(--f-mono);font-size:13px;color:var(--slate);cursor:pointer';
          it.addEventListener('click', function () { select(v); });
          list.appendChild(it);
          items.push(it);
        })(i);
      }
      list.appendChild(el('div')).style.height = ITEM_H + 'px';
      boxW.appendChild(list);
      var col = { box: boxW, items: items, value: initial, max: max, timer: null };
      function paint() {
        items.forEach(function (it, idx) {
          var on = idx === col.value;
          it.style.color = on ? 'var(--ink)' : 'var(--slate)';
          it.style.fontWeight = on ? '700' : '400';
          it.style.background = on ? 'var(--chip-bg)' : 'transparent';
          it.style.borderRadius = on ? '8px' : '0';
        });
      }
      function select(v) {
        col.value = Math.max(0, Math.min(max, v));
        try { boxW.scrollTop = col.value * ITEM_H; } catch (e) { /* jsdom */ }
        paint();
      }
      boxW.addEventListener('scroll', function () {
        if (col.timer) window.clearTimeout(col.timer);
        col.timer = window.setTimeout(function () {
          select(Math.max(0, Math.min(max, Math.round(boxW.scrollTop / ITEM_H))));
        }, 70);
      });
      col.select = select; col.paint = paint;
      cols.push(col);
      var lab = el('div', null, label);
      lab.style.cssText = 'font-size:9px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;' +
        'color:var(--ash);text-align:center;margin-top:3px';
      var unit = el('div');
      unit.appendChild(boxW); unit.appendChild(lab);
      wrap.appendChild(unit);
      select(initial);
    }
    makeCol(23, 'hrs', Math.floor(initialSec / 3600));
    makeCol(59, 'min', Math.floor((initialSec % 3600) / 60));
    makeCol(59, 'sec', initialSec % 60);
    wrap.get = function () { return cols[0].value * 3600 + cols[1].value * 60 + cols[2].value; };
    return wrap;
  }

  function begin(g, mode, sec) {
    stopRun();
    run = { goalId: g.id, mode: mode, startTs: Date.now(), planSec: sec, interval: null, clockEl: null };
    if (window.GoalDetail) window.GoalDetail.refresh();
  }

  function startModal(g) {
    var m = UI.modal({ zScrim: 87, zWrap: 88 });
    var pl = planOf(g);
    var defSec = (pl.mode === 'range' ? pl.min : pl.fixed) * 60;
    var wheel = null;
    m.open('Start session — ' + g.title, function (body) {
      var upBtn = el('button', 'btn-solid', '▲ Count Up');
      upBtn.style.cssText += ';margin-bottom:10px';
      upBtn.addEventListener('click', function () { m.close(); begin(g, 'up', 0); });
      body.appendChild(upBtn);
      var or = el('div', null, 'OR');
      or.style.cssText = 'font-size:10px;font-weight:700;letter-spacing:.08em;color:var(--ash);text-align:center;margin:2px 0 8px';
      body.appendChild(or);
      body.appendChild(UI.label('Countdown'));
      wheel = wheelPicker(defSec);
      body.appendChild(wheel);
      var startBtn = el('button', 'btn-solid', '▶ Start');
      startBtn.style.cssText += ';margin-top:10px';
      startBtn.addEventListener('click', function () {
        var sec = wheel.get() || defSec;
        m.close();
        begin(g, 'down', sec);
      });
      body.appendChild(startBtn);
    }, null);
    var sv = m.sheet.querySelector('.sheet-actions .btn-solid');
    if (sv) sv.style.display = 'none';
  }

  function runningRow(g) {
    var row = el('div');
    row.style.cssText = 'display:flex;align-items:center;gap:10px;margin-top:12px;padding:10px 12px;' +
      'border:1px solid var(--line);border-radius:14px;background:var(--chip-bg)';
    var clock = el('div', null, fmtSec(run.mode === 'down' ? run.planSec : 0));
    clock.style.cssText = 'flex:1;font-family:var(--f-mono);font-size:22px;font-weight:700;color:var(--ink)';
    row.appendChild(clock);
    var stop = UI.pillBtn('■ Stop & log');
    stop.style.cssText += ';padding:7px 12px;font-size:11px';
    stop.addEventListener('click', function () {
      var elapsed = Math.round((Date.now() - run.startTs) / 1000);
      var sec = run.mode === 'down' ? Math.min(run.planSec, elapsed) : elapsed;
      logAndRefresh(g.id, Math.max(1, Math.round(sec / 60)),
        { startMs: run.startTs, endMs: Date.now() });
    });
    row.appendChild(stop);
    var cancel = UI.pillBtn('Cancel');
    cancel.style.cssText += ';padding:7px 12px;font-size:11px';
    cancel.addEventListener('click', function () { stopRun(); if (window.GoalDetail) window.GoalDetail.refresh(); });
    row.appendChild(cancel);
    run.interval = window.setInterval(function () {
      var elapsed = Math.round((Date.now() - run.startTs) / 1000);
      if (run.mode === 'down') {
        var left = run.planSec - elapsed;
        if (left <= 0) {
          logAndRefresh(g.id, Math.max(1, Math.round(run.planSec / 60)),
            { startMs: run.startTs, endMs: run.startTs + run.planSec * 1000 });
          return;
        }
        clock.textContent = fmtSec(left);
      } else {
        clock.textContent = fmtSec(elapsed);
      }
    }, 1000);
    return row;
  }

  function idleRow(g) {
    var row = el('div');
    row.style.cssText = 'display:flex;align-items:center;gap:8px;margin-top:12px;flex-wrap:nowrap';
    var startBtn = UI.pillBtn('▶ Start session');
    startBtn.style.cssText += ';padding:8px 12px;font-size:11px;flex:none';
    startBtn.addEventListener('click', function () { startModal(g); });
    row.appendChild(startBtn);
    var manIn = el('input');
    manIn.type = 'number';
    manIn.placeholder = 'min';
    manIn.style.cssText = 'flex:1;min-width:0;width:64px;padding:8px 10px;border-radius:10px;border:1px solid var(--s2);' +
      'background:var(--input-bg);font:inherit;font-size:12px;color:var(--ink);outline:none';
    row.appendChild(manIn);
    var manBtn = UI.pillBtn('+ Manual timing');
    manBtn.style.cssText += ';padding:8px 12px;font-size:11px;flex:none';
    manBtn.addEventListener('click', function () {
      var mm = parseInt(manIn.value, 10);
      if (!mm || mm < 1) { manIn.focus(); return; }
      logAndRefresh(g.id, mm, null);
    });
    row.appendChild(manBtn);
    return row;
  }

  /* ---------- MAIN panel : 3-month rolling window ---------- */
  function panel(g) {
    var p = el('div', 'gh-panel');
    p.style.cssText = 'margin:0 18px 12px;padding:14px;border:1px solid var(--line);border-radius:18px;' +
      'background:var(--tile-bg);box-shadow:inset 0 1px 0 var(--hl-soft)';

    var head = el('div');
    head.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:4px';
    /* chips wrap ho sakti hain, arrow hamesha right par ek hi line mein */
    var chipsWrap = el('div');
    chipsWrap.style.cssText = 'flex:1;min-width:0;display:flex;gap:6px;flex-wrap:wrap;align-items:center';
    chipsWrap.appendChild(UI.panelTitle('Heat-map', true));
    var pl = planOf(g);
    chipsWrap.appendChild(UI.chip(pl.mode === 'range' ? pl.min + '–' + pl.max + ' min daily' : pl.fixed + ' min daily'));
    var todayMin = minutesByDate(g)[appToday()] || 0;
    var tc = UI.chip('Today ' + todayMin + 'm');
    tc.style.cssText += ';background:rgba(46,160,67,.12);color:#2ea043;border-color:rgba(46,160,67,.35)';
    chipsWrap.appendChild(tc);
    head.appendChild(chipsWrap);
    var exp = UI.miniBtn(ICON_EXPAND, 'Full heat-map');
    exp.style.flex = 'none';
    exp.addEventListener('click', function () { openFull(g); });
    head.appendChild(exp);
    p.appendChild(head);

    if (!g.startDate) {
      var hint = el('div', null, 'Set a start date (Detail) to see the heat-map.');
      hint.style.cssText = 'font-size:11.5px;color:var(--slate);line-height:1.6;margin-top:6px';
      p.appendChild(hint);
      return p;
    }

    var m = minutesByDate(g);
    var todayMK = monthKey(appToday());
    var startMK = monthKey(g.startDate);
    var fromMK = startMK > addMonths(todayMK, -2) ? startMK : addMonths(todayMK, -2);
    var toMK = addMonths(fromMK, 2);
    p.appendChild(monthRows(g, fromMK, toMK, m));
    p.appendChild(legend(g));

    if (run && run.goalId === g.id) p.appendChild(runningRow(g));
    else {
      stopRun();
      if (g.subjectId) {
        /* STUDY-GOALS: linked goal — time SIRF Subject Tracker se aata
           hai, isliye Start session / Manual timing YAHAN NAHI */
        var auto = el('div', 'sg-auto-note');
        auto.style.cssText = 'margin-top:12px;padding:9px 12px;border:1px dashed var(--s2);' +
          'border-radius:12px;font-size:11px;color:var(--slate);line-height:1.6';
        auto.textContent = 'Study Goal ON — Subject Tracker ka padhai-time apne aap is goal mein judta hai. ' +
          'Timer aur manual entry ke buttons sirf normal (unlinked) goals mein hote hain.';
        p.appendChild(auto);
      } else {
        p.appendChild(idleRow(g));
      }
    }
    return p;
  }

  /* ---------- FULL heat screen ---------- */
  var fullScreen = null;
  function openFull(g) {
    if (!fullScreen) {
      fullScreen = el('section', 'screen');
      fullScreen.style.paddingTop = '58px';
      document.getElementById('app').appendChild(fullScreen);
    }
    fullScreen.innerHTML = '';
    var scroll = el('div', 'scroll');

    var head = el('div');
    head.style.cssText = 'display:flex;align-items:center;gap:10px;padding:12px 16px 6px';
    var back = UI.miniBtn(UI.icons.back, 'Back');
    back.style.cssText += ';width:34px;height:34px;border-radius:50%;border:1px solid var(--s2);' +
      'background:var(--chip-bg);box-shadow:inset 0 1px 0 var(--hl-soft)';
    back.addEventListener('click', function () {
      if (window.GoalDetail) window.GoalDetail.open(g.id);
    });
    head.appendChild(back);
    var tt = el('b', null, 'Heat-map — full');
    tt.style.cssText = 'flex:1;font-family:var(--f-disp);font-size:16px;font-weight:700;color:var(--ink)';
    head.appendChild(tt);
    scroll.appendChild(head);

    var wrapP = el('div');
    wrapP.style.cssText = 'margin:6px 18px 12px;padding:14px;border:1px solid var(--line);border-radius:18px;' +
      'background:var(--tile-bg);box-shadow:inset 0 1px 0 var(--hl-soft)';
    var m = minutesByDate(g);
    var endMK = monthKey(window.GoalStore.endDate(g) || appToday());
    var startMK = monthKey(g.startDate);
    wrapP.appendChild(monthRows(g, startMK, endMK, m));
    wrapP.appendChild(legend(g));
    scroll.appendChild(wrapP);

    fullScreen.appendChild(scroll);
    window.SubjectListBridge.show(fullScreen, true);
  }

  window.GoalHeat = {
    panel: panel, openFull: openFull, dayModal: dayModal,
    colorFor: colorFor, planOf: planOf, minutesByDate: minutesByDate
  };
})();
