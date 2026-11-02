/* ================================================================
   FEATURES / GOALS / STUDY-GOALS.JS — "Study Goal" bridge
   ----------------------------------------------------------------
   Goals screen ke '+' ke LEFT ek BOOK button (goal-list.js mein)
   ye popup kholta hai : "Study Goal" — Subject Tracker ke har
   subject ka naam + ON/OFF slide toggle.

   ON  → us subject ke liye goal card :
     1) pehle se LINKED goal (subjectId stamp) hai → wahi refresh
     2) exact (case-sensitive) naam ka UNLINKED goal maujood
        → USI card ko link karo (saara data safe, naya card nahi)
        → 2+ matches → picker popup (+ "Naya card banao" escape)
     3) koi match nahi → naya goal card (category 'Study')
   OFF → sirf UNLINK : card + sessions + parts sab waise hi rehte
         hain (normal goal ban jata hai); dobara ON → naam se wahi
         card re-link.

   TIME KA BAHAAO : Subject Tracker mein kahin bhi record ho
   (stopwatch / countdown, koi bhi chapter, browser ya APK native)
   → ST.recordStudy WRAP hone ki wajah se linked goal ke sessions
   mein apne aap judta hai (heat-map + day totals isi se chalte
   hain). Link ke waqt POORI purani history backfill hoti hai;
   dedupe entry-id (src) se — kabhi double nahi.

   Subject Tracker ki KOI file chhui nahi — sirf data read + wrap.
   Storage : goals wala 'achiva.goals.v1' hi (backup/namespace free).
   ================================================================ */

