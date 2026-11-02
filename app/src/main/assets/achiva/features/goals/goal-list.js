/* ================================================================
   FEATURES / GOALS / GOAL-LIST.JS — Goal list (single file)
   ----------------------------------------------------------------
   Ye AKELI file poora goal-list feature sambhalti hai :
     • FAB → GOALS toggle par list screen khulti hai
     • + icon  → New goal modal : sirf Goal name + Category
                 (Personal / Professional / Other) + Save
     • Card    → name (bada), category, progress bar,
                 total time spent / remaining days,
                 aur top-right mein : auto STATUS chip + 3-dot kebab
     • STATUS  → user choose NAHI karta; internal logic se :
                   Upcoming   : start date aaj ke baad hai
                   Active     : window ke andar chal raha hai
                   Completed  : saare parts done (window ke andar)
                   Overdue    : window nikal gayi, kaam baaki
     • 3-dot   → Edit / Delete (app ka popover rule)
     • Card tap→ detail screen (abhi "Coming soon")
   • Data : core/storage.js saveAt/loadAt → 'achiva.goals.v1'
     (per-account namespace ke saath, cloud backup mein shaamil)
   ================================================================ */

(function () {
  'use strict';

  if (window.__achivaGoalListLoaded) return;
  window.__achivaGoalListLoaded = true;

  var el = UI.el, esc = UI.esc, uid = UI.uid;
  var KEY = 'achiva.goals.v1';
  var CATEGORIES = ['Personal', 'Professional', 'Other'];

  /* STUDY-GOALS: header book button ka icon (popup study-goals.js kholta hai) */
  var BOOK_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>';

  var data = window.AppStorage.loadAt(KEY) || { goals: [] };
  if (!Array.isArray(data.goals)) data.goals = [];

  function persist() { window.AppStorage.saveAt(KEY, data); }
  function bridge() { return window.SubjectListBridge; }

  /* ---------- store ---------- */
  function all() { return data.goals; }
  function get(id) {
    for (var i = 0; i < data.goals.length; i++) if (data.goals[i].id === id) return data.goals[i];
    return null;
  }
  function upsert(g) {
    if (data.goals.indexOf(g) < 0) data.goals.push(g);
    persist();
  }
  function remove(id) {
    data.goals = data.goals.filter(function (g) { return g.id !== id; });
    persist();
  }
  /* DAY-CLOCK : 'aaj' app ke apne din se (Settings → Mera Din) */
  function appToday() { return window.DayClock ? window.DayClock.today() : UI.todayISO(); }

  function addSession(id, minutes, iso, extra) {
    var g = get(id);
    if (!g) return;
    if (!Array.isArray(g.sessions)) g.sessions = [];
    var s = { date: iso || appToday(), minutes: Math.max(0, Math.round(minutes)), at: Date.now() };
    if (extra) { for (var k in extra) s[k] = extra[k]; }
    g.sessions.push(s);
    persist();
  }

  /* ---------- date / progress helpers ---------- */
  function endDate(g) {
    if (!g.startDate) return null;
    if (g.mode === 'days' && g.targetDays) return UI.addDays(g.startDate, Math.max(1, g.targetDays) - 1);
    return g.deadline || g.startDate;
  }
  function daysLeft(g) {
    var e = endDate(g);
    if (!e) return null;
    return Math.round((new Date(e) - new Date(appToday())) / 86400000);
  }
  function totalMinutes(g) {
    var t = 0;
    (g.sessions || []).forEach(function (s) { t += s.minutes || 0; });
    return t;
  }
  function fmtTime(min) {
    var h = Math.floor(min / 60), m = min % 60;
    return h > 0 ? h + 'h ' + m + 'm' : m + 'm';
  }
  function partsStats(g) {
    var ps = (g.parts || []);
    var done = ps.filter(function (p) { return p.done; }).length;
    return { total: ps.length, done: done };
  }

  /* ---------- AUTO STATUS (user choose nahi karta) ---------- */
  function autoStatus(g) {
    var today = appToday();
    var st = partsStats(g);
    var e = endDate(g);
    if (st.total > 0 && st.done === st.total) return 'Completed';
    if (g.done === true) return 'Completed';
    if (!g.startDate || today < g.startDate) return 'Upcoming';
    if (e && today > e) return 'Overdue';
    return 'Active';
  }

  var STATUS_STYLE = {
    'Active':    'background:var(--ink);color:var(--paper);border:1px solid var(--line-strong)',
    'Completed': 'background:rgba(46,160,67,.16);color:#2ea043;border:1px solid rgba(46,160,67,.45)',
    'Upcoming':  'background:rgba(160,106,0,.12);color:#a06a00;border:1px solid rgba(160,106,0,.4)',
    'Overdue':   'background:rgba(192,57,43,.12);color:#c0392b;border:1px solid rgba(192,57,43,.4)'
  };

  window.GoalStore = {
    all: all, get: get, upsert: upsert, remove: remove, addSession: addSession,
    endDate: endDate, daysLeft: daysLeft, totalMinutes: totalMinutes,
    autoStatus: autoStatus, persist: persist
  };

  /* ================================================================
     LIST SCREEN
  ================================================================ */
  var screen = el('section', 'screen');
  screen.style.paddingTop = '58px';
  document.getElementById('app').appendChild(screen);

  var formModal = UI.modal({ zScrim: 85, zWrap: 86 });

  function openList() {
    renderList();
    bridge().show(screen, true);
  }

  function renderList() {
    screen.innerHTML = '';
    var scroll = el('div', 'scroll');

    /* header */
    var head = el('div');
    head.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:12px 20px 8px';
    var ht = el('b', null, 'Goals');
    ht.style.cssText = 'font-family:var(--f-disp);font-size:20px;font-weight:700;color:var(--ink)';
    head.appendChild(ht);
    /* STUDY-GOALS: book button '+' ke LEFT — dono ek flex group mein,
       look bilkul same round chip (36×36) */
    var btns = el('div');
    btns.style.cssText = 'display:flex;align-items:center;gap:8px';
    var ROUND = ';width:36px;height:36px;border:1px solid var(--s2);background:var(--chip-bg);border-radius:50%';
    var book = UI.miniBtn(BOOK_ICON, 'Study goals');
    book.style.cssText += ROUND;
    book.addEventListener('click', function () {
      if (window.StudyGoals) window.StudyGoals.openPopup();
    });
    btns.appendChild(book);
    var add = UI.miniBtn(UI.icons.plusBig, 'New goal');
    add.style.cssText += ROUND;
    add.addEventListener('click', function () { openForm(null); });
    btns.appendChild(add);
    head.appendChild(btns);
    scroll.appendChild(head);

    var goals = all();
    if (!goals.length) {
      var empty = el('div');
      empty.style.cssText = 'margin:26px 20px;padding:22px;border:1px dashed var(--s2);border-radius:18px;' +
        'color:var(--slate);font-size:12.5px;line-height:1.7;text-align:center';
      empty.innerHTML = 'No goals yet.<br>Tap + to create your first goal.';
      scroll.appendChild(empty);
    } else {
      goals.forEach(function (g) { scroll.appendChild(card(g)); });
    }
    screen.appendChild(scroll);
  }

  /* ---------- CARD ---------- */
  function card(g) {
    var c = el('div', 'sub-card');
    c.style.alignItems = 'flex-start';
    c.style.padding = '13px 14px';          /* kebab edge se andar */

    var main = el('div', 'sub-main');
    main.style.width = '100%';

    /* row 1 : name + auto status + kebab (andar ki taraf) */
    var top = el('div', 'cb-top');
    top.style.marginBottom = '2px';
    top.style.gap = '8px';
    var name = el('h3', null, esc(g.title));
    name.style.flex = '1';
    top.appendChild(name);

    var status = autoStatus(g);
    var schip = el('span', null, status);
    schip.style.cssText = 'flex:none;padding:5px 11px;border-radius:99px;font-size:10px;font-weight:700;' +
      'letter-spacing:.05em;' + STATUS_STYLE[status];
    top.appendChild(schip);

    var pop = UI.makeKebabPop(
      function () { openForm(g); },
      function () { confirmDelete(g); },
      { top: '40px', right: '10px' }
    );
    var kb = UI.miniBtn(UI.icons.kebab, 'Menu');
    kb.style.marginRight = '4px';           /* horizontally andar */
    kb.addEventListener('click', function (e) { e.stopPropagation(); UI.togglePop(pop); });
    top.appendChild(kb);
    c.appendChild(pop);
    main.appendChild(top);

    /* row 2 : category */
    var cat = el('div', 'sub-meta', esc(g.category || 'Other'));
    cat.style.marginBottom = '9px';
    main.appendChild(cat);

    /* row 3 : progress bar (naam ke neeche) */
    var st = partsStats(g);
    var pct = st.total ? Math.round((st.done / st.total) * 100) : (g.done ? 100 : 0);
    var prow = el('div');
    prow.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:9px';
    var bar = el('div');
    bar.style.cssText = 'flex:1;height:6px;border-radius:99px;background:var(--s2);overflow:hidden';
    var fill = el('div');
    fill.style.cssText = 'height:100%;border-radius:99px;width:' + pct + '%;' +
      (status === 'Completed' ? 'background:#2ea043' : 'background:var(--ink)');
    bar.appendChild(fill);
    prow.appendChild(bar);
    var pl = el('span', null, pct + '%');
    pl.style.cssText = 'font-size:10.5px;font-weight:700;color:var(--slate);flex:none';
    prow.appendChild(pl);
    main.appendChild(prow);

    /* row 4 : Work <time> / Remaining <n> days */
    var trow = el('div');
    trow.style.cssText = 'display:flex;align-items:baseline;gap:6px';
    var spent = el('b', null, 'Work ' + fmtTime(totalMinutes(g)));
    spent.style.cssText = 'font-size:12.5px;font-weight:700;color:var(--ink)';
    var slash = el('span', null, '/');
    slash.style.cssText = 'font-size:11px;color:var(--ash)';
    var dl = daysLeft(g);
    var rem = el('span', null, dl === null ? 'Remaining — days' : (dl < 0 ? 'Remaining 0 days' : 'Remaining ' + dl + ' days'));
    rem.style.cssText = 'font-size:11.5px;font-weight:600;color:' +
      (dl !== null && dl < 0 ? '#c0392b' : 'var(--slate)');
    trow.appendChild(spent); trow.appendChild(slash); trow.appendChild(rem);
    main.appendChild(trow);

    c.appendChild(main);
    c.addEventListener('click', function () { openDetail(g.id); });
    return c;
  }

  /* ---------- CREATE / EDIT (name + category) ---------- */
  function openForm(g) {
    var nameF = UI.inputField('Goal name', 'e.g. Launch my app in 5 months');
    var catR = UI.chipRow(CATEGORIES, (g && g.category) || 'Personal');
    if (g) nameF.input.value = g.title || '';

    formModal.open(g ? 'Edit goal' : 'New goal', function (body) {
      body.appendChild(nameF.wrap);
      body.appendChild(UI.label('Category'));
      body.appendChild(catR.row);
      catR.row.style.marginTop = '6px';
    }, function () {
      var title = nameF.input.value.trim();
      if (!title) { nameF.input.focus(); return; }
      if (g) {
        g.title = title;
        g.category = catR.get();
      } else {
        g = {
          id: uid(), title: title, category: catR.get(), note: '',
          startDate: null, mode: 'deadline', deadline: null, targetDays: null,
          status: 'active', done: false, parts: [], sessions: [], createdAt: Date.now()
        };
        data.goals.push(g);
      }
      persist();
      formModal.close();
      renderList();
    });
  }

  function confirmDelete(g) {
    var m = UI.modal({ zWrap: 88, zScrim: 87 });
    m.open('Delete goal?', function (body) {
      body.appendChild(el('div', null, '"' + g.title + '" and all its logged time will be removed.'));
    }, function () {
      m.close();
      remove(g.id);
      renderList();
    });
  }

  /* ---------- DETAIL : goal-detail.js ko delegate ---------- */
  function openDetail(id) {
    if (window.GoalDetail) window.GoalDetail.open(id);
  }

  window.GoalList = {
    open: openList,
    showList: function () { renderList(); bridge().show(screen, false); },
    openDetail: openDetail,
    refresh: function () { renderList(); }
  };
})();
