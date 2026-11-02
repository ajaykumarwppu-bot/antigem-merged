/* ================================================================
   FEATURES / SUBJECT TRACKER / SOURCES-DETAIL.JS
   ----------------------------------------------------------------
   Source card ke ANDAR wali screen (detail hissa) :
     • header : back arrow, source name, category tag
       (3-dot YAHAN NAHI : Edit/Delete sirf bahar sources list
       ke card ke kebab se hota hai)
     • stats tiles : total / solved / left
     • teen parallel buttons — "+ Solved" / "+ Doubt" / "+ Analysis" :
       teeno mein 1..total numbers ka multi-select picker.
         - solved  = user ne khud solve kiye
         - doubt   = jin par user ka doubt hai
         - analysis= jo solve nahi kiye, par answer dekh kar
                     pattern samjha
       ANALYSIS SIRF NORMAL SOURCES KE LIYE : PYQ source par
       "+ Analysis" dabane se picker ki jagah ek chhota info-popup
       khulta hai (analysis ki definition + PYQ mein kyun nahi),
       jise Back button se band kiya jata hai. PYQ ko analyze
       nahi, solve karna chahiye.
       Teeno ke ticks SIRF picker ke andar rehte hain (bahar chips
       nahi dikhte) ; solved count stats tile mein update hota hai.
     • Important Questions : numbers tag karo (multi-select)
     • Multiple Attempts : question(s) + attempts (2 / 3 / 4+),
       attempt-group mein merge, group edit/delete
     • Important Pages : page number + multiple topics +
       multiple questions; same page dobara add ho to merge
   Ye file sources.js ke list hisse se bridge (ctx) ke through
   judi hai : ctx.commit / ctx.rerender / ctx.goBack.
   Saanjhe UI tools core/ui.js (window.UI) se aate hain.
   ================================================================ */