(function () {
  'use strict';

  if (window.__achivaStudyGoalsLoaded) return;
  window.__achivaStudyGoalsLoaded = true;

  var el = UI.el, esc = UI.esc, uid = UI.uid;

  /* ---------- small helpers ---------- */
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function store() { return window.GoalStore; }
  function subjects() {
    return (window.ST && window.ST.state && Array.isArray(window.ST.state.subjects))
      ? window.ST.state.subjects : [];
  }
  function findSubject(id) {
    var ss = subjects();
    for (var i = 0; i < ss.length; i++) if (ss[i].id === id) return ss[i];
    return null;
  }

  /* local din ka ISO (YYYY-MM-DD) — heat-map ki date isi se banti hai */
  function localISO(ms) {
    /* DAY-CLOCK : derived session ka din app-day se (enabledAt cutoff ke
       wajah se purana data apne asli din par hi rahega) */
    if (window.DayClock && window.DayClock.dayOf) return window.DayClock.dayOf(ms);
    var d = new Date(ms);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  /* ---------- link helpers ---------- */

  /* is subject se abhi linked goal (agar user ne goal delete kar diya
     to null → toggle apne aap OFF dikhta hai) */
  function linkedGoal(subId) {
    var gs = store().all();
    for (var i = 0; i < gs.length; i++) if (gs[i].subjectId === subId) return gs[i];
    return null;
  }

  /* EXACT (case-sensitive) naam wale UNLINKED goals */
  function matchesFor(subject) {
    return store().all().filter(function (g) {
      return !g.subjectId && g.title === subject.name;
    });
  }

  /* ---------- time sync : study-store → goal.sessions ---------- */
  function syncAll() {
    if (!window.ST || !store()) return 0;
    var entries = window.ST.studyStore();
    var gs = store().all();
    var added = 0;
    gs.forEach(function (g) {
      if (!g.subjectId) return;
      if (!Array.isArray(g.sessions)) g.sessions = [];
      var have = {};
      g.sessions.forEach(function (s) { if (s.src) have[s.src] = true; });
      var changed = false;
      entries.forEach(function (e) {
        if (!e || e.subjectId !== g.subjectId) return;
        if (have[e.id]) return;                 /* dedupe : entry-id se */
        g.sessions.push({
          date: localISO(e.startMs || e.endMs || Date.now()),
          minutes: Math.max(1, Math.round((e.ms || 0) / 60000)),
          at: e.endMs || Date.now(),
          startMs: e.startMs || null,
          endMs: e.endMs || null,
          src: e.id,                            /* kis study-entry se bana */
          derived: true                         /* Subject Tracker se aaya */
        });
        have[e.id] = true;
        changed = true;
        added++;
      });
      if (changed) store().persist();
    });
    return added;
  }

  /* ---------- UI refresh ---------- */
  function afterLinkChange() {
    try { if (window.GoalList && window.GoalList.refresh) window.GoalList.refresh(); } catch (e) { }
    try { if (window.GoalDetail && window.GoalDetail.refresh) window.GoalDetail.refresh(); } catch (e) { }
    try { repaintPopup(); } catch (e) { }
  }

  /* ---------- ON / OFF ---------- */

  /* maujooda (naam-match) card ko link karo + poori history backfill */
  function doLink(g, subject) {
    g.subjectId = subject.id;
    g.studyLinked = Date.now();
    store().persist();
    syncAll();
    afterLinkChange();
    return g;
  }

  /* naya Study card banao (koi naam-match nahi mila / user ne chuna) */
  function makeGoal(subject) {
    var g = {
      id: uid(), title: subject.name, category: 'Study', note: '',
      startDate: null, mode: 'deadline', deadline: null, targetDays: null,
      status: 'active', done: false, parts: [], sessions: [], createdAt: Date.now(),
      subjectId: subject.id, studyLinked: Date.now()
    };
    store().upsert(g);                 /* upsert persist bhi karta hai */
    syncAll();                         /* purani history abhi backfill */
    afterLinkChange();
    return g;
  }

  /* toggle ON : 3-step rule (linked → name-match → create) */
  function turnOn(subject, opts) {
    if (!subject) return null;
    var linked = linkedGoal(subject.id);
    if (linked) {                      /* already ON — bas sync/refresh */
      syncAll();
      afterLinkChange();
      return linked;
    }
    var ms = matchesFor(subject);
    if (ms.length === 1) return doLink(ms[0], subject);
    if (ms.length > 1 && !(opts && opts.forceNew)) { openPicker(subject, ms); return null; }
    return makeGoal(subject);
  }

  /* toggle OFF : SIRF unlink — card + data waise hi */
  function turnOff(subject) {
    if (!subject) return null;
    var g = linkedGoal(subject.id);
    if (!g) return null;
    g.subjectId = null;
    g.studyLinked = null;
    store().persist();
    afterLinkChange();
    return g;
  }

  /* ---------- STUDY GOAL popup (modal, full screen NAHI) ---------- */
  var popup = null;
  function popupModal() {
    if (!popup) popup = UI.modal({ zScrim: 81, zWrap: 82 });
    return popup;
  }

  function toggleTrack(on) {
    var track = el('button');
    track.type = 'button';
    track.className = 'sg-toggle' + (on ? ' on' : '');
    track.setAttribute('role', 'switch');
    track.setAttribute('aria-checked', on ? 'true' : 'false');
    track.style.cssText = 'flex:none;position:relative;width:44px;height:26px;border-radius:99px;' +
      'cursor:pointer;padding:0;border:1px solid ' + (on ? 'rgba(46,160,67,.55)' : 'var(--s2)') + ';' +
      'background:' + (on ? 'rgba(46,160,67,.22)' : 'var(--chip-bg)');
    var knob = el('span');
    knob.className = 'sg-knob';
    knob.style.cssText = 'position:absolute;top:2px;left:' + (on ? '20px' : '2px') + ';width:20px;height:20px;' +
      'border-radius:50%;background:' + (on ? '#2ea043' : 'var(--ash)') + ';box-shadow:0 1px 3px rgba(0,0,0,.3)';
    track.appendChild(knob);
    return track;
  }

  function subjectRow(subject) {
    var on = !!linkedGoal(subject.id);
    var row = el('div', 'sg-row');
    row.setAttribute('data-subject', subject.id);
    row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:11px 4px;' +
      'border-bottom:1px solid var(--line)';

    var nm = el('div');
    nm.style.cssText = 'flex:1;min-width:0';
    var t = el('b', null, esc(subject.name));
    t.style.cssText = 'display:block;font-size:13.5px;font-weight:700;color:var(--ink);' +
      'overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
    nm.appendChild(t);
    var hint = el('span', null, on ? 'Linked — time auto-add ho raha hai' : 'Off');
    hint.className = 'sg-hint';
    hint.style.cssText = 'font-size:10.5px;color:var(--slate)';
    nm.appendChild(hint);
    row.appendChild(nm);

    var track = toggleTrack(on);
    track.setAttribute('aria-label', 'Study goal for ' + subject.name);
    track.addEventListener('click', function (e) {
      e.stopPropagation();
      wrapRecord();                     /* safety : ST baad mein aaya ho */
      if (linkedGoal(subject.id)) turnOff(subject);
      else turnOn(subject);
    });
    row.appendChild(track);
    return row;
  }

  function buildPopup(body) {
    var note = el('div');
    note.style.cssText = 'font-size:11.5px;color:var(--slate);line-height:1.65;margin-bottom:10px';
    note.textContent = 'Subject ON karo — uska goal card list mein aa jayega aur ' +
      'Subject Tracker ka saara padhai-time apne aap usme judta rahega. ' +
      'OFF karne par card normal goal ban jata hai (data safe).';
    body.appendChild(note);

    var subs = subjects();
    if (!subs.length) {
      var empty = el('div', 'empty');
      empty.textContent = 'Koi subject nahi. Pehle Subject Tracker mein subject banao.';
      body.appendChild(empty);
      return;
    }
    var box = el('div', 'sg-list');
    box.style.cssText = 'max-height:300px;overflow-y:auto';
    subs.forEach(function (s) { box.appendChild(subjectRow(s)); });
    body.appendChild(box);
  }

  function repaintPopup() {
    if (!popup || !popup.isOpen()) return;
    popup.body.innerHTML = '';
    buildPopup(popup.body);
  }

  function openPopup() {
    wrapRecord();                       /* safety net */
    popupModal().open('Study Goal', buildPopup, null);   /* saveFn null → koi Save nahi */
  }

  /* ---------- PICKER : 2+ same-name unlinked goals ---------- */
  function openPicker(subject, matches) {
    var m = UI.modal({ zScrim: 83, zWrap: 84 });   /* popup (81/82) ke theek upar */
    m.open('Kaunsa card link karein?', function (body) {
      var note = el('div');
      note.style.cssText = 'font-size:11.5px;color:var(--slate);line-height:1.6;margin-bottom:10px';
      note.textContent = '"' + subject.name + '" naam ke ' + matches.length +
        ' goals pehle se hain. Ek card chuno (uska data safe rahega) ya naya card banao :';
      body.appendChild(note);

      matches.forEach(function (g) {
        var b = el('button', 'sg-pick');
        b.type = 'button';
        b.setAttribute('data-goal', g.id);
        b.style.cssText = 'display:block;width:100%;text-align:left;padding:11px 12px;margin-bottom:8px;' +
          'border:1px solid var(--s2);border-radius:12px;background:var(--chip-bg);cursor:pointer;font:inherit';
        var nm = el('b', null, esc(g.title));
        nm.style.cssText = 'display:block;font-size:13px;color:var(--ink)';
        b.appendChild(nm);
        var meta = el('span', null,
          (g.category || 'Other') + ' · ' + (g.sessions || []).length + ' session' +
          ((g.sessions || []).length === 1 ? '' : 's') +
          (g.createdAt ? ' · ' + UI.fmtDate(localISO(g.createdAt)) : ''));
        meta.style.cssText = 'font-size:10.5px;color:var(--slate)';
        b.appendChild(meta);
        b.addEventListener('click', function () {
          m.close();
          doLink(g, subject);
        });
        body.appendChild(b);
      });

      var nb = el('button', 'sg-pick-new');
      nb.type = 'button';
      nb.style.cssText = 'display:block;width:100%;padding:11px 12px;border:1px dashed var(--s2);' +
        'border-radius:12px;background:none;cursor:pointer;font:inherit;font-size:12.5px;' +
        'font-weight:700;color:var(--ink2);text-align:center';
      nb.textContent = '+ Naya card banao';
      nb.addEventListener('click', function () {
        m.close();
        makeGoal(subject);
      });
      body.appendChild(nb);
    }, null);
  }

  /* ---------- ST.recordStudy WRAP (Subject Tracker untouched) ----------
     study-timer.js ke saare call sites property-access karte hain
     (ST.recordStudy ke through) — isliye wrap browser + APK native
     dono mein chalta hai. Har record ke baad linked goals sync. */
  function wrapRecord() {
    if (!window.ST || window.ST.__studyGoalsWrap) return;
    var orig = window.ST.recordStudy;
    if (typeof orig !== 'function') return;
    var wrapped = function (ms, startMs, sessionId, cat) {
      var out = orig.call(window.ST, ms, startMs, sessionId, cat);
      try {
        syncAll();
        afterLinkChange();
      } catch (e) { }
      return out;
    };
    wrapped.__studyGoalsWrap = true;
    window.ST.recordStudy = wrapped;
    window.ST.__studyGoalsWrap = true;
  }

  /* ---------- boot ---------- */
  wrapRecord();
  syncAll();      /* app band rehate hue bane entries bhi backfill */

  window.StudyGoals = {
    openPopup: openPopup,
    sync: syncAll,
    linkedGoal: linkedGoal,
    matchesFor: matchesFor,
    turnOn: turnOn,
    turnOff: turnOff,
    doLink: doLink,
    makeGoal: makeGoal,
    localISO: localISO,
    findSubject: findSubject,
    isWrapped: function () { return !!(window.ST && window.ST.__studyGoalsWrap); },
    popupIsOpen: function () { return !!(popup && popup.isOpen()); }
  };
})();
