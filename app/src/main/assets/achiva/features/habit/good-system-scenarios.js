/* ================================================================
   FEATURES / HABIT / GOOD-SYSTEM-SCENARIOS.JS  —  TEST CARDS (deletable)
   ----------------------------------------------------------------
   ⚠ Ye file SIRF testing/demo ke liye hai. Isme saara TEST DATA hai.
     Jab zaroorat na ho poora file delete kar dena — app bilkul chalta
     rahega (good-detail mein "View test scenarios" button sirf tab
     dikhta hai jab ye file loaded ho).

   Har scenario synthetic logs banata hai, GoodSystem.compute() se
   nikaalta hai, aur ek card mein graph + stats dikhata hai taaki
   har rule (grace, penalty, stage, strict, minimum) aankhon se
   verify ho sake aur koi loophole na chhute.
   ================================================================ */

(function () {
  'use strict';

  if (window.__achivaGoodScenariosLoaded) return;
  window.__achivaGoodScenariosLoaded = true;

  var el = UI.el;
  var GS = function () { return window.GoodSystem; };

  function iso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function addD(isoStr, n) { var d = new Date(isoStr + 'T00:00:00'); d.setDate(d.getDate() + n); return iso(d); }
  function today() { return UI.todayISO(); }

  /* logs builder : startISO + per-day status/reps */
  function buildLogs(start, days, repsPerDay, fn) {
    var logs = {};
    for (var i = 0; i < days; i++) {
      var d = addD(start, i);
      var reps = fn(i, d);           // 0..repsPerDay
      if (reps > 0) logs[d] = { done: reps, times: [] };
    }
    return logs;
  }
  function all(reps) { return function () { return reps; }; }
  function none() { return 0; }

  /* ---------- SCENARIO DATA (yahi test data hai) ---------- */
  var T = today();
  var SCENARIOS = [
    {
      title: 'Ignition L1 — day 5 miss',
      desc: 'Pehle 7 din sabse hard: ek miss par streak 0 aur automaticity 0.',
      start: addD(T, -9), reps: 1, strict: 3,
      fn: function (i) { return i === 4 ? 0 : 1; },
      expect: 'streak 0 · auto 0'
    },
    {
      title: 'Perfect 30 days (Strict 3)',
      desc: 'Lagaatar done → front-loaded rise, Ignition L3 tak.',
      start: addD(T, -29), reps: 1, strict: 3, fn: all(1),
      expect: 'streak 30 · auto ~60+'
    },
    {
      title: 'Strict 1 · day 300 · 2 din miss',
      desc: 'Strict 1 ka grace-cap 1 hai → 2 lagaatar miss par streak toot-ti.',
      start: addD(T, -310), reps: 1, strict: 1,
      fn: function (i) { return (i === 300 || i === 301) ? 0 : 1; },
      expect: 'streak break · badi penalty (×1.5)'
    },
    {
      title: 'Strict 5 · day 300 · 3 din miss',
      desc: 'Strict 5 floor 3 (day 22+) → 3 miss par streak bachi, chhota drop.',
      start: addD(T, -310), reps: 1, strict: 5,
      fn: function (i) { return (i >= 300 && i <= 302) ? 0 : 1; },
      expect: 'streak safe · halka drop'
    },
    {
      title: 'Strict 5 · day 15 · 1 miss',
      desc: 'Floor sirf day 22 ke baad → day 15 par 1 miss par bhi streak toot-ti.',
      start: addD(T, -20), reps: 1, strict: 5,
      fn: function (i) { return i === 14 ? 0 : 1; },
      expect: 'streak break (no floor yet)'
    },
    {
      title: 'Discipline L3 (~700 din) · 3 miss',
      desc: '700+ din par grace 3 → 3 miss safe; graph peak par raha.',
      start: addD(T, -705), reps: 1, strict: 3,
      fn: function (i) { return (i >= 700 && i <= 702) ? 0 : 1; },
      expect: 'Discipline L3 · streak safe'
    },
    {
      title: 'Discipline L3 · 4 miss',
      desc: 'Grace 3 se ek zyada → streak break, ~3% penalty.',
      start: addD(T, -705), reps: 1, strict: 3,
      fn: function (i) { return (i >= 700 && i <= 703) ? 0 : 1; },
      expect: 'streak break · ~3% drop'
    },
    {
      title: 'Minimum day keeps streak',
      desc: 'repsPerDay 3 mein sirf 1 rep = minimum → streak zinda, ~45% gain.',
      start: addD(T, -14), reps: 3, strict: 3,
      fn: function (i) { return i === 7 ? 1 : 3; },
      expect: 'streak 15 · day 8 = minimum'
    },
    {
      title: '1 mahina gayab → recover',
      desc: '30 din no-follow → automaticity ~0; phir dobara chadhti hai.',
      start: addD(T, -70), reps: 1, strict: 3,
      fn: function (i) { return (i >= 20 && i <= 50) ? 0 : 1; },
      expect: 'graph girta hai phir chadhta'
    },
    {
      title: 'Never-miss-twice pattern',
      desc: 'har doosre din ek miss (gap 1) → strict3 grace0 par streak toot-ti rehti.',
      start: addD(T, -20), reps: 1, strict: 3,
      fn: function (i) { return i % 2 === 0 ? 1 : 0; },
      expect: 'streak ~1 · auto kam'
    }
  ];

  function miniGraph(series) {
    var W = 260, H = 70, x0 = 4, y0 = 4, x1 = 256, y1 = 62;
    var maxDay = series.length ? series[series.length - 1].day : 1;
    function px(d) { return x0 + (d / Math.max(1, maxDay)) * (x1 - x0); }
    function py(A) { return y1 - (A / 100) * (y1 - y0); }
    var pts = series.map(function (q) { return px(q.day).toFixed(1) + ',' + py(q.A).toFixed(1); });
    var area = 'M' + x0 + ',' + y1 + ' L' + pts.join(' L') + ' L' + px(maxDay).toFixed(1) + ',' + y1 + ' Z';
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:auto;display:block">' +
      '<path d="' + area + '" fill="rgba(46,160,67,.18)"/>' +
      '<polyline points="' + pts.join(' ') + '" fill="none" stroke="#2ea043" stroke-width="1.6"/>' +
      '</svg>';
  }

  var screen = null;
  function open() {
    if (!screen) {
      screen = el('section', 'screen');
      screen.style.paddingTop = '58px';
      document.getElementById('app').appendChild(screen);
    }
    screen.innerHTML = '';
    var scroll = el('div', 'scroll');
    var head = el('div');
    head.style.cssText = 'display:flex;align-items:center;gap:10px;padding:12px 16px 6px';
    var back = UI.miniBtn(UI.icons.back, 'Back');
    back.style.cssText += ';width:34px;height:34px;border-radius:50%;border:1px solid var(--s2);background:var(--chip-bg)';
    back.addEventListener('click', function () { window.GoodList.open(); });
    head.appendChild(back);
    var tt = el('b', null, 'Test scenarios');
    tt.style.cssText = 'flex:1;font-family:var(--f-disp);font-size:16px;font-weight:700;color:var(--ink)';
    head.appendChild(tt);
    scroll.appendChild(head);
    var note = el('div', null, 'Ye test cards good-system-scenarios.js se aate hain — file delete karne par ye hat jayenge.');
    note.style.cssText = 'margin:0 18px 10px;font-size:10.5px;color:var(--slate)';
    scroll.appendChild(note);

    SCENARIOS.forEach(function (sc) {
      var logs = buildLogs(sc.start, Math.round((new Date(T) - new Date(sc.start)) / 86400000) + 1, sc.reps, sc.fn);
      var cs = GS().compute(logs, { startDate: sc.start, strict: sc.strict, repsPerDay: sc.reps }, T, addD);
      var card = el('div');
      card.style.cssText = 'margin:0 18px 12px;padding:12px 14px;border:1px solid var(--line);border-radius:16px;background:var(--tile-bg)';
      var t1 = el('div', null, sc.title);
      t1.style.cssText = 'font-size:13px;font-weight:700;color:var(--ink);margin-bottom:2px';
      card.appendChild(t1);
      var t2 = el('div', null, sc.desc);
      t2.style.cssText = 'font-size:10.5px;color:var(--slate);line-height:1.5;margin-bottom:8px';
      card.appendChild(t2);
      var gw = el('div');
      gw.innerHTML = miniGraph(cs.series);
      card.appendChild(gw);
      var stats = el('div');
      stats.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin-top:8px';
      [['streak', cs.streak], ['auto', cs.autoPercent + '%'], ['stage', cs.stage.key], ['done', cs.completedDays + '/' + cs.totalDays]]
        .forEach(function (kv) {
          var c = UI.chip(kv[0] + ' ' + kv[1]);
          c.style.cssText += ';font-size:9.5px';
          stats.appendChild(c);
        });
      card.appendChild(stats);
      var ex = el('div', null, 'Expect: ' + sc.expect);
      ex.style.cssText = 'font-size:10px;color:var(--ash);margin-top:6px';
      card.appendChild(ex);
      scroll.appendChild(card);
    });

    screen.appendChild(scroll);
    window.SubjectListBridge.show(screen, true);
  }

  window.GoodSystemScenarios = { open: open, SCENARIOS: SCENARIOS };
})();
