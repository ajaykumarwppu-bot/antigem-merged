/* ================================================================
   CANVAS / CANVAS.JS  —  Draw feature : canvas list + store
   ----------------------------------------------------------------
   • FAB ke DRAW button se khulti hai (bridge se)
   • List screen : "Draw" title + Add (+) button
       - Add popup (standard mid-screen modal) : canvas ka naam +
         category (optional — baad mein edit ho sakti hai)
       - Canvas cards : naam, category chip, date (kab bana)
       - card ke 3-dot se Edit (naam/category) / Delete (confirm)
       - card click → fullscreen editor (canvas-editor.js)
   • Data : { canvases: [ {id,name,category,date,cards[],lines[],groups[]} ] }
     core/storage.js ke saveAt/loadAt se alag key par persist.
     groups = glass group boxes (canvas-groups.js) — purane canvases
     mein field na ho to load par [] se normalize ho jati hai.
   ================================================================ */

(function () {
  'use strict';

  if (window.__achivaCanvasListLoaded) return;
  window.__achivaCanvasListLoaded = true;

  var el = UI.el, esc = UI.esc, uid = UI.uid;
  var ICON_PLUS = UI.icons.plusBig;
  var KEY = 'achiva.canvas.v1';

  var data = window.AppStorage.loadAt(KEY) || { canvases: [] };
  if (!Array.isArray(data.canvases)) data.canvases = [];
  data.canvases.forEach(function (c) {
    if (!Array.isArray(c.cards)) c.cards = [];
    if (!Array.isArray(c.lines)) c.lines = [];
    if (!Array.isArray(c.groups)) c.groups = [];
  });

  function persistNow() {
    window.AppStorage.saveAt(KEY, data);
  }

  function bridge() { return window.SubjectListBridge; }

  /* ---------- list screen ---------- */
  var screen = el('section', 'screen');
  screen.style.paddingTop = '58px';
  document.getElementById('app').appendChild(screen);

  var addModal = UI.modal({ zScrim: 81, zWrap: 82 });
  var editTarget = null;

  function openList() {
    render();
    bridge().show(screen, true);
  }

  function render() {
    screen.innerHTML = '';

    var head = el('div');
    head.style.cssText = 'display:flex;align-items:center;gap:12px;padding:12px 18px 4px';
    /* back arrow NAHI : Draw ek top-level feature hai (kisi cheez ke
       andar nahi) — is par aana-jaana FAB (menu button) se hota hai */
    var tw = el('div', 'sub-title-wrap');
    tw.style.flex = '1';
    tw.appendChild(el('h2', null, 'Draw'));
    tw.appendChild(el('div', 'sub-meta', data.canvases.length + ' canvases'));
    head.appendChild(tw);
    var addBtn = el('button', 'add-btn', ICON_PLUS);
    addBtn.type = 'button';
    addBtn.setAttribute('aria-label', 'Add canvas');
    addBtn.addEventListener('click', function () { openAddEdit(null); });
    head.appendChild(addBtn);
    screen.appendChild(head);

    var wrap = el('div', 'scroll');
    /* goal-scoped boards (category:'goal') Draw list mein NAHI dikhte —
       wo sirf apne goal ke andar (goal-task.js) khulte hain */
    var free = data.canvases.filter(function (c) { return c.category !== 'goal'; });
    head.querySelector('.sub-meta').textContent = free.length + ' canvases';
    if (!free.length) {
      var empty = el('div', 'empty', 'Koi canvas nahi.<br>+ button se apna pehla canvas add karo.');
      empty.style.margin = '12px 18px';
      wrap.appendChild(empty);
    }
    free.slice().reverse().forEach(function (c) {
      wrap.appendChild(canvasCard(c));
    });
    screen.appendChild(wrap);
  }

  function canvasCard(c) {
    var card = el('div', 'sub-card');
    card.style.padding = '12px 30px 12px 12px';
    var tile = el('div', 'sub-tile t2', esc((c.name || '?').charAt(0).toUpperCase()));
    tile.style.width = '40px';
    tile.style.height = '40px';
    tile.style.borderRadius = '12px';
    tile.style.fontSize = '16px';
    card.appendChild(tile);

    var main = el('div', 'sub-main');
    var top = el('div', 'cb-top');
    top.style.marginBottom = '4px';
    var head = el('div');
    head.style.cssText = 'flex:1;min-width:0';
    head.appendChild(el('h3', null, esc(c.name)));
    head.appendChild(el('div', 'sub-meta', c.date + (c.category ? ' · ' + esc(c.category) : '')));
    top.appendChild(head);
    if (c.category) top.appendChild(UI.chip(esc(c.category)));
    var pop = UI.makeKebabPop(
      function () { openAddEdit(c); },
      function () {
        data.canvases = data.canvases.filter(function (x) { return x !== c; });
        persistNow();
        render();
      }
    );
    var keb = UI.miniBtn(UI.icons.kebab, 'Edit or delete canvas');
    keb.addEventListener('click', function (e) {
      e.stopPropagation();
      UI.togglePop(pop);
    });
    top.appendChild(keb);
    main.appendChild(top);
    var metaTxt = (c.cards || []).length + ' cards · ' + (c.lines || []).length + ' lines';
    if ((c.groups || []).length) metaTxt += ' · ' + c.groups.length + ' groups';
    main.appendChild(el('div', 'sub-meta', metaTxt));
    card.appendChild(main);
    card.appendChild(pop);

    card.addEventListener('click', function () {
      if (window.CanvasEditor) window.CanvasEditor.open(c);
    });
    return card;
  }

  /* ---------- add / edit popup ---------- */
  function openAddEdit(existing) {
    editTarget = existing;
    addModal.open(existing ? 'Edit Canvas' : 'Add Canvas', function (body) {
      var nameF = UI.inputField('Canvas name', 'e.g. Physics Mindmap');
      var catF = UI.inputField('Category (optional)', 'e.g. Notes / Mindmap / Prep');
      body.appendChild(nameF.wrap);
      body.appendChild(catF.wrap);
      if (existing) {
        nameF.input.value = existing.name;
        catF.input.value = existing.category || '';
      }
      body._get = function () {
        return { name: nameF.input.value.trim(), category: catF.input.value.trim() };
      };
      window.setTimeout(function () {
        if (addModal.isOpen()) nameF.input.focus();
      }, 260);
    }, function () {
      var v = addModal.body._get();
      if (!v.name) return;
      if (editTarget) {
        editTarget.name = v.name;
        editTarget.category = v.category;
      } else {
        data.canvases.push({
          id: uid(),
          name: v.name,
          category: v.category,
          date: UI.fmtDate(UI.todayISO()),
          cards: [],
          lines: [],
          groups: []
        });
      }
      persistNow();
      addModal.close();
      render();
    });
  }

  window.CanvasList = {
    openList: openList,
    getData: function () { return data; },
    persistNow: persistNow
  };
})();
