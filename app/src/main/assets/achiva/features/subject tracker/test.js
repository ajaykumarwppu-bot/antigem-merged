/* ================================================================
   FEATURES / SUBJECT TRACKER / TEST.JS  (PDF tree wala naam)
   ----------------------------------------------------------------
   TEST BOOK — user ke tests ka analysis (mock test, JEE Mains,
   JEE Advanced, kuch bhi):
     • Subject screen ke neeche "Test Book" book-card se khulti hai
     • Test Book screen : saare test cards (naya sabse upar),
       "Add Test" button
     • Add Test : POORI ALAG SCREEN (popup nahi) — staged flow :
         1. Test name (optional — na likhe to system "Test N"
            khud laga deta hai)
         2. Choose Subjects → sabhi added subjects ke chhote
            cards, multi-select → Save
         3. Choose Chapters → chune gaye subjects ke sabhi
            chapters subject-wise groups mein, multi-select → Save
         4. Test type (JEE Mains / JEE Advanced / Mock Test),
            total questions, attempted questions, marks obtained,
            total marks, optional rank (rank + rank out of)
            → Save Test
     • Test card : name, type, date, total/attempted questions,
            marks obtained/total, rank (agar hai)
     • Card click → poori detail screen (subjects, chapters,
            saara data wapas)
   Data state.tests mein (list.js bridge ke through) :
   core/storage.js se persist.
   ================================================================ */