(function () {
  'use strict';

  if (window.__achivaSourcesDetailLoaded) return;
  window.__achivaSourcesDetailLoaded = true;

  /* core/ui.js ke saanjhe tools */
  var el = UI.el, esc = UI.esc, uid = UI.uid;
  var sorted = UI.sorted, sortedUnique = UI.sortedUnique;
  var togglePop = UI.togglePop;
  var panel = UI.panel, label = UI.label, pillBtn = UI.pillBtn, tile = UI.tile;
  var rowBox = UI.rowBox, numberPicker = UI.numberPicker, chipEditor = UI.chipEditor;
  var ICON_BACK = UI.icons.back;
  var ICON_KEBAB = UI.icons.kebab;

  var container = null;
  var source = null;   /* jis source ka detail khula hai */
  var ctx = null;      /* sources.js ka bridge */

  /* apna modal instance (add/edit pickers ke liye) */
  var sheetModal = UI.modal({ zScrim: 83, zWrap: 84 });
  var sheetBody = null;

  function openModal(title, build, saveFn) {
    sheetModal.open(title, function (b) { sheetBody = b; build(b); }, saveFn);
  }

  function closeModal() { sheetModal.close(); }

  /* INFO popup — PYQ source par "+ Analysis" dabane par khulta hai.
     Alag modal instance : iska Cancel button hamesha "Back" rehta hai
     (saveFn null ke saath khulta hai, isliye Save dikhta hi nahi) */
  var infoModal = UI.modal({ zScrim: 83, zWrap: 84 });
  (function () {
    var backBtn = infoModal.sheet.querySelector('.sheet-actions .btn-ghost');
    if (backBtn) {
      backBtn.innerHTML = ICON_BACK + '<span>Back</span>';
      backBtn.style.display = 'inline-flex';
      backBtn.style.alignItems = 'center';
      backBtn.style.justifyContent = 'center';
      backBtn.style.gap = '7px';
    }
  })();

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
     MODALS : solved / important / attempts / page
  ================================================================ */
  function openSolvedModal(s) {
    openModal('Solved Questions', function (body) {
      if (!s.total) {
        body.appendChild(el('div', 'sub-meta', 'Pehle is source mein total questions add karo.'));
        return;
      }
      body.appendChild(label('Solve kiye gaye question numbers chuno:'));
      var pick = numberPicker(s.total, s.solved, true);
      body.appendChild(pick.wrap);
      body._get = pick.get;
    }, function () {
      s.solved = sheetBody._get();
      closeModal();
      ctx.commit();
      ctx.rerender();
    });
  }

  function openDoubtModal(s) {
    openModal('Doubt Questions', function (body) {
      if (!s.total) {
        body.appendChild(el('div', 'sub-meta', 'Pehle is source mein total questions add karo.'));
        return;
      }
      body.appendChild(label('Doubt wale question numbers chuno:'));
      var pick = numberPicker(s.total, s.doubt, true);
      body.appendChild(pick.wrap);
      body._get = pick.get;
    }, function () {
      s.doubt = sheetBody._get();
      closeModal();
      ctx.commit();
      ctx.rerender();
    });
  }

  /* ANALYSIS : jo questions user ne khud solve NAHI kiye, par unke
     answer dekh kar pattern samjha — wahi number-picker, alag list.
     SIRF Normal sources ke liye; PYQ par info-popup dikhta hai. */
  function openAnalysisModal(s) {
    openModal('Analysis Questions', function (body) {
      if (!s.total) {
        body.appendChild(el('div', 'sub-meta', 'Pehle is source mein total questions add karo.'));
        return;
      }
      body.appendChild(label('Jin questions ka answer dekh kar pattern samjha, unke number chuno:'));
      var pick = numberPicker(s.total, s.analysis, true);
      body.appendChild(pick.wrap);
      body._get = pick.get;
    }, function () {
      s.analysis = sheetBody._get();
      closeModal();
      ctx.commit();
      ctx.rerender();
    });
  }

  /* PYQ source par "+ Analysis" click → chhota sa message popup :
     analysis ki definition + ye sirf Normal questions ke liye kyun
     hai. Back dabate hi popup band (baaki modals jaisa smooth fade). */
  function openAnalysisInfoModal() {
    infoModal.open('Analysis — sirf Normal sources ke liye', function (body) {
      function para(text) {
        var p = el('div');
        p.textContent = text;
        p.style.cssText = 'font-size:13px;line-height:1.65;color:var(--ink2);margin:0 0 12px';
        return p;
      }
      body.appendChild(label('Analysis ka matlab:'));
      body.appendChild(para('Aap sirf question ko dekhte ho, use mentally solve karte ho, phir apne method ko answer ke method se match karke pattern observe karte ho. Isme aap physically kisi bhi question ko solve nahi karte.'));
      body.appendChild(para('Ye tab important hai jab aapke paas time na ho, but aap extra questions bhi dekhna chaho.'));
      body.appendChild(label('PYQ mein analysis kyun nahi:'));
      body.appendChild(para('Analysis sirf Normal questions par applicable hai — jo coaching ya kisi aur source se provide kiye jaate hain. PYQ (purane papers ke questions) ka analysis na karein — PYQ mein jitne ho sakein questions khud solve karein.'));
    }, null);   /* saveFn null → Save hidden, sirf Back button */
  }

  function openImportantModal(s) {
    openModal('Important Questions', function (body) {
      if (!s.total) {
        body.appendChild(el('div', 'sub-meta', 'Pehle is source mein total questions add karo.'));
        return;
      }
      body.appendChild(label('Important question numbers chuno:'));
      var pick = numberPicker(s.total, s.important, true);
      body.appendChild(pick.wrap);
      body._get = pick.get;
    }, function () {
      s.important = sheetBody._get();
      closeModal();
      ctx.commit();
      ctx.rerender();
    });
  }

  function openAttemptsModal(s, existing) {
    openModal('Multiple Attempts', function (body) {
      if (!s.total) {
        body.appendChild(el('div', 'sub-meta', 'Pehle is source mein total questions add karo.'));
        return;
      }
      body.appendChild(label('Is attempt mein kaunse questions hue:'));
      var attWrap = el('div');
      attWrap.style.marginTop = '12px';
      attWrap.appendChild(label('Kitne attempts mein hua:'));
      var att = UI.chipRow(['2', '3', '4+'], existing ? existing.attempts : null);
      attWrap.appendChild(att.row);

      var msg = el('div', 'sub-meta', '');
      msg.style.marginTop = '10px';

      var pick = numberPicker(s.total, existing ? existing.qs : [], true, function () {
        if (!att.get()) {
          msg.textContent = 'Pehle neeche choose karo ki kitne attempts mein hua (2 / 3 / 4+).';
          return false;
        }
        msg.textContent = '';
        return true;
      });
      body.appendChild(pick.wrap);
      body.appendChild(attWrap);
      body.appendChild(msg);

      body._get = function () { return { qs: pick.get(), attempts: att.get() }; };
      body._msg = function (t) { msg.textContent = t; };
    }, function () {
      var v = sheetBody._get();
      if (!v.attempts) {
        sheetBody._msg('Pehle neeche choose karo ki kitne attempts mein hua (2 / 3 / 4+).');
        return;
      }
      if (!v.qs.length) {
        sheetBody._msg('Kam se kam ek question number chuno.');
        return;
      }
      if (existing) s.attempts = s.attempts.filter(function (g) { return g !== existing; });
      s.attempts.forEach(function (g) {
        g.qs = g.qs.filter(function (n) { return v.qs.indexOf(n) === -1; });
      });
      s.attempts = s.attempts.filter(function (g) { return g.qs.length; });
      var target = null;
      s.attempts.forEach(function (g) { if (g.attempts === v.attempts) target = g; });
      if (!target) {
        target = { id: uid(), attempts: v.attempts, qs: [] };
        s.attempts.push(target);
      }
      v.qs.forEach(function (n) {
        if (target.qs.indexOf(n) === -1) target.qs.push(n);
      });
      target.qs = sortedUnique(target.qs);
      closeModal();
      ctx.commit();
      ctx.rerender();
    });
  }

  function openPageModal(s, existing) {
    openModal('Important Page', function (body) {
      var pageF = UI.inputField('Page number', 'e.g. 8', 'number');
      var topicsE = chipEditor('Important topics (Enter ya + se add karo):', 'Topic ka naam');
      var qsE = chipEditor('Important question numbers (Enter ya + se add karo):', 'e.g. 12', true);
      body.appendChild(pageF.wrap);
      body.appendChild(topicsE.wrap);
      body.appendChild(qsE.wrap);
      if (existing) {
        pageF.input.value = existing.page;
        topicsE.set(existing.topics);
        qsE.set(existing.qs);
      }
      body._get = function () {
        return {
          page: parseInt(pageF.input.value, 10),
          topics: topicsE.get(),
          qs: qsE.get()
        };
      };
      window.setTimeout(function () { if (sheetModal.isOpen()) pageF.input.focus(); }, 260);
    }, function () {
      var v = sheetBody._get();
      if (isNaN(v.page)) return;
      if (!v.topics.length && !v.qs.length) return;
      if (existing) s.pages = s.pages.filter(function (p) { return p !== existing; });
      var target = null;
      s.pages.forEach(function (p) { if (p.page === v.page) target = p; });
      if (!target) {
        target = { id: uid(), page: v.page, topics: [], qs: [] };
        s.pages.push(target);
      }
      v.topics.forEach(function (t) {
        if (target.topics.indexOf(t) === -1) target.topics.push(t);
      });
      v.qs.forEach(function (q) {
        if (target.qs.indexOf(q) === -1) target.qs.push(q);
      });
      target.qs = sortedUnique(target.qs);
      closeModal();
      ctx.commit();
      ctx.rerender();
    });
  }

  /* ================================================================
     DETAIL RENDER
  ================================================================ */
  function sectionPanel(title, onAdd) {
    var p = panel();
    var head = el('div');
    head.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px';
    var t = el('div', null, title);
    t.style.cssText = 'font-family:var(--f-disp);font-size:14px;font-weight:700;color:var(--ink)';
    var add = pillBtn('+ Add');
    add.addEventListener('click', onAdd);
    head.appendChild(t);
    head.appendChild(add);
    p.appendChild(head);
    return p;
  }

  function render() {
    var s = source;
    if (!Array.isArray(s.doubt)) s.doubt = [];
    if (!Array.isArray(s.analysis)) s.analysis = [];
    container.innerHTML = '';

    /* header : back + name + category tag
       (3-dot ANDAR nahi — Edit/Delete sirf bahar list ke card se) */
    var head = el('div');
    head.style.cssText = 'display:flex;align-items:center;gap:12px;padding:12px 18px 4px';
    var back = el('button', 'icon-btn', ICON_BACK);
    back.type = 'button';
    back.setAttribute('aria-label', 'Back to sources');
    back.addEventListener('click', ctx.goBack);
    var tw = el('div', 'sub-title-wrap');
    tw.appendChild(el('h2', null, esc(s.name)));
    tw.appendChild(el('div', 'sub-meta', s.category === 'PYQ' ? 'PYQ source' : 'Normal source'));
    head.appendChild(back);
    head.appendChild(tw);
    head.appendChild(tagChip(s.category));
    container.appendChild(head);

    /* stats tiles */
    var stats = panel();
    var grid = el('div');
    grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px';
    grid.appendChild(tile(s.total, 'total'));
    grid.appendChild(tile(s.solved.length, 'solved'));
    grid.appendChild(tile(s.total - s.solved.length, 'left'));
    stats.appendChild(grid);
    container.appendChild(stats);

    /* teeno question-category buttons EK HI ROW mein (parallel) :
       + Solved / + Doubt / + Analysis
       labels chhote rakhe hain taaki narrow screen par bhi teeno
       side-by-side fit ho jayein (wrap na ho) */
    var solvedRow = el('div');
    solvedRow.style.cssText = 'display:flex;gap:8px;align-items:stretch;padding:0 18px 12px';
    [
      { label: '+ Solved', fn: function () { openSolvedModal(s); } },
      { label: '+ Doubt', fn: function () { openDoubtModal(s); } },
      { label: '+ Analysis', fn: function () {
          /* PYQ source → analysis accessible nahi : definition wala
             info-popup dikha do. Normal source → dono (sab) chalta hai */
          if (s.category === 'PYQ') openAnalysisInfoModal();
          else openAnalysisModal(s);
        } }
    ].forEach(function (cfg) {
      var b = pillBtn(cfg.label);
      /* teeno barabar chaurai lein (flex shorthand ki jagah longhand —
         har browser + jsdom dono mein reliably lagta hai) */
      b.style.flexGrow = '1';
      b.style.flexShrink = '1';
      b.style.flexBasis = '0';
      b.style.minWidth = '0';
      b.style.justifyContent = 'center';
      b.style.padding = '9px 6px';
      b.style.fontSize = '12px';
      b.style.whiteSpace = 'nowrap';
      b.addEventListener('click', cfg.fn);
      solvedRow.appendChild(b);
    });
    container.appendChild(solvedRow);

    /* NOTE : doubt / analysis ke question-chips yahan BAHAR nahi dikhte —
       jaise solved ke sirf number-picker ke andar tick rehte hain,
       bilkul waise hi doubt aur analysis ke bhi. */

    /* ---------- Important Questions ---------- */
    var impPanel = sectionPanel('Important Questions', function () { openImportantModal(s); });
    if (!s.important.length) {
      impPanel.appendChild(el('div', 'sub-meta', 'Koi important question tag nahi kiya.'));
    } else {
      var impWrap = el('div');
      impWrap.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap';
      sorted(s.important).forEach(function (n) {
        impWrap.appendChild(UI.chip(String(n)));
      });
      impPanel.appendChild(impWrap);
    }
    container.appendChild(impPanel);

    /* ---------- Multiple Attempts (attempt-wise grouped rows) ---------- */
    var attPanel = sectionPanel('Multiple Attempts', function () { openAttemptsModal(s, null); });
    var attGroups = ['2', '3', '4+'].map(function (k) {
      var g = null;
      s.attempts.forEach(function (x) { if (x.attempts === k && x.qs.length) g = x; });
      return g;
    }).filter(function (g) { return g; });
    if (!attGroups.length) {
      attPanel.appendChild(el('div', 'sub-meta', 'Koi attempt entry nahi.'));
    } else {
      attGroups.forEach(function (g) {
        var row = rowBox();
        row.style.flexDirection = 'column';
        row.style.alignItems = 'stretch';
        var rhead = el('div');
        rhead.style.cssText = 'display:flex;align-items:center;gap:10px;margin-bottom:8px';
        var txt = el('div', null, g.attempts === '4+' ? '4+ attempts' : g.attempts + ' attempts');
        txt.style.cssText = 'flex:1;font-size:13px;font-weight:600;color:var(--ink2)';
        rhead.appendChild(txt);
        var rp = makePop(
          function () { openAttemptsModal(s, g); },
          function () {
            s.attempts = s.attempts.filter(function (x) { return x !== g; });
            ctx.commit();
            ctx.rerender();
          }
        );
        rhead.appendChild(kebab(function () { togglePop(rp); }));
        rhead.appendChild(rp);
        row.appendChild(rhead);
        var chips = el('div');
        chips.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap';
        sorted(g.qs).forEach(function (n) { chips.appendChild(UI.chip(String(n))); });
        row.appendChild(chips);
        attPanel.appendChild(row);
      });
    }
    container.appendChild(attPanel);

    /* ---------- Important Pages (page-wise grouped) ---------- */
    var pgPanel = sectionPanel('Important Pages', function () { openPageModal(s, null); });
    if (!s.pages.length) {
      pgPanel.appendChild(el('div', 'sub-meta', 'Koi page add nahi kiya.'));
    } else {
      s.pages.forEach(function (pg) {
        var row = rowBox();
        row.style.flexDirection = 'column';
        row.style.alignItems = 'stretch';

        var rhead = el('div');
        rhead.style.cssText = 'display:flex;align-items:center;gap:10px;margin-bottom:8px';
        rhead.appendChild(el('span', 'chap-num', 'P' + pg.page));
        var spacer = el('div');
        spacer.style.flex = '1';
        rhead.appendChild(spacer);
        var rp = makePop(
          function () { openPageModal(s, pg); },
          function () {
            s.pages = s.pages.filter(function (x) { return x !== pg; });
            ctx.commit();
            ctx.rerender();
          }
        );
        rhead.appendChild(kebab(function () { togglePop(rp); }));
        rhead.appendChild(rp);
        row.appendChild(rhead);

        if (pg.topics.length) {
          row.appendChild(label('Topics:'));
          var twrap = el('div');
          twrap.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px';
          pg.topics.forEach(function (t) { twrap.appendChild(UI.chip(esc(t))); });
          row.appendChild(twrap);
        }
        if (pg.qs.length) {
          row.appendChild(label('Questions:'));
          var qwrap = el('div');
          qwrap.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap';
          sorted(pg.qs).forEach(function (n) { qwrap.appendChild(UI.chip(String(n))); });
          row.appendChild(qwrap);
        }
        pgPanel.appendChild(row);
      });
    }
    container.appendChild(pgPanel);
  }

  /* ================================================================
     ENTRY : sources.js yahan se detail render karwata hai
  ================================================================ */
  window.SourcesDetail = {
    render: function (cont, s, context) {
      container = cont;
      source = s;
      ctx = context;
      render();
    }
  };
})();
