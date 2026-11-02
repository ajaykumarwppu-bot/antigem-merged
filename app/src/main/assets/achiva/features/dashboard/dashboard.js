/* ================================================================
   FEATURES / DASHBOARD / DASHBOARD.JS — landing screen
   ----------------------------------------------------------------
   • App khulte hi DIRECT yahi screen khulti hai (koi feature nahi).
   • Abhi v1 : "Total Tasks" card — poore app ke saare tasks ek jagah :
       - GOAL tasks  : har goal ke canvas-board ke tagged cards
                       (daily / range / date tasks)  [goal-task logic]
       - HABIT tasks : har active habit = ek recurring daily task
       - TASKS feature tasks : task.js wale extra tasks (one-time /
                       repeating) — done = us din ki occurrence tick
   • Count + list (naam + source + type + due-status).
   • Aage aur sections (streaks, progress, timers) yahi judenge.
   ================================================================ */

(function () {
  'use strict';
  if (window.__achivaDashboardLoaded) return;
  window.__achivaDashboardLoaded = true;

  var el = UI.el, esc = UI.esc;

  var screen = el('section', 'screen');
  screen.style.paddingTop = '58px';
  document.getElementById('app').appendChild(screen);

  function bridge() { return window.SubjectListBridge; }
  function today() { return window.DayClock ? window.DayClock.today() : UI.todayISO(); }   /* DAY-CLOCK */

  /* ---------- goal tasks : tagged canvas cards ---------- */
  function goalTasks() {
    var out = [];
    try {
      var gd = window.AppStorage.loadAt('achiva.goals.v1') || { goals: [] };
      var goals = gd.goals || [];
      var cd = window.CanvasList ? window.CanvasList.getData() : { canvases: [] };
      goals.forEach(function (g) {
        var board = null;
        (cd.canvases || []).forEach(function (c) {
          if ((g.canvasId && c.id === g.canvasId) || (!board && c.goalId === g.id)) board = c;
        });
        if (!board) return;
        (board.cards || []).forEach(function (c) {
          if (!c.tag) return;
          /* SIRF AAJ ke goal tasks : daily = har din due; range =
             aaj beech mein; date = sirf wahi din. Baaki dated cards
             dashboard par NAHI ginte (wo goal ke andar dikhte hain). */
          var tag = c.tag, tdy = today(), due = false;
          if (tag.type === 'daily') due = true;
          else if (tag.type === 'range' && tag.range) due = (tdy >= tag.range.from && tdy <= tag.range.to);
          else if (tag.type === 'date') due = (tag.date === tdy);
          if (!due) return;
          out.push({
            title: (c.text || '').split('\n')[0].replace(/#(daily|done)|#range\s+[0-9/\-]+/gi, '').trim() || 'Task',
            source: 'Goal',
            type: c.tag.type,
            done: !!c.tag.done,
            goal: g.title
          });
        });
      });
    } catch (e) { }
    return out;
  }

  /* ---------- habit tasks : har active habit = daily task ---------- */
  function habitTasks() {
    var out = [];
    try {
      var habits = (window.GoodList && window.GoodList.all) ? window.GoodList.all() : [];
      (habits || []).forEach(function (h) {
        out.push({
          title: h.name || 'Habit',
          source: 'Habit',
          type: 'daily',
          done: (window.GoodList.repsOn(h, today()) >= (h.repsPerDay || 1)),
          goal: ''
        });
      });
    } catch (e) { }
    return out;
  }

  /* ---------- TASKS feature tasks (features/task/task.js) ----------
     Dashboard par SIRF AAJ occur karne wale tasks ginte hain
     (upcoming / passed TASKS screen par rehte hain). done = aaj ki
     occurrence tick. */
  function featureTasks() {
    var out = [];
    try {
      var TF = window.TaskFeature;
      if (!TF || !TF.all) return out;
      var tdy = today();
      (TF.all() || []).forEach(function (t) {
        if (!TF.occursOn(t, tdy)) return;
        out.push({
          title: t.name || 'Task',
          source: 'Task',
          type: (t.repeat && t.repeat.mode !== 'none') ? TF.repeatLabel(t) : 'one-time',
          done: !!(t.done && t.done[tdy]),
          goal: ''
        });
      });
    } catch (e) { }
    return out;
  }

  function tasks() {
    return goalTasks().concat(habitTasks()).concat(featureTasks());
  }

  function statusOf(t) {
    if (t.done) return 'done';
    if (t.type === 'daily') return 'today';
    return 'pending';
  }

  function render() {
    screen.innerHTML = '';
    var scroll = el('div', 'scroll');

    var head = el('div');
    head.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:12px 18px 6px';
    var t = el('b', null, 'Dashboard');
    t.style.cssText = 'font-family:var(--f-disp);font-size:20px;font-weight:700;color:var(--ink)';
    head.appendChild(t);
    scroll.appendChild(head);

    var all = tasks();
    var done = all.filter(function (x) { return x.done; }).length;

    /* Total Tasks card */
    var card = el('div');
    card.style.cssText = 'margin:0 18px 12px;padding:16px;border:1px solid var(--line);border-radius:18px;' +
      'background:var(--tile-bg);box-shadow:inset 0 1px 0 var(--hl-soft)';
    var big = el('div', null, String(all.length));
    big.style.cssText = 'font-family:var(--f-disp);font-size:38px;font-weight:700;color:var(--ink);line-height:1';
    card.appendChild(big);
    var lab = el('div', null, 'Total Tasks');
    lab.style.cssText = 'font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--slate);margin:4px 0 10px';
    card.appendChild(lab);
    var sub = el('div', null, done + ' done · ' + (all.length - done) + ' pending');
    sub.style.cssText = 'font-size:11.5px;color:var(--ash);margin-bottom:10px';
    card.appendChild(sub);

    scroll.appendChild(card);
    /* DAY-CLOCK PHASE 3 : "Mera Din" dual-view panel (app-day vs asli tareekhen) */
    if (window.DashboardMyDay) scroll.appendChild(window.DashboardMyDay.build());
    if (window.DashboardToday) window.DashboardToday.render(scroll);
    screen.appendChild(scroll);
  }

  var openRetries = 0;
  function open() {
    /* init ke waqt goals/habit/task scripts abhi load nahi hui hoti →
       ek tick ruk kar render karo taaki pehli baar bhi sab sections bhare dikhein */
    if ((!window.GoalTask || !window.GoodList || !window.TaskFeature) && openRetries < 5) {
      openRetries++;
      window.setTimeout(open, 0);
      return;
    }
    openRetries = 0;
    render();
    if (bridge()) bridge().show(screen, true);
  }

  /* kya dashboard screen abhi active hai? (task.js parse-time par
     isi se pata karke dashboard refresh karta hai) */
  function isCurrent() {
    return screen.classList.contains('active');
  }

  window.Dashboard = { open: open, render: render, tasks: tasks, isCurrent: isCurrent };
})();
