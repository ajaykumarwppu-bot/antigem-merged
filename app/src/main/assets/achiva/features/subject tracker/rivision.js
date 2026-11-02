/* ================================================================
   FEATURES / SUBJECT TRACKER / RIVISION.JS   (PDF tree wala naam)
   ----------------------------------------------------------------
   Chapter view ke "Revision" bottom-tab ka content :

   A) RULES SCREEN (naya sub-screen)
      • "Rules" button se khulta hai
      • English note : default steps har revision mein dikhti hain,
        chahe to specific revision mein apni steps use karo
      • Chapter Revision Steps  : permanent/default steps (add,
        edit, delete) — chapter recall mein default use hoti hain
      • Question Revision Steps : permanent/default steps (add,
        edit, delete) — question revision mein default dikhti hain
      • Ye lists sirf Rules ke andar dikhti hain

   B) CHAPTER RECALL (spaced repetition) — main view
      • Chapter Revision History (rename) : number, date, time, star
      • Next revision pending card : rating ke hisaab se auto due
        (1★→2d, 2★→5d, 3★→8d, 4★→11d, 5★→15d), date edit :
        peeche kitna bhi, aage system-date se max +2 din
      • Start Recall → session : default chapter steps + personal
        steps tick karo → Complete Recall → rating popup
        (1★ Worst … 5★ Perfect)

   C) QUESTION REVISION (sources.js ke data se)
      • Start Question Revision → saare sources dikhte hain,
        unke andar : important questions, multiple-attempt questions
        (2/3/4+), important pages (topics + questions)
      • Har question ke saamne tick : user chunta hai kiska revision
        kiya; har item ke neeche "Revised ×N" (jitni baar hua)
      • Complete Revision → Question Revision History entry :
        kaunsa source, kaunse questions, kis part se
        (koi auto next-date nahi — button phir se available)

   Data chapter.revision mein save hota hai aur core/storage.js
   (window.AppStorage) ke through persist hota hai.
   List.js ke bottom tab se hook : window.Revision.renderChapterView.
   ================================================================ */

