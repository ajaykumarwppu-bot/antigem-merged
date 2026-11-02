/* ================================================================
   FEATURES / THOUGHT / GRAPH.JS — Obsidian-jaisa thought graph
   ----------------------------------------------------------------
   • Phone-friendly force-directed graph (SVG, koi library nahi) :
       - nodes = categories / sub-categories + thoughts (store se)
       - edges = parent↔sub connections (auto) + demo edges
       - 1 finger drag = pan · node drag = move · pinch = zoom
       - +/−/⟲ zoom buttons · node tap = actions sheet
   • Upar SETTING (gear) button → panel mein :
       - "+ Add category" (top-level)
       - poori tree : har category/sub ke saath [+ sub] [rename]
         [delete] — nesting kitni bhi gehri (3000 tak bhi chalegi)
       - jo bhi category/sub banegi wo TURANT graph mein node ban
         kar apne parent se connected dikhti hai
   • Storage : 'achiva.thoughtCats.v1' → { cats:[{id,name,parent}],
       links:[] } — backup/namespace pehle se is key ko jaante hain.
   • FAB → THOUGHT route (core/app-shell.js) window.ThoughtFeature
     dekhta hai — isi liye yahan bhi wahi export set hota hai.
   • ES5-only (purane WebView safe).
   ================================================================ */

