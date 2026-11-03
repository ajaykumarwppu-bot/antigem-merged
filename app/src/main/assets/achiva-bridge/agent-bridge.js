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

  function countTopicNodes(nodes) {
    var n = 0;
    (Array.isArray(nodes) ? nodes : []).forEach(function (t) {
      if (!t || typeof t !== 'object') return;
      n++;
      n += countTopicNodes(t.children);
    });
    return n;
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
      thoughts: function () { return loadObj('achiva.thoughts.v1', 'thoughts').thoughts; },
      tests: function () {
        if (window.ST && window.ST.state && Array.isArray(window.ST.state.tests)) return window.ST.state.tests;
        var b = loadObj('achiva.subjectTracker.v1', 'subjects');
        return Array.isArray(b.tests) ? b.tests : [];
      },
      errors: function () {
        if (window.ST && window.ST.state && Array.isArray(window.ST.state.errors)) return window.ST.state.errors;
        var b2 = loadObj('achiva.subjectTracker.v1', 'subjects');
        return Array.isArray(b2.errors) ? b2.errors : [];
      },
      stepTemplates: function () {
        if (window.ST && window.ST.state && window.ST.state.stepTemplates) return window.ST.state.stepTemplates;
        var b3 = loadObj('achiva.subjectTracker.v1', 'subjects');
        return (b3.stepTemplates && typeof b3.stepTemplates === 'object') ? b3.stepTemplates : { complete: [], mastery: [] };
      }
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
      var nCh = 0, nTop = 0, nSrc = 0, nSteps = 0, nMst = 0, nRev = 0;
      var subjMini = [];
      subs.forEach(function (s) {
        var chs = Array.isArray(s.chapters) ? s.chapters : [];
        nCh += chs.length;
        subjMini.push({ id: s.id, name: s.name, cat: s.cat || null, chapters: chs.length });
        chs.forEach(function (c) {
          nTop += countTopicNodes(c.topics);
          nSrc += Array.isArray(c.sources) ? c.sources.length : 0;
          nSteps += Array.isArray(c.steps) ? c.steps.length : 0;
          nMst += Array.isArray(c.masterySteps) ? c.masterySteps.length : 0;
          if (c.revision && c.revision.pending) nRev++;
        });
      });
      summary.chapters = nCh;
      summary.topicNodes = nTop;
      summary.sources = nSrc;
      summary.roadmapSteps = nSteps + nMst;
      summary.revisionsPending = nRev;
      summary.subjectList = subjMini;
      summary.tests = Array.isArray(data.tests) ? data.tests.length : 0;
      summary.mistakes = Array.isArray(data.errors) ? data.errors.length : 0;
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

  /* ================================================================
     SUBJECT TRACKER — shared helpers (v2)
     Sab mutations LIVE ST.state object par hote hain + ST.persist().
     Raw saveAt('achiva.subjectTracker.v1', ...) KABHI nahi — cache
     overwrite bug (upar header note dekho). Field semantics Achiva ke
     apne files se mirror kiye gaye hain:
       basics.js (priority/status/dates/steps), topic.js (topics tree),
       notes.js (topic notes), sources.js + sources-detail.js (sources),
       rivision.js (revision), test.js + error.js (tests/mistakes),
       SubjectSetting.js (global step templates), exam-widget.js (exams).
     ================================================================ */

  function stReady() {
    return !!(window.ST && window.ST.state && window.ST.state.subjects);
  }

  function stPersist() {
    if (window.ST && typeof window.ST.persist === 'function') { window.ST.persist(); return true; }
    return false;
  }

  function stRefresh() {
    try { if (window.ST && typeof window.ST.refreshLists === 'function') window.ST.refreshLists(); } catch (e) {}
    refreshDashboard();
  }

  /* chapter ke lazily-attached fields — basics.js:43-50 + topic.js:78 +
     sources.js:47-49 ke ensure() ka mirror */
  function ensureCh(ch) {
    if (!ch.priority) ch.priority = 'Low';
    if (!ch.status) ch.status = 'Not Started';
    if (ch.startDate == null) ch.startDate = null;
    if (ch.endDate == null) ch.endDate = null;
    if (!Array.isArray(ch.steps)) ch.steps = [];
    if (!Array.isArray(ch.masterySteps)) ch.masterySteps = [];
    if (!Array.isArray(ch.topics)) ch.topics = [];
    if (!Array.isArray(ch.sources)) ch.sources = [];
  }

  /* rivision.js:70-86 ensure() ka mirror */
  function ensureRev(ch) {
    if (!ch.revision || typeof ch.revision !== 'object') {
      ch.revision = { chapterSteps: [], questionSteps: [], history: [], pending: null, qHistory: [], itemCounts: {} };
    }
    var r = ch.revision;
    if (!Array.isArray(r.chapterSteps) && Array.isArray(r.steps)) r.chapterSteps = r.steps;
    if (!Array.isArray(r.chapterSteps)) r.chapterSteps = [];
    if (!Array.isArray(r.questionSteps)) r.questionSteps = [];
    if (!Array.isArray(r.history)) r.history = [];
    if (!Array.isArray(r.qHistory)) r.qHistory = [];
    if (!r.itemCounts || typeof r.itemCounts !== 'object') r.itemCounts = {};
    if (r.pending && typeof r.pending !== 'object') r.pending = null;
    delete r.steps;
    return r;
  }

  function addDaysISO(iso, n) {
    var d = validISO(iso); if (!d) return null;
    var p = d.split('-');
    var dt = new Date(+p[0], (+p[1]) - 1, +p[2]);
    dt.setDate(dt.getDate() + n);
    return dt.getFullYear() + '-' + pad2(dt.getMonth() + 1) + '-' + pad2(dt.getDate());
  }

  function nowHm() {
    var n = new Date();
    return pad2(n.getHours()) + ':' + pad2(n.getMinutes());
  }

  /* UI.fmtDate (core/ui.js:73-76) ka display-string mirror — test/error
     entries date ko DISPLAY string ke roop me store karte hain */
  var MONTHS_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];
  function fmtDateDisp(iso) {
    var d = validISO(iso); if (!d) return '';
    var p = d.split('-');
    return (+p[2]) + ' ' + MONTHS_ABBR[(+p[1]) - 1] + ' ' + (+p[0]);
  }

  function sortedUniqueNums(arr) {
    var out = [];
    (Array.isArray(arr) ? arr : []).forEach(function (n) {
      var v = parseInt(n, 10);
      if (!isNaN(v) && v > 0 && out.indexOf(v) === -1) out.push(v);
    });
    return out.sort(function (a, b) { return a - b; });
  }

  /* sources.js:51-97 ensureSource ka mirror (migration bhi) */
  function ensureSource(s) {
    if (!Array.isArray(s.solved)) s.solved = [];
    if (!Array.isArray(s.doubt)) s.doubt = [];
    if (!Array.isArray(s.analysis)) s.analysis = [];
    if (!Array.isArray(s.important)) s.important = [];
    if (!Array.isArray(s.attempts)) s.attempts = [];
    if (!Array.isArray(s.pages)) s.pages = [];
    if (typeof s.total !== 'number') s.total = parseInt(s.total, 10) || 0;
    if (s.category !== 'PYQ') s.category = 'Normal';
  }

  function findSource(ch, q) {
    ensureCh(ch);
    var s = String(q).trim().toLowerCase();
    for (var i = 0; i < ch.sources.length; i++) {
      if (String(ch.sources[i].id).toLowerCase() === s ||
          String(ch.sources[i].name).trim().toLowerCase() === s) return ch.sources[i];
    }
    for (var j = 0; j < ch.sources.length; j++) {
      if (String(ch.sources[j].name).toLowerCase().indexOf(s) !== -1) return ch.sources[j];
    }
    return null;
  }

  /* topic.js:81-88 ensureNode + :113-120 findNode ka mirror — exact id/
   * naam pehle, phir partial (findSubject jaisa do-pass behaviour) */
  function ensureNode(n) {
    if (!Array.isArray(n.children)) n.children = [];
    if (n.tag == null) n.tag = '';
    n.done = !!n.done;
    if (n.notes == null) n.notes = '';
    if (n.notesTitle == null) n.notesTitle = '';
  }

  function findTopicExact(nodes, s) {
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (!n || typeof n !== 'object') continue;
      ensureNode(n);
      if (String(n.id).toLowerCase() === s || String(n.name).trim().toLowerCase() === s) return n;
      var f = findTopicExact(n.children, s);
      if (f) return f;
    }
    return null;
  }

  function findTopicPartial(nodes, s) {
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (!n || typeof n !== 'object') continue;
      ensureNode(n);
      if (String(n.name).toLowerCase().indexOf(s) !== -1) return n;
      var f = findTopicPartial(n.children, s);
      if (f) return f;
    }
    return null;
  }

  function findTopic(ch, q) {
    ensureCh(ch);
    var s = String(q).trim().toLowerCase();
    return findTopicExact(ch.topics, s) || findTopicPartial(ch.topics, s);
  }

  /* topic.js:100-103 setDone ka mirror — node + poora subtree */
  function setTopicDone(n, v) {
    n.done = v;
    n.children.forEach(function (c) { setTopicDone(c, v); });
  }

  /* topic.js:105-111 removeNode ka mirror — recursive splice;
     removed subtree ka node-count bhi gin leta hai (report ke liye) */
  function countSubtree(n) {
    var c = 1;
    n.children.forEach(function (x) { c += countSubtree(x); });
    return c;
  }

  function removeTopicNode(nodes, id) {
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].id === id) { nodes.splice(i, 1); return true; }
      if (removeTopicNode(nodes[i].children || [], id)) return true;
    }
    return false;
  }

  function stepListOf(ch, list) {
    ensureCh(ch);
    if (list === 'mastery') return ch.masterySteps;
    if (list === 'complete') return ch.steps;
    return null;
  }

  function findStepIn(list, q) {
    var s = String(q).trim().toLowerCase();
    for (var i = 0; i < list.length; i++) {
      if (String(list[i].id).toLowerCase() === s ||
          String(list[i].text).trim().toLowerCase() === s) return list[i];
    }
    for (var j = 0; j < list.length; j++) {
      if (String(list[j].text).toLowerCase().indexOf(s) !== -1) return list[j];
    }
    return null;
  }

  /* rivision.js:349-373 sourceItems ka mirror — Q-revision ke tickable
     items (key formats: 'imp:Q', 'att:Q', 'pg:PAGE:Q') */
  function sourceItemsOf(s) {
    var items = [];
    (s.important || []).slice().sort(function (a, b) { return a - b; }).forEach(function (q) {
      items.push({ key: 'imp:' + q, label: 'Q' + q, box: 'Q' + q, part: 'Important' });
    });
    ['2', '3', '4+'].forEach(function (k) {
      (s.attempts || []).forEach(function (g) {
        if (g.attempts !== k) return;
        (g.qs || []).slice().sort(function (a, b) { return a - b; }).forEach(function (q) {
          items.push({ key: 'att:' + q, label: 'Q' + q, box: 'Q' + q, part: k + ' attempts' });
        });
      });
    });
    (s.pages || []).forEach(function (pg) {
      (pg.qs || []).slice().sort(function (a, b) { return a - b; }).forEach(function (q) {
        items.push({ key: 'pg:' + pg.page + ':' + q, label: 'P' + pg.page + ' · Q' + q, box: 'Q' + q, part: 'Page ' + pg.page });
      });
    });
    return items;
  }

  /* rivision.js:47 GAPS ka mirror */
  var REV_GAPS = { 1: 2, 2: 5, 3: 8, 4: 11, 5: 15 };
  var REV_RATING_LABEL = { 1: 'Worst', 2: 'Weak', 3: 'Average', 4: 'Good', 5: 'Perfect' };
  var REV_MAX_FORWARD_DAYS = 2;

  /* error.js:35-42 MISTAKE_TYPES ka mirror */
  var MISTAKE_TYPES = [
    'Conceptual Mistake', 'Calculation Mistake', 'Reading Mistake',
    'Memory Mistake', 'Careless / Silly Mistake', 'Time Pressure Mistake'
  ];

  /* test.js:41 TEST_TYPES ka mirror */
  var TEST_TYPES = ['JEE Mains', 'JEE Advanced', 'Mock Test'];

  /* 2-step delete guard: confirm=true ke bina kuch delete nahi hota.
     Pehli call preview deti hai — agent user se poochh kar dobara
     confirm:true ke saath call karega. */
  function confirmGuard(a, label, detail) {
    if (a && a.confirm === true) return null;
    return {
      ok: true,
      requires_confirmation: true,
      would_delete: label,
      detail: detail || '',
      message: 'Two-step delete: ask the user to confirm in chat, then call this op again with confirm=true.'
    };
  }

  function needST() {
    if (!stReady()) return err('subject tracker (window.ST) is not loaded — open the Subjects screen once, then retry');
    return null;
  }

  /* ---------------- subject tracker ops (v2) ---------------- */

  function opUpdateSubject(a) {
    var e = needST(); if (e) return e;
    if (!a || !a.subject) return err('subject is required (id ya naam)');
    var sub = findSubject(a.subject);
    if (!sub) return err('subject not found: ' + a.subject);
    var changed = {};
    if (a.name && String(a.name).trim()) { sub.name = String(a.name).trim(); changed.name = sub.name; }
    if (a.cat !== undefined) {
      if (a.cat === 'jee' || a.cat === 'boards') { sub.cat = a.cat; changed.cat = a.cat; }
      else if (a.cat === 'none' || a.cat === null || a.cat === '') { sub.cat = null; changed.cat = null; }
      else return err("cat must be 'jee', 'boards' or 'none'");
    }
    stPersist(); stRefresh();
    return { ok: true, id: sub.id, changed: changed, subject: sub };
  }

  function opDeleteSubject(a) {
    var e = needST(); if (e) return e;
    if (!a || !a.subject) return err('subject is required (id ya naam)');
    var sub = findSubject(a.subject);
    if (!sub) return err('subject not found: ' + a.subject);
    var g = confirmGuard(a, 'Subject "' + sub.name + '"',
      (sub.chapters || []).length + ' chapters with all their topics, sources, roadmaps and revision data');
    if (g) return g;
    var i = window.ST.state.subjects.indexOf(sub);
    if (i >= 0) window.ST.state.subjects.splice(i, 1);
    stPersist(); stRefresh();
    return { ok: true, deleted: sub.name, chaptersRemoved: (sub.chapters || []).length };
  }

  function opUpdateChapter(a) {
    var e = needST(); if (e) return e;
    if (!a || !a.subject) return err('subject is required (id ya naam)');
    if (!a.chapter) return err('chapter is required (id ya naam)');
    var sub = findSubject(a.subject);
    if (!sub) return err('subject not found: ' + a.subject);
    var ch = findChapter(sub, a.chapter);
    if (!ch) return err('chapter not found: ' + a.chapter);
    ensureCh(ch);
    var changed = {};
    if (a.name && String(a.name).trim()) { ch.name = String(a.name).trim(); changed.name = ch.name; }
    if (a.priority !== undefined) {
      if (['Low', 'Medium', 'High'].indexOf(a.priority) < 0) return err("priority must be 'Low', 'Medium' or 'High'");
      ch.priority = a.priority; changed.priority = a.priority;
    }
    if (a.status !== undefined) {
      if (['Not Started', 'In Progress', 'Completed'].indexOf(a.status) < 0) {
        return err("status must be 'Not Started', 'In Progress' or 'Completed'");
      }
      ch.status = a.status; changed.status = a.status;
    }
    if (a.start_date !== undefined) {
      if (a.start_date === null || a.start_date === '' || a.start_date === 'clear') { ch.startDate = null; changed.startDate = null; }
      else {
        var sd = validISO(a.start_date);
        if (!sd) return err('start_date must be YYYY-MM-DD (ya null/clear to remove)');
        ch.startDate = sd; changed.startDate = sd;
      }
    }
    if (a.end_date !== undefined) {
      if (a.end_date === null || a.end_date === '' || a.end_date === 'clear') { ch.endDate = null; changed.endDate = null; }
      else {
        var ed = validISO(a.end_date);
        if (!ed) return err('end_date must be YYYY-MM-DD (ya null/clear to remove)');
        ch.endDate = ed; changed.endDate = ed;
      }
    }
    stPersist(); stRefresh();
    return { ok: true, subject: sub.name, chapter: ch, changed: changed };
  }

  function opDeleteChapter(a) {
    var e = needST(); if (e) return e;
    if (!a || !a.subject) return err('subject is required (id ya naam)');
    if (!a.chapter) return err('chapter is required (id ya naam)');
    var sub = findSubject(a.subject);
    if (!sub) return err('subject not found: ' + a.subject);
    var ch = findChapter(sub, a.chapter);
    if (!ch) return err('chapter not found: ' + a.chapter);
    var g = confirmGuard(a, 'Chapter "' + ch.name + '" (subject: ' + sub.name + ')',
      'all its topics, sources, roadmaps and revision data');
    if (g) return g;
    var i = sub.chapters.indexOf(ch);
    if (i >= 0) sub.chapters.splice(i, 1);
    stPersist(); stRefresh();
    return { ok: true, deleted: ch.name, subject: sub.name };
  }

  function opAddStep(a) {
    var e = needST(); if (e) return e;
    if (!a || !a.subject || !a.chapter) return err('subject and chapter are required');
    if (!a.text || !String(a.text).trim()) return err('text is required');
    var list = stepListFor(a);
    if (!list) return err("list must be 'complete' (ch.steps) ya 'mastery' (ch.masterySteps)");
    var step = { id: uid(), text: String(a.text).trim(), done: false };
    if (a.index >= 0 && a.index <= list.length) list.splice(parseInt(a.index, 10), 0, step);
    else list.push(step);
    stPersist(); stRefresh();
    return { ok: true, id: step.id, list: a.list === 'mastery' ? 'mastery' : 'complete', step: step };
  }

  function stepListFor(a) {
    var sub = findSubject(a.subject);
    if (!sub) return null;
    var ch = findChapter(sub, a.chapter);
    if (!ch) return null;
    a.__ch = ch; a.__sub = sub;
    return stepListOf(ch, a.list === 'mastery' ? 'mastery' : (a.list === 'complete' ? 'complete' : String(a.list || '')));
  }

  function opUpdateStep(a) {
    var e = needST(); if (e) return e;
    if (!a || !a.subject || !a.chapter || !a.step) return err('subject, chapter and step are required');
    var list = stepListFor(a);
    if (!list) return err('subject/chapter not found (ya list galat — complete|mastery)');
    var st = findStepIn(list, a.step);
    if (!st) return err('step not found: ' + a.step);
    var changed = {};
    if (a.text && String(a.text).trim()) { st.text = String(a.text).trim(); changed.text = st.text; }
    if (a.done !== undefined) { st.done = !!a.done; changed.done = st.done; }
    stPersist(); stRefresh();
    return { ok: true, id: st.id, changed: changed };
  }

  function opDeleteStep(a) {
    var e = needST(); if (e) return e;
    if (!a || !a.subject || !a.chapter || !a.step) return err('subject, chapter and step are required');
    var list = stepListFor(a);
    if (!list) return err('subject/chapter not found (ya list galat — complete|mastery)');
    var st = findStepIn(list, a.step);
    if (!st) return err('step not found: ' + a.step);
    var g = confirmGuard(a, 'Roadmap step "' + st.text + '"', 'list: ' + (a.list === 'mastery' ? 'mastery' : 'complete'));
    if (g) return g;
    var i = list.indexOf(st);
    if (i >= 0) list.splice(i, 1);
    stPersist(); stRefresh();
    return { ok: true, deleted: st.text };
  }

  /* Global step templates (SubjectSetting.js — triangle icon wala
     feature). Ye APIs khud syncAll() + persist + refresh karti hain. */
  function opAddStepTemplate(a) {
    if (!window.SubjectSetting || typeof window.SubjectSetting.addStep !== 'function') {
      return err('SubjectSetting module is not loaded');
    }
    if (!a || (a.key !== 'complete' && a.key !== 'mastery')) return err("key must be 'complete' ya 'mastery'");
    if (!a.text || !String(a.text).trim()) return err('text is required');
    var st = window.SubjectSetting.addStep(a.key, String(a.text).trim());
    if (!st) return err('template step add nahi hua');
    refreshDashboard();
    return { ok: true, id: st.id, key: a.key, text: st.text, synced_to_all_chapters: true };
  }

  function opUpdateStepTemplate(a) {
    if (!window.SubjectSetting || typeof window.SubjectSetting.setText !== 'function') {
      return err('SubjectSetting module is not loaded');
    }
    if (!a || (a.key !== 'complete' && a.key !== 'mastery')) return err("key must be 'complete' ya 'mastery'");
    if (!a.id) return err('template step id is required (achiva_get_state keys=[stepTemplates])');
    if (!a.text || !String(a.text).trim()) return err('text is required');
    var done = window.SubjectSetting.setText(a.key, a.id, String(a.text).trim());
    if (!done) return err('template step not found: ' + a.id);
    refreshDashboard();
    return { ok: true, id: a.id, text: String(a.text).trim(), synced_to_all_chapters: true };
  }

  function opDeleteStepTemplate(a) {
    if (!window.SubjectSetting || typeof window.SubjectSetting.removeStep !== 'function') {
      return err('SubjectSetting module is not loaded');
    }
    if (!a || (a.key !== 'complete' && a.key !== 'mastery')) return err("key must be 'complete' ya 'mastery'");
    if (!a.id) return err('template step id is required (achiva_get_state keys=[stepTemplates])');
    var g = confirmGuard(a, 'Global template step ' + a.id,
      'ye step SABHI chapters se hat jayega (jo chapters me locally edit hua hai wo bachta hai)');
    if (g) return g;
    var done = window.SubjectSetting.removeStep(a.key, a.id);
    if (!done) return err('template step not found: ' + a.id);
    refreshDashboard();
    return { ok: true, deleted: a.id, removed_from_all_chapters: true };
  }

  function opMoveStepTemplate(a) {
    if (!window.SubjectSetting || typeof window.SubjectSetting.moveStep !== 'function') {
      return err('SubjectSetting module is not loaded');
    }
    if (!a || (a.key !== 'complete' && a.key !== 'mastery')) return err("key must be 'complete' ya 'mastery'");
    if (!a.id) return err('template step id is required');
    var dir = parseInt(a.dir, 10) < 0 ? -1 : 1;
    var done = window.SubjectSetting.moveStep(a.key, a.id, dir);
    if (!done) return err('move nahi hua (step not found ya list ke edge par hai)');
    refreshDashboard();
    return { ok: true, id: a.id, moved: dir < 0 ? 'up' : 'down', synced_to_all_chapters: true };
  }

  function opAddTopic(a) {
    var e = needST(); if (e) return e;
    if (!a || !a.subject || !a.chapter) return err('subject and chapter are required');
    var names = [];
    if (Array.isArray(a.names)) names = a.names;
    else if (a.name && String(a.name).trim()) names = [a.name];
    names = names.map(function (x) { return String(x).trim(); }).filter(function (x) { return x; });
    if (!names.length) return err('name (ya names array) is required');
    var sub = findSubject(a.subject);
    if (!sub) return err('subject not found: ' + a.subject);
    var ch = findChapter(sub, a.chapter);
    if (!ch) return err('chapter not found: ' + a.chapter);
    ensureCh(ch);
    var tag = ['', 'imp', 'vvi'].indexOf(a.tag) >= 0 ? a.tag : '';
    var target = ch.topics;
    if (a.parent_topic) {
      var p = findTopic(ch, a.parent_topic);
      if (!p) return err('parent topic not found: ' + a.parent_topic);
      target = p.children;
    }
    var added = [];
    names.forEach(function (nm) {
      var node = { id: uid(), name: nm, done: false, tag: tag, children: [] };
      target.push(node);
      added.push(node);
    });
    stPersist(); stRefresh();
    return { ok: true, added: added, under_parent: a.parent_topic || null };
  }

  function opUpdateTopic(a) {
    var e = needST(); if (e) return e;
    if (!a || !a.subject || !a.chapter || !a.topic) return err('subject, chapter and topic are required');
    var sub = findSubject(a.subject);
    if (!sub) return err('subject not found: ' + a.subject);
    var ch = findChapter(sub, a.chapter);
    if (!ch) return err('chapter not found: ' + a.chapter);
    var n = findTopic(ch, a.topic);
    if (!n) return err('topic not found: ' + a.topic);
    var changed = {};
    if (a.name && String(a.name).trim()) { n.name = String(a.name).trim(); changed.name = n.name; }
    if (a.tag !== undefined) {
      if (['', 'imp', 'vvi'].indexOf(a.tag) < 0) return err("tag must be '' (none), 'imp' ya 'vvi'");
      n.tag = a.tag; changed.tag = a.tag;
    }
    if (a.done !== undefined) {
      setTopicDone(n, !!a.done);
      changed.done = !!a.done;
      changed.done_applies_to_subtree = true;
    }
    stPersist(); stRefresh();
    return { ok: true, id: n.id, topic: n.name, changed: changed };
  }

  function opSetTopicNotes(a) {
    var e = needST(); if (e) return e;
    if (!a || !a.subject || !a.chapter || !a.topic) return err('subject, chapter and topic are required');
    if (a.notes === undefined && a.title === undefined) return err('notes ya title me se kuch to do');
    var sub = findSubject(a.subject);
    if (!sub) return err('subject not found: ' + a.subject);
    var ch = findChapter(sub, a.chapter);
    if (!ch) return err('chapter not found: ' + a.chapter);
    var n = findTopic(ch, a.topic);
    if (!n) return err('topic not found: ' + a.topic);
    ensureNode(n);
    var changed = {};
    if (a.title !== undefined) { n.notesTitle = String(a.title == null ? '' : a.title); changed.title = n.notesTitle; }
    if (a.notes !== undefined) { n.notes = String(a.notes == null ? '' : a.notes); changed.notes_chars = n.notes.length; }
    stPersist(); stRefresh();
    return { ok: true, id: n.id, topic: n.name, changed: changed };
  }

  function opDeleteTopic(a) {
    var e = needST(); if (e) return e;
    if (!a || !a.subject || !a.chapter || !a.topic) return err('subject, chapter and topic are required');
    var sub = findSubject(a.subject);
    if (!sub) return err('subject not found: ' + a.subject);
    var ch = findChapter(sub, a.chapter);
    if (!ch) return err('chapter not found: ' + a.chapter);
    var n = findTopic(ch, a.topic);
    if (!n) return err('topic not found: ' + a.topic);
    var g = confirmGuard(a, 'Topic "' + n.name + '"',
      countSubtree(n) > 1 ? 'poora subtree (' + countSubtree(n) + ' nodes incl. sub-topics aur unke notes)' : 'topic + uske notes');
    if (g) return g;
    removeTopicNode(ch.topics, n.id);
    stPersist(); stRefresh();
    return { ok: true, deleted: n.name };
  }

  function opAddSource(a) {
    var e = needST(); if (e) return e;
    if (!a || !a.subject || !a.chapter) return err('subject and chapter are required');
    if (!a.name || !String(a.name).trim()) return err('name is required');
    var sub = findSubject(a.subject);
    if (!sub) return err('subject not found: ' + a.subject);
    var ch = findChapter(sub, a.chapter);
    if (!ch) return err('chapter not found: ' + a.chapter);
    ensureCh(ch);
    var total = parseInt(a.total, 10);
    if (isNaN(total) || total < 0) total = 0;
    var cat = a.category === 'PYQ' ? 'PYQ' : 'Normal';
    var s = {
      id: uid(), name: String(a.name).trim(), total: total, category: cat,
      solved: [], doubt: [], analysis: [], important: [],
      attempts: [], pages: []
    };
    ch.sources.push(s);
    stPersist(); stRefresh();
    return { ok: true, id: s.id, source: s };
  }

  /* sources.js:159-183 edit+clamp ka mirror — total ghataya to bade
     question numbers HAR list se hat jaate hain, khali groups ud jaate
     hain (data loss nahi hota, wahi app ka behaviour hai) */
  function opUpdateSource(a) {
    var e = needST(); if (e) return e;
    if (!a || !a.subject || !a.chapter || !a.source) return err('subject, chapter and source are required');
    var sub = findSubject(a.subject);
    if (!sub) return err('subject not found: ' + a.subject);
    var ch = findChapter(sub, a.chapter);
    if (!ch) return err('chapter not found: ' + a.chapter);
    var s = findSource(ch, a.source);
    if (!s) return err('source not found: ' + a.source);
    ensureSource(s);
    var changed = {};
    if (a.name && String(a.name).trim()) { s.name = String(a.name).trim(); changed.name = s.name; }
    if (a.category !== undefined) {
      if (a.category !== 'Normal' && a.category !== 'PYQ') return err("category must be 'Normal' ya 'PYQ'");
      s.category = a.category; changed.category = a.category;
    }
    if (a.total !== undefined) {
      var t = parseInt(a.total, 10);
      if (isNaN(t) || t < 0) return err('total must be a number >= 0');
      s.total = t; changed.total = t;
      s.solved = s.solved.filter(function (n) { return n <= t; });
      s.doubt = s.doubt.filter(function (n) { return n <= t; });
      s.analysis = s.analysis.filter(function (n) { return n <= t; });
      s.important = s.important.filter(function (n) { return n <= t; });
      s.attempts.forEach(function (g) { g.qs = (g.qs || []).filter(function (n) { return n <= t; }); });
      s.attempts = s.attempts.filter(function (g) { return g.qs.length; });
      s.pages.forEach(function (pg) { pg.qs = (pg.qs || []).filter(function (n) { return n <= t; }); });
      s.pages = s.pages.filter(function (pg) { return (pg.topics || []).length || (pg.qs || []).length; });
      changed.clamped = true;
    }
    stPersist(); stRefresh();
    return { ok: true, id: s.id, source: s, changed: changed };
  }

  function opDeleteSource(a) {
    var e = needST(); if (e) return e;
    if (!a || !a.subject || !a.chapter || !a.source) return err('subject, chapter and source are required');
    var sub = findSubject(a.subject);
    if (!sub) return err('subject not found: ' + a.subject);
    var ch = findChapter(sub, a.chapter);
    if (!ch) return err('chapter not found: ' + a.chapter);
    var s = findSource(ch, a.source);
    if (!s) return err('source not found: ' + a.source);
    var g = confirmGuard(a, 'Source "' + s.name + '"',
      'total ' + s.total + ' questions, ' + (s.solved || []).length + ' solved, ' + (s.doubt || []).length + ' doubtful — saara question-tracking data');
    if (g) return g;
    var i = ch.sources.indexOf(s);
    if (i >= 0) ch.sources.splice(i, 1);
    stPersist(); stRefresh();
    return { ok: true, deleted: s.name };
  }

  function opSetSourceQuestions(a) {
    var e = needST(); if (e) return e;
    if (!a || !a.subject || !a.chapter || !a.source) return err('subject, chapter and source are required');
    var LISTS = ['solved', 'doubt', 'doubt_solved', 'analysis', 'important'];
    if (LISTS.indexOf(a.list) < 0) return err("list must be one of: " + LISTS.join(', '));
    if (['set', 'add', 'remove'].indexOf(a.mode) < 0) return err("mode must be 'set', 'add' ya 'remove'");
    var qs = sortedUniqueNums(a.questions);
    if (!qs.length) return err('questions array is required (positive question numbers)');
    var sub = findSubject(a.subject);
    if (!sub) return err('subject not found: ' + a.subject);
    var ch = findChapter(sub, a.chapter);
    if (!ch) return err('chapter not found: ' + a.chapter);
    var s = findSource(ch, a.source);
    if (!s) return err('source not found: ' + a.source);
    ensureSource(s);
    if (a.list === 'analysis' && s.category === 'PYQ') {
      return err('analysis list sirf Normal sources ke liye hai (PYQ par app me option hi nahi aata)');
    }
    var over = qs.filter(function (n) { return n > s.total; });
    if (over.length) return err('ye question numbers total (' + s.total + ') se bade hain: ' + over.join(', '));
    var key = a.list === 'doubt_solved' ? 'doubtSolved' : a.list;
    if (!Array.isArray(s[key])) s[key] = [];
    var before = s[key].length;
    if (a.mode === 'set') s[key] = qs.slice();
    else if (a.mode === 'add') s[key] = sortedUniqueNums(s[key].concat(qs));
    else s[key] = s[key].filter(function (n) { return qs.indexOf(n) === -1; });
    /* doubtSolved logically doubt ka subset hota hai — doubt se hataya
       to doubtSolved se bhi hatao (doubt.js toggle behaviour) */
    if (a.list === 'doubt' && (a.mode === 'set' || a.mode === 'remove')) {
      if (!Array.isArray(s.doubtSolved)) s.doubtSolved = [];
      s.doubtSolved = s.doubtSolved.filter(function (n) { return s.doubt.indexOf(n) !== -1; });
    }
    stPersist(); stRefresh();
    return { ok: true, source: s.name, list: a.list, mode: a.mode, count: s[key].length, added: s[key].length - before, questions: s[key] };
  }

  /* sources-detail.js:230-244 ka mirror — attempts groups EXCLUSIVE hain:
     naye questions doosre groups se nikal kar target group me aate hain */
  function opAddSourceAttempts(a) {
    var e = needST(); if (e) return e;
    if (!a || !a.subject || !a.chapter || !a.source) return err('subject, chapter and source are required');
    if (['2', '3', '4+'].indexOf(String(a.attempts)) < 0) return err("attempts must be '2', '3' ya '4+'");
    var qs = sortedUniqueNums(a.questions);
    if (!qs.length) return err('questions array is required (positive question numbers)');
    var sub = findSubject(a.subject);
    if (!sub) return err('subject not found: ' + a.subject);
    var ch = findChapter(sub, a.chapter);
    if (!ch) return err('chapter not found: ' + a.chapter);
    var s = findSource(ch, a.source);
    if (!s) return err('source not found: ' + a.source);
    ensureSource(s);
    var over = qs.filter(function (n) { return n > s.total; });
    if (over.length) return err('ye question numbers total (' + s.total + ') se bade hain: ' + over.join(', '));
    /* pehle in qs ko doosre groups se hatao (app ka exact behaviour) */
    s.attempts.forEach(function (g) {
      g.qs = (g.qs || []).filter(function (n) { return qs.indexOf(n) === -1; });
    });
    s.attempts = s.attempts.filter(function (g) { return g.qs.length; });
    var target = null;
    s.attempts.forEach(function (g) { if (g.attempts === String(a.attempts)) target = g; });
    if (!target) { target = { id: uid(), attempts: String(a.attempts), qs: [] }; s.attempts.push(target); }
    qs.forEach(function (n) { if (target.qs.indexOf(n) === -1) target.qs.push(n); });
    target.qs = sortedUniqueNums(target.qs);
    stPersist(); stRefresh();
    return { ok: true, source: s.name, attempts: target.attempts, qs: target.qs };
  }

  function opDeleteSourceAttempts(a) {
    var e = needST(); if (e) return e;
    if (!a || !a.subject || !a.chapter || !a.source || a.attempts === undefined) {
      return err('subject, chapter, source and attempts are required');
    }
    var sub = findSubject(a.subject);
    if (!sub) return err('subject not found: ' + a.subject);
    var ch = findChapter(sub, a.chapter);
    if (!ch) return err('chapter not found: ' + a.chapter);
    var s = findSource(ch, a.source);
    if (!s) return err('source not found: ' + a.source);
    ensureSource(s);
    var g = null;
    s.attempts.forEach(function (x) {
      if (x.attempts === String(a.attempts) || x.id === a.attempts) g = x;
    });
    if (!g) return err('attempts group not found: ' + a.attempts);
    var gd = confirmGuard(a, 'Attempts group "' + g.attempts + '" (' + g.qs.length + ' questions) from source "' + s.name + '"', '');
    if (gd) return gd;
    s.attempts = s.attempts.filter(function (x) { return x !== g; });
    stPersist(); stRefresh();
    return { ok: true, deleted: g.attempts, qs: g.qs };
  }

  /* sources-detail.js:272-289 ka mirror — pages INCLUSIVE hain (topics/
     qs target page me union hote hain, doosre pages touch nahi hote) */
  function opAddSourcePage(a) {
    var e = needST(); if (e) return e;
    if (!a || !a.subject || !a.chapter || !a.source) return err('subject, chapter and source are required');
    var page = parseInt(a.page, 10);
    if (isNaN(page) || page <= 0) return err('page must be a positive number');
    var topics = (Array.isArray(a.topics) ? a.topics : []).map(function (t) { return String(t).trim(); }).filter(function (t) { return t; });
    var qs = sortedUniqueNums(a.questions);
    if (!topics.length && !qs.length) return err('topics ya questions me se kuch to do');
    var sub = findSubject(a.subject);
    if (!sub) return err('subject not found: ' + a.subject);
    var ch = findChapter(sub, a.chapter);
    if (!ch) return err('chapter not found: ' + a.chapter);
    var s = findSource(ch, a.source);
    if (!s) return err('source not found: ' + a.source);
    ensureSource(s);
    var over = qs.filter(function (n) { return n > s.total; });
    if (over.length) return err('ye question numbers total (' + s.total + ') se bade hain: ' + over.join(', '));
    var target = null;
    s.pages.forEach(function (p) { if (p.page === page) target = p; });
    if (!target) { target = { id: uid(), page: page, topics: [], qs: [] }; s.pages.push(target); }
    topics.forEach(function (t) { if (target.topics.indexOf(t) === -1) target.topics.push(t); });
    qs.forEach(function (q) { if (target.qs.indexOf(q) === -1) target.qs.push(q); });
    target.qs = sortedUniqueNums(target.qs);
    stPersist(); stRefresh();
    return { ok: true, source: s.name, page: target.page, topics: target.topics, qs: target.qs };
  }

  function opDeleteSourcePage(a) {
    var e = needST(); if (e) return e;
    if (!a || !a.subject || !a.chapter || !a.source || a.page === undefined) {
      return err('subject, chapter, source and page are required');
    }
    var page = parseInt(a.page, 10);
    var sub = findSubject(a.subject);
    if (!sub) return err('subject not found: ' + a.subject);
    var ch = findChapter(sub, a.chapter);
    if (!ch) return err('chapter not found: ' + a.chapter);
    var s = findSource(ch, a.source);
    if (!s) return err('source not found: ' + a.source);
    ensureSource(s);
    var pg = null;
    s.pages.forEach(function (p) { if (p.page === page || p.id === a.page) pg = p; });
    if (!pg) return err('page entry not found: ' + a.page);
    var g = confirmGuard(a, 'Page ' + pg.page + ' entry (' + (pg.topics || []).length + ' topics, ' + (pg.qs || []).length + ' questions) from source "' + s.name + '"', '');
    if (g) return g;
    s.pages = s.pages.filter(function (p) { return p !== pg; });
    stPersist(); stRefresh();
    return { ok: true, deleted_page: pg.page };
  }

  /* test.js:283-301 literal ka mirror — date DISPLAY string store hoti
     hai ("5 Nov 2026" jaisa), ye app ka apna format hai */
  function opAddTest(a) {
    var e = needST(); if (e) return e;
    if (!a) return err('args required');
    if (TEST_TYPES.indexOf(a.type) < 0) return err("type must be one of: " + TEST_TYPES.join(', '));
    var iso = validISO(a.date);
    if (!iso) return err('date is required as YYYY-MM-DD');
    var num = function (v) {
      var n = parseInt(v, 10);
      return isNaN(n) || n < 0 ? 0 : n;
    };
    var subRefs = [];
    var badSub = null;
    (Array.isArray(a.subjects) ? a.subjects : []).forEach(function (ref) {
      var s = findSubject(ref);
      if (!s) { badSub = ref; }
      else subRefs.push({ id: s.id, name: s.name });
    });
    if (badSub) return err('subject not found: ' + badSub);
    var chRefs = [];
    var badCh = null;
    (Array.isArray(a.chapters) ? a.chapters : []).forEach(function (p) {
      if (!p || !p.subject || !p.chapter) { badCh = JSON.stringify(p); return; }
      var s2 = findSubject(p.subject);
      if (!s2) { badCh = String(p.subject); return; }
      var c2 = findChapter(s2, p.chapter);
      if (!c2) { badCh = String(p.chapter); return; }
      chRefs.push({ subjectName: s2.name, name: c2.name });
    });
    if (badCh) return err('chapter not found: ' + badCh);
    var tests = Array.isArray(window.ST.state.tests) ? window.ST.state.tests : (window.ST.state.tests = []);
    var t = {
      id: uid(),
      name: (a.name && String(a.name).trim()) ? String(a.name).trim() : ('Test ' + (tests.length + 1)),
      date: fmtDateDisp(iso),
      type: a.type,
      subjects: subRefs,
      chapters: chRefs,
      totalQ: num(a.total_q),
      attempted: num(a.attempted),
      marksGot: num(a.marks_got),
      marksTotal: num(a.marks_total),
      rank: (a.rank !== undefined && a.rank !== null && String(a.rank) !== '') ? num(a.rank) : null,
      rankTotal: (a.rank_total !== undefined && a.rank_total !== null && String(a.rank_total) !== '') ? num(a.rank_total) : null
    };
    tests.push(t);
    stPersist(); stRefresh();
    return { ok: true, id: t.id, test: t };
  }

  /* error.js:312-334 ka mirror — ek (testId, q) ka sirf EK error hota
     hai; dobara bhejne par update hota hai (purana single-type field
     delete karke types array likhte hain) */
  function opAddMistake(a) {
    var e = needST(); if (e) return e;
    if (!a || !a.test || a.q === undefined) return err('test and q are required');
    var q = parseInt(a.q, 10);
    if (isNaN(q) || q <= 0) return err('q must be a positive question number');
    var types = (Array.isArray(a.types) ? a.types : []).filter(function (x) { return MISTAKE_TYPES.indexOf(x) >= 0; });
    if (!types.length) return err('types must be a non-empty array from: ' + MISTAKE_TYPES.join(' | '));
    var tests = Array.isArray(window.ST.state.tests) ? window.ST.state.tests : [];
    var t = null;
    var s = String(a.test).trim().toLowerCase();
    tests.forEach(function (x) {
      if (String(x.id).toLowerCase() === s || String(x.name).trim().toLowerCase() === s) t = x;
    });
    if (!t) tests.forEach(function (x) {
      if (!t && String(x.name).toLowerCase().indexOf(s) !== -1) t = x;
    });
    if (!t) return err('test not found: ' + a.test + ' (pehle achiva_add_test chalao ya get_state me tests dekho)');
    var errors = Array.isArray(window.ST.state.errors) ? window.ST.state.errors : (window.ST.state.errors = []);
    var ex = null;
    errors.forEach(function (x) { if (x.testId === t.id && x.q === q) ex = x; });
    var updated = false;
    if (ex) {
      ex.types = types;
      ex.desc = a.desc ? String(a.desc) : '';
      delete ex.type; /* legacy single-type field hatao */
      updated = true;
    } else {
      ex = {
        id: uid(), testId: t.id, q: q, types: types,
        desc: a.desc ? String(a.desc) : '',
        date: fmtDateDisp(todayISO())
      };
      errors.push(ex);
    }
    stPersist(); stRefresh();
    return { ok: true, id: ex.id, test: t.name, q: q, types: types, updated_existing: updated };
  }

  function revStepList(ch, list) {
    var r = ensureRev(ch);
    if (list === 'chapter') return r.chapterSteps;
    if (list === 'question') return r.questionSteps;
    return null;
  }

  function opAddRevisionStep(a) {
    var e = needST(); if (e) return e;
    if (!a || !a.subject || !a.chapter) return err('subject and chapter are required');
    if (a.list !== 'chapter' && a.list !== 'question') return err("list must be 'chapter' ya 'question'");
    if (!a.text || !String(a.text).trim()) return err('text is required');
    var sub = findSubject(a.subject);
    if (!sub) return err('subject not found: ' + a.subject);
    var ch = findChapter(sub, a.chapter);
    if (!ch) return err('chapter not found: ' + a.chapter);
    var list = revStepList(ch, a.list);
    var st = { id: uid(), text: String(a.text).trim() };
    list.push(st);
    stPersist(); stRefresh();
    return { ok: true, id: st.id, list: a.list, step: st };
  }

  function opUpdateRevisionStep(a) {
    var e = needST(); if (e) return e;
    if (!a || !a.subject || !a.chapter || !a.step) return err('subject, chapter and step are required');
    if (a.list !== 'chapter' && a.list !== 'question') return err("list must be 'chapter' ya 'question'");
    var sub = findSubject(a.subject);
    if (!sub) return err('subject not found: ' + a.subject);
    var ch = findChapter(sub, a.chapter);
    if (!ch) return err('chapter not found: ' + a.chapter);
    var list = revStepList(ch, a.list);
    var st = findStepIn(list, a.step);
    if (!st) return err('step not found: ' + a.step);
    if (!a.text || !String(a.text).trim()) return err('text is required');
    st.text = String(a.text).trim();
    stPersist(); stRefresh();
    return { ok: true, id: st.id, text: st.text, list: a.list };
  }

  function opDeleteRevisionStep(a) {
    var e = needST(); if (e) return e;
    if (!a || !a.subject || !a.chapter || !a.step) return err('subject, chapter and step are required');
    if (a.list !== 'chapter' && a.list !== 'question') return err("list must be 'chapter' ya 'question'");
    var sub = findSubject(a.subject);
    if (!sub) return err('subject not found: ' + a.subject);
    var ch = findChapter(sub, a.chapter);
    if (!ch) return err('chapter not found: ' + a.chapter);
    var list = revStepList(ch, a.list);
    var st = findStepIn(list, a.step);
    if (!st) return err('step not found: ' + a.step);
    var g = confirmGuard(a, 'Revision step "' + st.text + '"', 'list: ' + a.list);
    if (g) return g;
    var i = list.indexOf(st);
    if (i >= 0) list.splice(i, 1);
    stPersist(); stRefresh();
    return { ok: true, deleted: st.text };
  }

  /* rivision.js:272-284 completeRecall ka exact mirror — rating 1-5,
     history entry + agla revision pending set hota hai */
  function opCompleteRevision(a) {
    var e = needST(); if (e) return e;
    if (!a || !a.subject || !a.chapter) return err('subject and chapter are required');
    var rating = parseInt(a.rating, 10);
    if (isNaN(rating) || rating < 1 || rating > 5) return err('rating must be 1-5 (1 Worst ... 5 Perfect)');
    var sub = findSubject(a.subject);
    if (!sub) return err('subject not found: ' + a.subject);
    var ch = findChapter(sub, a.chapter);
    if (!ch) return err('chapter not found: ' + a.chapter);
    var r = ensureRev(ch);
    var n = r.pending ? r.pending.n : r.history.length + 1;
    var dateISO = todayISO();
    r.history.push({ n: n, date: dateISO, time: nowHm(), rating: rating });
    var sysDue = addDaysISO(dateISO, REV_GAPS[rating]);
    r.pending = { n: n + 1, systemDue: sysDue, due: sysDue };
    stPersist(); stRefresh();
    return {
      ok: true, subject: sub.name, chapter: ch.name,
      revision_number: n, rating: rating, rating_label: REV_RATING_LABEL[rating],
      next_revision: r.pending
    };
  }

  /* rivision.js:630-641 ka mirror — due sirf systemDue+2 din tak aage
     ja sakta hai (app ka cap); peeche kabhi bhi */
  function opSetRevisionDue(a) {
    var e = needST(); if (e) return e;
    if (!a || !a.subject || !a.chapter) return err('subject and chapter are required');
    var iso = validISO(a.date);
    if (!iso) return err('date is required as YYYY-MM-DD');
    var sub = findSubject(a.subject);
    if (!sub) return err('subject not found: ' + a.subject);
    var ch = findChapter(sub, a.chapter);
    if (!ch) return err('chapter not found: ' + a.chapter);
    var r = ensureRev(ch);
    if (!r.pending) return err('koi revision pending nahi hai — pehle achiva_complete_revision chalao');
    var maxDue = addDaysISO(r.pending.systemDue, REV_MAX_FORWARD_DAYS);
    var clamped = false;
    if (iso > maxDue) { iso = maxDue; clamped = true; }
    r.pending.due = iso;
    stPersist(); stRefresh();
    return { ok: true, subject: sub.name, chapter: ch.name, due: iso, clamped_to_max: clamped, system_due: r.pending.systemDue };
  }

  /* rivision.js:386-409 completeQRevision ka mirror — keys format:
     'imp:Q' (important), 'att:Q' (attempts), 'pg:PAGE:Q' (pages).
     Jo keys kisi source me match nahi hui unki report milti hai. */
  function opCompleteQuestionRevision(a) {
    var e = needST(); if (e) return e;
    if (!a || !a.subject || !a.chapter) return err('subject and chapter are required');
    if (!Array.isArray(a.keys) || !a.keys.length) return err('keys array is required, e.g. ["imp:5","att:12","pg:23:4"]');
    var want = {};
    a.keys.forEach(function (k) { want[String(k).trim()] = true; });
    var sub = findSubject(a.subject);
    if (!sub) return err('subject not found: ' + a.subject);
    var ch = findChapter(sub, a.chapter);
    if (!ch) return err('chapter not found: ' + a.chapter);
    ensureCh(ch);
    var r = ensureRev(ch);
    var sources = ch.sources;
    if (a.source) {
      var s0 = findSource(ch, a.source);
      if (!s0) return err('source not found: ' + a.source);
      sources = [s0];
    }
    var entries = [];
    var matched = 0;
    var unknown = [];
    sources.forEach(function (s) {
      var picked = [];
      sourceItemsOf(s).forEach(function (it) {
        if (!want[it.key]) return;
        picked.push(it);
        matched++;
        delete want[it.key];
        var m = r.itemCounts[s.id] || (r.itemCounts[s.id] = {});
        m[it.key] = (m[it.key] || 0) + 1;
      });
      if (picked.length) entries.push({ source: s.name, items: picked });
    });
    Object.keys(want).forEach(function (k) { unknown.push(k); });
    if (!matched) return err('koi question match nahi hua. Valid keys source ke important/attempts/pages se aati hain — get_state me sources dekho. Unknown: ' + unknown.join(', '));
    r.qHistory.push({
      n: r.qHistory.length + 1,
      date: todayISO(), time: nowHm(),
      entries: entries
    });
    stPersist(); stRefresh();
    return {
      ok: true, subject: sub.name, chapter: ch.name,
      revised: matched, unknown_keys: unknown,
      q_revision_number: r.qHistory.length, entries: entries
    };
  }

  /* exam-widget.js:195-228 ke mutations — exams apne storage key me
     hain (loadAt/saveAt safe hai; widget har render par reload karta
     hai) + ExamWidget.refresh() */
  function findExam(q) {
    var d = window.AppStorage.loadAt('achiva.exams.v1');
    if (!d || !Array.isArray(d.exams)) return { doc: null, exam: null };
    var s = String(q).trim().toLowerCase();
    var ex = null;
    for (var i = 0; i < d.exams.length; i++) {
      if (String(d.exams[i].id).toLowerCase() === s ||
          String(d.exams[i].name).trim().toLowerCase() === s) { ex = d.exams[i]; break; }
    }
    if (!ex) {
      for (var j = 0; j < d.exams.length; j++) {
        if (String(d.exams[j].name).toLowerCase().indexOf(s) !== -1) { ex = d.exams[j]; break; }
      }
    }
    return { doc: d, exam: ex };
  }

  function examRefresh() {
    try { if (window.ExamWidget && typeof window.ExamWidget.refresh === 'function') window.ExamWidget.refresh(); } catch (e) {}
    refreshDashboard();
  }

  function opUpdateExam(a) {
    if (!a || !a.exam) return err('exam is required (id ya naam)');
    var f = findExam(a.exam);
    if (!f.doc) return err('exams storage not readable');
    if (!f.exam) return err('exam not found: ' + a.exam);
    var changed = {};
    if (a.name && String(a.name).trim()) { f.exam.name = String(a.name).trim(); changed.name = f.exam.name; }
    if (a.date !== undefined) {
      var iso = validISO(a.date);
      if (!iso) return err('date must be YYYY-MM-DD');
      var t = validHM(a.time) || '09:00';
      var tp = t.split(':');
      var p = iso.split('-');
      f.exam.dt = new Date(+p[0], (+p[1]) - 1, +p[2], +tp[0], +tp[1], 0, 0).getTime();
      changed.date = iso; changed.time = t;
    }
    window.AppStorage.saveAt('achiva.exams.v1', f.doc);
    examRefresh();
    return { ok: true, id: f.exam.id, changed: changed, exam: f.exam };
  }

  function opDeleteExam(a) {
    if (!a || !a.exam) return err('exam is required (id ya naam)');
    var f = findExam(a.exam);
    if (!f.doc) return err('exams storage not readable');
    if (!f.exam) return err('exam not found: ' + a.exam);
    var g = confirmGuard(a, 'Exam "' + f.exam.name + '"', '');
    if (g) return g;
    f.doc.exams = f.doc.exams.filter(function (x) { return x !== f.exam; });
    window.AppStorage.saveAt('achiva.exams.v1', f.doc);
    examRefresh();
    return { ok: true, deleted: f.exam.name };
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
      add_thought: opAddThought,
      /* ---- subject tracker v2 ---- */
      update_subject: opUpdateSubject,
      delete_subject: opDeleteSubject,
      update_chapter: opUpdateChapter,
      delete_chapter: opDeleteChapter,
      add_step: opAddStep,
      update_step: opUpdateStep,
      delete_step: opDeleteStep,
      add_step_template: opAddStepTemplate,
      update_step_template: opUpdateStepTemplate,
      delete_step_template: opDeleteStepTemplate,
      move_step_template: opMoveStepTemplate,
      add_topic: opAddTopic,
      update_topic: opUpdateTopic,
      set_topic_notes: opSetTopicNotes,
      delete_topic: opDeleteTopic,
      add_source: opAddSource,
      update_source: opUpdateSource,
      delete_source: opDeleteSource,
      set_source_questions: opSetSourceQuestions,
      add_source_attempts: opAddSourceAttempts,
      delete_source_attempts: opDeleteSourceAttempts,
      add_source_page: opAddSourcePage,
      delete_source_page: opDeleteSourcePage,
      add_test: opAddTest,
      add_mistake: opAddMistake,
      add_revision_step: opAddRevisionStep,
      update_revision_step: opUpdateRevisionStep,
      delete_revision_step: opDeleteRevisionStep,
      complete_revision: opCompleteRevision,
      set_revision_due: opSetRevisionDue,
      complete_question_revision: opCompleteQuestionRevision,
      update_exam: opUpdateExam,
      delete_exam: opDeleteExam
    };
    return {
      version: 2,
      ops: Object.keys(METHODS),
      ping: function () {
        return {
          ok: true,
          version: 2,
          appStorage: true,
          taskFeature: !!window.TaskFeature,
          st: !!window.ST,
          goalStore: !!window.GoalStore,
          goodList: !!window.GoodList,
          badList: !!window.BadList,
          thoughtStore: !!window.ThoughtStore,
          subjectSetting: !!window.SubjectSetting,
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
