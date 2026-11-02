/* ================================================================
   CANVAS / CANVAS-PRESENT.JS  —  Present / Revise mode
   ----------------------------------------------------------------
   Mind-map ko ek guided "presentation" ki tarah dikhata hai :

     start  → saare cards + lines HIDE (data safe, sirf invisible)
              camera root par zoom-in, root pop-in
     Next   → parent→child LINE stroke-dash se banti hai,
              child CARD pop-in hota hai, camera us par fly karta hai
     Prev   → aakhri reveal hua node wapas hide
     Auto   → har ~950ms par auto-next
     Anim   → animation on/off toggle (low-end phones ke liye instant)
     Exit   → overlay hatao, SAB kuch wapas visible, clean re-render

   Sirf VIEW mode hai : koi data mutate nahi hota, koi save nahi hota.
   Ek fullscreen overlay editor ke saare gestures (pan/drag/edit/undo)
   ko block karta hai, isliye existing editor logic bilkul nahi chhuta.

   Reveal order : DFS (root → topic → uske subtopics → agla topic),
   topic.js ke stamp kiye mm {depth,num,parentId} metadata se.
   Metadata na ho (generic canvas) to CanvasTemplates.inferHierarchy
   se fallback.

   Dependancies (sab read-only use) :
     api.getCanvas / getT / applyT / viewport / svg / cardsLayer / screen
     canvas-cards ke [data-cid] elements, canvas-lines ke <g data-lid>
   ================================================================ */

