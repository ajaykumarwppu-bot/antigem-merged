/* ================================================================
   FEATURES / DASHBOARD / DASHBOARD-TODAY.JS — "Aaj" ke sections
   ----------------------------------------------------------------
   Dashboard ke Total-Tasks card ke neeche aaj ke actionable items :

   1) AAJ KE CHAPTERS (subject tracker)
        - start == today            → "Aaj start"
        - end   == today            → "Deadline aaj"
        - start<=today, !done,
          (no end OR end>=today)    → "In progress"
        - end nahi hai → start se dikhta hai jab tak user done na kare
        Card : subject naam, chapter naam, progress %, status, priority,
               start/end. Click → seedha us chapter ke chapter-view.
   2) AAJ KE REVISIONS
        - chapter.revision.pending.due == today → "Aaj revision karna hai"
        Click → chapter-view ke Revision tab.
   3) GOAL TASKS (aaj)
        - daily / range(today andar) / date==today  → goal naam ke saath
        - Done toggle yahan se → goal ke andar bhi done ho jaata hai
   4) GOOD HABITS (aaj)
        - har habit = aaj repeat karna hai; done = reps poori
        - Done button → remaining reps bhar deta hai
   5) TASKS (features/task/task.js ke extra tasks)
        - jo bhi task create hua wo yahan bhi dikhta hai — TODAY /
          UPCOMING / PASSED groups mein (task.js wali hi grouping)
        - Gol tick → us din ki occurrence done/undone (task.js ke
          toggleDone API se, storage wahin se persist hoti hai)
        - Click-par-nav nahi : sirf tick, taaki galti se screen na khule
   ================================================================ */