(function () {
  'use strict';

  if (window.__achivaThoughtGraphLoaded) return;
  window.__achivaThoughtGraphLoaded = true;

  var el = UI.el, esc = UI.esc;
  var CATS_KEY = 'achiva.thoughtCats.v1';
  var PALETTE = ['#4a90d9', '#2ea043', '#e67e22', '#9b59b6', '#c0392b', '#16a085', '#d4a017', '#7f8c8d'];

  /* ---------- storage ---------- */
  var data = window.AppStorage.loadAt(CATS_KEY) || { cats: [], links: [] };
  if (!Array.isArray(data.cats)) data.cats = [];
  if (!Array.isArray(data.links)) data.links = [];
  function persist() { window.AppStorage.saveAt(CATS_KEY, data); }

  function allCats() { return data.cats; }
  function getCat(id) {
    for (var i = 0; i < data.cats.length; i++) if (data.cats[i].id === id) return data.cats[i];
    return null;
  }
  function topCats() { return data.cats.filter(function (c) { return !c.parent; }); }
  function subCatsOf(id) { return data.cats.filter(function (c) { return c.parent === id; }); }
  function addCat(name, parentId) {
    var c = { id: UI.uid(), name: name || 'Category', parent: parentId || null };
    data.cats.push(c);
    persist();
    render();
    return c;
  }
  function renameCat(id, name) {
    var c = getCat(id);
    if (!c) return null;
    c.name = name;
    persist();
    render();
    return c;
  }
  /* delete = khud + saari nested subs + unke future links */
  function removeCat(id) {
    var doomed = {};
    (function collect(cid) {
      doomed[cid] = 1;
      subCatsOf(cid).forEach(function (s) { collect(s.id); });
    })(id);
    data.cats = data.cats.filter(function (c) { return !doomed[c.id]; });
    data.links = data.links.filter(function (l) { return !doomed[l.catId]; });
    persist();
    render();
  }
  function topCatOf(catId) {
    var c = getCat(catId), guard = 0;
    while (c && c.parent && guard < 3000) { c = getCat(c.parent); guard++; }
    return c || null;
  }

  /* ---------- screen : graph POORI screen cover karta hai ----------
     Koi head/title nahi — sirf ek chhota sa GEAR button (settings
     screen kholta hai). */
  var screen = el('section', 'screen');
  screen.style.cssText += ';padding-top:8px;display:flex;flex-direction:column';
  screen.setAttribute('data-thought-full', '1');   /* yahan header/FAB chhupo */
  document.getElementById('app').appendChild(screen);

  var box = el('div');
  box.style.cssText = 'position:relative;flex:1;margin:0;overflow:hidden;background:var(--chap-bg)';
  screen.appendChild(box);

  /* BACK button : Knowledge Graph → wapas Recording/Upload screen */
  var backB = UI.miniBtn(UI.icons.back, 'Back to Thought');
  backB.style.cssText += ';position:absolute;top:8px;left:8px;z-index:6;width:34px;height:34px;' +
    'border-radius:50%;border:1px solid var(--s2);background:var(--chip-bg)';
  backB.addEventListener('click', function () {
    if (window.ThoughtMain) window.ThoughtMain.open();
  });
  screen.appendChild(backB);
  var GEAR = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.01a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55h.01a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.01a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1z"/></svg>';
  var gearB = UI.miniBtn(GEAR, 'Settings — categories');
  gearB.style.cssText += ';position:absolute;top:8px;right:8px;z-index:6;width:34px;height:34px;' +
    'border-radius:50%;border:1px solid var(--s2);background:var(--chip-bg)';
  gearB.addEventListener('click', function () { openSettings(); });
  screen.appendChild(gearB);

  /* ---------- graph render ---------- */
  var raf = 0;
  function render() {
    if (raf) window.cancelAnimationFrame(raf);
    raf = 0;
    box.innerHTML = '';

    var nodes = [], edges = [], byId = {};
    var topColor = {};
    topCats().forEach(function (c, i) { topColor[c.id] = PALETTE[i % PALETTE.length]; });
    function colorOfCat(cid) {
      var t = topCatOf(cid);
      return (t && topColor[t.id]) || '#7f8c8d';
    }

    data.cats.forEach(function (c) {
      var n = {
        id: 'cat:' + c.id, catId: c.id, kind: c.parent ? 'sub' : 'cat',
        label: c.name, color: colorOfCat(c.id),
        x: (Math.random() - 0.5) * 260, y: (Math.random() - 0.5) * 260, vx: 0, vy: 0
      };
      nodes.push(n); byId[n.id] = n;
    });
    /* THOUGHTS bhi nodes hain (store se) — categories se linked */
    if (window.ThoughtStore) {
      window.ThoughtStore.all().forEach(function (t, ti) {
        var cs = window.ThoughtStore.catsOf(t.id);
        var col = cs.length ? colorOfCat(cs[0].id) : '#98a0ab';
        var n = {
          id: 'th:' + t.id, kind: 'thought',
          label: t.name || ('Thought ' + (ti + 1)),
          thoughtId: t.id, color: col,
          x: (Math.random() - 0.5) * 300, y: (Math.random() - 0.5) * 300, vx: 0, vy: 0
        };
        nodes.push(n); byId[n.id] = n;
      });
    }
    data.cats.forEach(function (c) {
      if (c.parent && byId['cat:' + c.parent]) edges.push([byId['cat:' + c.id], byId['cat:' + c.parent]]);
    });
    if (window.ThoughtStore) {
      window.ThoughtStore.all().forEach(function (t) {
        (t.catIds || []).forEach(function (cid) {
          var a = byId['th:' + t.id], b = byId['cat:' + cid];
          if (a && b) edges.push([a, b]);
        });
      });
    }

    if (!nodes.length) {
      var hint = el('div', null, 'Graph khali hai — upar gear se pehli category add karo.');
      hint.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;' +
        'font-size:12px;color:var(--slate);text-align:center;padding:20px';
      box.appendChild(hint);
      return;
    }

    var NS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(NS, 'svg');
    svg.style.cssText = 'width:100%;height:100%;display:block;touch-action:none';
    box.appendChild(svg);
    var world = document.createElementNS(NS, 'g');
    svg.appendChild(world);
    var edgeEls = edges.map(function () {
      var l = document.createElementNS(NS, 'line');
      l.setAttribute('stroke', 'var(--s2)');
      l.setAttribute('stroke-width', '1.1');
      l.setAttribute('stroke-opacity', '.8');
      world.appendChild(l);
      return l;
    });
    var nodeEls = nodes.map(function (n) {
      var g = document.createElementNS(NS, 'g');
      g.style.cursor = 'pointer';
      var c = document.createElementNS(NS, 'circle');
      c.setAttribute('r', n.kind === 'cat' ? '8' : n.kind === 'sub' ? '6' : '5');
      c.setAttribute('fill', n.color);
      c.setAttribute('stroke', 'var(--tile-bg)');
      c.setAttribute('stroke-width', '1.6');
      g.appendChild(c);
      var t = document.createElementNS(NS, 'text');
      t.setAttribute('y', '17');
      t.setAttribute('text-anchor', 'middle');
      t.setAttribute('font-size', '8');
      t.setAttribute('fill', 'var(--ink2)');
      t.textContent = n.label.length > 26 ? n.label.slice(0, 25) + '…' : n.label;
      g.appendChild(t);
      world.appendChild(g);
      return g;
    });

    /* ---- view (pan/zoom) ---- */
    var view = { x: 0, y: 0, k: 1 };
    function applyView() {
      var w = box.clientWidth || 300, h = box.clientHeight || 300;
      world.setAttribute('transform', 'translate(' + (w / 2 + view.x) + ',' + (h / 2 + view.y) + ') scale(' + view.k + ')');
    }
    function paint() {
      edges.forEach(function (e, i) {
        edgeEls[i].setAttribute('x1', e[0].x); edgeEls[i].setAttribute('y1', e[0].y);
        edgeEls[i].setAttribute('x2', e[1].x); edgeEls[i].setAttribute('y2', e[1].y);
      });
      nodes.forEach(function (n, i) {
        nodeEls[i].setAttribute('transform', 'translate(' + n.x + ',' + n.y + ')');
      });
      applyView();
    }

    /* ---- physics : repulsion + spring + center gravity ---- */
    var alpha = 1;
    function tick() {
      if (alpha > 0.02) {
        var i, j, a, b, dx, dy, d2;
        for (i = 0; i < nodes.length; i++) {
          for (j = i + 1; j < nodes.length; j++) {
            a = nodes[i]; b = nodes[j];
            dx = b.x - a.x; dy = b.y - a.y;
            d2 = dx * dx + dy * dy || 1;
            if (d2 < 48000) {
              var f = 1100 / d2 * alpha;
              a.vx -= dx * f; a.vy -= dy * f;
              b.vx += dx * f; b.vy += dy * f;
            }
          }
        }
        edges.forEach(function (e) {
          var dx2 = e[1].x - e[0].x, dy2 = e[1].y - e[0].y;
          var d = Math.sqrt(dx2 * dx2 + dy2 * dy2) || 1;
          var f2 = (d - 78) * 0.022 * alpha;
          e[0].vx += dx2 / d * f2; e[0].vy += dy2 / d * f2;
          e[1].vx -= dx2 / d * f2; e[1].vy -= dy2 / d * f2;
        });
        nodes.forEach(function (n) {
          if (n.fixed) { n.vx = 0; n.vy = 0; return; }
          n.vx -= n.x * 0.013 * alpha; n.vy -= n.y * 0.013 * alpha;
          n.x += n.vx; n.y += n.vy;
          n.vx *= 0.8; n.vy *= 0.8;
        });
        alpha *= 0.986;
        paint();
      }
      raf = window.requestAnimationFrame(tick);
    }
    paint();
    raf = window.requestAnimationFrame(tick);

    /* ---- touch/mouse : pan · PINCH-ZOOM (2 fingers) · node drag · tap ---- */
    var pointers = {}, dragN = null, panS = null, pinch = null, moved = 0;
    function toWorld(cx, cy) {
      var r = svg.getBoundingClientRect();
      var w = box.clientWidth || 300, h = box.clientHeight || 300;
      return { x: (cx - r.left - w / 2 - view.x) / view.k, y: (cy - r.top - h / 2 - view.y) / view.k };
    }
    function pCount() { var n = 0; for (var k in pointers) n++; return n; }
    function addPointer(ev) {
      pointers[ev.pointerId] = { x: ev.clientX, y: ev.clientY };
      try { if (svg.setPointerCapture) svg.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
    }
    function startPinch() {
      var ids = Object.keys(pointers);
      if (ids.length < 2) return;
      var a = pointers[ids[0]], b = pointers[ids[1]];
      var r = svg.getBoundingClientRect();
      var w = box.clientWidth || 300, h = box.clientHeight || 300;
      var midX = (a.x + b.x) / 2 - r.left - w / 2;
      var midY = (a.y + b.y) / 2 - r.top - h / 2;
      pinch = {
        d0: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        k0: view.k,
        wx: (midX - view.x) / view.k,
        wy: (midY - view.y) / view.k
      };
      if (dragN) { dragN.fixed = false; dragN = null; }
      panS = null;
    }
    function downCommon(ev) {
      ev.preventDefault();
      addPointer(ev);
      moved = 0;
      if (pCount() === 2) { startPinch(); return true; }
      return pCount() > 2;
    }
    svg.addEventListener('pointerdown', function (ev) {
      if (downCommon(ev)) return;
      if (pinch) return;
      var wp = toWorld(ev.clientX, ev.clientY);
      var hit = null, best = 14 / view.k + 6;
      nodes.forEach(function (n) {
        var d = Math.hypot(n.x - wp.x, n.y - wp.y);
        if (d < best) { best = d; hit = n; }
      });
      if (hit) { dragN = hit; hit.fixed = true; alpha = Math.max(alpha, 0.25); }
      else panS = { sx: ev.clientX, sy: ev.clientY, ox: view.x, oy: view.y };
    });
    ['gesturestart', 'gesturechange'].forEach(function (gn) {
      svg.addEventListener(gn, function (e) { e.preventDefault(); });
    });
    nodeEls.forEach(function (g, i) {
      g.addEventListener('pointerdown', function (ev) {
        ev.stopPropagation();
        if (downCommon(ev)) return;
        if (pinch) return;
        dragN = nodes[i];
        dragN.fixed = true;
        alpha = Math.max(alpha, 0.25);
      });
    });
    window.addEventListener('pointermove', function (ev) {
      if (!pointers[ev.pointerId]) return;
      pointers[ev.pointerId] = { x: ev.clientX, y: ev.clientY };
      moved++;
      if (pinch && pCount() >= 2) {
        var ids = Object.keys(pointers);
        var a = pointers[ids[0]], b = pointers[ids[1]];
        var r = svg.getBoundingClientRect();
        var w = box.clientWidth || 300, h = box.clientHeight || 300;
        var midX = (a.x + b.x) / 2 - r.left - w / 2;
        var midY = (a.y + b.y) / 2 - r.top - h / 2;
        var d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        view.k = Math.min(3, Math.max(0.35, pinch.k0 * (d / pinch.d0)));
        view.x = midX - pinch.wx * view.k;
        view.y = midY - pinch.wy * view.k;
        applyView();
        return;
      }
      if (dragN) {
        var wp = toWorld(ev.clientX, ev.clientY);
        dragN.x = wp.x; dragN.y = wp.y;
        paint();
      } else if (panS) {
        view.x = panS.ox + (ev.clientX - panS.sx);
        view.y = panS.oy + (ev.clientY - panS.sy);
        applyView();
      }
    });
    function endPointer(ev) {
      if (!pointers[ev.pointerId]) return;
      delete pointers[ev.pointerId];
      if (pCount() < 2) pinch = null;
      if (dragN) {
        var n = dragN;
        n.fixed = false;
        dragN = null;
        if (pCount() === 0 && moved < 4) openNodeSheet(n);
      }
      if (pCount() === 0) { panS = null; moved = 0; }
    }
    window.addEventListener('pointerup', endPointer);
    window.addEventListener('pointercancel', endPointer);

    /* ---- zoom buttons ---- */
    var zb = el('div');
    zb.style.cssText = 'position:absolute;bottom:10px;right:10px;display:flex;gap:6px';
    [['+', 1.2], ['−', 0.83], ['⟲', 0]].forEach(function (b) {
      var x = el('button', null, b[0]);
      x.type = 'button';
      x.style.cssText = 'width:30px;height:30px;border-radius:9px;border:1px solid var(--s2);' +
        'background:var(--chip-bg);color:var(--ink2);cursor:pointer;font:inherit;font-size:13px';
      x.addEventListener('click', function () {
        if (b[1] === 0) { view.x = 0; view.y = 0; view.k = 1; alpha = Math.max(alpha, 0.4); }
        else view.k = Math.min(3, Math.max(0.35, view.k * b[1]));
        applyView();
      });
      zb.appendChild(x);
    });
    box.appendChild(zb);

    var leg = el('div');
    leg.style.cssText = 'position:absolute;left:10px;bottom:8px;font-size:9px;color:var(--ash);' +
      'letter-spacing:.04em;pointer-events:none';
    leg.textContent = 'drag = pan · pinch = zoom · node drag = move · tap = actions';
    box.appendChild(leg);
  }

  /* ---------- naam modal (add/rename shared) ---------- */
  function openNameModal(title, initial, saveLabel, cb) {
    var m = UI.modal({ zScrim: 92, zWrap: 93, saveLabel: saveLabel || 'Save' });
    var f = null;
    m.open(title, function (body) {
      f = UI.inputField('Naam', 'category / sub-category ka naam');
      f.input.value = initial || '';
      body.appendChild(f.wrap);
    }, function () {
      var v = (f.input.value || '').trim();
      if (!v) { f.input.focus(); return; }
      m.close();
      cb(v);
    });
  }

  /* ---------- node tap sheet ---------- */
  function openNodeSheet(n) {
    var cat = getCat(n.catId);
    if (!cat) return;
    var m = UI.modal({ zScrim: 94, zWrap: 95 });
    m.open(cat.name, function (body) {
      var info = el('div', null, (cat.parent ? 'Sub-category' : 'Main category') + ' · ' +
        subCatsOf(cat.id).length + ' sub');
      info.style.cssText = 'font-size:10.5px;color:var(--slate);margin-bottom:10px';
      body.appendChild(info);
      function btn(txt, fn, danger) {
        var b = el('button', null, txt);
        b.type = 'button';
        b.style.cssText = 'width:100%;margin-bottom:8px;padding:11px;border-radius:12px;border:1px solid ' +
          (danger ? 'rgba(192,57,43,.4)' : 'var(--s2)') + ';background:var(--chip-bg);font:inherit;' +
          'font-size:12.5px;font-weight:600;color:' + (danger ? '#c0392b' : 'var(--ink2)') + ';cursor:pointer';
        b.addEventListener('click', fn);
        body.appendChild(b);
      }
      btn('+ Iske andar sub-category', function () {
        m.close();
        openNameModal('Sub-category — ' + cat.name, '', 'Add', function (v) { addCat(v, cat.id); });
      });
      btn('Rename', function () {
        m.close();
        openNameModal('Rename', cat.name, 'Rename', function (v) { renameCat(cat.id, v); });
      });
      btn('Delete (saare subs ke saath)', function () {
        m.close();
        removeCat(cat.id);
      }, true);
    }, null);
  }

  /* ---------- SETTINGS : poori alag SCREEN (popup nahi) ----------
     Upar ADD CATEGORY input + button; neeche saari categories ki
     tree — har row par PLUS icon (sub-category add), kebab se
     rename/delete. Nesting kitni bhi gehri ho sakti hai. */
  var setScreen = null;
  function openSettings() {
    if (!setScreen) {
      setScreen = el('section', 'screen');
      setScreen.style.paddingTop = '58px';
      document.getElementById('app').appendChild(setScreen);
    }
    setScreen.innerHTML = '';
    var scroll = el('div', 'scroll');

    var head = el('div');
    head.style.cssText = 'display:flex;align-items:center;gap:10px;padding:12px 16px 6px';
    var back = UI.miniBtn(UI.icons.back, 'Back to graph');
    back.style.cssText += ';width:34px;height:34px;border-radius:50%;border:1px solid var(--s2);background:var(--chip-bg)';
    back.addEventListener('click', function () { open(); });
    head.appendChild(back);
    var tt = el('b', null, 'Categories');
    tt.style.cssText = 'flex:1;font-family:var(--f-disp);font-size:17px;font-weight:700;color:var(--ink)';
    head.appendChild(tt);
    scroll.appendChild(head);

    /* upar : add category */
    var addWrap = el('div');
    addWrap.style.cssText = 'margin:6px 18px 12px;padding:12px 14px;border:1px solid var(--line);' +
      'border-radius:16px;background:var(--tile-bg);box-shadow:inset 0 1px 0 var(--hl-soft)';
    var f = UI.inputField('Add category', 'category ka naam likho');
    f.wrap.style.marginBottom = '8px';
    addWrap.appendChild(f.wrap);
    var addB = UI.pillBtn('+ Add category');
    addB.addEventListener('click', function () {
      var v = (f.input.value || '').trim();
      if (!v) { f.input.focus(); return; }
      addCat(v, null);
      openSettings();
    });
    addWrap.appendChild(addB);
    scroll.appendChild(addWrap);

    /* tree : name + PLUS (sub add) + kebab (rename/delete) */
    function rowFor(cat, depth) {
      var r = el('div');
      r.style.cssText = 'position:relative;display:flex;align-items:center;gap:6px;' +
        'margin:0 18px 6px ' + (18 + depth * 18) + 'px;padding:10px 34px 10px 12px;' +
        'border:1px solid var(--line);border-radius:12px;background:var(--chap-bg)';
      var nm = el('div', null, (depth ? '↳ ' : '') + esc(cat.name));
      nm.style.cssText = 'flex:1;min-width:0;font-size:13px;font-weight:' + (depth ? '500' : '700') +
        ';color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
      r.appendChild(nm);
      var cnt = subCatsOf(cat.id).length;
      if (cnt) {
        var cc = UI.chip(cnt + ' sub');
        cc.style.cssText += ';font-size:9px';
        r.appendChild(cc);
      }
      var plus = UI.miniBtn(UI.icons.plus, 'Add sub-category');
      plus.style.cssText += ';border:1px solid var(--s2);background:var(--chip-bg)';
      plus.addEventListener('click', function (e) {
        e.stopPropagation();
        openNameModal('Sub-category — ' + cat.name, '', 'Add', function (v) {
          addCat(v, cat.id);
          openSettings();
        });
      });
      r.appendChild(plus);
      var pop = UI.makeKebabPop(function () {
        openNameModal('Rename', cat.name, 'Rename', function (v) {
          renameCat(cat.id, v);
          openSettings();
        });
      }, function () {
        removeCat(cat.id);
        openSettings();
      });
      var k = UI.miniBtn(UI.icons.kebab, 'Rename or delete');
      k.addEventListener('click', function (e) { e.stopPropagation(); UI.togglePop(pop); });
      r.appendChild(k);
      r.appendChild(pop);
      scroll.appendChild(r);
      subCatsOf(cat.id).forEach(function (s2) { rowFor(s2, depth + 1); });
    }
    var tops = topCats();
    if (!tops.length) {
      var hint = el('div', null, 'Abhi koi category nahi.<br>Upar se add karo — har category graph mein ' +
        'node banegi, sub-categories parent se auto-connect hongi.');
      hint.style.cssText = 'margin:20px 18px;padding:20px;border:1px dashed var(--s2);border-radius:16px;' +
        'color:var(--slate);font-size:12px;line-height:1.7;text-align:center';
      scroll.appendChild(hint);
    }
    tops.forEach(function (c) { rowFor(c, 0); });
    setScreen.appendChild(scroll);
    if (window.SubjectListBridge) window.SubjectListBridge.show(setScreen, true);
  }

  /* ---------- open ---------- */
  function open() {
    render();
    if (window.SubjectListBridge) window.SubjectListBridge.show(screen, true);
  }

  window.ThoughtGraph = {
    open: open, render: render,
    allCats: allCats, getCat: getCat, topCats: topCats, subCatsOf: subCatsOf,
    addCat: addCat, renameCat: renameCat, removeCat: removeCat,
    openSettings: openSettings
  };
  /* FAB → THOUGHT route (app-shell) isi export ko dhundhta hai */
  window.ThoughtFeature = { open: open };
})();
