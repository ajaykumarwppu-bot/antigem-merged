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

  /* ---- get_state helpers (v3 speed) ---- */

  /* kisi bhi subjects[] list me id/(partial) naam se dhoondo
     (findSubject ka reusable version — wo ST.state par fixed hai) */
  function findSubjectIn(list, q) {
    if (!q || !Array.isArray(list)) return null;
    var s = String(q).trim().toLowerCase();
    for (var i = 0; i < list.length; i++) {
      if (String(list[i].id).toLowerCase() === s || String(list[i].name).trim().toLowerCase() === s) return list[i];
    }
    for (var j = 0; j < list.length; j++) {
      if (String(list[j].name).toLowerCase().indexOf(s) !== -1) return list[j];
    }
    return null;
  }

  /* topic tree ko flat [ {id, name, tag, done} ] me (DFS — jaise app
     list dikhata hai). notes/children detail light mode me NAHI jaati. */
  function flatTopicsLite(nodes, out) {
    (Array.isArray(nodes) ? nodes : []).forEach(function (t) {
      if (!t || typeof t !== 'object') return;
      out.push({ id: t.id, name: t.name, tag: t.tag || '', done: !!t.done });
      flatTopicsLite(t.children, out);
    });
    return out;
  }

  /* LIGHT subjects view — structure + ids + names + counts, no notes /
     question arrays. get_state ka result kai guna chhota. */
  function lightSubjects(blob, subjectQuery) {
    var subs = (blob && Array.isArray(blob.subjects)) ? blob.subjects : [];
    if (subjectQuery) {
      var m = findSubjectIn(subs, subjectQuery);
      subs = m ? [m] : [];
    }
    return { subjects: subs.map(function (s) {
      return {
        id: s.id, name: s.name, cat: s.cat || null,
        chapters: (Array.isArray(s.chapters) ? s.chapters : []).map(function (c) {
          ensureCh(c);
          var r = (c.revision && typeof c.revision === 'object') ? c.revision : null;
          return {
            id: c.id, name: c.name, priority: c.priority, status: c.status,
            start_date: c.startDate, end_date: c.endDate,
            steps: (c.steps || []).map(function (x) { return { id: x.id, text: x.text, done: !!x.done }; }),
            masterySteps: (c.masterySteps || []).map(function (x) { return { id: x.id, text: x.text, done: !!x.done }; }),
            topics: flatTopicsLite(c.topics, []),
            sources: (c.sources || []).map(function (s2) {
              ensureSource(s2);
              return {
                id: s2.id, name: s2.name, total: s2.total, category: s2.category,
                solved: s2.solved.length, doubt: s2.doubt.length,
                doubt_solved: (s2.doubtSolved || []).length,
                analysis: s2.analysis.length, important: s2.important.length,
                attempts: (s2.attempts || []).map(function (g) { return { attempts: g.attempts, count: (g.qs || []).length }; }),
                pages: (s2.pages || []).map(function (p) { return { page: p.page, topics: (p.topics || []).length, qs: (p.qs || []).length }; })
              };
            }),
            revision: {
              pending: r ? (r.pending || null) : null,
              history: r ? (r.history || []).length : 0,
              qHistory: r ? (r.qHistory || []).length : 0,
              chapterSteps: r ? (r.chapterSteps || []).map(function (x) { return { id: x.id, text: x.text }; }) : [],
              questionSteps: r ? (r.questionSteps || []).map(function (x) { return { id: x.id, text: x.text }; }) : []
            }
          };
        })
      };
    }) };
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
      },
      /* v4: baaki features ke stores (light views) */
      focus: function () {
        var F = window.AchivaFocus;
        if (!F || typeof F.rules !== 'function') return null;
        var perm = null, run = false, strict = 'normal';
        try { perm = F.permissions(); } catch (e) { }
        try { run = !!F.running(); } catch (e) { }
        try { strict = F.strictLevel(); } catch (e) { }
        return { rules: F.rules(), settings: F.settings(), strict: strict, permissions: perm, running: run };
      },
      canvases: function () {
        var arr = canvasList();
        return arr.map(function (c) {
          return {
            id: c.id, name: c.name, category: c.category || null, goalId: c.goalId || null,
            cards: (c.cards || []).map(function (k) {
              return {
                id: k.id, text: k.text,
                tag: k.tag ? { type: k.tag.type, date: k.tag.date || null, from: k.tag.from || null, to: k.tag.to || null, done: k.tag.done === true } : null
              };
            }),
            lines: (c.lines || []).length, groups: (c.groups || []).length
          };
        });
      },
      thoughtCats: function () {
        var G = window.ThoughtGraph;
        if (!G || typeof G.allCats !== 'function') return [];
        return G.allCats().map(function (c) { return { id: c.id, name: c.name, parent: c.parent || null }; });
      }
    };

    var want = Array.isArray(a.keys) && a.keys.length ? a.keys : Object.keys(domains);
    var data = {};
    for (var i = 0; i < want.length; i++) {
      var k = String(want[i]);
      if (domains[k]) data[k] = domains[k]();
    }

    /* SPEED: light=true → subjects ka COMPACT view (ids/names/fields/
       counts — question number arrays, notes text, steps ka detail hatao).
       Result 5-10x chhota → agent ke context tokens bahut kam.
       subject=<id/naam> → sirf usi subject ka detail (light ke saath bhi
       chalega — light poora chhota dega, subject-filter usi par bhi). */
    if (data.subjects) {
      if (a.light) data.subjects = lightSubjects(data.subjects, a.subject);
      else if (a.subject) {
        var only = findSubjectIn((data.subjects && data.subjects.subjects) || [], a.subject);
        data.subjects = { subjects: only ? [only] : [] };
      }
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
    try {
      var gd = domains.goodHabits(), bd = domains.badHabits();
      summary.goodHabits = Array.isArray(gd) ? gd.length : 0;
      summary.badHabits = Array.isArray(bd) ? bd.length : 0;
    } catch (e) {}
    try {
      var th = domains.thoughts();
      summary.thoughts = Array.isArray(th) ? th.length : 0;
      summary.thoughtCats = (data.thoughtCats || []).length;
    } catch (e) {}
    try {
      var cv = data.canvases || [];
      summary.canvases = cv.length;
    } catch (e) {}
    try {
      var fz = data.focus;
      summary.focusRules = fz && Array.isArray(fz.rules) ? fz.rules.filter(function (r) { return r && r.active !== false; }).length : 0;
    } catch (e) {}

    return { ok: true, summary: summary, data: data };
  }

  /* opAddTask / opToggleTask ab FEATURES v4 section me hain —
     add_tasks (bulk+single) aur toggle_task (bulk+name+done) use karo */

  function opAddSubject(a) {
    if (!a || !a.name || !String(a.name).trim()) return err('name is required');
    if (!window.ST || !window.ST.state) return err('subject tracker (window.ST) is not loaded');
    var cat = null;
    if (a.category === 'jee' || a.category === 'boards') cat = a.category;
    var specs = [];
    if (a.chapters !== undefined && a.chapters !== null) {
      var pr = parseChapterSpecs(a.chapters);
      if (pr.error) return err(pr.error);
      specs = pr.specs;
    }
    /* pehle SAB chapters local sub object me banao — kisi spec me error
       to subject push hi nahi hoga (atomic) */
    var sub = { id: uid(), name: String(a.name).trim(), chapters: [], cat: cat };
    for (var i = 0; i < specs.length; i++) {
      var r = createChapterFromSpec(sub, specs[i]);
      if (r.error) return err('chapters[' + i + ']: ' + r.error);
    }
    window.ST.state.subjects.push(sub);
    window.ST.persist();
    return { ok: true, id: sub.id, name: sub.name, cat: sub.cat, chapters_added: sub.chapters.length };
  }

  function opAddChapter(a) {
    if (!a || !a.name || !String(a.name).trim()) return err('name is required');
    if (!a.subject) return err('subject is required (id ya naam)');
    if (!window.ST || !window.ST.state) return err('subject tracker (window.ST) is not loaded');
    var sub = findSubject(a.subject);
    if (!sub) return err('subject not found: ' + a.subject);
    if (!Array.isArray(sub.chapters)) sub.chapters = [];
    var r = createChapterFromSpec(sub, a);
    if (r.error) return err(r.error);
    window.ST.persist();
    return { ok: true, id: r.ch.id, name: r.ch.name, subject: sub.name, priority: r.ch.priority, status: r.ch.status, start_date: r.ch.startDate, end_date: r.ch.endDate };
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

  /* opAddGoal / opAddHabit ab FEATURES v4 section me hain —
     bulk goals[]/habits[] + poore fields (dates, type, slots) support karte hain */

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

  /* opAddThought ab FEATURES v4 section me hai (cats[] + summary support) */

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

  /* BULK-SPEED: bulk ops ke loop ke dauran persist suppress karo — end
     mein EK baar save (state bada ho to N baar JSON.stringify mehnga hai) */
  var persistSuppressed = 0;
  function beginBulk() { persistSuppressed++; }
  function endBulk() {
    if (persistSuppressed > 0) persistSuppressed--;
    if (persistSuppressed === 0) stPersist();
  }
  function stPersist() {
    if (persistSuppressed > 0) return true;
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
    return { ok: true, id: sub.id, name: sub.name, changed: changed };
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
    var e2 = applyChapterFields(ch, a, changed);
    if (e2) return err(e2);
    stPersist(); stRefresh();
    return { ok: true, id: ch.id, name: ch.name, subject: sub.name, changed: changed };
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

  /* ---------------- chapter field helpers (add/update/bulk shared) --------
     applyChapterFields: sirf diye gaye fields validate karke lagata hai.
     Return null = success, string = error (caller err() kare).
     Validation pehle hoti hai, tabhi mutation — add paths ATOMIC rahenge. */
  function validateChapterFields(a) {
    if (a.priority !== undefined && a.priority !== null &&
        ['Low', 'Medium', 'High'].indexOf(a.priority) < 0) {
      return "priority must be 'Low', 'Medium' or 'High'";
    }
    if (a.status !== undefined && a.status !== null &&
        ['Not Started', 'In Progress', 'Completed'].indexOf(a.status) < 0) {
      return "status must be 'Not Started', 'In Progress' or 'Completed'";
    }
    if (a.start_date !== undefined && a.start_date !== null && a.start_date !== '' &&
        a.start_date !== 'clear' && !validISO(a.start_date)) {
      return 'start_date must be YYYY-MM-DD (ya null/clear)';
    }
    if (a.end_date !== undefined && a.end_date !== null && a.end_date !== '' &&
        a.end_date !== 'clear' && !validISO(a.end_date)) {
      return 'end_date must be YYYY-MM-DD (ya null/clear)';
    }
    return null;
  }

  function applyChapterFields(ch, a, changed) {
    var e0 = validateChapterFields(a);
    if (e0) return e0;
    if (a.name !== undefined && a.name !== null && String(a.name).trim()) {
      ch.name = String(a.name).trim(); if (changed) changed.name = ch.name;
    }
    if (a.priority !== undefined && a.priority !== null) {
      ch.priority = a.priority; if (changed) changed.priority = a.priority;
    }
    if (a.status !== undefined && a.status !== null) {
      ch.status = a.status; if (changed) changed.status = a.status;
    }
    if (a.start_date !== undefined) {
      ch.startDate = (a.start_date === null || a.start_date === '' || a.start_date === 'clear')
        ? null : validISO(a.start_date);
      if (changed) changed.start_date = ch.startDate;
    }
    if (a.end_date !== undefined) {
      ch.endDate = (a.end_date === null || a.end_date === '' || a.end_date === 'clear')
        ? null : validISO(a.end_date);
      if (changed) changed.end_date = ch.endDate;
    }
    return null;
  }

  /* chapters[] entries normalize: string YA {name, priority?, status?,
     start_date?, end_date?, complete_steps?, mastery_steps?} */
  function parseChapterSpecs(raw) {
    if (!Array.isArray(raw)) return { error: 'chapters must be an array (strings ya {name,...} objects)' };
    var specs = [];
    for (var i = 0; i < raw.length; i++) {
      var e = raw[i];
      var nm = (typeof e === 'string') ? e.trim() : (e && e.name ? String(e.name).trim() : '');
      if (!nm) return { error: 'chapters[' + i + ']: name is required' };
      var spec = { name: nm };
      if (e && typeof e === 'object') {
        spec.priority = e.priority; spec.status = e.status;
        spec.start_date = e.start_date; spec.end_date = e.end_date;
        spec.complete_steps = (e.complete_steps !== undefined) ? e.complete_steps : e.steps;
        spec.mastery_steps = e.mastery_steps;
      }
      specs.push(spec);
    }
    return { specs: specs };
  }

  /* ek spec se chapter banao (fields + roadmap steps). Return {ch} ya
     {error}. Caller pehle validate kar chuka ho to error kabhi nahi milega.
     NOTE: sub.chapters.push LAST mein — error par kuch nahi joda gaya. */
  function createChapterFromSpec(sub, spec) {
    var e0 = validateChapterFields(spec);
    if (e0) return { error: e0 };
    var ch = { id: uid(), name: String(spec.name).trim() };
    ensureCh(ch);
    var e1 = applyChapterFields(ch, spec, null);
    if (e1) return { error: e1 };
    (Array.isArray(spec.complete_steps) ? spec.complete_steps : []).forEach(function (t) {
      var s = String(t).trim(); if (s) ch.steps.push({ id: uid(), text: s, done: false });
    });
    (Array.isArray(spec.mastery_steps) ? spec.mastery_steps : []).forEach(function (t) {
      var s = String(t).trim(); if (s) ch.masterySteps.push({ id: uid(), text: s, done: false });
    });
    sub.chapters.push(ch);
    return { ch: ch };
  }

  /* BULK: existing subject me ek se zyada chapters, poore fields ke
     saath — EK call me (speed: N round trips → 1) */
  function opAddChapters(a) {
    var e = needST(); if (e) return e;
    if (!a || !a.subject) return err('subject is required (id ya naam)');
    var sub = findSubject(a.subject);
    if (!sub) return err('subject not found: ' + a.subject);
    if (!Array.isArray(sub.chapters)) sub.chapters = [];
    var pr = parseChapterSpecs(a.chapters);
    if (pr.error) return err(pr.error);
    if (!pr.specs.length) return err('chapters array is required (strings ya {name,...} objects)');
    /* ATOMIC: pehle sab validate + banao local array me, phir ek saath jodo */
    var made = [];
    for (var i = 0; i < pr.specs.length; i++) {
      var probe = { id: uid(), name: pr.specs[i].name };
      ensureCh(probe);
      var e2 = applyChapterFields(probe, pr.specs[i], null);
      if (e2) return err('chapters[' + i + ']: ' + e2);
      made.push(pr.specs[i]);
    }
    var added = [];
    beginBulk();
    try {
      made.forEach(function (sp) {
        var r = createChapterFromSpec(sub, sp);
        if (r.ch) added.push({ id: r.ch.id, name: r.ch.name });
      });
    } finally { endBulk(); }
    stRefresh();
    return { ok: true, subject: sub.name, added: added, count: added.length };
  }

  /* BULK steps: roadmap (complete/mastery) YA revision checklist
     (rev_chapter/rev_question) me ek se zyada steps EK call me */
  function opAddSteps(a) {
    var e = needST(); if (e) return e;
    if (!a || !a.subject || !a.chapter) return err('subject and chapter are required');
    var listKey = null;
    if (a.list === 'complete' || a.list === 'mastery') listKey = a.list;
    else if (a.list === 'rev_chapter' || a.list === 'revision_chapter') listKey = 'rev_chapter';
    else if (a.list === 'rev_question' || a.list === 'revision_question') listKey = 'rev_question';
    if (!listKey) return err("list must be one of: complete | mastery | rev_chapter | rev_question");
    var texts = [];
    if (Array.isArray(a.texts)) texts = a.texts;
    else if (a.text && String(a.text).trim()) texts = [a.text];
    texts = texts.map(function (x) { return String(x).trim(); }).filter(function (x) { return x; });
    if (!texts.length) return err('text ya texts[] is required');
    var sub = findSubject(a.subject);
    if (!sub) return err('subject not found: ' + a.subject);
    var ch = findChapter(sub, a.chapter);
    if (!ch) return err('chapter not found: ' + a.chapter);
    var target, isRev = (listKey === 'rev_chapter' || listKey === 'rev_question');
    if (isRev) {
      ensureRev(ch);
      target = (listKey === 'rev_question') ? ch.revision.questionSteps : ch.revision.chapterSteps;
    } else {
      ensureCh(ch);
      target = (listKey === 'mastery') ? ch.masterySteps : ch.steps;
    }
    var idx = parseInt(a.index, 10);
    var hasIdx = !isNaN(idx) && idx >= 0 && idx <= target.length;
    var added = [];
    beginBulk();
    try {
      texts.forEach(function (t) {
        var st = isRev ? { id: uid(), text: t } : { id: uid(), text: t, done: false };
        if (hasIdx) { target.splice(idx, 0, st); idx++; }
        else target.push(st);
        added.push({ id: st.id, text: st.text });
      });
    } finally { endBulk(); }
    stRefresh();
    return { ok: true, list: listKey, chapter: ch.name, subject: sub.name, added: added, count: added.length };
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
    var texts = [];
    if (Array.isArray(a.texts)) texts = a.texts;
    else if (a.text && String(a.text).trim()) texts = [a.text];
    texts = texts.map(function (x) { return String(x).trim(); }).filter(function (x) { return x; });
    if (!texts.length) return err('text ya texts[] is required');
    var added = [], bad = [];
    texts.forEach(function (t) {
      var st = window.SubjectSetting.addStep(a.key, t);
      if (st) added.push({ id: st.id, text: st.text }); else bad.push(t);
    });
    refreshDashboard();
    if (!added.length) return err('template step add nahi hua');
    return { ok: true, key: a.key, added: added, count: added.length, failed: bad, synced_to_all_chapters: true };
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
    /* entries: string YA {name, tag} — per-topic tag ab ek hi call me */
    var raw = [];
    if (Array.isArray(a.names)) raw = a.names;
    else if (a.name && String(a.name).trim()) raw = [a.name];
    var entries = [];
    for (var i = 0; i < raw.length; i++) {
      var e0 = raw[i];
      if (e0 && typeof e0 === 'object') {
        var nm = e0.name ? String(e0.name).trim() : '';
        if (!nm) return err('names[' + i + ']: name is required');
        var tg = (e0.tag === undefined || e0.tag === null) ? '' : String(e0.tag);
        if (['', 'imp', 'vvi'].indexOf(tg) < 0) return err("names[" + i + "]: tag must be '', 'imp' ya 'vvi'");
        entries.push({ name: nm, tag: tg });
      } else {
        var s0 = String(e0 || '').trim();
        if (s0) entries.push({ name: s0, tag: ['', 'imp', 'vvi'].indexOf(a.tag) >= 0 ? a.tag : '' });
      }
    }
    if (!entries.length) return err('name ya names[] is required');
    var sub = findSubject(a.subject);
    if (!sub) return err('subject not found: ' + a.subject);
    var ch = findChapter(sub, a.chapter);
    if (!ch) return err('chapter not found: ' + a.chapter);
    ensureCh(ch);
    var target = ch.topics;
    if (a.parent_topic) {
      var p = findTopic(ch, a.parent_topic);
      if (!p) return err('parent topic not found: ' + a.parent_topic);
      target = p.children;
    }
    var added = [];
    beginBulk();
    try {
      entries.forEach(function (en) {
        var node = { id: uid(), name: en.name, done: false, tag: en.tag, children: [] };
        target.push(node);
        added.push({ id: node.id, name: node.name, tag: node.tag });
      });
    } finally { endBulk(); }
    stRefresh();
    return { ok: true, added: added, count: added.length, under_parent: a.parent_topic || null, chapter: ch.name };
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
    return { ok: true, id: s.id, name: s.name, total: s.total, category: s.category, chapter: ch.name };
  }

  /* BULK: ek chapter me ek se zyada sources EK call me */
  function opAddSources(a) {
    var e = needST(); if (e) return e;
    if (!a || !a.subject || !a.chapter) return err('subject and chapter are required');
    var sub = findSubject(a.subject);
    if (!sub) return err('subject not found: ' + a.subject);
    var ch = findChapter(sub, a.chapter);
    if (!ch) return err('chapter not found: ' + a.chapter);
    ensureCh(ch);
    var raw = Array.isArray(a.sources) ? a.sources : null;
    if (!raw || !raw.length) return err('sources array is required, e.g. [{name:"DC Pandey", total:300, category:"Normal"}]');
    var specs = [];
    for (var i = 0; i < raw.length; i++) {
      var e0 = raw[i];
      var nm = (e0 && e0.name) ? String(e0.name).trim() : '';
      if (!nm) return err('sources[' + i + ']: name is required');
      var total = parseInt(e0 && e0.total, 10);
      if (isNaN(total) || total < 0) total = 0;
      var cat = (e0 && e0.category === 'PYQ') ? 'PYQ' : 'Normal';
      specs.push({ name: nm, total: total, category: cat });
    }
    var added = [];
    beginBulk();
    try {
      specs.forEach(function (sp) {
        var s = {
          id: uid(), name: sp.name, total: sp.total, category: sp.category,
          solved: [], doubt: [], analysis: [], important: [],
          attempts: [], pages: []
        };
        ch.sources.push(s);
        added.push({ id: s.id, name: s.name, total: s.total, category: s.category });
      });
    } finally { endBulk(); }
    stRefresh();
    return { ok: true, chapter: ch.name, added: added, count: added.length };
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
    /* FIX: schema kehta hai "Default: add" — ab JS bhi wahi karta hai
       (pehle mode missing par error aata tha, agent phas jata tha) */
    var mode = (a.mode === undefined || a.mode === null || a.mode === '') ? 'add' : a.mode;
    if (['set', 'add', 'remove'].indexOf(mode) < 0) return err("mode must be 'set', 'add' ya 'remove'");
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
    if (mode === 'set') s[key] = qs.slice();
    else if (mode === 'add') s[key] = sortedUniqueNums(s[key].concat(qs));
    else s[key] = s[key].filter(function (n) { return qs.indexOf(n) === -1; });
    /* doubtSolved logically doubt ka subset hota hai — doubt se hataya
       to doubtSolved se bhi hatao (doubt.js toggle behaviour) */
    if (a.list === 'doubt' && (mode === 'set' || mode === 'remove')) {
      if (!Array.isArray(s.doubtSolved)) s.doubtSolved = [];
      s.doubtSolved = s.doubtSolved.filter(function (n) { return s.doubt.indexOf(n) !== -1; });
    }
    stPersist(); stRefresh();
    return { ok: true, source: s.name, list: a.list, mode: mode, count: s[key].length, added: s[key].length - before };
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
    /* SPEED: test + saari galtiyan EK call me (mock ke baad 10 galtiyan =
       abhi 11 round trips → 1) */
    var mistakesAdded = 0, mistakesUpdated = 0, mistakeErrors = [];
    if (Array.isArray(a.mistakes) && a.mistakes.length) {
      a.mistakes.forEach(function (m, i) {
        if (!m) { mistakeErrors.push('mistakes[' + i + ']: empty entry'); return; }
        var r = addMistakeCore(t, m.q, m.types, m.desc);
        if (r.error) mistakeErrors.push('mistakes[' + i + ']: ' + r.error);
        else if (r.updated_existing) mistakesUpdated++;
        else mistakesAdded++;
      });
    }
    stPersist(); stRefresh();
    return { ok: true, id: t.id, name: t.name, date: t.date, type: t.type,
             mistakes_added: mistakesAdded, mistakes_updated: mistakesUpdated,
             mistake_errors: mistakeErrors };
  }

  /* opAddMistake ka core — single + bulk + add_test-inline teeno isi se.
     Persist NAHI karta (caller ek hi baar save kare). Return object ya
     {error: '...'} */
  function addMistakeCore(t, qRaw, rawTypes, desc) {
    var q = parseInt(qRaw, 10);
    if (isNaN(q) || q <= 0) return { error: 'q must be a positive question number' };
    var types = (Array.isArray(rawTypes) ? rawTypes : []).filter(function (x) { return MISTAKE_TYPES.indexOf(x) >= 0; });
    if (!types.length) return { error: 'types must be a non-empty array from: ' + MISTAKE_TYPES.join(' | ') };
    var errors = Array.isArray(window.ST.state.errors) ? window.ST.state.errors : (window.ST.state.errors = []);
    var ex = null;
    errors.forEach(function (x) { if (x.testId === t.id && x.q === q) ex = x; });
    var updated = false;
    if (ex) {
      ex.types = types;
      ex.desc = desc ? String(desc) : '';
      delete ex.type; /* legacy single-type field hatao */
      updated = true;
    } else {
      ex = {
        id: uid(), testId: t.id, q: q, types: types,
        desc: desc ? String(desc) : '',
        date: fmtDateDisp(todayISO())
      };
      errors.push(ex);
    }
    return { id: ex.id, q: q, types: types, updated_existing: updated };
  }

  function findTestRef(q) {
    var tests = Array.isArray(window.ST.state.tests) ? window.ST.state.tests : [];
    var t = null;
    var s = String(q).trim().toLowerCase();
    tests.forEach(function (x) {
      if (String(x.id).toLowerCase() === s || String(x.name).trim().toLowerCase() === s) t = x;
    });
    if (!t) tests.forEach(function (x) {
      if (!t && String(x.name).toLowerCase().indexOf(s) !== -1) t = x;
    });
    return t;
  }

  /* error.js:312-334 ka mirror — ek (testId, q) ka sirf EK error hota
     hai; dobara bhejne par update hota hai. BULK: mistakes[] array. */
  function opAddMistake(a) {
    var e = needST(); if (e) return e;
    if (!a || !a.test) return err('test is required (id ya naam)');
    var t = findTestRef(a.test);
    if (!t) return err('test not found: ' + a.test + ' (pehle achiva_add_test chalao ya get_state me tests dekho)');
    if (Array.isArray(a.mistakes) && a.mistakes.length) {
      var results = [], errs = [];
      a.mistakes.forEach(function (m, i) {
        if (!m) { errs.push('mistakes[' + i + ']: empty entry'); return; }
        var r = addMistakeCore(t, m.q, m.types, m.desc);
        if (r.error) errs.push('mistakes[' + i + ']: ' + r.error);
        else results.push(r);
      });
      stPersist(); stRefresh();
      return { ok: true, test: t.name, results: results, errors: errs,
               added: results.filter(function (r) { return !r.updated_existing; }).length,
               updated: results.filter(function (r) { return r.updated_existing; }).length };
    }
    if (a.q === undefined) return err('q is required (ya mistakes[] array bhejo)');
    var r1 = addMistakeCore(t, a.q, a.types, a.desc);
    if (r1.error) return err(r1.error);
    stPersist(); stRefresh();
    return { ok: true, id: r1.id, test: t.name, q: r1.q, types: r1.types, updated_existing: r1.updated_existing };
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

  /* ================================================================
     GENERIC update — EK tool, sab targets (speed: kam schemas, kam
     trips). target: subject | chapter | step | step_template | topic |
     source | revision_step | exam. Bulk: step/topic targets par
     steps[]/topics[] arrays (e.g. 8 roadmap steps tick = 1 call).
     Internally wahi purane ops ka logic chalta hai — behaviour same.
     ================================================================ */
  function opUpdate(a) {
    var e = needST(); if (e) return e;
    if (!a || !a.target) {
      return err("target is required: subject | chapter | step | step_template | topic | source | revision_step | exam");
    }
    var t = String(a.target);

    if (t === 'chapter') {
      if (!a.subject) return err('subject is required');
      if (!a.chapter) return err('chapter is required');
      var sub = findSubject(a.subject);
      if (!sub) return err('subject not found: ' + a.subject);
      var ch = findChapter(sub, a.chapter);
      if (!ch) return err('chapter not found: ' + a.chapter);
      ensureCh(ch);
      var changed = {};
      var e2 = applyChapterFields(ch, a, changed);
      if (e2) return err(e2);
      stPersist(); stRefresh();
      return { ok: true, target: 'chapter', id: ch.id, name: ch.name, subject: sub.name, changed: changed };
    }

    if (t === 'step') {
      if (!a.subject || !a.chapter) return err('subject and chapter are required');
      var listKey = (a.list === 'mastery') ? 'mastery' : (a.list === 'complete' ? 'complete' : null);
      if (!listKey) return err("list must be 'complete' ya 'mastery'");
      var sub2 = findSubject(a.subject);
      if (!sub2) return err('subject not found: ' + a.subject);
      var ch2 = findChapter(sub2, a.chapter);
      if (!ch2) return err('chapter not found: ' + a.chapter);
      var list = (listKey === 'mastery') ? ensureCh(ch2) && ch2.masterySteps : (ensureCh(ch2), ch2.steps);
      var refs = Array.isArray(a.steps) ? a.steps : [a.step];
      if (!refs.length || (refs.length === 1 && !refs[0])) return err('step ya steps[] is required (id ya partial text)');
      var results = [], errs = [];
      beginBulk();
      try {
        refs.forEach(function (ref, i) {
          var st = ref ? findStepIn(list, ref) : null;
          if (!st) { errs.push('steps[' + i + ']: step not found: ' + ref); return; }
          var c = {};
          if (a.text && String(a.text).trim()) { st.text = String(a.text).trim(); c.text = st.text; }
          if (a.done !== undefined) { st.done = !!a.done; c.done = st.done; }
          results.push({ id: st.id, text: st.text, changed: c });
        });
      } finally { endBulk(); }
      stRefresh();
      if (!results.length) return err(errs.join('; ') || 'koi step update nahi hua');
      return { ok: true, target: 'step', list: listKey, chapter: ch2.name, updated: results.length, results: results, errors: errs };
    }

    if (t === 'topic') {
      if (!a.subject || !a.chapter) return err('subject and chapter are required');
      var sub3 = findSubject(a.subject);
      if (!sub3) return err('subject not found: ' + a.subject);
      var ch3 = findChapter(sub3, a.chapter);
      if (!ch3) return err('chapter not found: ' + a.chapter);
      var refs3 = Array.isArray(a.topics) ? a.topics : [a.topic];
      if (!refs3.length || (refs3.length === 1 && !refs3[0])) return err('topic ya topics[] is required');
      var results3 = [], errs3 = [];
      beginBulk();
      try {
        refs3.forEach(function (ref, i) {
          var n = ref ? findTopic(ch3, ref) : null;
          if (!n) { errs3.push('topics[' + i + ']: topic not found: ' + ref); return; }
          var c = {};
          if (a.name && String(a.name).trim()) { n.name = String(a.name).trim(); c.name = n.name; }
          if (a.tag !== undefined) {
            if (['', 'imp', 'vvi'].indexOf(a.tag) < 0) { errs3.push("topics[" + i + "]: tag must be '', 'imp' ya 'vvi'"); return; }
            n.tag = a.tag; c.tag = a.tag;
          }
          if (a.done !== undefined) { setTopicDone(n, !!a.done); c.done = !!a.done; c.done_applies_to_subtree = true; }
          results3.push({ id: n.id, name: n.name, changed: c });
        });
      } finally { endBulk(); }
      stRefresh();
      if (!results3.length) return err(errs3.join('; ') || 'koi topic update nahi hua');
      return { ok: true, target: 'topic', chapter: ch3.name, updated: results3.length, results: results3, errors: errs3 };
    }

    if (t === 'subject') {
      var r4 = opUpdateSubject({ subject: a.subject, name: a.name, cat: a.cat });
      if (!r4.ok) return r4;
      r4.target = 'subject'; return r4;
    }

    if (t === 'step_template') {
      var key = a.key || a.list;
      if (a.dir !== undefined) {
        var r5 = opMoveStepTemplate({ key: key, id: a.id, dir: a.dir });
        if (!r5.ok) return r5;
        r5.target = 'step_template'; return r5;
      }
      var r6 = opUpdateStepTemplate({ key: key, id: a.id, text: a.text });
      if (!r6.ok) return r6;
      r6.target = 'step_template'; return r6;
    }

    if (t === 'source') {
      var r7 = opUpdateSource({ subject: a.subject, chapter: a.chapter, source: a.source, name: a.name, total: a.total, category: a.category });
      if (!r7.ok) return r7;
      r7.target = 'source'; return r7;
    }

    if (t === 'revision_step') {
      var rl = (a.list === 'question' || a.list === 'rev_question' || a.list === 'revision_question') ? 'question'
             : (a.list === 'chapter' || a.list === 'rev_chapter' || a.list === 'revision_chapter') ? 'chapter' : null;
      if (!rl) return err("list must be 'chapter' ya 'question'");
      var r8 = opUpdateRevisionStep({ subject: a.subject, chapter: a.chapter, list: rl, step: a.step, text: a.text });
      if (!r8.ok) return r8;
      r8.target = 'revision_step'; return r8;
    }

    if (t === 'exam') {
      var r9 = opUpdateExam({ exam: a.exam || a.id, name: a.name, date: a.date, time: a.time });
      if (!r9.ok) return r9;
      r9.target = 'exam'; return r9;
    }

    return err("unknown target: " + t + " (valid: subject | chapter | step | step_template | topic | source | revision_step | exam)");
  }

  /* ================================================================
     GENERIC delete — EK tool, sab targets. SAFETY wahi 2-step: pehli
     call (confirm ke bina) sirf PREVIEW deti hai; user se chat me
     poochho, phir confirm=true se dobara call. Bulk delete JAAN-BOOJH
     kar nahi hai — galti se bada nuksan na ho.
     target: subject | chapter | step | step_template | topic | source |
             attempts | page | revision_step | exam
     ================================================================ */
  function opDelete(a) {
    var e = needST(); if (e) return e;
    if (!a || !a.target) {
      return err("target is required: subject | chapter | step | step_template | topic | source | attempts | page | revision_step | exam");
    }
    var t = String(a.target);
    var r = null;

    if (t === 'subject') r = opDeleteSubject({ subject: a.subject, confirm: a.confirm });
    else if (t === 'chapter') r = opDeleteChapter({ subject: a.subject, chapter: a.chapter, confirm: a.confirm });
    else if (t === 'step') r = opDeleteStep({ subject: a.subject, chapter: a.chapter, list: a.list, step: a.step, confirm: a.confirm });
    else if (t === 'step_template') r = opDeleteStepTemplate({ key: a.key || a.list, id: a.id, confirm: a.confirm });
    else if (t === 'topic') r = opDeleteTopic({ subject: a.subject, chapter: a.chapter, topic: a.topic, confirm: a.confirm });
    else if (t === 'source') r = opDeleteSource({ subject: a.subject, chapter: a.chapter, source: a.source, confirm: a.confirm });
    else if (t === 'attempts') r = opDeleteSourceAttempts({ subject: a.subject, chapter: a.chapter, source: a.source, attempts: a.attempts, confirm: a.confirm });
    else if (t === 'page') r = opDeleteSourcePage({ subject: a.subject, chapter: a.chapter, source: a.source, page: a.page, confirm: a.confirm });
    else if (t === 'revision_step') {
      var rl = (a.list === 'question' || a.list === 'rev_question' || a.list === 'revision_question') ? 'question'
             : (a.list === 'chapter' || a.list === 'rev_chapter' || a.list === 'revision_chapter') ? 'chapter' : null;
      if (!rl) return err("list must be 'chapter' ya 'question'");
      r = opDeleteRevisionStep({ subject: a.subject, chapter: a.chapter, list: rl, step: a.step, confirm: a.confirm });
    }
    else if (t === 'exam') r = opDeleteExam({ exam: a.exam || a.id, confirm: a.confirm });
    else return err("unknown target: " + t + " (valid: subject | chapter | step | step_template | topic | source | attempts | page | revision_step | exam)");

    if (!r) return err('delete nahi hua (args check karo)');
    if (r && r.requires_confirmation) {
      r.target = t;
      r.message = 'Two-step delete: ask the user to confirm in chat, then call achiva_delete again with target=' + t + ' and confirm=true.';
    }
    return r;
  }

  /* ================================================================
     FEATURES v4 — baaki features ka FULL agent control
     (Tasks / Goals / Habits / Thoughts / Focus / Canvas)
     ----------------------------------------------------------------
     SPEED RULES (wahi jo subject tracker me proven hain):
       • bulk-first — ek call = poora kaam (tasks[], goals[], habits[])
       • results CHHOTE — {ok, id, name, changed}; poore object wapas nahi
       • har feature ka APNA live store use hota hai (TaskFeature.all(),
         GoalStore, GoodList/BadList, ThoughtStore/ThoughtGraph,
         AchivaFocus, CanvasList) — koi raw storage write nahi
       • delete hamesha 2-step (preview → user chat-confirm → confirm=true)
     ================================================================ */

  /* ---------- shared finder: id → exact name → partial name ---------- */
  function findLive(list, ref, nameKey) {
    if (!ref || !Array.isArray(list)) return null;
    var k = nameKey || 'name';
    var s = String(ref).trim().toLowerCase();
    var i, v, nm;
    for (i = 0; i < list.length; i++) {
      v = list[i]; if (!v) continue;
      if (String(v.id).toLowerCase() === s) return v;
      nm = (k === 'title') ? v.title : v[k];
      if (nm && String(nm).trim().toLowerCase() === s) return v;
    }
    for (i = 0; i < list.length; i++) {
      v = list[i]; if (!v) continue;
      nm = (k === 'title') ? v.title : v[k];
      if (nm && String(nm).toLowerCase().indexOf(s) !== -1) return v;
    }
    return null;
  }

  /* repeat parsing — task.js ke modes ka exact mirror */
  function parseRepeat(a) {
    var rep = (a && a.repeat) ? String(a.repeat).toLowerCase() : 'none';
    if (rep === '' || rep === 'none' || rep === 'once' || rep === 'off') return { repeat: { mode: 'none' } };
    if (rep === 'daily') return { repeat: { mode: 'daily' } };
    if (rep === 'weekly') return { repeat: { mode: 'weekly' } };
    if (rep === 'monthly') return { repeat: { mode: 'monthly' } };
    if (rep === 'every' || rep === 'every_n_days') {
      return { repeat: { mode: 'every', days: Math.max(1, parseInt(a.every_n_days, 10) || 1) } };
    }
    if (rep === 'dates' || rep === 'specific') {
      var raw = Array.isArray(a.dates) ? a.dates : (a.dates ? [a.dates] : []);
      var ds = [], bad = [];
      raw.forEach(function (x) {
        var iso = validISO(x);
        if (iso && ds.indexOf(iso) < 0) ds.push(iso); else if (x) bad.push(String(x));
      });
      if (bad.length) return { error: 'ye dates valid YYYY-MM-DD nahi hain: ' + bad.join(', ') };
      if (!ds.length) return { error: "repeat='dates' ke liye dates[] array chahiye (YYYY-MM-DD)" };
      ds.sort();
      return { repeat: { mode: 'dates', dates: ds } };
    }
    return { error: "repeat must be: none | daily | weekly | monthly | every | dates" };
  }

  /* ---------------- TASKS ---------------- */

  function liveTasks() {
    if (window.TaskFeature && typeof window.TaskFeature.all === 'function') return window.TaskFeature.all();
    return loadObj('achiva.tasks.v1', 'tasks').tasks;
  }
  function persistTasks() {
    window.AppStorage.saveAt('achiva.tasks.v1', { tasks: liveTasks() });
  }

  function makeTask(a) {
    if (!a || !a.name || !String(a.name).trim()) return { error: 'name is required' };
    var pr = parseRepeat(a); if (pr.error) return pr;
    return { task: {
      id: uid(),
      name: String(a.name).trim(),
      desc: a.desc ? String(a.desc) : '',
      date: validISO(a.date) || todayISO(),
      time: validHM(a.time) || '09:00',
      repeat: pr.repeat,
      priority: ['High', 'Medium', 'Low'].indexOf(a.priority) >= 0 ? a.priority : 'Medium',
      done: {}
    } };
  }

  /* BULK: tasks[] ek hi call me — "kal 5 chapters padhne hain" = 1 trip */
  function opAddTasks(a) {
    var raw = Array.isArray(a && a.tasks) ? a.tasks : null;
    if (!raw) {
      var one = makeTask(a);
      if (one.error) return err(one.error);
      raw = [a];
      var r1 = addTaskOne(one.task);
      refreshDashboard();
      return { ok: true, added: 1, tasks: [{ id: r1.id, name: r1.name }] };
    }
    var added = [], failures = [];
    beginBulk();
    try {
      raw.forEach(function (t, i) {
        var m = makeTask(t);
        if (m.error) { failures.push('tasks[' + i + ']: ' + m.error); return; }
        var nt = addTaskOne(m.task);
        added.push({ id: nt.id, name: nt.name });
      });
    } finally { endBulk(); }
    refreshDashboard();
    if (!added.length) return err(failures.join('; ') || 'koi task add nahi hua');
    return { ok: true, added: added.length, tasks: added, failed: failures };
  }
  function addTaskOne(t) {
    liveTasks().push(t);
    persistTasks();
    return t;
  }

  function opUpdateTask(a) {
    var t = findLive(liveTasks(), a && (a.task || a.id));
    if (!t) return err('task not found: ' + ((a && (a.task || a.id)) || '(task required)'));
    var changed = {};
    if (a.name && String(a.name).trim()) { t.name = String(a.name).trim(); changed.name = t.name; }
    if (a.desc !== undefined) { t.desc = String(a.desc || ''); changed.desc = t.desc; }
    if (a.date !== undefined) {
      if (a.date === 'clear' || a.date === null) { t.date = todayISO(); changed.date = t.date; }
      else {
        var iso = validISO(a.date);
        if (!iso) return err('date must be YYYY-MM-DD ya "clear"');
        t.date = iso; changed.date = iso;
      }
    }
    if (a.time !== undefined) {
      var hm = validHM(a.time);
      if (!hm) return err('time must be HH:MM (24h)');
      t.time = hm; changed.time = hm;
    }
    if (a.priority !== undefined) {
      if (['High', 'Medium', 'Low'].indexOf(a.priority) < 0) return err("priority must be High | Medium | Low");
      t.priority = a.priority; changed.priority = a.priority;
    }
    if (a.repeat !== undefined || a.dates !== undefined || a.every_n_days !== undefined) {
      var pr = parseRepeat(a); if (pr.error) return err(pr.error);
      t.repeat = pr.repeat; changed.repeat = pr.repeat;
    }
    persistTasks(); refreshDashboard();
    return { ok: true, id: t.id, name: t.name, changed: changed };
  }

  function opDeleteTask(a) {
    var list = liveTasks();
    var t = findLive(list, a && (a.task || a.id));
    if (!t) return err('task not found: ' + ((a && (a.task || a.id)) || '(task required)'));
    var rep = (t.repeat && t.repeat.mode !== 'none') ? (' · repeat: ' + t.repeat.mode) : '';
    var g = confirmGuard(a, 'Task "' + t.name + '"' + rep,
      'ye task aur uski saari done-history delete ho jayegi (repeating task ki poori history).');
    if (g) return g;
    var idx = list.indexOf(t);
    if (idx >= 0) list.splice(idx, 1);
    persistTasks(); refreshDashboard();
    return { ok: true, deleted: t.name, id: t.id };
  }

  /* toggle_task UPGRADE — ab bulk + naam-se + explicit done:
     {tasks:["Physics revision","x2"], date, done:true} — 1 trip me saare. */
  function opToggleTask(a) {
    if (!a) return err('args required');
    var iso = validISO(a.date) || todayISO();
    var refs = [];
    if (Array.isArray(a.tasks)) refs = a.tasks;
    else if (Array.isArray(a.ids)) refs = a.ids;
    else if (Array.isArray(a.names)) refs = a.names;
    else refs = [a.id || a.task || a.name];
    refs = refs.filter(function (x) { return x !== undefined && x !== null && x !== ''; });
    if (!refs.length) return err('task ya tasks[] is required (id ya naam — get_state se ids milte hain)');
    var list = liveTasks();
    var results = [], errs = [];
    beginBulk();
    try {
      refs.forEach(function (ref, i) {
        var t = findLive(list, ref);
        if (!t) { errs.push('tasks[' + i + ']: task not found: ' + ref); return; }
        t.done = t.done || {};
        if (a.done === undefined) t.done[iso] = !t.done[iso];
        else t.done[iso] = !!a.done;
        results.push({ id: t.id, name: t.name, done: !!t.done[iso] });
      });
    } finally { endBulk(); }
    persistTasks(); refreshDashboard();
    if (!results.length) return err(errs.join('; ') || 'koi task tick nahi hua');
    return { ok: true, date: iso, updated: results.length, results: results, errors: errs };
  }

  /* ---------------- GOALS ---------------- */

  function liveGoals() {
    if (window.GoalStore && typeof window.GoalStore.all === 'function') return window.GoalStore.all();
    return loadObj('achiva.goals.v1', 'goals').goals;
  }
  function persistGoals() {
    window.AppStorage.saveAt('achiva.goals.v1', { goals: liveGoals() });
  }

  /* FIX: pehle deadline ms-timestamp ban raha tha — app (goal-detail.js)
     dates ko ISO string me likhta hai aur autoStatus string-compare
     karta hai. Ab ISO string hi store hoti hai (app-consistent). */
  function makeGoal(a) {
    if (!a || !(a.title || a.name) || !String(a.title || a.name).trim()) return { error: 'title is required' };
    var cat = ['Personal', 'Professional', 'Other', 'Study'].indexOf(a.category) >= 0 ? a.category : 'Personal';
    var td = parseInt(a.target_days, 10);
    var g = {
      id: uid(),
      title: String(a.title || a.name).trim(),
      category: cat,
      note: a.note ? String(a.note) : '',
      startDate: validISO(a.start_date),
      mode: 'deadline',
      deadline: validISO(a.deadline),
      targetDays: (td > 0) ? td : null,
      status: 'active',
      done: false,
      parts: [],
      sessions: [],
      createdAt: Date.now()
    };
    if (g.targetDays && g.startDate) g.mode = 'days';
    return { goal: g };
  }

  /* add_goal UPGRADE — bulk goals[] + poore fields (start_date,
     target_days, deadline, note) ek hi call me */
  function opAddGoal(a) {
    var raw = Array.isArray(a && a.goals) ? a.goals : null;
    if (!raw) {
      var m0 = makeGoal(a);
      if (m0.error) return err(m0.error);
      var g0 = addGoalOne(m0.goal);
      refreshDashboard();
      return { ok: true, added: 1, goals: [{ id: g0.id, title: g0.title }] };
    }
    var added = [], failures = [];
    beginBulk();
    try {
      raw.forEach(function (x, i) {
        var m = makeGoal(x);
        if (m.error) { failures.push('goals[' + i + ']: ' + m.error); return; }
        var g = addGoalOne(m.goal);
        added.push({ id: g.id, title: g.title });
      });
    } finally { endBulk(); }
    refreshDashboard();
    if (!added.length) return err(failures.join('; ') || 'koi goal add nahi hua');
    return { ok: true, added: added.length, goals: added, failed: failures };
  }
  function addGoalOne(g) {
    if (window.GoalStore && typeof window.GoalStore.upsert === 'function') {
      window.GoalStore.upsert(g);
      try { if (window.GoalList && typeof window.GoalList.refresh === 'function') window.GoalList.refresh(); } catch (e) {}
    } else {
      liveGoals().push(g);
      persistGoals();
    }
    return g;
  }

  function opUpdateGoal(a) {
    var g = findLive(liveGoals(), a && (a.goal || a.id), 'title');
    if (!g) return err('goal not found: ' + ((a && (a.goal || a.id)) || '(goal required)'));
    var changed = {};
    if (a.title && String(a.title).trim()) { g.title = String(a.title).trim(); changed.title = g.title; }
    if (a.category !== undefined) {
      if (['Personal', 'Professional', 'Other', 'Study'].indexOf(a.category) < 0)
        return err('category must be Personal | Professional | Other | Study');
      g.category = a.category; changed.category = a.category;
    }
    if (a.note !== undefined) { g.note = String(a.note || ''); changed.note = g.note; }
    if (a.start_date !== undefined) {
      if (a.start_date === 'clear' || a.start_date === null) { g.startDate = null; changed.start_date = null; }
      else {
        var sd = validISO(a.start_date);
        if (!sd) return err('start_date must be YYYY-MM-DD ya "clear"');
        g.startDate = sd; changed.start_date = sd;
      }
    }
    if (a.deadline !== undefined) {
      if (a.deadline === 'clear' || a.deadline === null) { g.deadline = null; changed.deadline = null; }
      else {
        var dl = validISO(a.deadline);
        if (!dl) return err('deadline must be YYYY-MM-DD ya "clear"');
        g.deadline = dl; changed.deadline = dl;
      }
    }
    if (a.target_days !== undefined) {
      var td = parseInt(a.target_days, 10);
      g.targetDays = (td > 0) ? td : null;
      changed.target_days = g.targetDays;
    }
    if (a.done !== undefined) { g.done = !!a.done; changed.done = g.done; }
    g.mode = (g.targetDays && g.startDate) ? 'days' : 'deadline';
    changed.mode = g.mode;
    if (window.GoalStore && typeof window.GoalStore.persist === 'function') window.GoalStore.persist();
    else persistGoals();
    refreshDashboard();
    var GS = window.GoalStore;
    return { ok: true, id: g.id, title: g.title, changed: changed,
             status: (GS && GS.autoStatus) ? GS.autoStatus(g) : undefined };
  }

  function opDeleteGoal(a) {
    var g = findLive(liveGoals(), a && (a.goal || a.id), 'title');
    if (!g) return err('goal not found: ' + ((a && (a.goal || a.id)) || '(goal required)'));
    var mins = (window.GoalStore && window.GoalStore.totalMinutes) ? window.GoalStore.totalMinutes(g) : 0;
    var g2 = confirmGuard(a, 'Goal "' + g.title + '"',
      'goal + uska logged time (' + mins + ' min, ' + (g.sessions || []).length + ' sessions) delete hoga. ' +
      'Iska Draw board (agar bana hai) alag bachta hai.');
    if (g2) return g2;
    if (window.GoalStore && typeof window.GoalStore.remove === 'function') window.GoalStore.remove(g.id);
    else { persistGoalsAfterRemove(g.id); }
    refreshDashboard();
    return { ok: true, deleted: g.title, id: g.id };
  }
  function persistGoalsAfterRemove(id) {
    var d = loadObj('achiva.goals.v1', 'goals');
    d.goals = d.goals.filter(function (x) { return x.id !== id; });
    window.AppStorage.saveAt('achiva.goals.v1', d);
  }

  /* session log — bulk: sessions[] {minutes, date?} ya single minutes */
  function opAddGoalSession(a) {
    var g = findLive(liveGoals(), a && (a.goal || a.id), 'title');
    if (!g) return err('goal not found: ' + ((a && (a.goal || a.id)) || '(goal required)'));
    var entries = [];
    if (Array.isArray(a.sessions)) entries = a.sessions;
    else if (a.minutes !== undefined) entries = [{ minutes: a.minutes, date: a.date }];
    if (!entries.length) return err('minutes ya sessions[] is required');
    var added = 0, errs = [];
    beginBulk();
    try {
      entries.forEach(function (s, i) {
        var min = parseFloat(s && s.minutes);
        if (!(min > 0)) { errs.push('sessions[' + i + ']: minutes must be > 0'); return; }
        var iso = validISO(s.date);
        if (window.GoalStore && typeof window.GoalStore.addSession === 'function') {
          window.GoalStore.addSession(g.id, min, iso);
        } else {
          g.sessions = g.sessions || [];
          g.sessions.push({ date: iso || todayISO(), minutes: Math.max(0, Math.round(min)), at: Date.now() });
        }
        added++;
      });
    } finally { endBulk(); }
    if (!Array.isArray(a.sessions)) { /* single path me addSession persist kar chuka */ }
    if (window.GoalStore && typeof window.GoalStore.persist === 'function') window.GoalStore.persist();
    else persistGoals();
    refreshDashboard();
    if (!added) return err(errs.join('; ') || 'koi session add nahi hua');
    var GS = window.GoalStore;
    return { ok: true, goal: g.title, added: added, errors: errs,
             total_minutes: (GS && GS.totalMinutes) ? GS.totalMinutes(g) : undefined,
             status: (GS && GS.autoStatus) ? GS.autoStatus(g) : undefined };
  }

  /* goal ke progress tasks = goal board ke TAGGED cards (goal-task.js).
     action: add | update | toggle | delete (delete 2-step) */
  function opGoalTask(a) {
    if (!window.GoalTask) return err('GoalTask module not loaded — Goals screen ek baar kholo, phir retry');
    var g = findLive(liveGoals(), a && (a.goal || a.goal_id), 'title');
    if (!g) return err('goal not found: ' + ((a && (a.goal || a.goal_id)) || '(goal required)'));
    /* SMART default: done + koi ref → toggle; task ref bina done → update;
       warna add (agent ko action yaad rakhna nahi padta) */
    var action = a.action;
    if (!action) {
      if (a.done !== undefined && (a.task || a.id || a.text)) action = 'toggle';
      else if (a.task || a.id) action = 'update';
      else action = 'add';
    }

    if (action === 'add') {
      if (!a.text || !String(a.text).trim()) return err('text is required');
      var tb = buildGoalTag(a); if (tb.error) return err(tb.error);
      var c = window.GoalTask.addTask(g, String(a.text).trim(), tb.tag);
      try { if (window.GoalDetail && typeof window.GoalDetail.refresh === 'function') window.GoalDetail.refresh(); } catch (e) {}
      return { ok: true, action: 'add', id: c.id, goal: g.title, text: c.text, tag: tb.tag };
    }

    var ts = window.GoalTask.tasksOf(g);
    var card = findLive(ts, a.task || a.id || (action === 'toggle' ? a.text : null), 'text');
    if (!card) return err('goal task not found: ' + ((a.task || a.id || a.text) || '(task required — get_state keys=[canvases] se ids milte hain)'));

    if (action === 'update') {
      var changed = {};
      if (a.text && String(a.text).trim()) { card.text = String(a.text).trim(); changed.text = card.text; }
      if (a.type !== undefined || a.date !== undefined || a.from !== undefined || a.to !== undefined) {
        var tb2 = buildGoalTag(a, card.tag); if (tb2.error) return err(tb2.error);
        card.tag = tb2.tag; changed.tag = tb2.tag;
      }
      window.CanvasList.persistNow();
      try { if (window.GoalDetail && typeof window.GoalDetail.refresh === 'function') window.GoalDetail.refresh(); } catch (e) {}
      return { ok: true, action: 'update', id: card.id, goal: g.title, changed: changed };
    }

    if (action === 'toggle') {
      var st = window.GoalTask.taskState(g, card);
      if (!st.enabled) {
        return err('aaj is task ki date nahi hai (type: ' + card.tag.type +
          (card.tag.date ? ', date: ' + card.tag.date : '') + ') — app is din tick allow nahi karta');
      }
      if (a.done === undefined) {
        window.GoalTask.toggleDone(g, card);
        var st2 = window.GoalTask.taskState(g, card);
        return { ok: true, action: 'toggle', id: card.id, goal: g.title, text: card.text, done: st2.done };
      }
      /* explicit set — app ke toggleDone ka seeded version */
      var t = card.tag, td2 = todayISO();
      if (t.type === 'date') t.done = !!a.done;
      else {
        if (!Array.isArray(t.doneDays)) t.doneDays = [];
        var ix = t.doneDays.indexOf(td2);
        if (a.done && ix < 0) t.doneDays.push(td2);
        if (!a.done && ix >= 0) t.doneDays.splice(ix, 1);
      }
      window.CanvasList.persistNow();
      try { if (window.GoalDetail && typeof window.GoalDetail.refresh === 'function') window.GoalDetail.refresh(); } catch (e) {}
      return { ok: true, action: 'toggle', id: card.id, goal: g.title, text: card.text, done: a.done };
    }

    if (action === 'delete') {
      var g3 = confirmGuard(a, 'Goal task "' + card.text + '" (goal: ' + g.title + ')',
        'ye progress task goal board se hat jayega.');
      if (g3) return g3;
      window.GoalTask.deleteTask(g, card);
      return { ok: true, action: 'delete', deleted: card.text, id: card.id };
    }

    return err("action must be: add | update | toggle | delete");
  }

  function buildGoalTag(a, oldTag) {
    var type = a.type ? String(a.type).toLowerCase() : (oldTag ? oldTag.type : 'daily');
    if (type === 'daily') return { tag: { type: 'daily' } };
    if (type === 'date' || type === 'specific') {
      var d = validISO(a.date !== undefined ? a.date : (oldTag && oldTag.date));
      if (!d) return { error: "type='date' ke liye valid date (YYYY-MM-DD) chahiye" };
      return { tag: { type: 'date', date: d } };
    }
    if (type === 'range' || type === 'fromto') {
      var f = validISO(a.from !== undefined ? a.from : (oldTag && oldTag.from));
      var t2 = validISO(a.to !== undefined ? a.to : (oldTag && oldTag.to));
      if (!f || !t2) return { error: "type='range' ke liye from aur to dates chahiye (YYYY-MM-DD)" };
      if (t2 < f) return { error: 'to date from se pehle nahi ho sakti' };
      return { tag: { type: 'range', from: f, to: t2 } };
    }
    return { error: "type must be: daily | date | range" };
  }

  /* ---------------- HABITS ---------------- */

  function goodLive() {
    if (window.GoodList && typeof window.GoodList.all === 'function') return window.GoodList.all();
    return loadObj('achiva.goodHabits.v1', 'habits').habits;
  }
  function badLive() {
    if (window.BadList && typeof window.BadList.all === 'function') return window.BadList.all();
    return loadObj('achiva.badHabits.v1', 'habits').habits;
  }
  function persistGood() {
    if (window.GoodList && typeof window.GoodList.persist === 'function') { window.GoodList.persist(); return; }
    window.AppStorage.saveAt('achiva.goodHabits.v1', { habits: goodLive() });
  }
  function persistBad() {
    window.AppStorage.saveAt('achiva.badHabits.v1', { habits: badLive() });
  }
  function findHabit(kind, ref) {
    if (kind === 'bad') return findLive(badLive(), ref);
    return findLive(goodLive(), ref);
  }

  /* habit-types.js ke 3 user types: one (tap) | time (slots) | timer.
     normalize() app ka apna shape-fixer hai — use hi last me chalate hain. */
  function makeHabit(a, kind) {
    if (!a || !a.name || !String(a.name).trim()) return { error: 'name is required' };
    if (kind === 'bad') {
      return { habit: {
        id: uid(), name: String(a.name).trim(),
        since: todayISO(), createdAt: Date.now(), defended: {}, reps: [],
        note: a.note ? String(a.note) : ''
      } };
    }
    var type = a.type ? String(a.type).toLowerCase() : 'one';
    if (['one', 'time', 'timer'].indexOf(type) < 0)
      return { error: "type must be: one | time | timer (study card auto hai, wo nahi ban sakta)" };
    var h = {
      id: uid(), name: String(a.name).trim(), type: type,
      repsPerDay: Math.max(1, parseInt(a.reps_per_day, 10) || 1),
      startDate: validISO(a.start_date) || todayISO(),
      logs: {}
    };
    if (a.unit) h.unit = String(a.unit);
    if (a.color) h.color = String(a.color);
    if (a.note) h.note = String(a.note);
    if (type === 'time') {
      var raw = Array.isArray(a.slots) ? a.slots : [];
      var slots = [];
      for (var i = 0; i < raw.length; i++) {
        var s = raw[i];
        var t = (s && typeof s === 'object') ? s.t : s;
        var hm = validHM(t);
        if (!hm) return { error: 'slots[' + i + ']: time must be HH:MM' };
        slots.push({
          t: hm,
          minus: (s && typeof s === 'object' && s.minus !== undefined) ? Math.max(0, parseInt(s.minus, 10) || 0) : 0,
          plus: (s && typeof s === 'object' && s.plus !== undefined) ? Math.max(0, parseInt(s.plus, 10) || 0) : 0
        });
      }
      if (!slots.length) return { error: "type='time' ke liye slots[] chahiye ([{t:'06:00', minus:5, plus:10}])" };
      h.slots = slots;
    }
    if (type === 'timer') {
      var dm = parseInt(a.duration_min, 10);
      h.durationMin = (dm > 0) ? dm : (window.HabitTypes ? window.HabitTypes.DEFAULT_DUR : 20);
    }
    if (window.HabitTypes && typeof window.HabitTypes.normalize === 'function') window.HabitTypes.normalize(h);
    return { habit: h };
  }

  /* add_habit UPGRADE — bulk habits[] + kind + poore type fields */
  function opAddHabit(a) {
    var kind = (a && a.kind === 'bad') ? 'bad' : 'good';
    var raw = Array.isArray(a && a.habits) ? a.habits : null;
    if (!raw) {
      var m0 = makeHabit(a, kind);
      if (m0.error) return err(m0.error);
      var h0 = addHabitOne(kind, m0.habit);
      return { ok: true, added: 1, habits: [{ id: h0.id, name: h0.name, kind: kind }] };
    }
    var added = [], failures = [];
    beginBulk();
    try {
      raw.forEach(function (x, i) {
        var kd = (x && x.kind === 'bad') ? 'bad' : (x && x.kind === 'good') ? 'good' : kind;
        var m = makeHabit(x, kd);
        if (m.error) { failures.push('habits[' + i + ']: ' + m.error); return; }
        var h = addHabitOne(kd, m.habit);
        added.push({ id: h.id, name: h.name, kind: kd });
      });
    } finally { endBulk(); }
    if (!added.length) return err(failures.join('; ') || 'koi habit add nahi hui');
    return { ok: true, added: added.length, habits: added, failed: failures };
  }
  function addHabitOne(kind, h) {
    if (kind === 'bad') {
      if (window.BadList && typeof window.BadList.addHabit === 'function') return window.BadList.addHabit(h);
      badLive().push(h); persistBad(); return h;
    }
    if (window.GoodList && typeof window.GoodList.addHabit === 'function') return window.GoodList.addHabit(h);
    goodLive().push(h); persistGood(); return h;
  }

  function opUpdateHabit(a) {
    var kind = (a && a.kind === 'bad') ? 'bad' : (a && a.kind === 'good') ? 'good' : null;
    var h = null;
    if (kind) h = findHabit(kind, a && (a.habit || a.id));
    else {
      h = findHabit('good', a && (a.habit || a.id));
      kind = 'good';
      if (!h) { h = findHabit('bad', a && (a.habit || a.id)); kind = h ? 'bad' : 'good'; }
    }
    if (!h) return err('habit not found: ' + ((a && (a.habit || a.id)) || '(habit required)'));
    var changed = {};
    if (a.name && String(a.name).trim()) { h.name = String(a.name).trim(); changed.name = h.name; }
    if (a.note !== undefined) { h.note = String(a.note || ''); changed.note = h.note; }
    if (kind === 'good') {
      if (window.StudyHabit && typeof window.StudyHabit.isStudyCard === 'function' && window.StudyHabit.isStudyCard(h.id)) {
        /* study card ka type/reps app khud sambhalta hai — sirf target badalne deta hoon */
        if (a.study_target_min !== undefined) {
          var stm = parseInt(a.study_target_min, 10);
          if (!(stm > 0)) return err('study_target_min must be > 0');
          h.studyTargetMin = stm; changed.study_target_min = stm;
          persistGood();
          return { ok: true, id: h.id, name: h.name, kind: kind, changed: changed };
        }
        return err('Study card default hai — uska type/reps change nahi hota (sirf study_target_min)');
      }
      if (a.reps_per_day !== undefined) {
        var rp = parseInt(a.reps_per_day, 10);
        if (!(rp >= 1)) return err('reps_per_day must be >= 1');
        h.repsPerDay = rp; changed.reps_per_day = rp;
      }
      if (a.unit !== undefined) { h.unit = String(a.unit || ''); changed.unit = h.unit; }
      if (a.color !== undefined) { h.color = String(a.color || ''); changed.color = h.color; }
      if (a.type !== undefined || a.slots !== undefined || a.duration_min !== undefined) {
        var nt = a.type ? String(a.type).toLowerCase() : h.type;
        if (['one', 'time', 'timer'].indexOf(nt) < 0) return err("type must be: one | time | timer");
        var m = makeHabit({ name: h.name, type: nt, slots: a.slots, duration_min: a.duration_min, reps_per_day: h.repsPerDay, unit: h.unit, color: h.color, note: h.note }, 'good');
        if (m.error) return err(m.error);
        h.type = m.habit.type;
        if (h.type === 'time') h.slots = m.habit.slots;
        if (h.type === 'timer') h.durationMin = m.habit.durationMin;
        if (window.HabitTypes && typeof window.HabitTypes.normalize === 'function') window.HabitTypes.normalize(h);
        changed.type = h.type;
      }
      persistGood();
    } else {
      persistBad();
    }
    return { ok: true, id: h.id, name: h.name, kind: kind, changed: changed };
  }

  function opDeleteHabit(a) {
    var kind = (a && a.kind === 'bad') ? 'bad' : (a && a.kind === 'good') ? 'good' : null;
    var h = null;
    if (kind) h = findHabit(kind, a && (a.habit || a.id));
    else {
      h = findHabit('good', a && (a.habit || a.id)); kind = 'good';
      if (!h) { h = findHabit('bad', a && (a.habit || a.id)); kind = h ? 'bad' : 'good'; }
    }
    if (!h) return err('habit not found: ' + ((a && (a.habit || a.id)) || '(habit required)'));
    if (window.StudyHabit && typeof window.StudyHabit.isStudyCard === 'function' && window.StudyHabit.isStudyCard(h.id)) {
      return err('Study card default hai — delete nahi ho sakta (app ka rule)');
    }
    var g = confirmGuard(a, kind + '-habit "' + h.name + '"',
      'habit + uski poori streak/log history delete ho jayegi.');
    if (g) return g;
    if (kind === 'bad') {
      if (window.BadList && typeof window.BadList.removeHabit === 'function') window.BadList.removeHabit(h.id);
      else persistBadAfterRemove(h.id);
    } else {
      if (window.GoodList && typeof window.GoodList.removeHabit === 'function') window.GoodList.removeHabit(h.id);
      else persistGoodAfterRemove(h.id);
    }
    return { ok: true, deleted: h.name, kind: kind, id: h.id };
  }
  function persistBadAfterRemove(id) {
    var d = loadObj('achiva.badHabits.v1', 'habits');
    d.habits = d.habits.filter(function (x) { return x.id !== id; });
    window.AppStorage.saveAt('achiva.badHabits.v1', d);
  }
  function persistGoodAfterRemove(id) {
    var d = loadObj('achiva.goodHabits.v1', 'habits');
    d.habits = d.habits.filter(function (x) { return x.id !== id; });
    window.AppStorage.saveAt('achiva.goodHabits.v1', d);
  }

  /* habit_log — BULK tick: {habits:["Read 20 pages","Meditate"], action:'done'}
     action: done | undo | rep | defend | defend_off | slip
       good : done/undo/rep  (date backfill allowed — logs[date])
       bad  : slip (rep + trigger) | defend | defend_off (sirf rep-wale din par nahi)
     Study card par done/undo BAND — wo achiva_log_study se chalta hai. */
  function opHabitLog(a) {
    if (!a) return err('args required');
    var action = a.action || 'done';
    if (['done', 'undo', 'rep', 'defend', 'defend_off', 'slip'].indexOf(action) < 0)
      return err("action must be: done | undo | rep | defend | defend_off | slip");
    var date = validISO(a.date) || todayISO();
    var refs = [];
    if (Array.isArray(a.habits)) refs = a.habits;
    else if (Array.isArray(a.ids)) refs = a.ids;
    else if (Array.isArray(a.names)) refs = a.names;
    else refs = [a.habit || a.id || a.name];
    refs = refs.filter(function (x) { return x !== undefined && x !== null && x !== ''; });
    if (!refs.length) return err('habit ya habits[] is required (id ya naam)');
    var results = [], errs = [];
    beginBulk();
    try {
      refs.forEach(function (ref, i) {
        var kind = 'good', h = findHabit('good', ref);
        if (!h) { h = findHabit('bad', ref); kind = h ? 'bad' : 'good'; }
        if (!h) { errs.push('habits[' + i + ']: habit not found: ' + ref); return; }
        if (kind === 'good') {
          if (window.StudyHabit && typeof window.StudyHabit.isStudyCard === 'function' && window.StudyHabit.isStudyCard(h.id)) {
            errs.push('habits[' + i + ']: ' + h.name + ' study card hai — achiva_log_study use karo');
            return;
          }
          if (!h.logs) h.logs = {};
          var L = h.logs[date] || (h.logs[date] = { done: 0, times: [] });
          if (!Array.isArray(L.times)) L.times = [];
          var cap = h.repsPerDay || 1;
          if (action === 'done') {
            L.done = cap;
            if (!L.times.length) L.times.push(Date.now());
          } else if (action === 'undo') {
            L.done = 0; L.times = [];
          } else if (action === 'rep') {
            L.done = Math.min(cap, (L.done || 0) + 1);
            L.times.push(Date.now());
          } else {
            errs.push('habits[' + i + ']: action ' + action + ' sirf bad-habits ke liye hai');
            return;
          }
          results.push({ id: h.id, name: h.name, kind: 'good', date: date, done: L.done, of: cap });
        } else {
          if (action === 'slip') {
            h.reps = h.reps || [];
            var at = (window.UI && typeof window.UI.nowTime === 'function') ? window.UI.nowTime() : '00:00';
            h.reps.push({ iso: date, at: at, ts: Date.now(), trigger: a.trigger ? String(a.trigger) : '' });
            if (h.defended) delete h.defended[date];
            results.push({ id: h.id, name: h.name, kind: 'bad', date: date, slips: h.reps.length });
          } else if (action === 'defend') {
            h.defended = h.defended || {};
            var slips = (h.reps || []).filter(function (r) { return r.iso === date; }).length;
            if (slips) { errs.push('habits[' + i + ']: ' + date + ' ko slip ho chuki — us din defend nahi hota (app rule)'); return; }
            h.defended[date] = true;
            results.push({ id: h.id, name: h.name, kind: 'bad', date: date, defended: true });
          } else if (action === 'defend_off') {
            if (h.defended) delete h.defended[date];
            results.push({ id: h.id, name: h.name, kind: 'bad', date: date, defended: false });
          } else {
            errs.push('habits[' + i + ']: action ' + action + ' sirf good-habits ke liye hai');
            return;
          }
        }
      });
    } finally { endBulk(); }
    persistGood(); persistBad();
    try { if (window.GoodList && typeof window.GoodList.refreshList === 'function') window.GoodList.refreshList(); } catch (e) {}
    if (!results.length) return err(errs.join('; ') || 'koi habit update nahi hui');
    return { ok: true, action: action, date: date, updated: results.length, results: results, errors: errs };
  }

  /* ---------------- THOUGHTS ---------------- */

  /* cats resolve/create — naam se (agent ids yaad nahi rakhta) */
  function resolveCats(raw, errs) {
    var out = [];
    (Array.isArray(raw) ? raw : (raw ? [raw] : [])).forEach(function (c, i) {
      if (!c || !String(c).trim()) return;
      var G = window.ThoughtGraph;
      var cat = G ? findLive(G.allCats(), String(c).trim(), 'name') : null;
      if (!cat && G && typeof G.addCat === 'function') cat = G.addCat(String(c).trim());
      if (!cat) { errs.push('cats[' + i + ']: category resolve nahi hui: ' + c); return; }
      if (out.indexOf(cat.id) < 0) out.push(cat.id);
    });
    return out;
  }

  function opAddThought(a) {
    if (!a || !a.content || !String(a.content).trim()) return err('content is required');
    var txt = String(a.content).trim();
    var nm = (a.name && String(a.name).trim()) ? String(a.name).trim() : txt.slice(0, 40);
    var catErrs = [];
    var catIds = resolveCats(a.cats, catErrs);
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
        structured: a.summary ? { summary: String(a.summary) } : null,
        catIds: catIds
      });
    } else {
      var d = loadObj('achiva.thoughts.v1', 'thoughts');
      t = {
        id: uid(), name: nm, transcript: txt, status: 'done',
        date: todayISO(), createdAt: Date.now(), duration: 0, size: 0,
        mime: null, audioId: null, language: null,
        structured: a.summary ? { summary: String(a.summary) } : null,
        catIds: catIds
      };
      d.thoughts.push(t);
      window.AppStorage.saveAt('achiva.thoughts.v1', d);
    }
    return { ok: true, id: t.id, name: t.name, date: t.date, cats: catIds.length, errors: catErrs };
  }

  function opDeleteThought(a) {
    var S = window.ThoughtStore;
    var list = S && typeof S.all === 'function' ? S.all() : loadObj('achiva.thoughts.v1', 'thoughts').thoughts;
    var t = findLive(list, a && (a.thought || a.id));
    if (!t) return err('thought not found: ' + ((a && (a.thought || a.id)) || '(thought required)'));
    var g = confirmGuard(a, 'Thought "' + t.name + '" (' + t.date + ')',
      'thought + uska transcript delete hoga.' + (t.audioId ? ' (audio file bhi)' : ''));
    if (g) return g;
    if (S && typeof S.remove === 'function') S.remove(t.id);
    else {
      var d = loadObj('achiva.thoughts.v1', 'thoughts');
      d.thoughts = d.thoughts.filter(function (x) { return x.id !== t.id; });
      window.AppStorage.saveAt('achiva.thoughts.v1', d);
    }
    return { ok: true, deleted: t.name, id: t.id };
  }

  /* thought categories (knowledge graph) — action: add | rename | delete |
     link | unlink. delete 2-step (nested subs bhi jaati hain). */
  function opThoughtCat(a) {
    var G = window.ThoughtGraph;
    if (!G || typeof G.allCats !== 'function') return err('ThoughtGraph module not loaded — Thoughts screen ek baar kholo, phir retry');
    var action = a.action || 'add';

    if (action === 'add') {
      if (!a.name || !String(a.name).trim()) return err('name is required');
      var parent = null;
      if (a.parent) {
        var p = findLive(G.allCats(), a.parent, 'name');
        if (!p) return err('parent category not found: ' + a.parent);
        parent = p.id;
      }
      var c = G.addCat(String(a.name).trim(), parent);
      return { ok: true, action: 'add', id: c.id, name: c.name, parent: c.parent };
    }

    var cat = findLive(G.allCats(), a.cat || a.id || a.name, 'name');
    if (!cat) return err('category not found: ' + ((a.cat || a.id || a.name) || '(cat required)'));

    if (action === 'rename') {
      if (!a.name || !String(a.name).trim()) return err('name is required for rename');
      var c2 = G.renameCat(cat.id, String(a.name).trim());
      return { ok: true, action: 'rename', id: cat.id, name: c2.name };
    }
    if (action === 'delete') {
      var subs = (typeof G.subCatsOf === 'function') ? G.subCatsOf(cat.id).length : 0;
      var linked = 0;
      var S = window.ThoughtStore;
      if (S && typeof S.all === 'function') {
        S.all().forEach(function (t) { if ((t.catIds || []).indexOf(cat.id) >= 0) linked++; });
      }
      var g = confirmGuard(a, 'Thought category "' + cat.name + '"',
        'category + ' + subs + ' sub-categories + unke saare thought-links delete honge (' + linked + ' thoughts affected).');
      if (g) return g;
      G.removeCat(cat.id);
      return { ok: true, action: 'delete', deleted: cat.name, id: cat.id };
    }
    if (action === 'link' || action === 'unlink') {
      var S2 = window.ThoughtStore;
      if (!S2 || typeof S2.linkCat !== 'function') return err('ThoughtStore not loaded');
      var t = findLive(S2.all(), a.thought || a.thought_id);
      if (!t) return err('thought not found: ' + ((a.thought || a.thought_id) || '(thought required)'));
      if (action === 'link') S2.linkCat(t.id, cat.id); else S2.unlinkCat(t.id, cat.id);
      return { ok: true, action: action, thought: t.name, cat: cat.name };
    }
    return err("action must be: add | rename | delete | link | unlink");
  }

  /* ---------------- FOCUS SHIELD ---------------- */

  /* rules CRUD — app ka AchivaFocus.addRule/updateRule/removeRule use
     hota hai (wo khud native FocusService ko sync karta hai). */
  function opFocusRule(a) {
    var F = window.AchivaFocus;
    if (!F || typeof F.addRule !== 'function') return err('AchivaFocus not loaded — Focus Shield settings ek baar kholo, phir retry');
    var action = a.action || 'add';

    if (action === 'add') {
      if (!a.name || !String(a.name).trim()) return err('name is required');
      var mode = a.mode ? String(a.mode).toLowerCase() : 'time';
      if (['time', 'target', 'timer'].indexOf(mode) < 0) return err("mode must be: time | target | timer");
      var r = { name: String(a.name).trim(), mode: mode, apps: strList(a.apps), days: intDays(a.days) };
      if (mode === 'time') {
        var s = validHM(a.start), e = validHM(a.end);
        if (!s || !e) return err("mode='time' ke liye start aur end (HH:MM) chahiye");
        r.start = s; r.end = e;
      }
      if (mode === 'timer') {
        var tm = parseInt(a.timer_min, 10);
        if (!(tm > 0)) return err("mode='timer' ke liye timer_min (> 0) chahiye");
        r.timerMin = tm;
      }
      var nr = F.addRule(r);
      return { ok: true, action: 'add', id: nr.id, name: nr.name, mode: nr.mode, active: nr.active !== false };
    }

    var rules = F.rules();
    var rule = findLive(rules, a.rule || a.id || a.name);
    if (!rule) return err('focus rule not found: ' + ((a.rule || a.id || a.name) || '(rule required)'));

    if (action === 'update') {
      var patch = {}, changed = {};
      if (a.name && String(a.name).trim()) { patch.name = String(a.name).trim(); changed.name = patch.name; }
      if (a.mode !== undefined) {
        var m2 = String(a.mode).toLowerCase();
        if (['time', 'target', 'timer'].indexOf(m2) < 0) return err("mode must be: time | target | timer");
        patch.mode = m2; changed.mode = m2;
      }
      if (a.apps !== undefined) { patch.apps = strList(a.apps); changed.apps = patch.apps; }
      if (a.days !== undefined) { patch.days = intDays(a.days); changed.days = patch.days; }
      if (a.start !== undefined) {
        var s2 = validHM(a.start); if (!s2) return err('start must be HH:MM');
        patch.start = s2; changed.start = s2;
      }
      if (a.end !== undefined) {
        var e2 = validHM(a.end); if (!e2) return err('end must be HH:MM');
        patch.end = e2; changed.end = e2;
      }
      if (a.timer_min !== undefined) {
        var t3 = parseInt(a.timer_min, 10); if (!(t3 > 0)) return err('timer_min must be > 0');
        patch.timerMin = t3; changed.timer_min = t3;
      }
      if (a.active !== undefined) { patch.active = !!a.active; changed.active = patch.active; }
      F.updateRule(rule.id, patch);
      return { ok: true, action: 'update', id: rule.id, name: rule.name, changed: changed };
    }

    if (action === 'toggle') {
      var na = (rule.active === false);
      F.updateRule(rule.id, { active: na });
      return { ok: true, action: 'toggle', id: rule.id, name: rule.name, active: na };
    }

    if (action === 'delete') {
      var g = confirmGuard(a, 'Focus rule "' + rule.name + '"',
        'ye blocking rule delete ho jayega (uske apps phir blocked nahi honge).');
      if (g) return g;
      F.removeRule(rule.id);
      return { ok: true, action: 'delete', deleted: rule.name, id: rule.id };
    }

    return err("action must be: add | update | toggle | delete");
  }
  function strList(x) {
    var arr = Array.isArray(x) ? x : (x ? [x] : []);
    return arr.map(function (s) { return String(s).trim(); }).filter(function (s) { return s; });
  }
  function intDays(x) {
    var arr = Array.isArray(x) ? x : (x ? [x] : []);
    var out = [];
    arr.forEach(function (n) {
      var v = parseInt(n, 10);
      if (v >= 1 && v <= 7 && out.indexOf(v) < 0) out.push(v);
    });
    return out.sort();
  }

  /* settings + service control. list_apps=true → installed apps ki list
     (rule ke apps[] package names ke liye). */
  function opFocusSettings(a) {
    var F = window.AchivaFocus;
    if (!F || typeof F.setSettings !== 'function') return err('AchivaFocus not loaded — Focus Shield settings ek baar kholo, phir retry');
    var changed = {};
    if (a.cooldown_min !== undefined) {
      var cm = parseInt(a.cooldown_min, 10);
      if (!(cm >= 1)) return err('cooldown_min must be >= 1');
      changed.cooldownMin = cm;
    }
    if (a.strict_level !== undefined) {
      if (['normal', 'strict', 'ultra'].indexOf(a.strict_level) < 0) return err('strict_level must be: normal | strict | ultra');
      if (typeof F.setStrictLevel === 'function') F.setStrictLevel(a.strict_level);
      else changed.strictLevel = a.strict_level;
    }
    if (a.boot_start !== undefined) changed.bootStart = !!a.boot_start;
    if (a.overlay_text !== undefined) changed.overlayText = String(a.overlay_text || '');
    var patch = {};
    for (var k in changed) if (Object.prototype.hasOwnProperty.call(changed, k)) patch[k] = changed[k];
    if (Object.keys(patch).length) F.setSettings(patch);

    var service = a.service ? String(a.service).toLowerCase() : null;
    if (service === 'start') F.start();
    else if (service === 'stop') F.stop();
    else if (service) return err("service must be: start | stop");

    var out = { ok: true, changed: changed, strict: F.strictLevel(), running: F.running() };
    if (a.list_apps) out.apps = F.listApps().map(function (x) { return { label: x.label, pkg: x.pkg || x.package || x.pkgName || '' }; });
    out.permissions = F.permissions();
    return out;
  }

  /* ---------------- CANVAS (Draw) ---------------- */

  /* cards hi asli data hain (lines/groups visual geometry). Goal boards
     (category:'goal') goal_task ke through sambhalte hain — yahan se
     unhe delete nahi karte. */
  function canvasList() {
    if (window.CanvasList && typeof window.CanvasList.getData === 'function') {
      var d = window.CanvasList.getData();
      return (d && Array.isArray(d.canvases)) ? d.canvases : [];
    }
    var d2 = loadObj('achiva.canvas.v1', 'canvases');
    return Array.isArray(d2.canvases) ? d2.canvases : [];
  }
  function persistCanvas() {
    if (window.CanvasList && typeof window.CanvasList.persistNow === 'function') { window.CanvasList.persistNow(); return; }
    window.AppStorage.saveAt('achiva.canvas.v1', { canvases: canvasList() });
  }
  function findCanvas(ref) { return findLive(canvasList(), ref); }

  function opCanvas(a) {
    if (!a || !a.action) return err("action is required: add_canvas | rename_canvas | delete_canvas | add_card | update_card | delete_card");
    var action = String(a.action);

    if (action === 'add_canvas') {
      if (!a.name || !String(a.name).trim()) return err('name is required');
      var c = {
        id: uid(), name: String(a.name).trim(),
        category: a.category ? String(a.category).trim() : '',
        date: window.UI.fmtDate(todayISO()),
        cards: [], lines: [], groups: []
      };
      canvasList().push(c); persistCanvas();
      return { ok: true, action: action, id: c.id, name: c.name };
    }

    if (action === 'rename_canvas') {
      var cv = findCanvas(a.canvas || a.id);
      if (!cv) return err('canvas not found: ' + ((a.canvas || a.id) || '(canvas required)'));
      var ch = {};
      if (a.name && String(a.name).trim()) { cv.name = String(a.name).trim(); ch.name = cv.name; }
      if (a.category !== undefined) { cv.category = String(a.category || '').trim(); ch.category = cv.category; }
      persistCanvas();
      return { ok: true, action: action, id: cv.id, name: cv.name, changed: ch };
    }

    if (action === 'delete_canvas') {
      var cv2 = findCanvas(a.canvas || a.id);
      if (!cv2) return err('canvas not found: ' + ((a.canvas || a.id) || '(canvas required)'));
      if (cv2.goalId) return err('ye ek goal ka board hai — ise achiva_delete (goal) se delete karo');
      var g = confirmGuard(a, 'Canvas "' + cv2.name + '"',
        'canvas + uske ' + (cv2.cards || []).length + ' cards delete honge.');
      if (g) return g;
      var all = canvasList();
      var ix = all.indexOf(cv2);
      if (ix >= 0) all.splice(ix, 1);
      persistCanvas();
      return { ok: true, action: action, deleted: cv2.name, id: cv2.id };
    }

    var target = findCanvas(a.canvas || a.id);
    if (!target) return err('canvas not found: ' + ((a.canvas || a.id) || '(canvas required)'));

    if (action === 'add_card') {
      if (!a.text || !String(a.text).trim()) return err('text is required');
      var f = (window.CanvasCards && typeof window.CanvasCards.fitSize === 'function')
        ? window.CanvasCards.fitSize(String(a.text).trim(), 210, 84)
        : { w: 210, h: 84 };
      var n = (target.cards || []).length;
      var card = {
        id: uid(), text: String(a.text).trim(),
        x: (a.x !== undefined) ? Math.round(parseFloat(a.x) || 0) : 60,
        y: (a.y !== undefined) ? Math.round(parseFloat(a.y) || 0) : 60 + n * 30,
        w: (a.w !== undefined) ? Math.round(parseFloat(a.w) || 0) || f.w : f.w,
        h: (a.h !== undefined) ? Math.round(parseFloat(a.h) || 0) || f.h : f.h,
        color: a.color ? String(a.color) : '#ffffff'
      };
      target.cards = target.cards || [];
      target.cards.push(card); persistCanvas();
      return { ok: true, action: action, id: card.id, canvas: target.name, text: card.text };
    }

    var cd = findLive(target.cards || [], a.card || a.id, 'text');
    if (!cd) return err('card not found: ' + ((a.card || a.id) || '(card required — get_state keys=[canvases] se ids milte hain)'));

    if (action === 'update_card') {
      var ch2 = {};
      if (a.text && String(a.text).trim()) {
        cd.text = String(a.text).trim(); ch2.text = cd.text;
        if (window.CanvasCards && typeof window.CanvasCards.fitSize === 'function' && a.w === undefined && a.h === undefined) {
          var f2 = window.CanvasCards.fitSize(cd.text, cd.w || 210, cd.h || 84);
          if (f2 && f2.w) { cd.w = f2.w; cd.h = f2.h; }
        }
      }
      if (a.x !== undefined) { cd.x = Math.round(parseFloat(a.x) || 0); ch2.x = cd.x; }
      if (a.y !== undefined) { cd.y = Math.round(parseFloat(a.y) || 0); ch2.y = cd.y; }
      if (a.w !== undefined) { cd.w = Math.round(parseFloat(a.w) || 0) || cd.w; ch2.w = cd.w; }
      if (a.h !== undefined) { cd.h = Math.round(parseFloat(a.h) || 0) || cd.h; ch2.h = cd.h; }
      if (a.color !== undefined) { cd.color = String(a.color || '#ffffff'); ch2.color = cd.color; }
      persistCanvas();
      return { ok: true, action: action, id: cd.id, canvas: target.name, changed: ch2 };
    }

    if (action === 'delete_card') {
      var g3 = confirmGuard(a, 'Card "' + cd.text + '" (canvas: ' + target.name + ')',
        'card + uski judi lines delete hongi.');
      if (g3) return g3;
      target.cards = (target.cards || []).filter(function (x) { return x !== cd; });
      target.lines = (target.lines || []).filter(function (l) {
        return !(l.from && l.from.cid === cd.id) && !(l.to && l.to.cid === cd.id);
      });
      persistCanvas();
      return { ok: true, action: action, deleted: cd.text, id: cd.id };
    }

    return err("unknown action: " + action + " (add_canvas | rename_canvas | delete_canvas | add_card | update_card | delete_card)");
  }

  function buildBridge() {
    var METHODS = {
      get_state: opGetState,
      add_task: opAddTasks,
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
      delete_exam: opDeleteExam,
      /* ---- v3 SPEED: bulk + generic (purane ops alias ke roop me zinda
         hain taaki chalte sessions kabhi na tootein) ---- */
      add_chapters: opAddChapters,
      add_steps: opAddSteps,
      add_sources: opAddSources,
      set_source_attempts: opAddSourceAttempts,
      update: opUpdate,
      'delete': opDelete,
      /* ---- v4 FEATURES: Tasks / Goals / Habits / Thoughts / Focus /
         Canvas ka full control (bulk-first, chhote results) ---- */
      add_tasks: opAddTasks,
      update_task: opUpdateTask,
      delete_task: opDeleteTask,
      update_goal: opUpdateGoal,
      delete_goal: opDeleteGoal,
      add_goal_session: opAddGoalSession,
      goal_task: opGoalTask,
      update_habit: opUpdateHabit,
      delete_habit: opDeleteHabit,
      habit_log: opHabitLog,
      thought_cat: opThoughtCat,
      delete_thought: opDeleteThought,
      focus_rule: opFocusRule,
      focus_settings: opFocusSettings,
      canvas: opCanvas
    };
    return {
      version: 3,
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