(function () {
  'use strict';

  if (window.__achivaTestLoaded) return;
  window.__achivaTestLoaded = true;

  var el = UI.el, esc = UI.esc, uid = UI.uid;
  var ICON_BACK = UI.icons.back;
  var ICON_PLUS = UI.icons.plus;

  function bridge() { return window.SubjectListBridge; }
  function state() { return bridge().getState(); }

  var TEST_TYPES = ['JEE Mains', 'JEE Advanced', 'Mock Test'];

  /* ================================================================
     SCREENS
  ================================================================ */
  function makeScreen() {
    var s = el('section', 'screen');
    s.style.paddingTop = '58px';
    document.getElementById('app').appendChild(s);
    return s;
  }

  function screenHeader(screen, title, subtitle, onBack, rightBtn) {
    var head = el('div');
    head.style.cssText = 'display:flex;align-items:center;gap:12px;padding:12px 18px 4px';
    var back = el('button', 'icon-btn', ICON_BACK);
    back.type = 'button';
    back.setAttribute('aria-label', 'Back');
    back.addEventListener('click', onBack);
    var tw = el('div', 'sub-title-wrap');
    tw.appendChild(el('h2', null, title));
    if (subtitle) tw.appendChild(el('div', 'sub-meta', subtitle));
    head.appendChild(back);
    head.appendChild(tw);
    if (rightBtn) head.appendChild(rightBtn);
    screen.appendChild(head);
  }

  var bookScreen = makeScreen();
  var formScreen = makeScreen();
  var detailScreen = makeScreen();

  /* ================================================================
     TEST BOOK SCREEN
  ================================================================ */
  function openBook() {
    renderBook();
    bridge().show(bookScreen, true);
  }

  function renderBook() {
    bookScreen.innerHTML = '';
    var addBtn = UI.pillBtn(ICON_PLUS + ' <span>Add Test</span>');
    addBtn.addEventListener('click', openForm);
    screenHeader(bookScreen, 'Test Book', 'Add Test Analysis', function () {
      bridge().show(bridge().subjectScreen(), false);
    }, addBtn);

    var wrap = el('div', 'scroll');
    var tests = state().tests;
    if (!tests.length) {
      var empty = el('div', 'empty', 'Koi test add nahi kiya.<br>Add Test se apna pehla test add karo.');
      empty.style.margin = '12px 18px';
      wrap.appendChild(empty);
    }
    tests.slice().reverse().forEach(function (t) {
      wrap.appendChild(testCard(t));
    });
    bookScreen.appendChild(wrap);
  }

  function testCard(t) {
    var card = el('div', 'sub-card');
    card.style.padding = '12px 30px 12px 12px';
    var tile = el('div', 'sub-tile t2', 'T');
    tile.style.width = '40px';
    tile.style.height = '40px';
    tile.style.borderRadius = '12px';
    tile.style.fontSize = '16px';
    card.appendChild(tile);

    var main = el('div', 'sub-main');
    var top = el('div', 'cb-top');
    top.style.marginBottom = '6px';
    var head = el('div');
    head.style.cssText = 'flex:1;min-width:0';
    head.appendChild(el('h3', null, esc(t.name)));
    head.appendChild(el('div', 'sub-meta', esc(t.type) + ' · ' + t.date));
    top.appendChild(head);
    top.appendChild(UI.chip(t.type));
    main.appendChild(top);

    main.appendChild(el('div', 'sub-meta',
      'Questions: ' + t.attempted + '/' + t.totalQ + ' · Marks: ' + t.marksGot + '/' + t.marksTotal +
      (t.rank ? ' · Rank: ' + t.rank + (t.rankTotal ? '/' + t.rankTotal : '') : '')));
    card.appendChild(main);

    card.addEventListener('click', function () { openDetail(t); });
    return card;
  }

  /* ================================================================
     ADD TEST — poori alag screen (staged)
  ================================================================ */
  var form = null;

  function openForm() {
    form = {
      name: '', subjectIds: [], chapterPicks: [], type: null,
      totalQ: '', attempted: '', marksGot: '', marksTotal: '',
      rank: '', rankTotal: ''
    };
    renderForm();
    bridge().show(formScreen, true);
  }

  /* single-page form : Name → Choose Subjects → Choose Chapters
     → Test Details → Save Test (koi alag choose/save button nahi) */
  function renderForm() {
    var prevScroll = formScreen.querySelector('.scroll');
    var st = prevScroll ? prevScroll.scrollTop : 0;
    formScreen.innerHTML = '';
    screenHeader(formScreen, 'Add Test', 'Test ka poora data bharo', function () {
      bridge().show(bookScreen, false);
    });

    var wrap = el('div', 'scroll');

    /* ---- 1) test name ---- */
    var nameP = UI.panel();
    nameP.appendChild(UI.panelTitle('Test Name'));
    var nameF = UI.inputField('Test name (optional)', 'Test name (optional — default Test N)');
    nameP.appendChild(nameF.wrap);
    nameP.appendChild(el('div', 'sub-meta', 'Khali chhoda to system automatic "Test ' +
      (state().tests.length + 1) + '" laga dega.'));
    wrap.appendChild(nameP);

    /* ---- 2) choose subjects (sirf heading + subjects) ---- */
    var subP = UI.panel();
    subP.appendChild(UI.panelTitle('Choose Subjects'));
    var subGrid = el('div');
    subGrid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:8px';
    if (!state().subjects.length) {
      subGrid.appendChild(el('div', 'sub-meta', 'Koi subject added nahi hai.'));
    }
    state().subjects.forEach(function (s) {
      var c = el('div');
      var sel = form.subjectIds.indexOf(s.id) > -1;
      c.style.cssText = 'padding:10px 12px;border-radius:12px;cursor:pointer;font-size:12.5px;font-weight:600;' +
        'transition:.15s;' +
        (sel
          ? 'background:var(--ink);color:var(--paper);border:1px solid var(--line-strong)'
          : 'background:var(--chip-bg);color:var(--slate);border:1px solid var(--s2)');
      c.textContent = s.name;
      c.addEventListener('click', function () {
        var i = form.subjectIds.indexOf(s.id);
        if (i > -1) {
          form.subjectIds.splice(i, 1);
          /* is subject ke chapters bhi hata do */
          form.chapterPicks = form.chapterPicks.filter(function (p) { return p.sid !== s.id; });
        } else {
          form.subjectIds.push(s.id);
        }
        renderForm();
      });
      subGrid.appendChild(c);
    });
    subP.appendChild(subGrid);
    wrap.appendChild(subP);

    /* ---- 3) choose chapters (sirf heading; selected subjects ke chapters) ---- */
    var chP = UI.panel();
    chP.appendChild(UI.panelTitle('Choose Chapters'));
    var chosenSubjects = state().subjects.filter(function (s) {
      return form.subjectIds.indexOf(s.id) > -1;
    });
    if (!chosenSubjects.length) {
      chP.appendChild(el('div', 'sub-meta', 'Pehle subjects choose karo — phir unke chapters yahan dikhenge.'));
    }
    chosenSubjects.forEach(function (s) {
      var g = el('div');
      g.style.marginBottom = '10px';
      g.appendChild(UI.label(s.name));
      var chips = el('div');
      chips.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap';
      (s.chapters || []).forEach(function (ch) {
        var picked = form.chapterPicks.some(function (p) { return p.cid === ch.id; });
        var b = el('button', null, esc(ch.name));
        b.type = 'button';
        b.style.cssText = 'padding:7px 12px;border-radius:99px;cursor:pointer;font:inherit;' +
          'font-size:11.5px;font-weight:600;transition:.15s;' +
          (picked
            ? 'background:var(--ink);color:var(--paper);border:1px solid var(--line-strong)'
            : 'background:var(--chip-bg);color:var(--slate);border:1px solid var(--s2)');
        b.addEventListener('click', function () {
          var i = -1;
          form.chapterPicks.forEach(function (p, idx) { if (p.cid === ch.id) i = idx; });
          if (i > -1) form.chapterPicks.splice(i, 1);
          else form.chapterPicks.push({ sid: s.id, sname: s.name, cid: ch.id, cname: ch.name });
          renderForm();
        });
        chips.appendChild(b);
      });
      if (!(s.chapters || []).length) {
        chips.appendChild(el('div', 'sub-meta', 'Koi chapter nahi.'));
      }
      g.appendChild(chips);
      chP.appendChild(g);
    });
    wrap.appendChild(chP);

    /* ---- 4) test details ---- */
    var dP = UI.panel();
    dP.appendChild(UI.panelTitle('Test Details'));
    dP.appendChild(UI.label('Test type:'));
    var typeRow = UI.chipRow(TEST_TYPES, form.type);
    dP.appendChild(typeRow.row);
    var typeMsg = el('div', 'sub-meta', '');
    typeMsg.style.marginTop = '8px';
    dP.appendChild(typeMsg);

    var g2 = el('div');
    g2.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px';
    var fTQ = UI.inputField('Total questions', 'e.g. 75', 'number');
    var fAQ = UI.inputField('Attempted questions', 'e.g. 60', 'number');
    var fMG = UI.inputField('Marks obtained', 'e.g. 210', 'number');
    var fMT = UI.inputField('Total marks', 'e.g. 300', 'number');
    g2.appendChild(fTQ.wrap); g2.appendChild(fAQ.wrap);
    g2.appendChild(fMG.wrap); g2.appendChild(fMT.wrap);
    dP.appendChild(g2);

    dP.appendChild(UI.label('Rank (optional):'));
    var g3 = el('div');
    g3.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:10px';
    var fR = UI.inputField('Rank', 'e.g. 1200', 'number');
    var fRT = UI.inputField('Rank out of', 'e.g. 45000', 'number');
    g3.appendChild(fR.wrap); g3.appendChild(fRT.wrap);
    dP.appendChild(g3);

    var saveBtn = UI.solidBtn('Save Test');
    saveBtn.style.marginTop = '14px';
    saveBtn.addEventListener('click', function () {
      var type = typeRow.get();
      if (!type) {
        typeMsg.textContent = 'Test type chuno (JEE Mains / JEE Advanced / Mock Test).';
        return;
      }
      var num = function (v) {
        var n = parseInt(v, 10);
        return isNaN(n) || n < 0 ? 0 : n;
      };
      var name = nameF.input.value.trim() || ('Test ' + (state().tests.length + 1));
      state().tests.push({
        id: uid(),
        name: name,
        date: UI.fmtDate(UI.todayISO()),
        type: type,
        subjects: form.subjectIds.map(function (id) {
          var s = state().subjects.filter(function (x) { return x.id === id; })[0];
          return { id: id, name: s ? s.name : '?' };
        }),
        chapters: form.chapterPicks.map(function (p) {
          return { subjectName: p.sname, name: p.cname };
        }),
        totalQ: num(fTQ.input.value),
        attempted: num(fAQ.input.value),
        marksGot: num(fMG.input.value),
        marksTotal: num(fMT.input.value),
        rank: fR.input.value.trim() ? num(fR.input.value) : null,
        rankTotal: fRT.input.value.trim() ? num(fRT.input.value) : null
      });
      bridge().persist();
      renderBook();
      bridge().show(bookScreen, false);
    });
    dP.appendChild(saveBtn);
    wrap.appendChild(dP);

    formScreen.appendChild(wrap);
    wrap.scrollTop = st;
  }

  /* ================================================================
     TEST DETAIL SCREEN
  ================================================================ */
  var detailTest = null;

  function openDetail(t) {
    detailTest = t;
    renderDetail();
    bridge().show(detailScreen, true);
  }

  function renderDetail() {
    var t = detailTest;
    detailScreen.innerHTML = '';
    screenHeader(detailScreen, esc(t.name), esc(t.type) + ' · ' + t.date, function () {
      bridge().show(bookScreen, false);
    });

    var wrap = el('div', 'scroll');

    var stats = UI.panel();
    var grid = el('div');
    grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px';
    grid.appendChild(UI.tile(t.totalQ, 'total q'));
    grid.appendChild(UI.tile(t.attempted, 'attempted'));
    grid.appendChild(UI.tile(t.marksGot + '/' + t.marksTotal, 'marks'));
    stats.appendChild(grid);
    if (t.rank) {
      var rline = el('div', 'sub-meta', 'Rank: ' + t.rank + (t.rankTotal ? ' / ' + t.rankTotal : ''));
      rline.style.marginTop = '8px';
      stats.appendChild(rline);
    }
    wrap.appendChild(stats);

    var sp = UI.panel();
    sp.appendChild(UI.panelTitle('Subjects'));
    if (!t.subjects.length) sp.appendChild(el('div', 'sub-meta', 'Koi subject nahi chuna tha.'));
    var schips = el('div');
    schips.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap';
    t.subjects.forEach(function (s) { schips.appendChild(UI.chip(esc(s.name))); });
    sp.appendChild(schips);
    wrap.appendChild(sp);

    var cp = UI.panel();
    cp.appendChild(UI.panelTitle('Chapters'));
    if (!t.chapters.length) cp.appendChild(el('div', 'sub-meta', 'Koi chapter nahi chuna tha.'));
    var bySub = {};
    t.chapters.forEach(function (c) {
      if (!bySub[c.subjectName]) bySub[c.subjectName] = [];
      bySub[c.subjectName].push(c.name);
    });
    Object.keys(bySub).forEach(function (sn) {
      cp.appendChild(UI.label(sn + ':'));
      var chips = el('div');
      chips.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px';
      bySub[sn].forEach(function (cn) { chips.appendChild(UI.chip(esc(cn))); });
      cp.appendChild(chips);
    });
    wrap.appendChild(cp);

    detailScreen.appendChild(wrap);
  }

  /* ================================================================
     EXPORT
  ================================================================ */
  window.TestBook = { open: openBook };
})();
