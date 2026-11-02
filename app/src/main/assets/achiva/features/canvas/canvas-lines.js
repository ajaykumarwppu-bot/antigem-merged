/* ================================================================
   CANVAS / CANVAS-LINES.JS  —  connections (curved lines)
   ----------------------------------------------------------------
   • Cards AUR group boxes (virtual glass cards) ke 4-side anchors
     ke beech CURVED bezier lines — card↔card, card↔group aur
     group↔group teeno connect ho sakte hain (endpoint {cid,side}
     mein cid card ka id bhi ho sakta hai aur group ka bhi)
   • Node move/resize par auto-reroute
   • Line par click → koi popup nahi :
       - wahin par inline text cursor (input) — line ka text
         wahin likho jahan cursor hai
       - upar mini toolbar : [Edit(text)] [Arrow] [Color] [Delete]
           - Arrow : 4 types cycle → jis side se aayi / donon
             side / opposite side / bina arrow
           - Color : wahi poori color plate + saved colors
           - Delete : do-click confirm
       - bahar click karte hi toolbar + input gayab
   • Connect drag ke dauraan temporary dashed line
   ================================================================ */

(function () {
  'use strict';

  if (window.__achivaCanvasLinesLoaded) return;
  window.__achivaCanvasLinesLoaded = true;

  var el = UI.el;
  var NS = 'http://www.w3.org/2000/svg';
  var ARROW_MODES = ['end', 'both', 'start', 'none'];
  var ARROW_LABEL = { end: '→', both: '↔', start: '←', none: '—' };

  var ICON_TEXT = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7V4h16v3M9 20h6M12 4v16"/></svg>';
  var ICON_TRASH = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>';
  var ICON_COLOR = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="13.5" cy="6.5" r="1.5" fill="currentColor"/><circle cx="17.5" cy="10.5" r="1.5" fill="currentColor"/><circle cx="8.5" cy="7.5" r="1.5" fill="currentColor"/><circle cx="6.5" cy="12.5" r="1.5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.9 0 1.8-.7 1.8-1.8 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-1 .8-1.8 1.8-1.8H17c2.8 0 5-2.2 5-5 0-5-4.5-9-10-9z"/></svg>';

  var E = null;
  var canvas = null;
  var tempPath = null;
  var tempFrom = null;

  /* default line color theme ke hisaab se :
     light → black, dark → silverish ; explicit color ho to wahi */
  function effColor(line) {
    if (line && line.color) return line.color;
    var dark = document.documentElement.getAttribute('data-theme') === 'dark';
    return dark ? '#c9cfd7' : '#22262c';
  }

  /* line mini-UI : inline input + toolbar */
  var lineInput = null;
  var lineToolbar = null;
  var uiLine = null;

  function buildUI() {
    lineInput = el('input');
    lineInput.type = 'text';
    lineInput.placeholder = 'line text...';
    lineInput.style.cssText = 'position:absolute;z-index:21;display:none;width:150px;' +
      'padding:6px 10px;border-radius:10px;border:1px solid var(--s2);background:var(--input-bg);' +
      'font:inherit;font-size:12px;color:var(--ink);outline:none';
    lineInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { hideUI(); }
      e.stopPropagation();
    });
    lineInput.addEventListener('blur', function () {
      hideUI();
    });
    E.screen.appendChild(lineInput);

    lineToolbar = el('div');
    lineToolbar.style.cssText = 'position:absolute;z-index:21;display:none;gap:6px;padding:6px;' +
      'border-radius:14px;background:var(--tile-bg);border:1px solid var(--line);' +
      'box-shadow:0 12px 28px -14px rgba(20,23,28,.5)';
    var defs = [
      [ICON_TEXT, 'Edit text', function () { lineInput.focus(); }],
      [null, 'Arrow', function () {
        uiLine.arrow = ARROW_MODES[(ARROW_MODES.indexOf(uiLine.arrow || 'end') + 1) % ARROW_MODES.length];
        arrowBtn.innerHTML = ARROW_LABEL[uiLine.arrow];
        E.commit();
        render();
      }],
      [ICON_COLOR, 'Color', function () {
        E.openColorPlate(effColor(uiLine), function (col) {
          uiLine.color = col;
          render();
        }, function () {
          E.commit();
          render();
        });
      }],
      [ICON_TRASH, 'Delete', null]
    ];
    var arrowBtn = null;
    defs.forEach(function (d) {
      var b = el('button', null, d[0] || '');
      b.type = 'button';
      b.setAttribute('aria-label', d[1]);
      b.style.cssText = 'width:32px;height:32px;border-radius:10px;border:1px solid var(--s2);' +
        'background:var(--chip-bg);color:var(--ink2);cursor:pointer;display:flex;' +
        'align-items:center;justify-content:center;font-size:14px;font-weight:700';
      if (d[1] === 'Arrow') arrowBtn = b;
      b.addEventListener('pointerdown', function (e) { e.preventDefault(); e.stopPropagation(); });
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        if (!uiLine) return;
        if (d[1] === 'Delete') {
          if (!b._armed) {
            b._armed = true;
            b.innerHTML = '✕!';
            b.style.background = 'var(--ink)';
            b.style.color = 'var(--paper)';
            return;
          }
          canvas.lines = canvas.lines.filter(function (x) { return x !== uiLine; });
          uiLine = null;
          hideUI(true);
          E.commit();
          render();
          return;
        }
        d[2]();
      });
      lineToolbar.appendChild(b);
    });
    E.screen.appendChild(lineToolbar);
  }

  function commitText() {
    if (!uiLine) return;
    uiLine.text = lineInput.value.trim();
    uiLine = null;
    E.commit();
    render();
  }

  function hideUI(skipCommit) {
    if (!skipCommit) commitText();   /* bahar click par bhi text save */
    uiLine = null;
    if (lineInput) lineInput.style.display = 'none';
    if (lineToolbar) lineToolbar.style.display = 'none';
  }

  function showUI(line, cx, cy) {
    if (!lineToolbar) buildUI();
    uiLine = line;
    var r = E.viewport.getBoundingClientRect();
    lineInput.value = line.text || '';
    lineInput.style.display = 'block';
    lineInput.style.left = Math.max(8, Math.min(cx - 75, (r.width || 360) - 160)) + 'px';
    lineInput.style.top = Math.min(cy + 10, (r.height || 640) - 46) + 'px';
    lineToolbar.style.display = 'flex';
    lineToolbar.style.left = Math.max(8, Math.min(cx - 80, (r.width || 360) - 160)) + 'px';
    lineToolbar.style.top = Math.max(8, cy - 52) + 'px';
    var arrowBtn = [...lineToolbar.children][1];
    arrowBtn.innerHTML = ARROW_LABEL[line.arrow || 'end'];
    [...lineToolbar.children][3]._armed = false;
    var del = [...lineToolbar.children][3];
    del.innerHTML = ICON_TRASH;
    del.style.background = 'var(--chip-bg)';
    del.style.color = 'var(--ink2)';
    lineInput.focus();
  }

  /* ---------- geometry ----------
     endpoint card bhi ho sakta hai aur group box bhi — dono ka
     {x,y,w,h} same shape hai, isliye anchorPoint dono par chalta hai */
  function nodeById(id) {
    var n = null;
    canvas.cards.forEach(function (x) { if (x.id === id) n = x; });
    if (!n) (canvas.groups || []).forEach(function (x) { if (x.id === id) n = x; });
    return n;
  }

  function points(line) {
    var a = window.CanvasCards.anchorPoint(nodeById(line.from.cid), line.from.side);
    var b = window.CanvasCards.anchorPoint(nodeById(line.to.cid), line.to.side);
    return { a: a, b: b };
  }

  function curveD(a, b) {
    var dist = Math.hypot(b.x - a.x, b.y - a.y);
    var k = Math.max(28, Math.min(110, dist * 0.4));
    var c1 = { x: a.x + a.nx * k, y: a.y + a.ny * k };
    var c2 = { x: b.x + b.nx * k, y: b.y + b.ny * k };
    return {
      d: 'M ' + a.x + ' ' + a.y + ' C ' + c1.x + ' ' + c1.y + ', ' + c2.x + ' ' + c2.y + ', ' + b.x + ' ' + b.y,
      c1: c1, c2: c2
    };
  }

  function midPoint(a, c1, c2, b) {
    return {
      x: (a.x + 3 * c1.x + 3 * c2.x + b.x) / 8,
      y: (a.y + 3 * c1.y + 3 * c2.y + b.y) / 8
    };
  }

  function arrowHead(at, from, color) {
    var ang = Math.atan2(at.y - from.y, at.x - from.x);
    var s = 9;
    var p1 = { x: at.x - s * Math.cos(ang - 0.45), y: at.y - s * Math.sin(ang - 0.45) };
    var p2 = { x: at.x - s * Math.cos(ang + 0.45), y: at.y - s * Math.sin(ang + 0.45) };
    var p = document.createElementNS(NS, 'path');
    p.setAttribute('d', 'M ' + p1.x + ' ' + p1.y + ' L ' + at.x + ' ' + at.y + ' L ' + p2.x + ' ' + p2.y);
    p.setAttribute('stroke', color);
    p.setAttribute('stroke-width', '2');
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke-linecap', 'round');
    return p;
  }

  /* ---------- render ---------- */
  function render() {
    E.svg.innerHTML = '';
    canvas.lines.forEach(function (line) {
      if (!nodeById(line.from.cid) || !nodeById(line.to.cid)) return;
      var pt = points(line);
      var cv = curveD(pt.a, pt.b);
      var color = effColor(line);

      /* CANVAS-PRESENT: ek line ke saare elements (vis path + arrowheads +
         text + hit) ek <g data-lid="…"> mein — taaki Present/Revise mode poori
         line ko ek saath hide/draw kar sake. Behaviour bilkul wahi hai;
         tempPath (connect-drag) is group ke BAHAR rehta hai. */
      var g = document.createElementNS(NS, 'g');
      g.setAttribute('data-lid', line.id);

      var vis = document.createElementNS(NS, 'path');
      vis.setAttribute('d', cv.d);
      vis.setAttribute('stroke', color);
      vis.setAttribute('stroke-width', '2');
      vis.setAttribute('fill', 'none');
      vis.setAttribute('stroke-linecap', 'round');
      vis.setAttribute('data-vis', '1');
      g.appendChild(vis);

      var mode = line.arrow || 'end';
      if (mode === 'end' || mode === 'both') g.appendChild(arrowHead(pt.b, cv.c2, color));
      if (mode === 'start' || mode === 'both') g.appendChild(arrowHead(pt.a, cv.c1, color));

      if (line.text) {
        var m = midPoint(pt.a, cv.c1, cv.c2, pt.b);
        var t = document.createElementNS(NS, 'text');
        t.setAttribute('x', m.x);
        t.setAttribute('y', m.y - 6);
        t.setAttribute('text-anchor', 'middle');
        t.setAttribute('font-size', '12');
        t.setAttribute('fill', color);
        t.setAttribute('stroke', 'var(--paper)');
        t.setAttribute('stroke-width', '4');
        t.setAttribute('paint-order', 'stroke');
        t.textContent = line.text;
        g.appendChild(t);
      }

      var hit = document.createElementNS(NS, 'path');
      hit.setAttribute('d', cv.d);
      hit.setAttribute('stroke', 'transparent');
      hit.setAttribute('stroke-width', '16');
      hit.setAttribute('fill', 'none');
      hit.style.cursor = 'pointer';
      hit.addEventListener('click', function (e) {
        e.stopPropagation();
        if (E.readOnly()) return;
        var r = E.viewport.getBoundingClientRect();
        showUI(line, e.clientX - r.left, e.clientY - r.top);
      });
      g.appendChild(hit);

      E.svg.appendChild(g);
    });
  }

  /* ---------- temp connect line ---------- */
  function tempStart(from, w) {
    tempFrom = from;
    tempPath = document.createElementNS(NS, 'path');
    tempPath.setAttribute('stroke', '#8a929d');
    tempPath.setAttribute('stroke-width', '2');
    tempPath.setAttribute('stroke-dasharray', '6 5');
    tempPath.setAttribute('fill', 'none');
    E.svg.appendChild(tempPath);
    tempMove(w);
  }

  function tempMove(w) {
    if (!tempPath || !tempFrom) return;
    var a = window.CanvasCards.anchorPoint(nodeById(tempFrom.cid), tempFrom.side);
    tempPath.setAttribute('d', curveD(a, { x: w.x, y: w.y, nx: 0, ny: 0 }).d);
  }

  function tempEnd(ok) {
    if (tempPath && tempPath.parentNode) tempPath.parentNode.removeChild(tempPath);
    tempPath = null;
    tempFrom = null;
    return !!ok;
  }

  window.CanvasLines = {
    init: function (editor, cv) {
      E = editor;
      canvas = cv;
      if (lineToolbar && lineToolbar.parentNode) {
        lineToolbar.parentNode.removeChild(lineToolbar);
        lineInput.parentNode.removeChild(lineInput);
        lineToolbar = null; lineInput = null; uiLine = null;
      }
      /* bahar click par line-UI hide */
      E.viewport.addEventListener('pointerdown', function () { hideUI(); }, true);
      render();
    },
    render: render,
    tempStart: tempStart,
    tempMove: tempMove,
    tempEnd: tempEnd
  };
})();
