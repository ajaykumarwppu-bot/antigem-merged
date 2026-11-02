/* ================================================================
   ACHIVA AGENT BRIDGE (injected by AntiGem's Achiva WebView)
   ----------------------------------------------------------------
   Ye file AntiGem app ke assets (assets/achiva-bridge/) mein rehti
   hai aur AchivaScreen.onPageFinished par page mein INJECT hoti
   hai (hosted ya bundled — dono mode mein kaam karti hai).

   Kaam:
     • Kotlin side (AchivaWebBridge) JSON command bhejta hai:
         window.AchivaAgent.__handle('{"op":"add_task","args":{...}}')
     • Ye module Achiva ke APNI feature APIs use karta hai —
       window.TaskFeature / window.ST / window.ThoughtStore /
       window.GoalStore / window.GoodList / window.BadList —
       taaki in-memory cache aur storage kabhi diverge na ho
       (raw JSON push karne se cache-overwrite bug hota hai).
     • Har op {ok:true,...} ya {ok:false,error:"..."} string
       return karta hai.

   IMPORTANT: koi UI navigation nahi karte — data badalta hai,
   dashboard agar visible hai to turant re-render hota hai, aur
   baaki screens apna render() open par khud karte hain.
   ================================================================ */

(function () {
  'use strict';
  if (window.__achivaAgentBridge) return;

  var MAX_TRIES = 80;               /* ~20s tak AppStorage ka wait */
  var tries = 0;

  function install() {
    if (window.__achivaAgentBridge) return;
    var ready =
      window.AppStorage && typeof window.AppStorage.loadAt === 'function' &&
      typeof window.AppStorage.saveAt === 'function';
    if (!ready) {
      if (tries++ < MAX_TRIES) window.setTimeout(install, 250);
      return; /* page shayad error page hai — chup rehna safe hai */
    }
    window.__achivaAgentBridge = true;
    window.AchivaAgent = buildBridge();
    try {
      if (window.AchivaBridge && typeof window.AchivaBridge.notifyReady === 'function') {
        window.AchivaBridge.notifyReady();
      }
    } catch (e) { /* hooks na hon to bhi bridge kaam karega */ }
  }

  /* ---------------- helpers ---------------- */

  function err(msg) { return { ok: false, error: String(msg) }; }

  function uid() {
    try { if (window.UI && typeof window.UI.uid === 'function') return window.UI.uid(); } catch (e) {}
    return 'ag-' + Date.now() + '-' + Math.floor(Math.random() * 1000000);
  }

  function pad2(n) { return String(n).padStart(2, '0'); }

  function todayISO() {
    try { if (window.DayClock && typeof window.DayClock.today === 'function') return window.DayClock.today(); } catch (e) {}
    try { if (window.UI && typeof window.UI.todayISO === 'function') return window.UI.todayISO(); } catch (e) {}
    var d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function validISO(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s.trim())) return null;
    var p = s.trim().split('-');
    var d = new Date(+p[0], (+p[1]) - 1, +p[2]);
    if (d.getMonth() !== (+p[1]) - 1 || d.getDate() !== +p[2]) return null; /* 31 Feb reject */
    return s.trim();
  }

  function validHM(s) {
    if (typeof s !== 'string' || !/^([01]?\d|2[0-3]):[0-5]\d$/.test(s.trim())) return null;
    var p = s.trim().split(':');
    return pad2(+p[0]) + ':' + p[1];
  }

  /* local epoch ms for a given date (+optional HH:MM) — date-only
     strings Date.parse mein UTC bante hain, isliye manual */
  function isoAtMs(iso, hm) {
    var d = validISO(iso); if (!d) return null;
    var p = d.split('-');
    var t = validHM(hm) || '09:00';
    var tp = t.split(':');
    return new Date(+p[0], (+p[1]) - 1, +p[2], +tp[0], +tp[1], 0, 0).getTime();
  }

  function loadObj(key, arrField) {
    var d = window.AppStorage.loadAt(key);
    if (!d || typeof d !== 'object' || Array.isArray(d)) d = {};
    if (!Array.isArray(d[arrField])) d[arrField] = [];
    return d;
  }

  function findSubject(q) {
    if (!q || !window.ST || !window.ST.state) return null;
    var list = window.ST.state.subjects || [];
    var s = String(q).trim().toLowerCase();
    for (var i = 0; i < list.length; i++) {
      if (String(list[i].id).toLowerCase() === s || String(list[i].name).trim().toLowerCase() === s) return list[i];
    }
    /* partial match bhi chalega (agent user ke shabdon se bolega) */
    for (var j = 0; j < list.length; j++) {
      if (String(list[j].name).toLowerCase().indexOf(s) !== -1) return list[j];
    }
    return null;
  }

  function findChapter(sub, q) {
    if (!sub || !q || !Array.isArray(sub.chapters)) return null;
    var s = String(q).trim().toLowerCase();
    for (var i = 0; i < sub.chapters.length; i++) {
      if (String(sub.chapters[i].id).toLowerCase() === s ||
          String(sub.chapters[i].name).trim().toLowerCase() === s) return sub.chapters[i];
    }
    for (var j = 0; j < sub.chapters.length; j++) {
      if (String(sub.chapters[j].name).toLowerCase().indexOf(s) !== -1) return sub.chapters[j];
    }
    return null;
  }

  function refreshDashboard() {
    try {
      if (window.Dashboard && typeof window.Dashboard.isCurrent === 'function' &&
          typeof window.Dashboard.render === 'function' && window.Dashboard.isCurrent()) {
        window.Dashboard.render();
      }
    } catch (e) { /* ignore */ }
  }

  /* ---------------- methods ---------------- */

  function opGetState(a) {
    var domains = {
      tasks: function () { return loadObj('achiva.tasks.v1', 'tasks').tasks; },
      subjects: function () {
        if (window.ST && window.ST.state) return window.ST.state;
        return loadObj('achiva.subjectTracker.v1', 'subjects');
      },
      goals: function () { return loadObj('achiva.goals.v1', 'goals').goals; },
      goodHabits: function () { return loadObj('achiva.goodHabits.v1', 'habits').habits; },
      badHabits: function () { return loadObj('achiva.badHabits.v1', 'habits').habits; },
      exams: function () { return loadObj('achiva.exams.v1', 'exams').exams; },
      studySessions: function () {
        var d = window.AppStorage.loadAt('achiva.timer.study.v1');
        return Array.isArray(d) ? d : [];
      },
      thoughts: function () { return loadObj('achiva.thoughts.v1', 'thoughts').thoughts; }
    };

    var want = Array.isArray(a.keys) && a.keys.length ? a.keys : Object.keys(domains);
    var data = {};
    for (var i = 0; i < want.length; i++) {
      var k = String(want[i]);
      if (domains[k]) data[k] = domains[k]();
    }

    /* chhota summary — agent ko jaldi overview dene ke liye */
    var summary = { today: todayISO() };
    try {
      var tasks = domains.tasks();
      var tdy = todayISO();
      var todayPending = 0, todayTotal = 0;
      if (window.TaskFeature && typeof window.TaskFeature.occursOn === 'function') {
        tasks.forEach(function (t) {
          if (window.TaskFeature.occursOn(t, tdy)) {
            todayTotal++;
            if (!(t.done && t.done[tdy])) todayPending++;
          }
        });
      }
      summary.tasksTotal = tasks.length;
      summary.tasksTodayPending = todayPending;
      summary.tasksTodayTotal = todayTotal;
    } catch (e) {}
    try {
      var subs = (data.subjects && data.subjects.subjects) ? data.subjects.subjects : [];
      summary.subjects = subs.length;
    } catch (e) {}
    try {
      var goals = domains.goals();
      summary.goalsActive = goals.filter(function (g) { return !g.done && g.status !== 'archived'; }).length;
    } catch (e) {}
    try {
      var sess = domains.studySessions();
      var ms = 0;
      sess.forEach(function (s) { ms += (s.ms || 0); });
      summary.studySessionsTotal = sess.length;
      summary.studyMsTotal = ms;
    } catch (e) {}
    try {
      var exams = domains.exams();
      var now = Date.now();
      summary.examsUpcoming = exams.filter(function (x) { return (x.dt || 0) > now; }).length;
    } catch (e) {}

    return { ok: true, summary: summary, data: data };
  }

  function opAddTask(a) {
    if (!a || !a.name || !String(a.name).trim()) return err('name is required');
    var rep = a.repeat ? String(a.repeat).toLowerCase() : 'none';
    var repeat = { mode: 'none' };
    if (rep === 'daily') repeat = { mode: 'daily' };
    else if (rep === 'weekly') repeat = { mode: 'weekly' };
    else if (rep === 'monthly') repeat = { mode: 'monthly' };
    else if (rep === 'every' || rep === 'every_n_days') {
      repeat = { mode: 'every', days: Math.max(1, parseInt(a.every_n_days, 10) || 1) };
    }
    var pri = ['High', 'Medium', 'Low'].indexOf(a.priority) >= 0 ? a.priority : 'Medium';
    var date = validISO(a.date) || todayISO();
    var time = validHM(a.time) || '09:00';
    var task = {
      id: uid(),
      name: String(a.name).trim(),
      desc: a.desc ? String(a.desc) : '',
      date: date,
      time: time,
      repeat: repeat,
      priority: pri,
      done: {}
    };
    /* task.js ka in-memory `data` hi source of truth hai — iske live
       array mein hi push karte hain, warna uska cache overwrite
       kar deta (wahi bug jo dashboard bridge note karta hai) */
    if (window.TaskFeature && typeof window.TaskFeature.all === 'function') {
      window.TaskFeature.all().push(task);
      window.AppStorage.saveAt('achiva.tasks.v1', { tasks: window.TaskFeature.all() });
    } else {
      var d = loadObj('achiva.tasks.v1', 'tasks');
      d.tasks.push(task);
      window.AppStorage.saveAt('achiva.tasks.v1', d);
    }
    refreshDashboard();
    return { ok: true, id: task.id, task: task };
  }

  function opToggleTask(a) {
    if (!a || !a.id) return err('id is required (achiva_get_state se task ids mile hain)');
    var iso = validISO(a.date) || todayISO();
    if (window.TaskFeature && typeof window.TaskFeature.toggleDone === 'function') {
      var before = window.TaskFeature.all().filter(function (x) { return x.id === a.id; })[0];
      if (!before) return err('task not found: ' + a.id);
      window.TaskFeature.toggleDone(a.id, iso);
      var after = window.TaskFeature.all().filter(function (x) { return x.id === a.id; })[0];
      refreshDashboard();
      return { ok: true, id: a.id, date: iso, done: !!(after && after.done && after.done[iso]) };
    }
    var d = loadObj('achiva.tasks.v1', 'tasks');
    var t = d.tasks.filter(function (x) { return x.id === a.id; })[0];
    if (!t) return err('task not found: ' + a.id);
    t.done = t.done || {};
    t.done[iso] = !t.done[iso];
    window.AppStorage.saveAt('achiva.tasks.v1', d);
    refreshDashboard();
    return { ok: true, id: a.id, date: iso, done: !!t.done[iso] };
  }

  function opAddSubject(a) {
    if (!a || !a.name || !String(a.name).trim()) return err('name is required');
    if (!window.ST || !window.ST.state) return err('subject tracker (window.ST) is not loaded');
    var cat = null;
    if (a.category === 'jee' || a.category === 'boards') cat = a.category;
    var sub = { id: uid(), name: String(a.name).trim(), chapters: [], cat: cat };
    window.ST.state.subjects.push(sub);
    window.ST.persist();
    return { ok: true, id: sub.id, subject: sub };
  }

  function opAddChapter(a) {
    if (!a || !a.name || !String(a.name).trim()) return err('name is required');
    if (!a.subject) return err('subject is required (id ya naam)');
    if (!window.ST || !window.ST.state) return err('subject tracker (window.ST) is not loaded');
    var sub = findSubject(a.subject);
    if (!sub) return err('subject not found: ' + a.subject);
    if (!Array.isArray(sub.chapters)) sub.chapters = [];
    var ch = { id: uid(), name: String(a.name).trim() };
    sub.chapters.push(ch);
    window.ST.persist();
    return { ok: true, id: ch.id, subjectId: sub.id, chapter: ch };
  }

  function opLogStudy(a) {
    if (!a || !a.subject) return err('subject is required (id ya naam)');
    var minutes = parseFloat(a.minutes);
    if (!(minutes > 0)) return err('minutes must be > 0');
    if (!window.ST || typeof window.ST.recordStudy !== 'function') return err('subject tracker (window.ST) is not loaded');
    var sub = findSubject(a.subject);
    if (!sub) return err('subject not found: ' + a.subject);
    var ch = a.chapter ? findChapter(sub, a.chapter) : null;
    var ms = Math.round(minutes * 60000);
    if (ms < 1000) ms = 1000; /* recordStudy ka minimum guard */
    var startMs;
    var iso = validISO(a.date);
    if (iso) {
      startMs = isoAtMs(iso, validHM(a.time) || '12:00');
      /* backdated log — abhi ke bahut kareeb tak le aao taaki future
         timestamp na bane, par date wahi rahe */
      if (startMs + ms > Date.now()) startMs = Math.max(isoAtMs(iso, '00:01'), Date.now() - ms);
    } else {
      startMs = Date.now() - ms;
    }
    var catId = null;
    if (a.category && window.ST.CATS) {
      for (var i = 0; i < window.ST.CATS.length; i++) {
        if (window.ST.CATS[i].id === a.category) { catId = a.category; break; }
      }
    }
    window.ST.setStudyContext({
      subjectId: sub.id, subjectName: sub.name,
      chapterId: ch ? ch.id : null, chapterName: ch ? ch.name : ''
    });
    window.ST.recordStudy(ms, startMs, 'agent-' + uid(), catId);
    refreshDashboard();
    return {
      ok: true, subject: sub.name, chapter: ch ? ch.name : null,
      minutes: Math.round(ms / 60000), date: iso || todayISO(), category: catId
    };
  }

  function opAddGoal(a) {
    if (!a || !a.title || !String(a.title).trim()) return err('title is required');
    var cat = ['Personal', 'Professional', 'Other'].indexOf(a.category) >= 0 ? a.category : 'Personal';
    var dl = validISO(a.deadline);
    var g = {
      id: uid(),
      title: String(a.title).trim(),
      category: cat,
      note: a.note ? String(a.note) : '',
      startDate: null,
      mode: 'deadline',
      deadline: dl ? isoAtMs(dl, '09:00') : null,
      targetDays: null,
      status: 'active',
      done: false,
      parts: [],
      sessions: [],
      createdAt: Date.now()
    };
    if (window.GoalStore && typeof window.GoalStore.upsert === 'function') {
      window.GoalStore.upsert(g);
      try { if (window.GoalList && typeof window.GoalList.refresh === 'function') window.GoalList.refresh(); } catch (e) {}
    } else {
      var d = loadObj('achiva.goals.v1', 'goals');
      d.goals.push(g);
      window.AppStorage.saveAt('achiva.goals.v1', d);
    }
    refreshDashboard();
    return { ok: true, id: g.id, goal: g };
  }

  function opAddHabit(a) {
    if (!a || !a.name || !String(a.name).trim()) return err('name is required');
    var kind = (a.kind === 'bad') ? 'bad' : 'good';
    if (kind === 'bad') {
      if (window.BadList && typeof window.BadList.addHabit === 'function') {
        var b = window.BadList.addHabit({ name: String(a.name).trim() });
        return { ok: true, kind: 'bad', id: b.id, habit: b };
      }
      var bd = loadObj('achiva.badHabits.v1', 'habits');
      var bo = { id: uid(), name: String(a.name).trim(), since: todayISO(), createdAt: Date.now(), defended: {}, reps: [] };
      bd.habits.push(bo);
      window.AppStorage.saveAt('achiva.badHabits.v1', bd);
      return { ok: true, kind: 'bad', id: bo.id, habit: bo };
    }
    if (window.GoodList && typeof window.GoodList.addHabit === 'function') {
      var g = window.GoodList.addHabit({
        name: String(a.name).trim(),
        repsPerDay: Math.max(1, parseInt(a.reps_per_day, 10) || 1)
      });
      return { ok: true, kind: 'good', id: g.id, habit: g };
    }
    var gd = loadObj('achiva.goodHabits.v1', 'habits');
    var go = {
      id: uid(), name: String(a.name).trim(),
      repsPerDay: Math.max(1, parseInt(a.reps_per_day, 10) || 1),
      startDate: todayISO(), logs: {}
    };
    gd.habits.push(go);
    window.AppStorage.saveAt('achiva.goodHabits.v1', gd);
    return { ok: true, kind: 'good', id: go.id, habit: go };
  }

  function opAddExam(a) {
    if (!a || !a.name || !String(a.name).trim()) return err('name is required');
    var iso = validISO(a.date);
    if (!iso) return err('date is required as YYYY-MM-DD');
    var d = loadObj('achiva.exams.v1', 'exams');
    var ex = { id: uid(), name: String(a.name).trim(), dt: isoAtMs(iso, validHM(a.time) || '09:00') };
    d.exams.push(ex);
    window.AppStorage.saveAt('achiva.exams.v1', d);
    refreshDashboard();
    return { ok: true, id: ex.id, exam: ex };
  }

  function opAddThought(a) {
    if (!a || !a.content || !String(a.content).trim()) return err('content is required');
    var txt = String(a.content).trim();
    var nm = (a.name && String(a.name).trim()) ? String(a.name).trim() : txt.slice(0, 40);
    var t;
    if (window.ThoughtStore && typeof window.ThoughtStore.add === 'function') {
      t = window.ThoughtStore.add({
        name: nm,
        transcript: txt,
        status: 'done',
        language: null,
        duration: 0,
        size: 0,
        mime: null,
        audioId: null,
        structured: null
      });
    } else {
      var d = loadObj('achiva.thoughts.v1', 'thoughts');
      t = {
        id: uid(), name: nm, transcript: txt, status: 'done',
        date: todayISO(), createdAt: Date.now(), duration: 0, size: 0,
        mime: null, audioId: null, language: null, structured: null, catIds: []
      };
      d.thoughts.push(t);
      window.AppStorage.saveAt('achiva.thoughts.v1', d);
    }
    return { ok: true, id: t.id, thought: { id: t.id, name: t.name, date: t.date } };
  }

  function buildBridge() {
    var METHODS = {
      get_state: opGetState,
      add_task: opAddTask,
      toggle_task: opToggleTask,
      add_subject: opAddSubject,
      add_chapter: opAddChapter,
      log_study: opLogStudy,
      add_goal: opAddGoal,
      add_habit: opAddHabit,
      add_exam: opAddExam,
      add_thought: opAddThought
    };
    return {
      version: 1,
      ops: Object.keys(METHODS),
      ping: function () {
        return {
          ok: true,
          version: 1,
          appStorage: true,
          taskFeature: !!window.TaskFeature,
          st: !!window.ST,
          goalStore: !!window.GoalStore,
          goodList: !!window.GoodList,
          badList: !!window.BadList,
          thoughtStore: !!window.ThoughtStore,
          today: todayISO()
        };
      },
      __handle: function (jsonStr) {
        try {
          var req = JSON.parse(jsonStr);
          var op = req && req.op ? String(req.op) : '';
          var fn = METHODS[op];
          if (!fn) {
            return JSON.stringify(err("Unknown op '" + op + "'. Available: " + Object.keys(METHODS).join(', ')));
          }
          return JSON.stringify(fn(req.args || {}) || err('op returned nothing'));
        } catch (e) {
          return JSON.stringify(err(e && e.message ? e.message : e));
        }
      }
    };
  }

  install();
})();