(function () {
  'use strict';

  if (window.__achivaRevisionLoaded) return;
  window.__achivaRevisionLoaded = true;

  /* rating → din ka gap (next chapter revision) */
  var GAPS = { 1: 2, 2: 5, 3: 8, 4: 11, 5: 15 };
  var RATING_LABEL = { 1: 'Worst', 2: 'Weak', 3: 'Average', 4: 'Good', 5: 'Perfect' };
  var MAX_FORWARD_DAYS = 2;

  var hooks = null;
  var chapter = null;
  var container = null;
  var mode = 'main';      /* 'main' | 'rules' | 'session' | 'qsession' */
  var session = null;     /* chapter recall session */
  var qsession = null;    /* question revision session */
  var qhOpen = {};        /* question revision history : kaunsi entry khuli hai */

  /* ================================================================
     HELPERS
  ================================================================ */
  /* core/ui.js ke saanjhe tools (naam wahi → baaki code untouched) */
  var el = UI.el, esc = UI.esc, uid = UI.uid;

  var toISO = UI.toISO, fromISO = UI.fromISO, fmtDate = UI.fmtDate;
  var addDays = UI.addDays, nowTime = UI.nowTime;
  /* DAY-CLOCK : revision due/aaj ka hisaab app ke apne din se */
  function todayISO() { return window.DayClock ? window.DayClock.today() : UI.todayISO(); }

  function ensure(ch) {
    if (!ch.revision || typeof ch.revision !== 'object') {
      ch.revision = { chapterSteps: [], questionSteps: [], history: [], pending: null, qHistory: [], itemCounts: {} };
    }
    var r = ch.revision;
    /* purana format migrate : steps → chapterSteps */
    if (!Array.isArray(r.chapterSteps) && Array.isArray(r.steps)) {
      r.chapterSteps = r.steps;
    }
    if (!Array.isArray(r.chapterSteps)) r.chapterSteps = [];
    if (!Array.isArray(r.questionSteps)) r.questionSteps = [];
    if (!Array.isArray(r.history)) r.history = [];
    if (!Array.isArray(r.qHistory)) r.qHistory = [];
    if (!r.itemCounts || typeof r.itemCounts !== 'object') r.itemCounts = {};
    if (r.pending && typeof r.pending !== 'object') r.pending = null;
    delete r.steps;
  }

  function commit() {
    if (hooks && hooks.persist) hooks.persist();
  }

  /* inline SVG icons */
  var ICON_PLUS = UI.icons.plus;
  var ICON_BACK = UI.icons.back;
  var ICON_KEBAB = UI.icons.kebab;
  var ICON_EDIT = UI.icons.edit;
  var ICON_TRASH = UI.icons.trash;
  var ICON_CHECK = UI.icons.check;
  var ICON_STAR = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8-6.2-3.2-6.2 3.2L7 14.2 2 9.3l6.9-1z"/></svg>';
  var ICON_STAR_OFF = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8-6.2-3.2-6.2 3.2L7 14.2 2 9.3l6.9-1z"/></svg>';
  var ICON_RULES = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V2H6.5A2.5 2.5 0 0 0 4 4.5z"/><path d="M9 7h7M9 11h7"/></svg>';
  var ICON_CHEV = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>';

  var app = document.getElementById('app');

  /* ================================================================
     POPOVER (step edit/delete)
  ================================================================ */
  var closePops = UI.closePops, togglePop = UI.togglePop;

  function makeKebabPop(onEdit, onDelete) {
    return UI.makeKebabPop(onEdit, onDelete);
  }

  /* ================================================================
     MODAL (mid-screen)
  ================================================================ */
  var revModal = UI.modal({ zScrim: 88, zWrap: 89 });
  var sheetBody = null;

  function openModal(title, build, saveFn) {
    revModal.open(title, function (b) { sheetBody = b; build(b); }, saveFn);
  }

  function closeModal() { revModal.close(); }

  var FIELD_CSS = UI.fieldCss;

  function openStepModal(title, initial, onSave) {
    openModal(title, function (body) {
      var lab = el('label', null, 'Step');
      var inp = el('input');
      inp.type = 'text';
      inp.autocomplete = 'off';
      inp.value = initial || '';
      inp.placeholder = 'e.g. Formula sheet revise karo';
      inp.style.cssText = FIELD_CSS;
      body.appendChild(lab);
      body.appendChild(inp);
      body._get = function () { return inp.value.trim(); };
      window.setTimeout(function () {
        if (revModal.isOpen()) { inp.focus(); inp.select(); }
      }, 260);
    }, function () {
      var text = sheetBody._get();
      if (!text) return;
      onSave(text);
      closeModal();
      commit();
      rerender();
    });
  }

  /* ================================================================
     SHARED UI
  ================================================================ */
  var panel = UI.panel;

  function panelTitle(text) { return UI.panelTitle(text); }

  var pillBtn = UI.pillBtn;

  var solidBtn = UI.solidBtn;

  var roundCheck = UI.roundCheck;

  var stepRow = UI.stepRow;

  function starsRow(rating) {
    var s = el('span');
    s.style.cssText = 'display:inline-flex;gap:2px;color:var(--ink);vertical-align:middle';
    for (var i = 1; i <= 5; i++) {
      s.insertAdjacentHTML('beforeend', i <= rating ? ICON_STAR :
        '<span style="color:var(--s3);display:inline-flex">' + ICON_STAR_OFF + '</span>');
    }
    return s;
  }

  function screenHeader(title, subtitle, onBack) {
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
    container.appendChild(head);
  }

  /* ================================================================
     RULES SCREEN
  ================================================================ */
  function stepsPanel(title, list) {
    var p = panel();
    var head = el('div');
    head.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px';
    head.appendChild(panelTitle(title));
    var add = pillBtn(ICON_PLUS + ' <span>Add</span>');
    add.addEventListener('click', function () {
      openStepModal('Add Step', '', function (text) {
        list.push({ id: uid(), text: text });
      });
    });
    head.appendChild(add);
    p.appendChild(head);
    if (!list.length) {
      p.appendChild(el('div', 'sub-meta', 'Koi step add nahi ki.'));
    }
    list.forEach(function (s) {
      p.appendChild(stepRow(s.text, false, null,
        function () {
          openStepModal('Edit Step', s.text, function (text) { s.text = text; });
        },
        function () {
          var idx = list.indexOf(s);
          if (idx > -1) list.splice(idx, 1);
          commit();
          rerender();
        }
      ));
    });
    return p;
  }

  function renderRules() {
    screenHeader('Rules', 'Default revision steps yahan manage karo', function () {
      mode = 'main';
      rerender();
    });

    var note = panel();
    note.appendChild(el('div', 'sub-meta',
      'Note: The steps you add below will appear by default in every revision. ' +
      'If you don\'t want to use them, you can add your own specific steps for a ' +
      'specific revision while doing that revision.'));
    container.appendChild(note);

    container.appendChild(stepsPanel('Chapter Revision Steps', chapter.revision.chapterSteps));
    container.appendChild(stepsPanel('Question Revision Steps', chapter.revision.questionSteps));
  }

  /* ================================================================
     CHAPTER RECALL : rating + complete
  ================================================================ */
  function openRatingModal(revNumber) {
    openModal('Rate Your Recall', function (body) {
      var hint = el('div', 'sub-meta', 'Apni is revision ko kitne star dena chahoge?');
      hint.style.marginBottom = '12px';
      body.appendChild(hint);
      for (var r = 1; r <= 5; r++) {
        (function (rating) {
          var b = el('button');
          b.type = 'button';
          b.style.cssText = 'display:flex;align-items:center;gap:10px;width:100%;padding:10px 12px;' +
            'margin-bottom:8px;border-radius:12px;border:1px solid var(--s2);background:var(--chip-bg);' +
            'cursor:pointer;font:inherit;transition:.15s';
          b.appendChild(starsRow(rating));
          var lab = el('span', null, RATING_LABEL[rating]);
          lab.style.cssText = 'margin-left:auto;font-size:12.5px;font-weight:600;color:var(--slate)';
          b.appendChild(lab);
          b.addEventListener('click', function () { completeRecall(revNumber, rating); });
          body.appendChild(b);
        })(r);
      }
    }, null);
  }

  function completeRecall(revNumber, rating) {
    var dateISO = todayISO();
    chapter.revision.history.push({
      n: revNumber, date: dateISO, time: nowTime(), rating: rating
    });
    var sysDue = addDays(dateISO, GAPS[rating]);
    chapter.revision.pending = { n: revNumber + 1, systemDue: sysDue, due: sysDue };
    session = null;
    mode = 'main';
    closeModal();
    commit();
    rerender();
  }

  function startSession() {
    var n = chapter.revision.pending
      ? chapter.revision.pending.n
      : chapter.revision.history.length + 1;
    session = {
      n: n,
      steps: chapter.revision.chapterSteps.map(function (s) {
        return { id: s.id, text: s.text, done: false, personal: false };
      })
    };
    mode = 'session';
    rerender();
  }

  function renderSession() {
    screenHeader('Revision ' + session.n + ' Recall',
      'Steps tick karo, phir Complete Recall dabao', function () {
        session = null;
        mode = 'main';
        rerender();
      });

    var listWrap = el('div');
    listWrap.style.cssText = 'padding:10px 18px 0';

    if (!session.steps.length) {
      listWrap.appendChild(el('div', 'sub-meta',
        'Koi step nahi — seedha Complete Recall kar sakte ho.'));
    }
    session.steps.forEach(function (st) {
      listWrap.appendChild(stepRow(
        st.text + (st.personal ? '  ·(personal)' : ''),
        st.done,
        function () { st.done = !st.done; rerender(); },
        null, null
      ));
    });

    var addBtn = pillBtn(ICON_PLUS + ' <span>Add Step</span>');
    addBtn.style.margin = '0 0 12px';
    addBtn.addEventListener('click', function () {
      openStepModal('Add Step (is recall ke liye)', '', function (text) {
        session.steps.push({ id: uid(), text: text, done: false, personal: true });
      });
    });
    listWrap.appendChild(addBtn);
    container.appendChild(listWrap);

    var allDone = session.steps.every(function (s) { return s.done; });
    if (allDone) {
      var foot = el('div');
      foot.style.cssText = 'padding:0 18px 12px';
      var done = solidBtn('Complete Recall');
      done.addEventListener('click', function () { openRatingModal(session.n); });
      foot.appendChild(done);
      container.appendChild(foot);
    }
  }

  /* ================================================================
     QUESTION REVISION
  ================================================================ */
  /* source se tickable items nikaalo */
  function sourceItems(s) {
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
        items.push({
          key: 'pg:' + pg.page + ':' + q,
          label: 'P' + pg.page + ' · Q' + q,
          box: 'Q' + q,
          part: 'Page ' + pg.page
        });
      });
    });
    return items;
  }

  function itemCount(sourceId, key) {
    var m = chapter.revision.itemCounts[sourceId];
    return (m && m[key]) || 0;
  }

  function startQSession() {
    qsession = { picks: {} };
    mode = 'qsession';
    rerender();
  }

  function completeQRevision() {
    var entries = [];
    (chapter.sources || []).forEach(function (s) {
      var picked = [];
      var pm = qsession.picks[s.id] || {};
      sourceItems(s).forEach(function (it) {
        if (!pm[it.key]) return;
        picked.push(it);
        var m = chapter.revision.itemCounts[s.id] || (chapter.revision.itemCounts[s.id] = {});
        m[it.key] = (m[it.key] || 0) + 1;
      });
      if (picked.length) entries.push({ source: s.name, items: picked });
    });
    if (!entries.length) return;
    chapter.revision.qHistory.push({
      n: chapter.revision.qHistory.length + 1,
      date: todayISO(), time: nowTime(),
      entries: entries
    });
    qsession = null;
    mode = 'main';
    commit();
    rerender();
  }

  function renderQSession() {
    screenHeader('Question Revision',
      'Jo revise kiya hai us par tick lagao, phir Complete Revision', function () {
        qsession = null;
        mode = 'main';
        rerender();
      });

    /* default question steps (rules se) */
    var qSteps = chapter.revision.questionSteps;
    if (qSteps.length) {
      var sp = panel();
      sp.appendChild(panelTitle('Question Revision Steps'));
      qsession.stepDone = qsession.stepDone || {};
      qSteps.forEach(function (st) {
        sp.appendChild(stepRow(st.text, !!qsession.stepDone[st.id], function () {
          qsession.stepDone[st.id] = !qsession.stepDone[st.id];
          rerender();
        }, null, null));
      });
      container.appendChild(sp);
    }

    var anyPick = false;
    qsession.open = qsession.open || {};

    /* section labels */
    function secLabel(text) {
      var t = el('div', 'eyebrow', text);
      t.style.margin = '12px 0 8px';
      return t;
    }
    function subLabel(text) {
      var t = el('div', 'sub-meta', text);
      t.style.cssText = 'font-weight:600;margin:8px 0 6px';
      return t;
    }
    /* question number boxes : tick + neeche revision count */
    function boxesWrap(list, s) {
      var w = el('div');
      w.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap';
      /* picks per-source : do sources ke same question number alag-alag rahen */
      var pm = qsession.picks[s.id] || (qsession.picks[s.id] = {});
      list.forEach(function (it) {
        var picked = !!pm[it.key];
        if (picked) anyPick = true;
        var col = el('div');
        col.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:3px';
        var b = el('button');
        b.type = 'button';
        b.setAttribute('aria-label', 'Tick ' + it.label);
        b.style.cssText = 'position:relative;width:46px;height:46px;border-radius:12px;cursor:pointer;' +
          'font:inherit;font-size:12.5px;font-weight:700;transition:.15s;' +
          'display:flex;align-items:center;justify-content:center;' +
          (picked
            ? 'background:var(--hl);color:var(--ink);border:1.5px solid var(--ink)'
            : 'background:var(--chip-bg);color:var(--ink2);border:1px solid var(--s2)');
        b.textContent = it.box;
        if (picked) {
          b.insertAdjacentHTML('beforeend',
            '<span style="position:absolute;top:-7px;right:-7px;width:17px;height:17px;border-radius:50%;' +
            'background:var(--ink);color:var(--paper);display:flex;align-items:center;justify-content:center;' +
            'border:1.5px solid var(--paper)">' + ICON_CHECK + '</span>');
        }
        b.addEventListener('click', function () {
          pm[it.key] = !pm[it.key];
          rerender();
        });
        col.appendChild(b);
        var n = itemCount(s.id, it.key);
        if (n > 0) {
          var cap = el('div', null, n + (n === 1 ? ' time revision' : ' times revision'));
          cap.style.cssText = 'font-size:9px;letter-spacing:.04em;color:var(--ash);text-align:center';
          col.appendChild(cap);
        }
        w.appendChild(col);
      });
      return w;
    }

    (chapter.sources || []).forEach(function (s) {
      var items = sourceItems(s);
      var isOpen = !!qsession.open[s.id];

      /* collapsed source row : naam + tag + arrow */
      var row = el('div');
      row.style.cssText = 'display:flex;align-items:center;gap:10px;margin:0 18px 10px;padding:13px 14px;' +
        'border:1px solid var(--line);border-radius:14px;background:var(--tile-bg);cursor:pointer;' +
        'box-shadow:inset 0 1px 0 var(--hl-soft)';
      var nm = el('div', null, esc(s.name));
      nm.style.cssText = 'flex:1;min-width:0;font-size:13.5px;font-weight:600;color:var(--ink2)';
      row.appendChild(nm);
      row.appendChild(el('span', 'chip-st' + (s.category === 'PYQ' ? ' done' : ''), s.category || 'Normal'));
      var chev = el('span', null, ICON_CHEV);
      chev.style.cssText = 'display:flex;color:var(--steel);transition:transform .2s;flex:none;' +
        (isOpen ? 'transform:rotate(180deg)' : '');
      row.appendChild(chev);
      row.addEventListener('click', function () {
        qsession.open[s.id] = !isOpen;
        rerender();
      });
      container.appendChild(row);

      if (!isOpen) return;

      /* expanded body : section-wise boxes */
      var body = el('div');
      body.style.cssText = 'margin:-2px 18px 12px;padding:12px 14px;border:1px solid var(--line);' +
        'border-top:0;border-radius:0 0 14px 14px;background:var(--tile-bg)';

      if (!items.length) {
        body.appendChild(el('div', 'sub-meta',
          'Is source mein koi important / attempt / page item nahi hai.'));
      }

      var impItems = items.filter(function (it) { return it.part === 'Important'; });
      if (impItems.length) {
        body.appendChild(secLabel('Important Questions'));
        body.appendChild(boxesWrap(impItems, s));
      }

      var attItems = items.filter(function (it) { return /attempts$/.test(it.part); });
      if (attItems.length) {
        body.appendChild(secLabel('Multiple Attempts'));
        ['2', '3', '4+'].forEach(function (k) {
          var g = attItems.filter(function (it) { return it.part === k + ' attempts'; });
          if (!g.length) return;
          body.appendChild(subLabel(k + ' attempts'));
          body.appendChild(boxesWrap(g, s));
        });
      }

      var pgItems = items.filter(function (it) { return it.part.indexOf('Page ') === 0; });
      if (pgItems.length) {
        body.appendChild(secLabel('Important Pages'));
        (s.pages || []).forEach(function (pg) {
          var g = pgItems.filter(function (it) { return it.part === 'Page ' + pg.page; });
          if (!g.length) return;
          body.appendChild(subLabel('Page ' + pg.page));
          if ((pg.topics || []).length) {
            var tline = el('div', 'sub-meta', 'Topics: ' + pg.topics.join(', '));
            tline.style.margin = '0 0 6px';
            body.appendChild(tline);
          }
          body.appendChild(boxesWrap(g, s));
        });
      }

      container.appendChild(body);
    });

    if (!(chapter.sources || []).length) {
      var empty = el('div', 'empty', 'Koi source nahi — pehle Sources tab mein source add karo.');
      empty.style.margin = '0 18px 12px';
      container.appendChild(empty);
    }

    var foot = el('div');
    foot.style.cssText = 'padding:0 18px 12px';
    var btn = solidBtn('Complete Revision');
    if (!anyPick) { btn.style.opacity = '.45'; btn.disabled = true; }
    btn.addEventListener('click', function () {
      if (anyPick) completeQRevision();
    });
    foot.appendChild(btn);
    container.appendChild(foot);
  }

  /* ================================================================
     MAIN VIEW
  ================================================================ */
  function renderMain() {
    var rev = chapter.revision;

    /* header : Rules button */
    var head = el('div');
    head.style.cssText = 'display:flex;align-items:center;padding:12px 18px 8px';
    var rulesBtn = pillBtn(ICON_RULES + ' <span>Rules</span>');
    rulesBtn.addEventListener('click', function () {
      mode = 'rules';
      rerender();
    });
    head.appendChild(rulesBtn);
    container.appendChild(head);

    /* chapter revision history */
    if (rev.history.length) {
      var hp = panel();
      hp.appendChild(panelTitle('Chapter Revision History'));
      rev.history.forEach(function (h) {
        var row = el('div');
        row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:9px 12px;' +
          'border:1px solid var(--line);border-radius:12px;background:var(--chap-bg);margin-bottom:8px';
        var nm = el('div', null, 'Revision ' + h.n);
        nm.style.cssText = 'font-size:13px;font-weight:600;color:var(--ink2);flex:1;min-width:0';
        row.appendChild(nm);
        row.appendChild(el('div', 'sub-meta', fmtDate(h.date) + ' · ' + h.time));
        row.appendChild(starsRow(h.rating));
        hp.appendChild(row);
      });
      container.appendChild(hp);
    }

    /* pending / start recall */
    var foot = el('div');
    foot.style.cssText = 'padding:0 18px 12px';
    if (rev.pending) {
      var p = rev.pending;
      var card = panel();
      card.style.margin = '0 0 12px';
      var top = el('div');
      top.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px';
      top.appendChild(panelTitleNoMargin('Revision ' + p.n));
      var dueWrap = el('div');
      dueWrap.style.cssText = 'display:flex;align-items:center;gap:8px';
      var minus = pillBtn('−');
      minus.style.padding = '4px 12px';
      var plus = pillBtn('+');
      plus.style.padding = '4px 12px';
      var maxDue = addDays(p.systemDue, MAX_FORWARD_DAYS);
      minus.addEventListener('click', function () {
        p.due = addDays(p.due, -1);
        commit();
        rerender();
      });
      plus.addEventListener('click', function () {
        if (p.due >= maxDue) return;
        p.due = addDays(p.due, 1);
        commit();
        rerender();
      });
      if (p.due >= maxDue) { plus.style.opacity = '.45'; plus.disabled = true; }
      var dueLab = el('div', null, fmtDate(p.due));
      dueLab.style.cssText = 'font-family:var(--f-mono);font-size:12px;font-weight:700;color:var(--ink);min-width:96px;text-align:center';
      dueWrap.appendChild(minus);
      dueWrap.appendChild(dueLab);
      dueWrap.appendChild(plus);
      top.appendChild(dueWrap);
      card.appendChild(top);
      card.appendChild(el('div', 'sub-meta', 'Next revision due: ' + fmtDate(p.due) +
        (p.due > todayISO() ? ' · abhi time hai' : ' · aaj recall kar sakte ho')));
      var startBtn = solidBtn('Start Recall');
      var canStart = todayISO() >= p.due;
      if (!canStart) { startBtn.style.opacity = '.45'; startBtn.disabled = true; }
      startBtn.addEventListener('click', function () {
        if (todayISO() >= p.due) startSession();
      });
      card.appendChild(startBtn);
      foot.appendChild(card);
    } else {
      var first = solidBtn('Start Recall');
      first.addEventListener('click', startSession);
      foot.appendChild(first);
    }
    container.appendChild(foot);

    /* question revision section */
    var qp = panel();
    qp.appendChild(panelTitle('Question Revision'));
    var qStart = solidBtn('Start Question Revision');
    qStart.addEventListener('click', startQSession);
    qp.appendChild(qStart);
    container.appendChild(qp);

    /* question revision history : click par detail khulti hai */
    if (rev.qHistory.length) {
      var qh = panel();
      qh.appendChild(panelTitle('Question Revision History'));
      rev.qHistory.slice().reverse().forEach(function (h) {
        var box = el('div');
        box.style.cssText = 'border:1px solid var(--line);border-radius:12px;background:var(--chap-bg);' +
          'padding:10px 12px;margin-bottom:8px';

        var head = el('div');
        head.style.cssText = 'display:flex;align-items:center;gap:8px;cursor:pointer';
        var ttl = el('div');
        ttl.style.cssText = 'flex:1;min-width:0';
        ttl.appendChild(el('div', null, 'Question Revision ' + h.n +
          ' · ' + fmtDate(h.date) + ' · ' + h.time)).style.cssText =
          'font-size:12.5px;font-weight:600;color:var(--ink2)';
        ttl.appendChild(el('div', 'sub-meta',
          h.entries.map(function (e) { return esc(e.source); }).join(', ')));
        head.appendChild(ttl);
        var isOpen = !!qhOpen[h.n];
        var chev = el('span', null, ICON_CHEV);
        chev.style.cssText = 'display:flex;color:var(--steel);transition:transform .2s;flex:none;' +
          (isOpen ? 'transform:rotate(180deg)' : '');
        head.appendChild(chev);
        head.addEventListener('click', function () {
          qhOpen[h.n] = !qhOpen[h.n];
          rerender();
        });
        box.appendChild(head);

        if (isOpen) {
          h.entries.forEach(function (en) {
            var sName = el('div', null, esc(en.source));
            sName.style.cssText = 'font-size:12px;font-weight:700;color:var(--ink);margin:8px 0 4px';
            box.appendChild(sName);
            /* part-wise breakdown : important → attempts → pages */
            var parts = [];
            en.items.forEach(function (it) {
              var p = parts.filter(function (x) { return x.name === it.part; })[0];
              if (!p) { p = { name: it.part, labels: [] }; parts.push(p); }
              p.labels.push(it.label);
            });
            parts.sort(function (a, b) {
              function rank(n) {
                if (n === 'Important') return 0;
                if (n === '2 attempts') return 1;
                if (n === '3 attempts') return 2;
                if (n === '4+ attempts') return 3;
                return 4 + parseInt(n.replace('Page ', ''), 10) || 4;
              }
              return rank(a.name) - rank(b.name);
            });
            parts.forEach(function (p) {
              var line = el('div', 'sub-meta',
                p.name + ' (' + p.labels.length + '): ' + p.labels.join(', '));
              line.style.marginBottom = '3px';
              box.appendChild(line);
            });
          });
        }
        qh.appendChild(box);
      });
      container.appendChild(qh);
    }
  }

  function panelTitleNoMargin(text) { return UI.panelTitle(text, true); }

  /* ================================================================
     RENDER + ENTRY
  ================================================================ */
  function render() {
    container.innerHTML = '';
    if (mode === 'rules') renderRules();
    else if (mode === 'session' && session) renderSession();
    else if (mode === 'qsession' && qsession) renderQSession();
    else renderMain();
  }

  function rerender() {
    if (!container || !chapter) return;
    var st = container.scrollTop;
    render();
    container.scrollTop = st;
  }

  function renderChapterView(cont, ch, hk) {
    container = cont;
    hooks = hk || hooks;
    /* session sirf tab reset ho jab CHAPTER badle — tab-switch par
       in-progress recall/question-revision preserve rahe
       (sources.js ke detailSource wala pattern) */
    if (chapter !== ch) {
      chapter = ch;
      mode = 'main';
      session = null;
      qsession = null;
      qhOpen = {};
    }
    ensure(ch);
    rerender();
  }

  window.Revision = { renderChapterView: renderChapterView };
})();
