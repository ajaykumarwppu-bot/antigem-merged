/* ================================================================
   FEATURES / SUBJECT TRACKER / SUBJECT-SCREENS.JS — screens + render
   ----------------------------------------------------------------
   Teen screens (subjects → chapters → chapter-view), cards render,
   navigation, kebab/edit-delete popover, add/edit modal, delete,
   books (test/doubt/error) + tabs, global events, refreshLists.
   Data ke liye window.ST (subject-store) use karti hai.
   ================================================================ */

(function () {
  'use strict';
  if (window.__achivaSTScreensLoaded) return;
  window.__achivaSTScreensLoaded = true;
  var el = UI.el, esc = UI.esc, uid = UI.uid;

  var ST = window.ST;
  var ICON_PLUS = UI.icons.plusBig;
  var ICON_BACK = UI.icons.back;
  var ICON_CLOCK = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
  var ICON_KEBAB = UI.icons.kebab;
  var ICON_EDIT = UI.icons.edit;
  var ICON_TRASH = UI.icons.trash;
  var ICON_BOOK = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V2H6.5A2.5 2.5 0 0 0 4 4.5z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/></svg>';
  var ICON_TARGET = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/></svg>';
  var ICON_STACK = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l10 6-10 6L2 8z"/><path d="M2 14l10 6 10-6"/></svg>';
  var ICON_REPEAT = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>';

  var currentSubject = null;
  var currentChapter = null;
  var sheetMode = 'subject';
  var editTarget = null;
  var sheetOpen = false;

  /* ================================================================
     3-DOT (KEBAB) + EDIT/DELETE POPOVER
  ================================================================ */
  var closePops = UI.closePops, togglePop = UI.togglePop;

  /* chhota, border-less 3-dot button */
  function kebab(onClick) {
    var k = UI.miniBtn(ICON_KEBAB, 'Edit or delete');
    k.addEventListener('click', function (e) {
      e.stopPropagation();
      onClick();
    });
    return k;
  }

  /* card ke andar Edit / Delete popover
     (delete = do-click confirm, baaki sab features jaisa — subject/chapter
     delete sabse destructive action hai isliye confirm zaroori) */
  function makePop(onEdit, onDelete) {
    return UI.makeKebabPop(onEdit, onDelete, { top: '40px', right: '8px' });
  }

  /* patla (compact) card : padding, tile size aur gaps squeeze */
  function compactCard(card, tile) {
    card.style.padding = '12px 30px 12px 12px';
    tile.style.width = '40px';
    tile.style.height = '40px';
    tile.style.borderRadius = '12px';
    tile.style.fontSize = '16px';
  }

  /* ================================================================
     SCREENS (teen screens : subjects → chapters → chapter view)
     paddingTop : global header (~55px) ke neeche content rahe
  ================================================================ */
  var activeScreen = null;
  var SCREEN_TOP = '58px';

  function makeScreen(id) {
    var s = el('section', 'screen');
    s.id = id;
    s.style.paddingTop = SCREEN_TOP;
    app.appendChild(s);
    return s;
  }

  /* screen switch : forward = aage ki screen, warna back */
  function showScreen(next, forward) {
    if (next === activeScreen) return;
    if (activeScreen) {
      if (forward) {
        activeScreen.classList.remove('active');
        activeScreen.classList.add('exit-left');
      } else {
        activeScreen.classList.remove('active', 'exit-left');
      }
    }
    next.classList.remove('exit-left');
    next.classList.add('active');
    /* subject screen par wapsi : book counts fresh rakho */
    if (next === subjectScreen) updateBooks();
    activeScreen = next;
    /* FAB (floating menu button) sirf main screens par dikhe :
       subjects / chapters / books / features — lekin chapter-view
       (basics/topic/sources/revision) aur NOTES screen ke andar
       CHHUPA rahe (notes padhte waqt floating button disturb na kare) */
    if (window.AchivaFab) {
      window.AchivaFab.setVisible(next !== chapterViewScreen &&
        !(next && next.id === 'screen-topic-notes'));
    }
  }

  /* ---------- 1) SUBJECT SCREEN ---------- */
  var subjectScreen = makeScreen('screen-subjects');

  var subTop = el('div', 'sub-top');
  var subTopTitle = el('div', 'sub-title-wrap');
  var subjectEyebrow = el('div', 'eyebrow', '');
  subTopTitle.appendChild(subjectEyebrow);
  subTopTitle.appendChild(el('h2', null, 'Add Subject'));
  var addSubjectBtn = el('button', 'add-btn', ICON_PLUS);
  addSubjectBtn.type = 'button';
  addSubjectBtn.setAttribute('aria-label', 'Add subject');
  subTop.appendChild(subTopTitle);
  subTop.appendChild(addSubjectBtn);
  subjectScreen.appendChild(subTop);

  /* ---------- CATEGORY FILTER CHIPS : All / JEE / Boards ----------
     "Add Subject" heading ke THEEK NEECHE — subject cards ko category
     se filter karte hain. Row subjectScroll ke BAHAR hai isliye chips
     header ke saath fixed rehte hain, list neeche scroll hoti hai.
     Category data subject.cat mein hota hai (subject-store SUBJECT_CATS). */
  var SUBJECT_CATS = (ST && ST.SUBJECT_CATS) ||
    [{ id: 'jee', label: 'JEE' }, { id: 'boards', label: 'Boards' }];
  var FILTERS = [{ id: 'all', label: 'All' }].concat(SUBJECT_CATS);
  var subjectFilter = 'all';
  var filterBtns = {};

  function paintFilterChips() {
    FILTERS.forEach(function (f) {
      if (filterBtns[f.id]) filterBtns[f.id].classList.toggle('sel', f.id === subjectFilter);
    });
  }

  var subChips = el('div', 'chips');
  subChips.style.padding = '4px 18px 10px';   /* subject screen ke 18px gutters se align */
  FILTERS.forEach(function (f) {
    var b = el('button', 'chip' + (f.id === subjectFilter ? ' sel' : ''), f.label);
    b.type = 'button';
    b.addEventListener('click', function () {
      if (subjectFilter === f.id) return;
      subjectFilter = f.id;
      paintFilterChips();
      renderSubjects();
    });
    filterBtns[f.id] = b;
    subChips.appendChild(b);
  });
  subjectScreen.appendChild(subChips);

  var subjectScroll = el('div', 'scroll');
  var subjectList = el('div', 'chap-list');
  subjectScroll.appendChild(subjectList);

  /* ---------- BOOKS ROW : Test / Doubt / Error (subject cards ke neeche) ---------- */
  var ICON_BOOKTEST = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M9 12h6M9 16h4"/></svg>';
  var ICON_BOOKDOUBT = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9.2 9a2.8 2.8 0 0 1 5.6 0c0 1.8-2.8 2.2-2.8 3.5"/><circle cx="12" cy="17" r="0.6" fill="currentColor"/></svg>';
  var ICON_BOOKERR = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.8L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.8a2 2 0 0 0-3.4 0z"/><path d="M12 9v4"/><circle cx="12" cy="17" r="0.6" fill="currentColor"/></svg>';

  function bookCard(title, iconHtml, spineColor, onOpen) {
    var b = el('div');
    b.style.cssText = 'position:relative;cursor:pointer;border:1px solid var(--line);' +
      'border-left:6px solid ' + spineColor + ';border-radius:4px 14px 14px 4px;' +
      'background:var(--card-bg);box-shadow:inset 0 1px 0 var(--hl-soft),0 10px 22px -16px rgba(30,34,40,.3);' +
      'padding:12px 10px 10px 14px;min-height:112px;display:flex;flex-direction:column;' +
      'justify-content:space-between;gap:8px;transition:transform .18s';
    var top = el('div');
    top.style.cssText = 'display:flex;align-items:flex-start;justify-content:space-between;gap:6px';
    var t = el('div', null, title);
    t.style.cssText = 'font-family:var(--f-disp);font-size:12.5px;font-weight:700;color:var(--ink);line-height:1.2';
    var ico = el('span', null, iconHtml);
    ico.style.cssText = 'color:var(--slate);display:flex';
    top.appendChild(t);
    top.appendChild(ico);
    var count = el('div', 'sub-meta', '');
    b.appendChild(top);
    b.appendChild(count);
    b.addEventListener('click', onOpen);
    b._count = count;
    return b;
  }

  var booksRow = el('div');
  booksRow.style.cssText = 'display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin:6px 18px 14px';
  var testBook = bookCard('Test Book', ICON_BOOKTEST, 'var(--slate)', function () {
    if (window.TestBook) window.TestBook.open();
  });
  var doubtBook = bookCard('Doubt Book', ICON_BOOKDOUBT, 'var(--steel)', function () {
    if (window.DoubtBook) window.DoubtBook.open();
  });
  var errorBook = bookCard('Error Book', ICON_BOOKERR, 'var(--ash)', function () {
    if (window.ErrorBook) window.ErrorBook.open();
  });
  booksRow.appendChild(testBook);
  booksRow.appendChild(doubtBook);
  booksRow.appendChild(errorBook);
  subjectScroll.appendChild(booksRow);

  function updateBooks() {
    var doubts = 0;
    ST.state.subjects.forEach(function (s) {
      (s.chapters || []).forEach(function (c) {
        (c.sources || []).forEach(function (src) {
          doubts += (src.doubt || []).length;
        });
      });
    });
    testBook._count.textContent = ST.state.tests.length + (ST.state.tests.length === 1 ? ' test' : ' tests');
    doubtBook._count.textContent = doubts + (doubts === 1 ? ' doubt' : ' doubts');
    errorBook._count.textContent = ST.state.errors.length + (ST.state.errors.length === 1 ? ' error' : ' errors');
  }

  subjectScreen.appendChild(subjectScroll);

  /* ---------- 2) CHAPTER SCREEN ---------- */
  var chapterScreen = makeScreen('screen-chapters');

  var chapTop = el('div', 'sub-top');
  var chapBackBtn = el('button', 'icon-btn', ICON_BACK);
  chapBackBtn.type = 'button';
  chapBackBtn.setAttribute('aria-label', 'Back to subjects');
  var chapTopTitle = el('div', 'sub-title-wrap');
  var chapTitle = el('h2', null, '');
  chapTopTitle.appendChild(chapTitle);
  var addChapterBtn = el('button', 'add-btn', ICON_PLUS);
  addChapterBtn.type = 'button';
  addChapterBtn.setAttribute('aria-label', 'Add chapter');
  chapTop.appendChild(chapBackBtn);
  chapTop.appendChild(chapTopTitle);
  chapTop.appendChild(addChapterBtn);
  chapterScreen.appendChild(chapTop);

  var chapterScroll = el('div', 'scroll');
  var chapterList = el('div', 'chap-list');
  chapterScroll.appendChild(chapterList);
  chapterScreen.appendChild(chapterScroll);

  /* ---------- 3) CHAPTER VIEW SCREEN ("Coming soon") ---------- */
  var chapterViewScreen = makeScreen('screen-chapter-view');

  var viewTop = el('div', 'sub-top');
  var viewBackBtn = el('button', 'icon-btn', ICON_BACK);
  viewBackBtn.type = 'button';
  viewBackBtn.setAttribute('aria-label', 'Back to chapters');
  var viewTopTitle = el('div', 'sub-title-wrap');
  var viewTitle = el('h2', null, '');
  var viewMeta = el('div', 'sub-meta', '');
  viewTopTitle.appendChild(viewTitle);
  viewTopTitle.appendChild(viewMeta);
  var timeBtn = el('button', 'icon-btn', ICON_CLOCK);
  timeBtn.type = 'button';
  timeBtn.setAttribute('aria-label', 'Study timer');
  timeBtn.addEventListener('click', function () { ST.openTimerPopup(); });
  viewTop.appendChild(viewBackBtn);
  viewTop.appendChild(viewTopTitle);
  viewTop.appendChild(timeBtn);
  chapterViewScreen.appendChild(viewTop);

  var viewScroll = el('div', 'scroll');
  chapterViewScreen.appendChild(viewScroll);

  /* ---------- BOTTOM TAB NAVIGATION (chapter view mein fixed) ----------
     Chaar features : basics.js / topic.js / sources.js / rivision.js
     Bar hamesha bottom par fixed rehti hai, beech ka viewScroll
     scrollable rehta hai. Jab koi feature file (window.Topic,
     window.Sources, window.Revision ...) apna renderChapterView
     expose karegi, tab yahan se navigate ho jayega. */
  var TABS = [
    { key: 'basics', label: 'Basics', module: 'Basics', icon: ICON_BOOK },
    { key: 'topic', label: 'Topic', module: 'Topic', icon: ICON_TARGET },
    { key: 'sources', label: 'Sources', module: 'Sources', icon: ICON_STACK },
    { key: 'revision', label: 'Revision', module: 'Revision', icon: ICON_REPEAT }
  ];
  var currentTab = 'basics';
  var tabButtons = {};

  var tabBar = el('div');
  tabBar.style.cssText = 'position:absolute;left:0;right:0;bottom:0;z-index:30;display:flex;gap:8px;' +
    'padding:10px 14px calc(10px + env(safe-area-inset-bottom,0px));' +
    'background:var(--mi-bg);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);' +
    'border-top:1px solid var(--line)';

  function paintTabs() {
    TABS.forEach(function (t) {
      var b = tabButtons[t.key];
      var sel = t.key === currentTab;
      b.style.cssText = 'flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;' +
        'padding:9px 4px;border-radius:14px;cursor:pointer;font:inherit;font-size:10px;' +
        'font-weight:600;letter-spacing:.04em;transition:.18s;' +
        (sel
          ? 'background:var(--ink);color:var(--paper);border:1px solid var(--line-strong)'
          : 'background:var(--chip-bg);color:var(--slate);border:1px solid var(--s2)');
    });
  }

  function showTab(key) {
    currentTab = key;
    paintTabs();
    viewScroll.innerHTML = '';
    var tab = null;
    TABS.forEach(function (t) { if (t.key === key) tab = t; });
    var mod = window[tab.module];
    if (mod && mod.renderChapterView) {
      mod.renderChapterView(viewScroll, currentChapter, {
        persist: ST.persist,
        refreshCards: renderChapters
      });
    } else {
      /* feature file abhi nahi hai — beech ka area placeholder */
      var ph = el('div', 'empty', 'Coming soon<br>' + tab.label + ' feature yahan jald add hoga.');
      ph.style.margin = '18px 18px 12px';
      viewScroll.appendChild(ph);
    }
  }

  TABS.forEach(function (t) {
    var b = el('button');
    b.type = 'button';
    b.innerHTML = t.icon + '<span>' + t.label + '</span>';
    b.addEventListener('click', function () { showTab(t.key); });
    tabButtons[t.key] = b;
    tabBar.appendChild(b);
  });
  chapterViewScreen.appendChild(tabBar);

  /* ================================================================
     POPUP — mid-screen modal (add + edit dono ke liye)
  ================================================================ */
  var sheetScrim = el('div', 'sheet-scrim');
  sheetScrim.style.transition = 'opacity .22s ease';   /* wrap fade ke saath sync */
  app.appendChild(sheetScrim);

  /* centered wrapper : sheet ko screen ke beech mein rakhta hai.
     Fade IS wrapper par hota hai — box, input aur buttons SAB EK
     SAATH aate/jaate hain (koi hissa alag-alag timing par nahi). */
  var sheetWrap = el('div');
  sheetWrap.style.cssText = 'position:absolute;inset:0;z-index:75;display:flex;' +
    'align-items:center;justify-content:center;pointer-events:none;visibility:hidden;' +
    'opacity:0;transition:opacity .22s ease';
  var sheetHideTimer = null;

  var sheet = el('div', 'sheet');
  sheet.style.position = 'relative';
  sheet.style.left = 'auto';
  sheet.style.right = 'auto';
  sheet.style.bottom = 'auto';
  sheet.style.width = 'min(380px, calc(100% - 44px))';
  /* CSS ka slide-up/down transform yahan nahi chahiye — poora popup
     wrapper ke opacity fade se khulta/band hota hai (ek saath) */
  sheet.style.transform = 'none';
  sheet.style.transition = 'none';
  sheet.appendChild(el('div', 'sheet-grab'));
  var sheetTitle = el('h3', null, '');
  var sheetLabel = el('label', null, '');
  var sheetInput = el('input');
  sheetInput.type = 'text';
  sheetInput.autocomplete = 'off';

  /* ---------- CATEGORY SELECTOR (sirf subject add/edit modes mein dikhta hai) ----------
     JEE / Boards chips — Add Subject mein default JEE selected, Edit Subject
     mein subject ki current category. Selected chip dobara tap = deselect
     (subject bina category ke → sirf "All" filter mein dikhega). */
  var sheetCatLabel = el('label', null, 'Category');
  var sheetCatRow = el('div', 'chips');
  sheetCatRow.style.padding = '2px 0 0';
  var sheetCat = null;
  var sheetCatBtns = {};

  function paintSheetCat() {
    SUBJECT_CATS.forEach(function (c) {
      if (sheetCatBtns[c.id]) sheetCatBtns[c.id].classList.toggle('sel', sheetCat === c.id);
    });
  }

  SUBJECT_CATS.forEach(function (c) {
    var b = el('button', 'chip', c.label);
    b.type = 'button';
    b.addEventListener('click', function () {
      sheetCat = (sheetCat === c.id) ? null : c.id;
      paintSheetCat();
    });
    sheetCatBtns[c.id] = b;
    sheetCatRow.appendChild(b);
  });

  var sheetActions = el('div', 'sheet-actions');
  var sheetCancel = el('button', 'btn-ghost', 'Cancel');
  var sheetSave = el('button', 'btn-solid', 'Save');
  sheetCancel.type = 'button';
  sheetSave.type = 'button';
  sheetActions.appendChild(sheetCancel);
  sheetActions.appendChild(sheetSave);
  sheet.appendChild(sheetTitle);
  sheet.appendChild(sheetLabel);
  sheet.appendChild(sheetInput);
  sheet.appendChild(sheetCatLabel);           /* SUBJECT-CAT: category selector */
  sheet.appendChild(sheetCatRow);
  sheet.appendChild(sheetActions);
  sheetWrap.appendChild(sheet);
  app.appendChild(sheetWrap);

  function openSheet(mode, target) {
    sheetMode = mode;
    editTarget = target || null;

    if (mode === 'subject') {
      sheetTitle.textContent = 'Add Subject';
      sheetLabel.textContent = 'Subject name';
      sheetInput.placeholder = 'e.g. Mathematics';
      sheetInput.value = '';
      sheetCat = 'jee';                       /* naya subject : default JEE */
    } else if (mode === 'chapter') {
      sheetTitle.textContent = 'Add Chapter';
      sheetLabel.textContent = 'Chapter name';
      sheetInput.placeholder = 'e.g. Quadratic Equations';
      sheetInput.value = '';
      sheetCat = null;
    } else if (mode === 'edit-subject') {
      sheetTitle.textContent = 'Edit Subject';
      sheetLabel.textContent = 'Subject name';
      sheetInput.placeholder = 'Subject name';
      sheetInput.value = target.name;
      sheetCat = target.cat || null;          /* current category preselect */
    } else {
      sheetTitle.textContent = 'Edit Chapter';
      sheetLabel.textContent = 'Chapter name';
      sheetInput.placeholder = 'Chapter name';
      sheetInput.value = target.name;
      sheetCat = null;
    }

    /* category selector sirf subject add/edit modes mein dikhe */
    var showCat = (mode === 'subject' || mode === 'edit-subject');
    sheetCatLabel.style.display = showCat ? '' : 'none';
    sheetCatRow.style.display = showCat ? '' : 'none';
    paintSheetCat();

    sheetOpen = true;
    if (sheetHideTimer) { window.clearTimeout(sheetHideTimer); sheetHideTimer = null; }
    sheetWrap.style.visibility = 'visible';
    sheetWrap.style.pointerEvents = 'auto';
    app.classList.add('sheet-open');            /* scrim fade-in */
    window.requestAnimationFrame(function () {
      /* box + input + buttons — sab ek saath fade-in */
      if (sheetOpen) sheetWrap.style.opacity = '1';
    });
    window.setTimeout(function () {
      if (sheetOpen) { sheetInput.focus(); sheetInput.select(); }
    }, 260);
  }

  function closeSheet() {
    if (!sheetOpen) return;
    sheetOpen = false;
    app.classList.remove('sheet-open');        /* scrim fade-out (.22s) */
    /* box + input + buttons — sab EK SAATH fade-out,
       koi hissa pehle/baad mein nahi jaata */
    sheetWrap.style.opacity = '0';
    sheetWrap.style.pointerEvents = 'none';
    /* fade khatam hone par wrapper poori tarah chhupao */
    if (sheetHideTimer) window.clearTimeout(sheetHideTimer);
    sheetHideTimer = window.setTimeout(function () {
      sheetHideTimer = null;
      if (!sheetOpen) sheetWrap.style.visibility = 'hidden';
    }, 240);
  }

  function saveSheet() {
    if (!sheetOpen) return;               /* double-save guard */
    var name = sheetInput.value.trim();
    if (!name) { sheetInput.focus(); return; }

    try {
      if (sheetMode === 'chapter') {
        if (currentSubject) currentSubject.chapters.push({ id: uid(), name: name });
      } else if (sheetMode === 'edit-chapter' && editTarget) {
        editTarget.name = name;
        if (currentChapter === editTarget) viewTitle.textContent = name;
      } else if (sheetMode === 'subject') {
        /* SUBJECT-CAT: category ke saath naya subject */
        ST.state.subjects.push({ id: uid(), name: name, chapters: [], cat: sheetCat || null });
        /* agar active filter mein naya subject dikhega hi nahi (jaise
           Boards filter ON hai aur subject JEE bana), to filter "All"
           par reset karo — user ko naya subject turant dikhna chahiye */
        if (subjectFilter !== 'all' && subjectFilter !== (sheetCat || null)) {
          subjectFilter = 'all';
          paintFilterChips();
        }
      } else if (sheetMode === 'chapter') {
      } else if (sheetMode === 'edit-subject' && editTarget) {
        editTarget.name = name;
        editTarget.cat = sheetCat || null;    /* SUBJECT-CAT: category update */
        if (currentSubject === editTarget) chapTitle.textContent = name;
      }
      ST.persist();

      /* dono lists refresh : subject card ka chapter count bhi update rahe */
      renderSubjects();
      renderChapters();
    } finally {
      closeSheet();                      /* save ke baad popup hamesha band */
    }
  }

  /* ================================================================
     DELETE
  ================================================================ */
  function deleteSubject(subject) {
    ST.state.subjects = ST.state.subjects.filter(function (s) { return s !== subject; });
    if (currentSubject === subject) currentSubject = null;
    ST.persist();
    renderSubjects();
    renderChapters();
  }

  function deleteChapter(chapter) {
    if (!currentSubject) return;
    currentSubject.chapters = currentSubject.chapters.filter(function (c) { return c !== chapter; });
    if (currentChapter === chapter) currentChapter = null;
    ST.persist();
    renderSubjects();
    renderChapters();
  }

  /* ================================================================
     RENDER : SUBJECT CARDS
  ================================================================ */

  /* FAIL-SAFE progress : ChapterProgress na ho ya data odd ho to bhi bar chale */
  function safeSubjectPct(subject) {
    try {
      if (window.ChapterProgress) return window.ChapterProgress.subjectPct(subject);
    } catch (e) { }
    try { return ST.pctOf(ST.doneCount(subject), (subject.chapters || []).length); } catch (e) { return 0; }
  }
  function safeChapterPct(chapter) {
    try {
      if (window.ChapterProgress) return window.ChapterProgress.chapterPct(chapter);
    } catch (e) { }
    return 0;
  }

  function renderSubjects() {
    try { renderSubjectsInner(); } catch (e) {
      /* screen blank na ho : kam se kam empty state dikhe */
      try {
        var sc = window.ST.subjectScreen();
        if (sc) sc.innerHTML = '<div style="padding:20px;color:var(--slate);font-size:12px">Subjects load nahi ho paye: ' + (e && e.message ? e.message : 'error') + '</div>';
      } catch (e2) { }
    }
  }
  function renderSubjectsInner() {
    subjectList.innerHTML = '';

    /* header eyebrow : LIBRARY · N SUBJECTS */
    subjectEyebrow.textContent = 'Library · ' + ST.state.subjects.length +
      (ST.state.subjects.length === 1 ? ' subject' : ' subjects');

    if (!ST.state.subjects.length) {
      var empty = el('div', 'empty', 'No subjects yet.<br>+ button se apna pehla subject add karo.');
      empty.style.margin = '0 18px 12px';
      subjectList.appendChild(empty);
      updateBooks();
      return;
    }

    /* SUBJECT-CAT FILTER : 'all' → sab subjects, warna sirf matching
       category. forEach ORIGINAL list par chalta hai (index i se tile
       color stable rehta hai — filter badalne par card ke rang
       idhar-udhar nahi hote), bas non-matching cards skip hote hain. */
    var shown = 0;
    ST.state.subjects.forEach(function (subject, i) {
      if (subjectFilter !== 'all' && (subject.cat || null) !== subjectFilter) return;
      shown++;
      var total = subject.chapters.length;
      var done = ST.doneCount(subject);
      var pct = safeSubjectPct(subject);

      var card = el('div', 'sub-card');
      var tile = el('div', 'sub-tile t' + (i % 5),
        esc(subject.name.charAt(0).toUpperCase()));
      compactCard(card, tile);
      card.appendChild(tile);

      var main = el('div', 'sub-main');

      /* name row + 3-dot end mein */
      var top = el('div', 'cb-top');
      top.style.marginBottom = '8px';
      top.appendChild(el('h3', null, esc(subject.name)));
      top.appendChild(kebab(function () { togglePop(pop); }));
      main.appendChild(top);

      /* progress bar + highlighted % bar ke end mein */
      var mid = el('div', 'cb-mid');
      mid.style.marginBottom = '6px';
      var bar = el('div', 'cb-bar');
      var fill = el('i');
      fill.style.width = pct + '%';
      bar.appendChild(fill);
      mid.appendChild(bar);
      mid.appendChild(el('span', 'cb-pct', pct + '%'));

      /* subject ka TOTAL study time : name aur progress bar ke beech
         wale GAP (8px) ke andar — ABSOLUTE position, flow se bahar.
         Isliye time dikhne par bhi card ki height bilkul wahi rehti
         hai jo bina time ke hoti hai (koi extra line add nahi hoti). */
      var subMs = ST.studyMsForSubject(subject.id);
      if (subMs > 0) {
        top.style.position = 'relative';
        var tl2 = el('div', null, 'Total study : ' + ST.fmtHMS(subMs));
        tl2.style.cssText = 'position:absolute;left:0;top:100%;margin-top:4px;' +
          'transform:translateY(-50%);font-size:9px;line-height:1;' +
          'letter-spacing:.02em;color:var(--ash);white-space:nowrap;' +
          'pointer-events:none';
        top.appendChild(tl2);
      }
      main.appendChild(mid);

      /* category (JEE/Boards) · done/total chapters · % line
         (category META line mein hi — card ki height wahi rehti hai,
         jaise study-time label ke saath ki gayi thi) */
      var catLbl = ST.subjectCatLabel ? ST.subjectCatLabel(subject.cat) : '';
      main.appendChild(el('div', 'sub-meta',
        (catLbl ? esc(catLbl) + ' · ' : '') + done + '/' + total + ' chapters · ' + pct + '%'));

      card.appendChild(main);

      /* 3-dot popover : Edit / Delete */
      var pop = makePop(
        function () { openSheet('edit-subject', subject); },
        function () { deleteSubject(subject); }
      );
      card.appendChild(pop);

      card.addEventListener('click', function () { openChapters(subject); });
      subjectList.appendChild(card);
    });

    /* SUBJECT-CAT FILTER: is filter mein ek bhi subject nahi aaya */
    if (!shown) {
      var fLabel = 'All';
      FILTERS.forEach(function (f) { if (f.id === subjectFilter) fLabel = f.label; });
      var fEmpty = el('div', 'empty',
        'No ' + esc(fLabel) + ' subjects yet.<br>' +
        (subjectFilter === 'all'
          ? '+ button se apna pehla subject add karo.'
          : 'Koi subject is category mein nahi hai — "All" chip par jao<br>' +
            'ya subject ko Edit karke category set karo.'));
      fEmpty.style.margin = '0 18px 12px';
      subjectList.appendChild(fEmpty);
    }

    updateBooks();
  }

  /* ================================================================
     RENDER : CHAPTER CARDS (screenshot jaisa card design)
  ================================================================ */
  function renderChapters() {
    chapterList.innerHTML = '';
    if (!currentSubject) return;

    if (!currentSubject.chapters.length) {
      var empty = el('div', 'empty',
        'No chapters yet.<br>+ button se apna pehla chapter add karo.');
      empty.style.margin = '0 18px 12px';
      chapterList.appendChild(empty);
      return;
    }

    currentSubject.chapters.forEach(function (chapter, i) {
      var card = el('div', 'sub-card');
      var tile = el('div', 'sub-tile t' + (i % 5),
        esc(chapter.name.charAt(0).toUpperCase()));
      compactCard(card, tile);
      card.appendChild(tile);

      var main = el('div', 'sub-main');

      /* name + EXAM READY label (study time label ke JUST AAGE),
         aur 3-dot end mein */
      var chMs = ST.studyMsForChapter(chapter.id);
      var top = el('div', 'cb-top');
      top.style.marginBottom = '8px';
      var head = el('div');
      var h3 = el('h3', null, esc(chapter.name));
      h3.style.marginTop = '0';
      var label = el('div', 'eyebrow', 'Exam ready');
      label.style.marginTop = '1px';
      if (chMs > 0) {
        var tSpan = el('span', null, ' \u00b7 ' + ST.fmtHMS(chMs));
        tSpan.style.cssText = 'text-transform:none;letter-spacing:.04em';
        label.appendChild(tSpan);
      }
      head.appendChild(h3);
      head.appendChild(label);
      top.appendChild(head);
      top.appendChild(kebab(function () { togglePop(pop); }));
      main.appendChild(top);

      /* progress bar + % : ChapterProgress (topics+sources+recall+qrev) */
      var cpct = safeChapterPct(chapter);
      var mid = el('div', 'cb-mid');
      mid.style.marginBottom = '6px';
      var bar = el('div', 'cb-bar');
      var fill = el('i');
      fill.style.width = cpct + '%';
      bar.appendChild(fill);
      mid.appendChild(bar);
      mid.appendChild(el('span', 'cb-pct', cpct + '%'));
      main.appendChild(mid);

      /* status line : values basics.js ke selectors se aati hain
         (study time ab "Exam ready" ke just aage upar dikhta hai) */
      main.appendChild(el('div', 'sub-meta',
        'Status: ' + (chapter.status || 'Not Started') +
        ' · Priority: ' + (chapter.priority || 'Low')));

      card.appendChild(main);

      /* 3-dot popover : Edit / Delete */
      var pop = makePop(
        function () { openSheet('edit-chapter', chapter); },
        function () { deleteChapter(chapter); }
      );
      card.appendChild(pop);

      card.addEventListener('click', function () { openChapterView(chapter); });
      chapterList.appendChild(card);
    });
  }

  /* ================================================================
     NAVIGATION
  ================================================================ */
  function openChapters(subject) {
    currentSubject = subject;
    chapTitle.textContent = subject.name;
    renderChapters();
    showScreen(chapterScreen, true);
  }

  function openChapterView(chapter) {
    currentChapter = chapter;
    ST.setStudyContext({
      subjectId: currentSubject ? currentSubject.id : null,
      subjectName: currentSubject ? currentSubject.name : '',
      chapterId: chapter.id,
      chapterName: chapter.name
    });
    viewTitle.textContent = chapter.name;
    viewMeta.textContent = currentSubject ? currentSubject.name : '';

    /* chapter ke andar ka content bottom tab se chalta hai
       (default : Basics → basics.js) */
    showTab('basics');
    showScreen(chapterViewScreen, true);
  }

  function refreshLists() {
    try { renderChapters(); } catch (e) { }
    try { renderSubjects(); } catch (e) { }
  }

  /* ================================================================
     EVENTS
  ================================================================ */
  addSubjectBtn.addEventListener('click', function () { openSheet('subject'); });
  addChapterBtn.addEventListener('click', function () { openSheet('chapter'); });

  chapBackBtn.addEventListener('click', function () { showScreen(subjectScreen, false); });
  viewBackBtn.addEventListener('click', function () { showScreen(chapterScreen, false); });

  sheetCancel.addEventListener('click', closeSheet);
  sheetScrim.addEventListener('click', closeSheet);
  sheetSave.addEventListener('click', saveSheet);
  sheetInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') saveSheet();
  });

  /* kahin bhi bahar click par popover band */

  window.ST.showScreen = showScreen;
  window.ST.subjectScreen = function () { return subjectScreen; };
  window.ST.chapterViewScreen = function () { return chapterViewScreen; };
  window.ST.getState = function () { return ST.state; };
  window.ST.goToChapter = function (subjectId, chapterId) {
    var sub = null;
    (ST.state.subjects || []).forEach(function (s) { if (s.id === subjectId) sub = s; });
    if (!sub) return;
    currentSubject = sub;
    var ch = null;
    (sub.chapters || []).forEach(function (c) { if (c.id === chapterId) ch = c; });
    if (!ch) return;
    openChapters(sub);
    openChapterView(ch);
  };
  window.ST.openChapterViewTab = function (key) {
    showScreen(chapterViewScreen, false);
    showTab(key);
  };
  window.ST.refreshLists = refreshLists;
  window.ST.renderSubjects = renderSubjects;
  window.ST.renderChapters = renderChapters;
  window.ST.initScreens = function () {
    renderSubjects();
    showScreen(subjectScreen, true);
  };
})();
