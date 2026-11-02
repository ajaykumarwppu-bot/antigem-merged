/* ================================================================
   CANVAS / CANVAS-EDITOR.JS  —  fullscreen canvas shell
   ----------------------------------------------------------------
   • Koi top header nahi — poori screen canvas
   • Side buttons : upar right = Back + AI plan (BYOK, canvas-ai.js)
                    + Settings (layout-template chooser — template.js)
                    neeche right = Fit, Undo, Redo, Read-only
   • Infinite viewport : pan, pinch-zoom, wheel-zoom
   • Double-tap (do quick taps) khali jagah → naya card
     (mobile par dblclick fire nahi hota, isliye own detection)
   • LONG-PRESS (~½ sec) khali jagah / group box par + drag →
     dashed marquee → release par GLASS GROUP BOX banta hai
     (box ki duniya canvas-groups.js mein; detection yahan)
   • Undo/Redo snapshots, Read-only lock, Fit-to-screen
   • Shared color-plate modal (full picker + saved colors)
   • Modules ko API : world/svg, transform, coords, commit,
     focusCard, openColorPlate, groupsLayer, markMoved
   ================================================================ */

(function () {
  'use strict';

  if (window.__achivaCanvasEditorLoaded) return;
  window.__achivaCanvasEditorLoaded = true;

  var el = UI.el;
  var ICON_BACK = UI.icons.back;
  var ICON_GEAR = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h0a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55h0a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v0a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1z"/></svg>';
  var ICON_FIT = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3"/></svg>';
  var ICON_UNDO = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-15-6.7L3 13"/></svg>';
  var ICON_REDO = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 15-6.7L21 13"/></svg>';
  var ICON_EYE = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
  var ICON_AI = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.8 4.9L18.7 9.7l-4.9 1.8L12 16.4l-1.8-4.9L5.3 9.7l4.9-1.8z"/><path d="M18.5 15l.9 2.3 2.3.9-2.3.9-.9 2.3-.9-2.3-2.3-.9 2.3-.9z"/></svg>';
  /* CANVAS-PRESENT: play/present glyph (sirf mind-map canvases par dikhta hai) */
  var ICON_PRESENT = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M8 5.1v13.8L19 12z"/></svg>';

  var canvas = null;
  var readOnly = false;
  /* READ-ONLY gesture fix : lock ON ho to cards / group boxes / line
     hits pointer-events NA pakdein — har touch seedha world/viewport
     par gire, jisse pan (scroll) aur pinch/wheel zoom KAHIN SE bhi
     chale (khali jagah ho ya card ke upar). Padhna/scroll/zoom sab
     free; edit pehle hi blocked hai. */
  (function () {
    var st = document.createElement('style');
    st.textContent = '.ro [data-cid],.ro [data-gid],.ro svg{pointer-events:none}';
    document.head.appendChild(st);
  })();
  var t = { x: 60, y: 90, s: 1 };

  /* ---------- screen ---------- */
  var screen = el('section', 'screen');
  screen.style.cssText = 'padding-top:0;z-index:65;background:var(--paper)';
  document.getElementById('app').appendChild(screen);

  /* side toolbar : TOP = back + settings */
  var topTools = el('div');
  topTools.style.cssText = 'position:absolute;top:10px;right:10px;z-index:6;' +
    'display:flex;flex-direction:column;gap:8px';
  /* side toolbar : BOTTOM = fit, undo, redo, read-only */
  var bottomTools = el('div');
  bottomTools.style.cssText = 'position:absolute;bottom:14px;right:10px;z-index:6;' +
    'display:flex;flex-direction:column;gap:8px';

  function toolBtn(html, ariaLabel) {
    var b = el('button', 'icon-btn', html);
    b.type = 'button';
    b.setAttribute('aria-label', ariaLabel);
    b.style.width = '38px';
    b.style.height = '38px';
    return b;
  }
  var backBtn = toolBtn(ICON_BACK, 'Back');
  backBtn.addEventListener('click', function () {
    if (backFn) { backFn(); return; }
    if (window.CanvasList) window.CanvasList.openList();
  });
  var setBtn = toolBtn(ICON_GEAR, 'Settings');
  var setModal = UI.modal({ zScrim: 90, zWrap: 91 });
  setBtn.addEventListener('click', function () {
    setModal.open('Settings', function (body) {
      /* TEMPLATE: layout-template chooser (features/canvas/template.js).
         File load na hui ho to purana "Coming soon" fallback. */
      if (window.CanvasTemplates && window.CanvasTemplates.buildSettings) {
        body.appendChild(window.CanvasTemplates.buildSettings(function () { setModal.close(); }));
      } else {
        body.appendChild(el('div', 'empty', 'Coming soon<br>Canvas settings yahan jald add hongi.'));
      }
    }, null);
  });
  /* AI plan (BYOK) — canvas-ai.js; jahan bhi canvas khulta hai wahi button */
  var aiBtn = toolBtn(ICON_AI, 'AI plan');
  aiBtn.addEventListener('click', function () {
    if (readOnly) return;
    if (window.CanvasAI) window.CanvasAI.open();
  });
  /* CANVAS-PRESENT: Present/Revise mode — sirf topic auto mind-maps par.
     open() mein visibility set hoti hai (mindmap-* id ya mm metadata). */
  var presentBtn = toolBtn(ICON_PRESENT, 'Present / Revise');
  presentBtn.style.display = 'none';
  presentBtn.addEventListener('click', function () {
    if (window.CanvasPresent) window.CanvasPresent.start(api);
  });
  topTools.appendChild(backBtn);
  topTools.appendChild(aiBtn);
  topTools.appendChild(setBtn);
  topTools.appendChild(presentBtn);

  var fitBtn = toolBtn(ICON_FIT, 'Fit to screen');
  var undoBtn = toolBtn(ICON_UNDO, 'Undo');
  var redoBtn = toolBtn(ICON_REDO, 'Redo');
  var roBtn = toolBtn(ICON_EYE, 'Read only');
  [fitBtn, undoBtn, redoBtn, roBtn].forEach(function (b) { bottomTools.appendChild(b); });

  screen.appendChild(topTools);
  screen.appendChild(bottomTools);

  /* viewport + world */
  var viewport = el('div');
  viewport.style.cssText = 'position:absolute;inset:0;overflow:hidden;touch-action:none';
  var world = el('div');
  world.style.cssText = 'position:absolute;left:0;top:0;transform-origin:0 0;width:0;height:0';
  var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.style.cssText = 'position:absolute;left:0;top:0;overflow:visible;width:1px;height:1px';
  var cardsLayer = el('div');
  cardsLayer.style.cssText = 'position:absolute;left:0;top:0';
  /* groupsLayer sabse neeche : glass boxes lines + cards ke PEECHE */
  var groupsLayer = el('div');
  groupsLayer.style.cssText = 'position:absolute;left:0;top:0';
  world.appendChild(groupsLayer);
  world.appendChild(svg);
  world.appendChild(cardsLayer);
  viewport.appendChild(world);
  screen.appendChild(viewport);

  function applyT() {
    world.style.transform = 'translate(' + t.x + 'px,' + t.y + 'px) scale(' + t.s + ')';
  }
  function toWorld(cx, cy) {
    var r = viewport.getBoundingClientRect();
    return { x: (cx - r.left - t.x) / t.s, y: (cy - r.top - t.y) / t.s };
  }
  function screenPos(wx, wy) {
    var r = viewport.getBoundingClientRect();
    return { x: wx * t.s + t.x + r.left, y: wy * t.s + t.y + r.top };
  }

  /* ---------- history ---------- */
  var undoStack = [], redoStack = [], lastSnap = null;
  function snapshot() {
    return JSON.stringify({
      cards: canvas.cards,
      lines: canvas.lines,
      groups: canvas.groups || []
    });
  }
  function commit() {
    if (!canvas) return;
    undoStack.push(lastSnap);
    if (undoStack.length > 60) undoStack.shift();
    redoStack = [];
    lastSnap = snapshot();
    if (window.CanvasList) window.CanvasList.persistNow();
  }
  function applySnap(s) {
    var p = JSON.parse(s);
    canvas.cards = p.cards;
    canvas.lines = p.lines;
    canvas.groups = p.groups || [];
    if (window.CanvasCards) window.CanvasCards.render();
    if (window.CanvasLines) window.CanvasLines.render();
    if (window.CanvasGroups) window.CanvasGroups.render();
    if (window.CanvasList) window.CanvasList.persistNow();
  }
  undoBtn.addEventListener('click', function () {
    if (readOnly || !undoStack.length) return;
    redoStack.push(lastSnap);
    lastSnap = undoStack.pop();
    applySnap(lastSnap);
  });
  redoBtn.addEventListener('click', function () {
    if (readOnly || !redoStack.length) return;
    undoStack.push(lastSnap);
    lastSnap = redoStack.pop();
    applySnap(lastSnap);
  });
  function applyRO() {
    roBtn.style.background = readOnly ? 'var(--ink)' : '';
    roBtn.style.color = readOnly ? 'var(--paper)' : '';
    viewport.classList.toggle('ro', readOnly);
  }
  roBtn.addEventListener('click', function () {
    readOnly = !readOnly;
    applyRO();
  });
  fitBtn.addEventListener('click', function () {
    var vw = viewport.clientWidth || 360;
    var vh = viewport.clientHeight || 640;
    var groups = (canvas && canvas.groups) || [];
    if (!canvas || (!canvas.cards.length && !groups.length)) {
      t = { x: 60, y: 90, s: 1 };
      applyT();
      return;
    }
    var minx = 1e9, miny = 1e9, maxx = -1e9, maxy = -1e9;
    canvas.cards.forEach(function (c) {
      minx = Math.min(minx, c.x); miny = Math.min(miny, c.y);
      maxx = Math.max(maxx, c.x + c.w); maxy = Math.max(maxy, c.y + c.h);
    });
    groups.forEach(function (g) {
      minx = Math.min(minx, g.x); miny = Math.min(miny, g.y);
      maxx = Math.max(maxx, g.x + g.w); maxy = Math.max(maxy, g.y + g.h);
    });
    var bw = Math.max(80, maxx - minx), bh = Math.max(80, maxy - miny);
    var s = Math.max(0.25, Math.min(vw / bw, vh / bh, 1.4) * 0.88);
    t.s = s;
    t.x = (vw - bw * s) / 2 - minx * s;
    t.y = (vh - bh * s) / 2 - miny * s;
    applyT();
  });

  function focusCard(c) {
    var vw = viewport.clientWidth || 360;
    var vh = viewport.clientHeight || 640;
    t.x = vw / 2 - (c.x + c.w / 2) * t.s;
    t.y = vh / 2 - (c.y + c.h / 2) * t.s;
    applyT();
  }

  /* ---------- pan / pinch / wheel + double-tap create ---------- */
  var pointers = {};
  var panStart = null, panMoved = false, pinchStart = null;
  var lastTap = null;

  /* ---------- long-press → Group Box (marquee draw) ---------- */
  var LP_MS = 420;
  var lpTimer = null, lpFired = false, lpPt = null;
  var marqueeEl = null, marqueeStart = null;
  var tapSurface = false;   /* pointerdown khali jagah / group par hua tha */

  function isEditingTarget(node) {
    if (!node) return false;
    if (node.isContentEditable) return true;
    return !!(node.getAttribute && node.getAttribute('contenteditable') === 'true');
  }
  function cancelLP() {
    if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; }
  }
  function abortMarquee() {
    if (marqueeEl && marqueeEl.parentNode) marqueeEl.parentNode.removeChild(marqueeEl);
    marqueeEl = null;
    marqueeStart = null;
    lpFired = false;
  }
  function pulseRing(w) {
    var ring = el('div');
    ring.style.cssText = 'position:absolute;left:' + (w.x - 18) + 'px;top:' + (w.y - 18) + 'px;' +
      'width:36px;height:36px;border-radius:50%;border:2px solid var(--steel);' +
      'pointer-events:none;opacity:.9;transition:transform .35s ease-out,opacity .35s ease-out';
    world.appendChild(ring);
    try {
      requestAnimationFrame(function () {
        ring.style.transform = 'scale(2)';
        ring.style.opacity = '0';
      });
    } catch (err) { /* ignore */ }
    window.setTimeout(function () {
      if (ring.parentNode) ring.parentNode.removeChild(ring);
    }, 420);
  }
  function fireLP() {
    lpTimer = null;
    lpFired = true;
    panStart = null;                              /* pan cancel */
    if (window.CanvasGroups) window.CanvasGroups.cancelDrag();  /* group drag cancel */
    try { if (navigator.vibrate) navigator.vibrate(25); } catch (err) { /* ignore */ }
    pulseRing(lpPt.w);
    marqueeStart = lpPt.w;
    marqueeEl = el('div');
    marqueeEl.style.cssText = 'position:absolute;pointer-events:none;' +
      'border:2px dashed var(--steel);border-radius:14px;background:rgba(138,146,157,.08)';
    world.appendChild(marqueeEl);
    updateMarquee(lpPt.cx, lpPt.cy);
  }
  function armLP(e) {
    cancelLP();
    lpPt = { cx: e.clientX, cy: e.clientY, w: toWorld(e.clientX, e.clientY) };
    lpTimer = window.setTimeout(fireLP, LP_MS);
  }
  function updateMarquee(cx, cy) {
    if (!marqueeEl || !marqueeStart) return;
    var w = toWorld(cx, cy);
    marqueeEl.style.left = Math.min(marqueeStart.x, w.x) + 'px';
    marqueeEl.style.top = Math.min(marqueeStart.y, w.y) + 'px';
    marqueeEl.style.width = Math.abs(w.x - marqueeStart.x) + 'px';
    marqueeEl.style.height = Math.abs(w.y - marqueeStart.y) + 'px';
  }
  function finishMarquee(cx, cy) {
    var w = toWorld(cx, cy);
    var x = Math.round(Math.min(marqueeStart.x, w.x));
    var y = Math.round(Math.min(marqueeStart.y, w.y));
    var ww = Math.round(Math.abs(w.x - marqueeStart.x));
    var hh = Math.round(Math.abs(w.y - marqueeStart.y));
    abortMarquee();
    if (ww >= 40 && hh >= 40 && !readOnly && canvas) {
      if (!Array.isArray(canvas.groups)) canvas.groups = [];
      canvas.groups.push({ id: UI.uid(), x: x, y: y, w: ww, h: hh, color: '', text: '' });
      commit();
      if (window.CanvasGroups) window.CanvasGroups.render();
    }
  }

  viewport.addEventListener('pointerdown', function (e) {
    pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
    panMoved = false;
    var ids = Object.keys(pointers);
    if (ids.length === 2) {
      var p1 = pointers[ids[0]], p2 = pointers[ids[1]];
      pinchStart = {
        d: Math.hypot(p1.x - p2.x, p1.y - p2.y), s: t.s,
        mid: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 }, t: { x: t.x, y: t.y }
      };
      panStart = null;
      lastTap = null;
      tapSurface = false;
      cancelLP();
      abortMarquee();
    } else {
      var surface = (e.target === viewport || e.target === world);
      var inGroup = !!(e.target.closest && e.target.closest('[data-gid]'));
      /* anchor (data-side) par LP-marquee / double-tap-create NAHI —
         wo sirf connect-drag ke hain (card ho ya group box) */
      var onAnchor = !!(e.target.getAttribute && e.target.getAttribute('data-side'));
      tapSurface = (surface || inGroup) && !onAnchor && !readOnly && !isEditingTarget(e.target);
      if (surface) {
        panStart = { x: e.clientX, y: e.clientY, tx: t.x, ty: t.y };
      }
      if (tapSurface) armLP(e);
    }
  });
  viewport.addEventListener('pointermove', function (e) {
    if (!pointers[e.pointerId]) return;
    pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
    /* long-press se pehle hi ungli chal padi → LP cancel, normal pan/group-drag */
    if (lpTimer && !lpFired && lpPt &&
        (Math.abs(e.clientX - lpPt.cx) > 8 || Math.abs(e.clientY - lpPt.cy) > 8)) {
      cancelLP();
    }
    /* LP fire ho chuka → marquee draw mode (pan/pinch band) */
    if (lpFired) {
      if (marqueeEl) {
        updateMarquee(e.clientX, e.clientY);
        panMoved = true;
      }
      return;
    }
    var ids = Object.keys(pointers);
    if (ids.length === 2 && pinchStart) {
      var p1 = pointers[ids[0]], p2 = pointers[ids[1]];
      var d = Math.hypot(p1.x - p2.x, p1.y - p2.y);
      var ns = Math.max(0.25, Math.min(3, pinchStart.s * (d / pinchStart.d)));
      var r = viewport.getBoundingClientRect();
      var mx = pinchStart.mid.x - r.left, my = pinchStart.mid.y - r.top;
      t.x = mx - (mx - pinchStart.t.x) * (ns / pinchStart.s);
      t.y = my - (my - pinchStart.t.y) * (ns / pinchStart.s);
      t.s = ns;
      panMoved = true;
      applyT();
    } else if (panStart) {
      var dx = e.clientX - panStart.x, dy = e.clientY - panStart.y;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) panMoved = true;
      t.x = panStart.tx + dx;
      t.y = panStart.ty + dy;
      applyT();
    }
  });
  viewport.addEventListener('pointerup', function (e) {
    var wasPan = !!panStart;
    var moved = panMoved;
    var wasLP = lpFired;
    var canTap = tapSurface;
    var hadMarquee = !!marqueeEl;
    endPointer(e);
    cancelLP();
    tapSurface = false;
    /* marquee khatam → group box banao (agar size enough hai) */
    if (wasLP && hadMarquee) {
      finishMarquee(e.clientX, e.clientY);
      return;
    }
    /* double-tap khali jagah YA group box par → naya card (mobile + desktop) */
    if ((wasPan || canTap) && !moved && !wasLP && !readOnly && window.CanvasCards) {
      var now = Date.now();
      if (lastTap && now - lastTap.t < 350 &&
          Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 32) {
        lastTap = null;
        window.CanvasCards.createAt(toWorld(e.clientX, e.clientY));
      } else {
        lastTap = { t: now, x: e.clientX, y: e.clientY };
      }
    }
  });
  viewport.addEventListener('pointercancel', function (e) {
    endPointer(e);
    cancelLP();
    abortMarquee();
    tapSurface = false;
  });
  function endPointer(e) {
    delete pointers[e.pointerId];
    if (Object.keys(pointers).length < 2) pinchStart = null;
    if (Object.keys(pointers).length === 0) panStart = null;
  }
  viewport.addEventListener('wheel', function (e) {
    e.preventDefault();
    var r = viewport.getBoundingClientRect();
    var mx = e.clientX - r.left, my = e.clientY - r.top;
    var ns = Math.max(0.25, Math.min(3, t.s * (e.deltaY < 0 ? 1.12 : 0.9)));
    t.x = mx - (mx - t.x) * (ns / t.s);
    t.y = my - (my - t.y) * (ns / t.s);
    t.s = ns;
    applyT();
  }, { passive: false });

  /* ---------- shared color plate (full picker + saved colors) ---------- */
  var SAVED_KEY = 'achiva.canvas.savedColors';
  var plateModal = UI.modal({ zScrim: 94, zWrap: 95 });
  function openColorPlate(current, onApply, onDone) {
    var saved = window.AppStorage.loadAt(SAVED_KEY) || [];
    if (!Array.isArray(saved)) saved = [];
    plateModal.open('Color', function (body) {
      var inp = el('input');
      inp.type = 'color';
      inp.value = /^#[0-9a-fA-F]{6}$/.test(current || '') ? current : '#22262c';
      inp.style.cssText = 'width:100%;height:70px;border:1px solid var(--s2);border-radius:12px;' +
        'background:var(--input-bg);padding:4px;cursor:pointer';
      inp.addEventListener('input', function () { onApply(inp.value); });
      body.appendChild(inp);

      body.appendChild(UI.label('Saved colors:'));
      var srow = el('div');
      srow.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap;margin:0 0 12px;min-height:30px';
      function paintSaved() {
        srow.innerHTML = '';
        if (!saved.length) {
          srow.appendChild(el('div', 'sub-meta', 'Koi saved color nahi.'));
        }
        saved.forEach(function (col, i) {
          var wrap = el('div');
          wrap.style.cssText = 'position:relative';
          var b = el('button');
          b.type = 'button';
          b.style.cssText = 'width:32px;height:32px;border-radius:10px;background:' + col +
            ';border:1px solid var(--s2);cursor:pointer';
          b.addEventListener('click', function () { inp.value = col; onApply(col); });
          var x = el('button', null, '×');
          x.type = 'button';
          x.style.cssText = 'position:absolute;top:-7px;right:-7px;width:17px;height:17px;' +
            'border-radius:50%;background:var(--ink);color:var(--paper);border:0;' +
            'font-size:11px;line-height:1;cursor:pointer';
          x.addEventListener('click', function (ev) {
            ev.stopPropagation();
            saved.splice(i, 1);
            window.AppStorage.saveAt(SAVED_KEY, saved);
            paintSaved();
          });
          wrap.appendChild(b);
          wrap.appendChild(x);
          srow.appendChild(wrap);
        });
      }
      paintSaved();
      body.appendChild(srow);

      var saveBtn = UI.pillBtn('Save color');
      saveBtn.addEventListener('click', function () {
        if (saved.indexOf(inp.value) === -1) {
          saved.push(inp.value);
          window.AppStorage.saveAt(SAVED_KEY, saved);
          paintSaved();
        }
      });
      body.appendChild(saveBtn);
    }, function () {
      if (onDone) onDone();
      plateModal.close();
    });
  }

  /* ---------- open ---------- */
  var backFn = null;
  /* CANVAS-PRESENT: Present/Revise mode sirf topic auto mind-maps ke liye —
     id 'mindmap-…' hoti hai ya cards par mm metadata (topic.js stamp karta hai) */
  function isMindmap(c) {
    if (!c) return false;
    if (c.id && String(c.id).indexOf('mindmap-') === 0) return true;
    return (c.cards || []).some(function (k) { return !!(k && k.mm); });
  }
  function open(c, onBack) {
    canvas = c;
    backFn = onBack || null;
    readOnly = false;
    applyRO();
    /* CANVAS-PRESENT: button ko mind-map par hi dikhao */
    presentBtn.style.display = isMindmap(c) ? '' : 'none';
    if (!Array.isArray(c.groups)) c.groups = [];
    undoStack = []; redoStack = [];
    cancelLP();
    abortMarquee();
    tapSurface = false;
    lastSnap = snapshot();
    t = { x: 60, y: 90, s: 1 };
    applyT();
    lastTap = null;
    if (window.CanvasCards) window.CanvasCards.init(api, c);
    if (window.CanvasLines) window.CanvasLines.init(api, c);
    if (window.CanvasGroups) window.CanvasGroups.init(api, c);
    window.SubjectListBridge.show(screen, true);
  }

  var api = {
    screen: screen,
    viewport: viewport,
    world: world,
    svg: svg,
    cardsLayer: cardsLayer,
    groupsLayer: groupsLayer,
    getT: function () { return t; },
    toWorld: toWorld,
    screenPos: screenPos,
    applyT: applyT,
    readOnly: function () { return readOnly; },
    commit: commit,
    focusCard: focusCard,
    openColorPlate: openColorPlate,
    getCanvas: function () { return canvas; },
    markMoved: function () { panMoved = true; },
    rerenderLines: function () { if (window.CanvasLines) window.CanvasLines.render(); }
  };

  /* theme toggle → auto-color lines + glass groups turant update */
  try {
    new MutationObserver(function () {
      if (canvas && window.CanvasLines) window.CanvasLines.render();
      if (canvas && window.CanvasGroups) window.CanvasGroups.render();
    }).observe(document.documentElement, {
      attributes: true, attributeFilter: ['data-theme']
    });
  } catch (err) { /* ignore */ }

  window.CanvasEditor = { open: open, api: api };
})();
