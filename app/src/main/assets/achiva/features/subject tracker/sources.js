/* ================================================================
   FEATURES / SUBJECT TRACKER / SOURCES.JS  —  SOURCES LIST PART
   ----------------------------------------------------------------
   Sources tab ka LIST hissa :
     • header : left + button (source add), right Summary button
     • Add/Edit Source popup : name, total questions,
       category (PYQ / Normal)
     • Summary card (collapsible) : poore chapter ke sources ka
       overview — sources (total/normal/pyq), questions
       (normal/pyq/total), solved/doubt/analysis questions,
       important, attempts (2/3/4+)
     • Source cards : name, total/solved, category tag, 3-dot
       popover (Edit / Delete do-click confirm)
     • card click → detail hissa sources-detail.js ko saunpa jata
       hai (window.SourcesDetail.render)
   Saanjhe UI tools core/ui.js (window.UI) se aate hain.
   Data chapter.sources mein : core/storage.js se persist.
   List.js ke bottom tab se hook : window.Sources.renderChapterView.
   ================================================================ */

(function () {
  'use strict';

  if (window.__achivaSourcesLoaded) return;
  window.__achivaSourcesLoaded = true;

  /* core/ui.js ke saanjhe tools (naam wahi, isliye baaki code untouched) */
  var el = UI.el, esc = UI.esc, uid = UI.uid;
  var sortedUnique = UI.sortedUnique;
  var closePops = UI.closePops, togglePop = UI.togglePop;
  var panel = UI.panel, label = UI.label, pillBtn = UI.pillBtn, tile = UI.tile;
  var inputField = UI.inputField, chipRow = UI.chipRow;
  var ICON_PLUS = UI.icons.plusBig;
  var ICON_BACK = UI.icons.back;
  var ICON_KEBAB = UI.icons.kebab;
  var ICON_SUM = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 3v18h18"/><path d="M8 17v-6M13 17V7M18 17v-4"/></svg>';

  var hooks = null;
  var chapter = null;
  var container = null;
  var detailSource = null;   /* null = list view, warna source object */
  var summaryOpen = false;

  /* ================================================================
     DATA HELPERS
  ================================================================ */
  function ensure(ch) {
    if (!Array.isArray(ch.sources)) ch.sources = [];
  }

  function ensureSource(s) {
    if (!Array.isArray(s.solved)) s.solved = [];
    if (!Array.isArray(s.doubt)) s.doubt = [];
    if (!Array.isArray(s.analysis)) s.analysis = [];
    if (!Array.isArray(s.important)) s.important = [];
    if (!Array.isArray(s.attempts)) s.attempts = [];
    if (!Array.isArray(s.pages)) s.pages = [];
    if (typeof s.total !== 'number') s.total = parseInt(s.total, 10) || 0;
    if (s.category !== 'PYQ') s.category = 'Normal';

    /* ---- migrate : attempts {q,attempts} → attempt-groups {attempts,qs} ---- */
    var needMigrateAtt = s.attempts.some(function (a) { return !Array.isArray(a.qs); });
    if (needMigrateAtt) {
      var attMap = {};
      var attId = {};
      s.attempts.forEach(function (a) {
        var qs = Array.isArray(a.qs) ? a.qs : (a.q ? [a.q] : []);
        if (!attMap[a.attempts]) { attMap[a.attempts] = []; attId[a.attempts] = a.id || uid(); }
        attMap[a.attempts] = attMap[a.attempts].concat(qs);
      });
      s.attempts = Object.keys(attMap).map(function (k) {
        return { id: attId[k], attempts: k, qs: sortedUnique(attMap[k]) };
      });
    }

    /* ---- migrate : pages {page,topic,q} → page-groups {page,topics,qs} ---- */
    var needMigratePg = s.pages.some(function (p) { return !Array.isArray(p.topics); });
    if (needMigratePg) {
      var pgMap = {};
      s.pages.forEach(function (p) {
        var topics = Array.isArray(p.topics) ? p.topics : (p.topic != null ? [p.topic] : []);
        var qs = Array.isArray(p.qs) ? p.qs : (p.q != null ? [p.q] : []);
        if (!pgMap[p.page]) pgMap[p.page] = { id: p.id || uid(), page: p.page, topics: [], qs: [] };
        topics.forEach(function (t) {
          if (pgMap[p.page].topics.indexOf(t) === -1) pgMap[p.page].topics.push(t);
        });
        qs.forEach(function (q) {
          if (pgMap[p.page].qs.indexOf(q) === -1) pgMap[p.page].qs.push(q);
        });
      });
      s.pages = Object.keys(pgMap).map(function (k) {
        pgMap[k].page = parseInt(k, 10);
        pgMap[k].qs = sortedUnique(pgMap[k].qs);
        return pgMap[k];
      });
    }
  }

  function commit() {
    if (hooks && hooks.persist) hooks.persist();
  }

  function makePop(onEdit, onDelete) {
    return UI.makeKebabPop(onEdit, onDelete);
  }

  function kebab(onClick) {
    var k = UI.miniBtn(ICON_KEBAB, 'Edit or delete');
    k.addEventListener('click', function (e) {
      e.stopPropagation();
      onClick();
    });
    return k;
  }

  function tagChip(category) {
    return UI.chip(category, category === 'PYQ' ? 'done' : null);
  }

  /* ================================================================
     MODAL (core/ui.js factory) — add/edit source
  ================================================================ */
  var sheetModal = UI.modal({ zScrim: 81, zWrap: 82 });
  var sheetBody = null;

  function openModal(title, build, saveFn) {
    sheetModal.open(title, function (b) { sheetBody = b; build(b); }, saveFn);
  }

  function closeModal() { sheetModal.close(); }

  function openSourceModal(existing) {
    openModal(existing ? 'Edit Source' : 'Add Source', function (body) {
      var nameF = inputField('Source name', 'e.g. Physics PYQ 2024');
      var totalF = inputField('Total questions', 'e.g. 40', 'number');
      var catWrap = el('div');
      catWrap.appendChild(label('Category:'));
      var cat = chipRow(['Normal', 'PYQ'], existing ? existing.category : 'Normal');
      catWrap.appendChild(cat.row);
      body.appendChild(nameF.wrap);
      body.appendChild(totalF.wrap);
      body.appendChild(catWrap);
      if (existing) {
        nameF.input.value = existing.name;
        totalF.input.value = existing.total;
      }
      body._get = function () {
        return {
          name: nameF.input.value.trim(),
          total: parseInt(totalF.input.value, 10),
          category: cat.get()
        };
      };
      window.setTimeout(function () { if (sheetModal.isOpen()) nameF.input.focus(); }, 260);
    }, function () {
      var v = sheetBody._get();
      if (!v.name) return;
      if (isNaN(v.total) || v.total < 0) v.total = 0;
      if (existing) {
        existing.name = v.name;
        existing.total = v.total;
        existing.category = v.category;
        /* total kam hua to naye total se bade question numbers HAR JAGAH
           se hat jate hain : solved / doubt / analysis / important /
           attempts / pages */
        existing.solved = existing.solved.filter(function (n) { return n <= v.total; });
        existing.doubt = existing.doubt.filter(function (n) { return n <= v.total; });
        existing.analysis = existing.analysis.filter(function (n) { return n <= v.total; });
        existing.important = existing.important.filter(function (n) { return n <= v.total; });
        /* attempt-groups {attempts, qs} shape mein hain : har group ke qs
           ko naye total tak rakho, phir khali groups hatao (data loss nahi) */
        existing.attempts.forEach(function (g) {
          g.qs = (g.qs || []).filter(function (n) { return n <= v.total; });
        });
        existing.attempts = existing.attempts.filter(function (g) { return g.qs.length; });
        /* page-groups : qs bhi total ke andar hone chahiye; jinke paas
           na topic bache na question, wo page entry hatao */
        existing.pages.forEach(function (pg) {
          pg.qs = (pg.qs || []).filter(function (n) { return n <= v.total; });
        });
        existing.pages = existing.pages.filter(function (pg) {
          return pg.topics.length || pg.qs.length;
        });
      } else {
        chapter.sources.push({
          id: uid(), name: v.name, total: v.total, category: v.category,
          solved: [], doubt: [], analysis: [], important: [],
          attempts: [], pages: []
        });
      }
      closeModal();
      commit();
      rerender();
    });
  }

  /* ================================================================
     LIST VIEW
  ================================================================ */
  function summaryData() {
    var srcs = chapter.sources;
    var d = {
      totalSources: srcs.length, normalSources: 0, pyqSources: 0,
      totalQuestions: 0, normalQuestions: 0, pyqQuestions: 0,
      solved: 0, doubt: 0, analysis: 0,
      important: 0, att2: 0, att3: 0, att4: 0
    };
    srcs.forEach(function (s) {
      ensureSource(s);
      if (s.category === 'PYQ') { d.pyqSources++; d.pyqQuestions += s.total; }
      else { d.normalSources++; d.normalQuestions += s.total; }
      d.totalQuestions += s.total;
      d.solved += s.solved.length;
      d.doubt += s.doubt.length;
      d.analysis += s.analysis.length;
      d.important += s.important.length;
      s.attempts.forEach(function (a) {
        var n = a.qs.length;
        if (a.attempts === '2') d.att2 += n;
        else if (a.attempts === '3') d.att3 += n;
        else d.att4 += n;
      });
    });
    return d;
  }

  function summaryPanel() {
    var d = summaryData();
    var p = panel();
    p.appendChild(label('Summary'));
    var grid = el('div');
    grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px';
    /* sequence : sources (total/normal/pyq) → questions (normal/pyq/total)
       → solved / doubt / analysis → important → attempts (2/3/4+) */
    [
      [d.totalSources, 'sources'], [d.normalSources, 'normal src'], [d.pyqSources, 'pyq src'],
      [d.normalQuestions, 'normal q'], [d.pyqQuestions, 'pyq q'], [d.totalQuestions, 'total q'],
      [d.solved, 'solved q'], [d.doubt, 'doubt q'], [d.analysis, 'analysis q'],
      [d.important, 'important'], [d.att2, '2 attempts'], [d.att3, '3 attempts'], [d.att4, '4+ attempts']
    ].forEach(function (item) {
      grid.appendChild(tile(item[0], item[1]));
    });
    p.appendChild(grid);
    return p;
  }

  function sourceCard(s, index) {
    ensureSource(s);
    var card = el('div', 'sub-card');
    card.style.padding = '12px 30px 12px 12px';
    var tileEl = el('div', 'sub-tile t' + (index % 5), esc(s.name.charAt(0).toUpperCase()));
    tileEl.style.width = '40px';
    tileEl.style.height = '40px';
    tileEl.style.borderRadius = '12px';
    tileEl.style.fontSize = '16px';
    card.appendChild(tileEl);

    var main = el('div', 'sub-main');
    var top = el('div', 'cb-top');
    top.style.marginBottom = '0';
    var head = el('div');
    head.style.cssText = 'flex:1;min-width:0';
    head.appendChild(el('h3', null, esc(s.name)));
    head.appendChild(el('div', 'sub-meta',
      s.total + ' questions · ' + s.solved.length + ' solved'));
    top.appendChild(head);
    var right = el('div');
    right.style.cssText = 'display:flex;align-items:center;gap:6px;flex:none';
    right.appendChild(tagChip(s.category));
    var pop = makePop(
      function () { openSourceModal(s); },
      function () {
        chapter.sources = chapter.sources.filter(function (x) { return x !== s; });
        if (detailSource === s) detailSource = null;
        commit();
        rerender();
      }
    );
    right.appendChild(kebab(function () { togglePop(pop); }));
    top.appendChild(right);
    main.appendChild(top);
    card.appendChild(main);
    card.appendChild(pop);

    card.addEventListener('click', function () {
      detailSource = s;
      rerender();
    });
    return card;
  }

  function renderList() {
    container.innerHTML = '';

    /* header : left + button, right summary button */
    var head = el('div');
    head.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:12px 18px 8px';
    var addBtn = el('button', 'add-btn', ICON_PLUS);
    addBtn.type = 'button';
    addBtn.setAttribute('aria-label', 'Add source');
    addBtn.addEventListener('click', function () { openSourceModal(null); });
    var sumBtn = pillBtn('');
    sumBtn.innerHTML = ICON_SUM + ' <span>Summary</span>';
    sumBtn.style.display = 'inline-flex';
    sumBtn.style.alignItems = 'center';
    sumBtn.style.gap = '7px';
    sumBtn.addEventListener('click', function () {
      summaryOpen = !summaryOpen;
      rerender();
    });
    head.appendChild(addBtn);
    head.appendChild(sumBtn);
    container.appendChild(head);

    if (summaryOpen) container.appendChild(summaryPanel());

    if (!chapter.sources.length) {
      var empty = el('div', 'empty', 'No sources yet.<br>+ button se apna pehla source add karo.');
      empty.style.margin = '0 18px 12px';
      container.appendChild(empty);
      return;
    }

    chapter.sources.forEach(function (s, i) {
      container.appendChild(sourceCard(s, i));
    });
  }

  /* ================================================================
     DETAIL VIEW → sources-detail.js ko delegate
     (detail ke andar Edit/Delete NAHI hota — wo sirf yahan list
     ke source-card ke 3-dot se hota hai)
  ================================================================ */
  function renderDetail() {
    if (window.SourcesDetail && window.SourcesDetail.render) {
      window.SourcesDetail.render(container, detailSource, {
        chapter: chapter,
        commit: commit,
        rerender: rerender,
        goBack: function () {
          detailSource = null;
          rerender();
        }
      });
    } else {
      var e = el('div', 'empty', 'Source detail unavailable.');
      e.style.margin = '18px 18px 12px';
      container.appendChild(e);
    }
  }

  /* ================================================================
     RENDER + ENTRY
  ================================================================ */
  function rerender() {
    if (!container || !chapter) return;
    var st = container.scrollTop;
    if (detailSource && chapter.sources.indexOf(detailSource) === -1) detailSource = null;
    if (detailSource) renderDetail();
    else renderList();
    container.scrollTop = st;
  }

  function renderChapterView(cont, ch, hk) {
    container = cont;
    chapter = ch;
    hooks = hk || hooks;
    ensure(ch);
    if (detailSource && ch.sources.indexOf(detailSource) === -1) detailSource = null;
    rerender();
  }

  window.Sources = { renderChapterView: renderChapterView };
})();