(function () {
  'use strict';

  if (window.__achivaCanvasPresentLoaded) return;
  window.__achivaCanvasPresentLoaded = true;

  var el = UI.el;

  var SPEED = { line: 320, box: 260, cam: 400, auto: 950 };

  var S = null;   /* active session */

  /* ---------- chhota tween helper (easeInOutCubic) ---------- */
  function raf(fn) {
    if (window.requestAnimationFrame) return window.requestAnimationFrame(fn);
    return window.setTimeout(function () { fn(Date.now()); }, 16);
  }
  function tween(ms, onFrame, onDone) {
    if (!ms || ms <= 0 || (S && S.instant)) { onFrame(1); if (onDone) onDone(); return; }
    var t0 = (window.performance && window.performance.now) ? window.performance.now() : Date.now();
    function frame(now) {
      var p = Math.min(1, (now - t0) / ms);
      var e = p < .5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
      onFrame(e);
      if (p < 1) raf(frame); else if (onDone) onDone();
    }
    raf(frame);
  }

  /* ---------- DOM lookups ---------- */
  function cardEl(id) {
    return S.api.cardsLayer.querySelector('[data-cid="' + id + '"]');
  }
  function lineG(id) {
    return S.api.svg.querySelector('[data-lid="' + id + '"]');
  }

  /* ---------- reveal order (DFS) ---------- */
  function buildOrder(canvas) {
    var cards = canvas.cards || [], lines = canvas.lines || [];
    var byId = {};
    cards.forEach(function (c) { byId[c.id] = c; });

    var edgeOf = {};
    lines.forEach(function (l) {
      var a = l.from && l.from.cid, b = l.to && l.to.cid;
      if (a && b) { edgeOf[a + '|' + b] = l.id; edgeOf[b + '|' + a] = l.id; }
    });

    var children = {}, rootId = null, hasMM = false;
    cards.forEach(function (c) { children[c.id] = []; if (c && c.mm) hasMM = true; });

    if (hasMM) {
      cards.forEach(function (c) {
        if (c.mm && c.mm.parentId && byId[c.mm.parentId]) children[c.mm.parentId].push(c.id);
        if (c.mm && (c.mm.depth === 0 || !c.mm.parentId) && !rootId) rootId = c.id;
      });
    } else if (window.CanvasTemplates && window.CanvasTemplates.inferHierarchy) {
      var H = window.CanvasTemplates.inferHierarchy(canvas);
      children = H.children;
      rootId = H.roots[0] || null;
    }

    var order = [], seen = {};
    function dfs(id, parentId) {
      if (seen[id] || !byId[id]) return;
      seen[id] = true;
      order.push({
        card: byId[id],
        parentId: parentId,
        edgeId: parentId ? (edgeOf[parentId + '|' + id] || null) : null
      });
      (children[id] || []).forEach(function (k) { dfs(k, id); });
    }
    if (rootId) dfs(rootId, null);
    /* forest / orphans : jo bach gaye unhe bhi order mein lo */
    cards.forEach(function (c) { if (!seen[c.id]) dfs(c.id, null); });
    return order;
  }

  /* ---------- hide / reveal primitives ---------- */
  function hideAll() {
    S.canvas.cards.forEach(function (c) {
      var e = cardEl(c.id);
      if (!e) return;
      e.style.transition = 'none';
      e.style.opacity = '0';
      e.style.transform = 'scale(.6)';
    });
    (S.canvas.lines || []).forEach(function (l) {
      var g = lineG(l.id);
      if (g) g.style.opacity = '0';
    });
  }
  function revealCard(c) {
    var e = cardEl(c.id);
    if (!e) return;
    e.style.transition = S.instant ? 'none'
      : 'opacity .26s ease, transform .26s cubic-bezier(.34,1.56,.64,1)';
    e.style.opacity = '1';
    e.style.transform = 'scale(1)';
  }
  function hideCard(c) {
    var e = cardEl(c.id);
    if (!e) return;
    e.style.transition = S.instant ? 'none' : 'opacity .18s ease';
    e.style.opacity = '0';
    e.style.transform = 'scale(.6)';
  }
  function revealLine(lineId) {
    var g = lineG(lineId);
    if (!g) return;
    g.style.opacity = '1';
    var vis = g.querySelector('[data-vis]');
    if (!vis || typeof vis.getTotalLength !== 'function') return;
    if (S.instant) {
      vis.style.strokeDasharray = 'none';
      vis.style.strokeDashoffset = '0';
      return;
    }
    var L = 0;
    try { L = vis.getTotalLength(); } catch (e) { return; }
    if (!(L > 0)) return;
    vis.style.strokeDasharray = String(L);
    vis.style.strokeDashoffset = String(L);
    tween(SPEED.line, function (p) {
      vis.style.strokeDashoffset = String(L * (1 - p));
    }, function () {
      vis.style.strokeDasharray = 'none';
      vis.style.strokeDashoffset = '0';
    });
  }
  function hideLine(lineId) {
    var g = lineG(lineId);
    if (!g) return;
    g.style.opacity = '0';
    var vis = g.querySelector('[data-vis]');
    if (vis) { vis.style.strokeDasharray = ''; vis.style.strokeDashoffset = ''; }
  }

  /* ---------- camera ---------- */
  function zoomFor(card, vw, vh) {
    var s = Math.min(vw / (card.w * 2.6), vh / (card.h * 2.6));
    return Math.max(.5, Math.min(1.4, s));
  }
  function flyTo(card) {
    var vw = S.api.viewport.clientWidth || 360;
    var vh = S.api.viewport.clientHeight || 640;
    var sT = zoomFor(card, vw, vh);
    var t0 = S.api.getT();
    var from = { x: t0.x, y: t0.y, s: t0.s };
    var to = { s: sT, x: vw / 2 - (card.x + card.w / 2) * sT, y: vh / 2 - (card.y + card.h / 2) * sT };
    tween(SPEED.cam, function (e) {
      var t = S.api.getT();
      t.x = from.x + (to.x - from.x) * e;
      t.y = from.y + (to.y - from.y) * e;
      t.s = from.s + (to.s - from.s) * e;
      S.api.applyT();
    });
  }
  function fitAll() {
    var cs = S.canvas.cards;
    if (!cs.length) return;
    var minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
    cs.forEach(function (c) {
      minX = Math.min(minX, c.x); minY = Math.min(minY, c.y);
      maxX = Math.max(maxX, c.x + c.w); maxY = Math.max(maxY, c.y + c.h);
    });
    var vw = S.api.viewport.clientWidth || 360, vh = S.api.viewport.clientHeight || 640;
    var s = Math.max(.2, Math.min(1.2, Math.min((vw - 70) / (maxX - minX), (vh - 130) / (maxY - minY))));
    var from = S.api.getT(); var f = { x: from.x, y: from.y, s: from.s };
    var to = { s: s, x: vw / 2 - (minX + (maxX - minX) / 2) * s, y: vh / 2 - (minY + (maxY - minY) / 2) * s };
    tween(SPEED.cam, function (e) {
      var t = S.api.getT();
      t.x = f.x + (to.x - f.x) * e; t.y = f.y + (to.y - f.y) * e; t.s = f.s + (to.s - f.s) * e;
      S.api.applyT();
    });
  }

  /* ---------- controls / overlay ---------- */
  function hud() {
    if (!S || !S.hud) return;
    var en = S.order[S.index];
    var label = en ? String(en.card.text || '') : '';
    S.hud.textContent = (S.index + 1) + ' / ' + S.order.length + '  ·  ' + label;
  }
  function mkBtn(label, fn, primary) {
    var b = el('button', null, label);
    b.type = 'button';
    b.style.cssText = 'padding:10px 16px;border-radius:99px;font:inherit;font-size:13px;' +
      'font-weight:700;cursor:pointer;color:#fff;border:1px solid ' +
      (primary ? 'transparent' : 'rgba(255,255,255,.28)') + ';background:' +
      (primary ? '#20242a' : 'rgba(20,23,28,.78)');
    b.addEventListener('click', function (e) { e.stopPropagation(); fn(); });
    b.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
    return b;
  }
  function buildOverlay() {
    var ov = el('div');
    ov.style.cssText = 'position:absolute;inset:0;z-index:60;touch-action:none';

    var hudEl = el('div');
    hudEl.style.cssText = 'position:absolute;top:12px;left:50%;transform:translateX(-50%);' +
      'max-width:76vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' +
      'padding:6px 14px;border-radius:99px;background:rgba(20,23,28,.8);color:#fff;' +
      'font-size:12px;font-weight:700';
    ov.appendChild(hudEl);
    S.hud = hudEl;

    var bar = el('div');
    bar.style.cssText = 'position:absolute;bottom:16px;left:50%;transform:translateX(-50%);' +
      'display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:center;max-width:94vw';
    S.prevB = mkBtn('◀ Prev', prev);
    S.nextB = mkBtn('Next ▶', next, true);
    S.autoB = mkBtn('▶ Auto', toggleAuto);
    S.animB = mkBtn('Anim', toggleAnim);
    var exitB = mkBtn('✕ Exit', exit);
    bar.appendChild(S.prevB); bar.appendChild(S.nextB);
    bar.appendChild(S.autoB); bar.appendChild(S.animB); bar.appendChild(exitB);
    ov.appendChild(bar);

    /* editor ke saare gestures block : overlay events ko aage nahi jaane deta */
    ov.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
    ov.addEventListener('click', function (e) { e.stopPropagation(); });
    ov.addEventListener('wheel', function (e) { e.stopPropagation(); }, { passive: false });

    S.api.screen.appendChild(ov);
    S.overlay = ov;
  }

  /* ---------- stepping ---------- */
  function next() {
    if (!S) return;
    if (S.index >= S.order.length - 1) { stopAuto(); fitAll(); return; }
    S.index++;
    var en = S.order[S.index];
    if (en.edgeId) revealLine(en.edgeId);
    revealCard(en.card);
    flyTo(en.card);
    hud();
  }
  function prev() {
    if (!S || S.index <= 0) return;
    var en = S.order[S.index];
    hideCard(en.card);
    if (en.edgeId) hideLine(en.edgeId);
    S.index--;
    flyTo(S.order[S.index].card);
    hud();
  }
  function toggleAuto() {
    if (!S) return;
    if (S.playing) { stopAuto(); return; }
    S.playing = true;
    if (S.autoB) S.autoB.textContent = '⏸ Auto';
    S.timer = window.setInterval(function () {
      if (!S) return;
      if (S.index >= S.order.length - 1) { stopAuto(); fitAll(); }
      else next();
    }, SPEED.auto);
  }
  function stopAuto() {
    if (!S) return;
    if (S.timer) { window.clearInterval(S.timer); S.timer = null; }
    S.playing = false;
    if (S.autoB) S.autoB.textContent = '▶ Auto';
  }
  function toggleAnim() {
    if (!S) return;
    S.instant = !S.instant;
    if (S.animB) S.animB.textContent = S.instant ? 'Anim: off' : 'Anim';
  }

  /* ---------- lifecycle ---------- */
  function start(api, opts) {
    if (S) return;
    var canvas = api && api.getCanvas ? api.getCanvas() : null;
    if (!canvas || (canvas.cards || []).length < 2) return;
    var order = buildOrder(canvas);
    if (!order.length) return;
    S = { api: api, canvas: canvas, order: order, index: -1,
          instant: !!(opts && opts.instant), playing: false, timer: null };
    buildOverlay();
    hideAll();
    next();            /* root reveal + zoom-in */
  }

  function exit() {
    if (!S) return;
    stopAuto();
    /* inline styles saaf karo (restore) */
    S.canvas.cards.forEach(function (c) {
      var e = cardEl(c.id);
      if (e) { e.style.opacity = ''; e.style.transform = ''; e.style.transition = ''; }
    });
    (S.canvas.lines || []).forEach(function (l) {
      var g = lineG(l.id);
      if (!g) return;
      g.style.opacity = '';
      var v = g.querySelector('[data-vis]');
      if (v) { v.style.strokeDasharray = ''; v.style.strokeDashoffset = ''; }
    });
    if (S.overlay && S.overlay.parentNode) S.overlay.parentNode.removeChild(S.overlay);
    S = null;
    /* pristine re-render — existing pipeline ko hi kaam karne do */
    if (window.CanvasCards) window.CanvasCards.render();
    if (window.CanvasLines) window.CanvasLines.render();
  }

  window.CanvasPresent = {
    start: start,
    exit: exit,
    next: next,
    prev: prev,
    isActive: function () { return !!S; },
    buildOrder: buildOrder,          /* tests ke liye */
    _session: function () { return S; }
  };
})();