(function () {
  'use strict';
  if (window.__achivaDashboardTodayLoaded) return;
  window.__achivaDashboardTodayLoaded = true;

  var el = UI.el, esc = UI.esc;
  function today() { return window.DayClock ? window.DayClock.today() : UI.todayISO(); }   /* DAY-CLOCK */
  function ST() { return window.ST; }

  function sectionTitle(txt) {
    var t = el('div', null, txt);
    t.style.cssText = 'font-family:var(--f-disp);font-size:13px;font-weight:700;color:var(--ink);margin:14px 18px 6px';
    return t;
  }
  function cardWrap() {
    var c = el('div');
    c.style.cssText = 'margin:0 18px 12px;padding:12px 14px;border:1px solid var(--line);border-radius:16px;' +
      'background:var(--tile-bg);box-shadow:inset 0 1px 0 var(--hl-soft)';
    return c;
  }
  function emptyRow(txt) {
    var d = el('div', null, txt);
    d.style.cssText = 'font-size:11px;color:var(--slate);line-height:1.6';
    return d;
  }
  function chip(txt, tone) {
    var c = UI.chip(txt);
    c.style.cssText += ';font-size:9px;flex:none';
    if (tone === 'green') c.style.cssText += ';background:rgba(46,160,67,.12);color:#2ea043;border-color:rgba(46,160,67,.35)';
    if (tone === 'amber') c.style.cssText += ';background:rgba(160,106,0,.12);color:#a06a00;border-color:rgba(160,106,0,.35)';
    if (tone === 'red') c.style.cssText += ';background:rgba(192,57,43,.12);color:#c0392b;border-color:rgba(192,57,43,.35)';
    return c;
  }

  /* ---------- 1) aaj ke chapters ----------
     SIRF AAJ KE : start aaj ho, end aaj ho, YA chapter sach mein
     chal raha ho (start aa chuka hai + end nahi aaya). Jin chapters
     ki start date NAHI hai ya aani baaki hai wo "In progress"
     NAHI dikhte — dashboard par sirf aaj ki date ka kaam. */
  function todayChapters() {
    var out = [];
    var t = today();
    (ST().state.subjects || []).forEach(function (s) {
      (s.chapters || []).forEach(function (ch) {
        if (ch.done) return;
        /* chapter dates subject-tracker mein startDate/endDate ke
           naam se save hoti hain (basics.js) — wahi padho */
        var start = ch.startDate || '', end = ch.endDate || '';
        var status = null;
        if (end === t) status = 'Deadline aaj';
        else if (start === t) status = 'Aaj start';
        else if (start && start < t && (!end || end > t)) status = 'In progress';
        else return;                    /* no-date / future-start / passed */
        out.push({ subject: s, ch: ch, status: status });
      });
    });
    return out;
  }

  function renderChapters(scroll) {
    scroll.appendChild(sectionTitle('Aaj ke Chapters'));
    var c = cardWrap();
    var list = todayChapters();
    if (!list.length) { c.appendChild(emptyRow('Aaj koi chapter active nahi.')); scroll.appendChild(c); return; }
    list.forEach(function (it, i) {
      if (i) c.appendChild(el('div')).style.cssText = 'height:1px;background:var(--line);margin:8px 0';
      var row = el('div');
      row.style.cssText = 'display:flex;align-items:center;gap:8px;cursor:pointer';
      var main = el('div');
      main.style.cssText = 'flex:1;min-width:0';
      var sub = el('div', null, esc(it.subject.name));
      sub.style.cssText = 'font-size:10px;color:var(--slate);text-transform:uppercase;letter-spacing:.06em';
      var nm = el('div', null, esc(it.ch.name));
      nm.style.cssText = 'font-size:13px;font-weight:700;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
      main.appendChild(sub); main.appendChild(nm);
      var meta = el('div', null,
        (it.ch.startDate || '?') + (it.ch.endDate ? ' → ' + it.ch.endDate : ' → no end') +
        ' · ' + (window.ChapterProgress ? window.ChapterProgress.chapterPct(it.ch) : 0) + '%');
      meta.style.cssText = 'font-size:10.5px;color:var(--ash);margin-top:2px';
      main.appendChild(meta);
      row.appendChild(main);
      /* STATUS + PRIORITY ek patli COLUMN mein (upar-neeche) —
        phone par chapter ka naam poori width mein saaf dikhe;
        card ki height wahi rehti hai (main block uncha hai) */
      var chipsCol = el('div');
      chipsCol.style.cssText = 'flex:none;display:flex;flex-direction:column;align-items:flex-end;gap:4px';
      chipsCol.appendChild(chip(it.status, it.status === 'Deadline aaj' ? 'red' : it.status === 'Aaj start' ? 'amber' : 'green'));
      chipsCol.appendChild(chip(it.ch.priority || 'Medium'));
      row.appendChild(chipsCol);
      row.addEventListener('click', function () {
        if (ST().goToChapter) ST().goToChapter(it.subject.id, it.ch.id);
      });
      c.appendChild(row);
    });
    scroll.appendChild(c);
  }

  /* ---------- 2) aaj ke revisions ---------- */
  function todayRevisions() {
    var out = [];
    var t = today();
    (ST().state.subjects || []).forEach(function (s) {
      (s.chapters || []).forEach(function (ch) {
        var p = ch.revision && ch.revision.pending;
        if (p && p.due === t) out.push({ subject: s, ch: ch, n: p.n });
      });
    });
    return out;
  }

  function renderRevisions(scroll) {
    scroll.appendChild(sectionTitle('Aaj ke Revisions'));
    var c = cardWrap();
    var list = todayRevisions();
    if (!list.length) { c.appendChild(emptyRow('Aaj koi revision due nahi.')); scroll.appendChild(c); return; }
    list.forEach(function (it, i) {
      if (i) c.appendChild(el('div')).style.cssText = 'height:1px;background:var(--line);margin:8px 0';
      var row = el('div');
      row.style.cssText = 'display:flex;align-items:center;gap:8px;cursor:pointer';
      var main = el('div');
      main.style.cssText = 'flex:1;min-width:0';
      var sub = el('div', null, esc(it.subject.name));
      sub.style.cssText = 'font-size:10px;color:var(--slate);text-transform:uppercase;letter-spacing:.06em';
      var nm = el('div', null, esc(it.ch.name) + ' — Revision #' + it.n);
      nm.style.cssText = 'font-size:13px;font-weight:700;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
      main.appendChild(sub); main.appendChild(nm);
      var meta = el('div', null, 'Aaj is chapter ka revision karna hai');
      meta.style.cssText = 'font-size:10.5px;color:var(--ash);margin-top:2px';
      main.appendChild(meta);
      row.appendChild(main);
      row.appendChild(chip('Revision', 'amber'));
      row.addEventListener('click', function () {
        if (ST().goToChapter) { ST().goToChapter(it.subject.id, it.ch.id); if (ST().openChapterViewTab) ST().openChapterViewTab('revision'); }
      });
      c.appendChild(row);
    });
    scroll.appendChild(c);
  }

  /* ---------- 3) goal tasks (aaj) ---------- */
  function goalTasksToday() {
    var out = [];
    var t = today();
    try {
      var gd = window.AppStorage.loadAt('achiva.goals.v1') || { goals: [] };
      (gd.goals || []).forEach(function (g) {
        if (!window.GoalTask) return;
        (window.GoalTask.tasksOf(g) || []).forEach(function (card) {
          var tag = card.tag;
          var due = false;
          if (tag.type === 'daily') due = true;
          else if (tag.type === 'range' && tag.range) due = (t >= tag.range.from && t <= tag.range.to);
          else if (tag.type === 'date') due = (tag.date === t);
          if (!due) return;
          var done = !!tag.done || ((tag.doneDays || []).indexOf(t) >= 0);
          out.push({ goal: g, card: card, tag: tag, done: done });
        });
      });
    } catch (e) { }
    return out;
  }

  function renderGoalTasks(scroll) {
    scroll.appendChild(sectionTitle('Goal Tasks (aaj)'));
    var c = cardWrap();
    var list = goalTasksToday();
    if (!list.length) { c.appendChild(emptyRow('Aaj koi goal task nahi.')); scroll.appendChild(c); return; }
    list.forEach(function (it, i) {
      if (i) c.appendChild(el('div')).style.cssText = 'height:1px;background:var(--line);margin:8px 0';
      var row = el('div');
      row.style.cssText = 'display:flex;align-items:center;gap:8px';
      var done = !!it.done;
      var tick = UI.roundCheck(done);
      tick.addEventListener('click', function () {
        window.GoalTask.toggleDone(it.goal, it.card);
        window.Dashboard.open();
      });
      row.appendChild(tick);
      var main = el('div');
      main.style.cssText = 'flex:1;min-width:0';
      var gname = el('div', null, esc(it.goal.title || 'Goal'));
      gname.style.cssText = 'font-size:10px;color:var(--slate);text-transform:uppercase;letter-spacing:.06em';
      var tname = el('div', null, esc((it.card.text || '').split('\n')[0]));
      tname.style.cssText = 'font-size:13px;font-weight:600;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' + (done ? 'text-decoration:line-through;opacity:.6' : '');
      main.appendChild(gname); main.appendChild(tname);
      row.appendChild(main);
      row.appendChild(chip(it.tag.type, done ? 'green' : null));
      c.appendChild(row);
    });
    scroll.appendChild(c);
  }

  /* ---------- 4) good habits (aaj) ---------- */
  function renderHabits(scroll) {
    scroll.appendChild(sectionTitle('Good Habits (aaj)'));
    var c = cardWrap();
    var habits = [];
    try { habits = (window.GoodList && window.GoodList.all) ? (window.GoodList.all() || []) : []; } catch (e) { }
    if (!habits.length) { c.appendChild(emptyRow('Koi good habit nahi.')); scroll.appendChild(c); return; }

    /* STUDY-HABIT: default Study card sabse upar (habits list wala hi order) */
    function isStudy(h) { return !!(window.StudyHabit && window.StudyHabit.isStudyCard(h)); }
    habits = habits.filter(isStudy).concat(habits.filter(function (h) { return !isStudy(h); }));

    habits.forEach(function (h, i) {
      if (i) c.appendChild(el('div')).style.cssText = 'height:1px;background:var(--line);margin:8px 0';
      var HT = window.HabitTypes;
      var study = isStudy(h);
      var htype = HT ? HT.typeOf(h) : 'one';
      var done = (window.GoodList.repsOn(h, today()) >= (h.repsPerDay || 1));
      var row = el('div');
      row.style.cssText = 'display:flex;align-items:center;gap:8px';
      var tick = UI.roundCheck(done);

      if (study) {
        /* STUDY-HABIT: ye card DISPLAY-ONLY hai — time Subject Tracker se apne
           aap aata hai. Tap se complete karne ka raasta JAAN-BOOJH kar band:
           warna bina padhe tick ho jata aur poora feature bekaar. */
        tick.style.cursor = 'default';
        tick.setAttribute('aria-label', 'Study time apne aap judta hai');
        tick.addEventListener('click', function () {
          if (window.GoodList.toast) window.GoodList.toast('Study time Subject Tracker se apne aap aata hai.');
        });
      } else {
        tick.addEventListener('click', function () {
          /* HABIT-TYPES (bug fix): 'time' aur 'timer' ke strict rules YAHAN BHI
             laagu hone chahiye. Pehle ye handler seedha addRep(h, need) karta
             tha jo SAARE bache reps ek jhatke mein bhar deta — isse
               • 'time'  habit apni window ke BAHAR complete ho jaati
               • 'timer' habit bina timer chalaye complete ho jaati
             Ab dono HT.applyTick() se jaate hain (wahi rules jo list par hain). */
          if (HT && (htype === 'time' || htype === 'timer')) {
            var r = HT.applyTick(h);
            if (!r || !r.ok) {
              if (window.GoodList.toast) {
                window.GoodList.toast((r && r.msg) || 'Abhi ye habit tick nahi ho sakti.');
              }
            } else {
              if (window.GoodList.persist) window.GoodList.persist();
              if (r.type === 'timer' && window.GoodList.toast) {
                window.GoodList.toast('Timer start · ' + HT.durLabel(HT.durationMin(h)));
              }
            }
          } else if (!done) {
            /* 'one' type : purana behaviour — baaki reps ek saath fill */
            var need = (h.repsPerDay || 1) - window.GoodList.repsOn(h, today());
            window.GoodList.addRep(h, need);
          }
          window.Dashboard.open();
        });
      }
      row.appendChild(tick);
      var main = el('div');
      main.style.cssText = 'flex:1;min-width:0';
      var nm = el('div', null, esc(h.name));
      nm.style.cssText = 'font-size:13px;font-weight:600;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' + (done ? 'text-decoration:line-through;opacity:.6' : '');
      /* STUDY-HABIT: study card par reps ki jagah minutes */
      var meta = el('div', null, study
        ? ('Aaj padhai · ' + String(window.StudyHabit.lineText(h)).replace('today ', ''))
        : ('Aaj repeat karein · ' + window.GoodList.repsOn(h, today()) + '/' + (h.repsPerDay || 1)));
      meta.style.cssText = 'font-size:10.5px;color:var(--ash);margin-top:2px';
      main.appendChild(nm); main.appendChild(meta);
      row.appendChild(main);
      row.appendChild(chip(done ? 'done' : 'daily', done ? 'green' : 'amber'));
      c.appendChild(row);
    });
    scroll.appendChild(c);
  }

  /* ---------- 5) TASKS feature ke extra tasks ----------
     Jo bhi task TASKS screen par create hua wo yahan bhi dikhta hai
     (Today / Upcoming / Passed — task.js wali hi grouping) aur gol
     tick se wahin se done hota hai. Toggle task.js ke toggleDone()
     se hota hai taaki in-memory cache aur storage dono sync rahein. */
  function taskItems() {
    var out = { today: [], up: [], past: [] };
    var TF = window.TaskFeature;
    if (!TF || !TF.all) return out;
    var tdy = today();
    (TF.all() || []).forEach(function (t) {
      if (TF.occursOn(t, tdy)) out.today.push({ t: t, iso: tdy });
      else {
        var nx = TF.nextFrom(t, tdy);
        if (nx) out.up.push({ t: t, iso: nx });
        else out.past.push({ t: t, iso: t.date });
      }
    });
    var byTime = function (a, b) { return (a.t.time || '').localeCompare(b.t.time || ''); };
    out.today.sort(byTime);
    out.up.sort(function (a, b) { return a.iso === b.iso ? byTime(a, b) : (a.iso < b.iso ? -1 : 1); });
    out.past.sort(byTime);
    return out;
  }

  function row(it) {
    var TF = window.TaskFeature;
    var t = it.t, iso = it.iso;
    var done = !!(t.done && t.done[iso]);
    var r = el('div');
    r.style.cssText = 'display:flex;align-items:center;gap:8px';
    var tick = UI.roundCheck(done);
    tick.addEventListener('click', function () {
      TF.toggleDone(t.id, iso);
      window.Dashboard.open();
    });
    r.appendChild(tick);
    var main = el('div');
    main.style.cssText = 'flex:1;min-width:0';
    var nm = el('div', null, esc(t.name || 'Task'));
    nm.style.cssText = 'font-size:13px;font-weight:600;color:var(--ink);overflow:hidden;' +
      'text-overflow:ellipsis;white-space:nowrap;' + (done ? 'text-decoration:line-through;opacity:.6' : '');
    main.appendChild(nm);
    var bits = [UI.fmtDate(iso), TF.fmtTime(t.time)];
    if ((t.repeat || {}).mode !== 'none') bits.push(TF.repeatLabel(t));
    var meta = el('div', null, esc(bits.join(' · ')));
    meta.style.cssText = 'font-size:10.5px;color:var(--ash);margin-top:2px';
    main.appendChild(meta);
    r.appendChild(main);
    r.appendChild(chip(t.priority || 'Medium',
      t.priority === 'High' ? 'red' : t.priority === 'Medium' ? 'amber' : null));
    return r;
  }

  function renderTasks(scroll) {
    /* DASHBOARD par SIRF AAJ ke tasks : Upcoming / Passed groups
       TASKS screen par dikhte hain, dashboard par nahi. */
    scroll.appendChild(sectionTitle('Tasks (aaj)'));
    var c = cardWrap();
    var list;
    try { list = taskItems().today; } catch (e) { list = []; }
    if (!list.length) {
      c.appendChild(emptyRow('Aaj koi task nahi — FAB → TASKS se add karo.'));
      scroll.appendChild(c);
      return;
    }
    list.forEach(function (it, i) {
      if (i) {
        var d = el('div');
        d.style.cssText = 'height:1px;background:var(--line);margin:8px 0';
        c.appendChild(d);
      }
      c.appendChild(row(it));
    });
    scroll.appendChild(c);
  }

  function render(scroll) {
    window.__dashScroll = scroll;
    renderChapters(scroll);
    renderRevisions(scroll);
    renderGoalTasks(scroll);
    renderHabits(scroll);
    renderTasks(scroll);
  }

  window.DashboardToday = { render: render, todayChapters: todayChapters, todayRevisions: todayRevisions, goalTasksToday: goalTasksToday, taskItems: taskItems };
})();
