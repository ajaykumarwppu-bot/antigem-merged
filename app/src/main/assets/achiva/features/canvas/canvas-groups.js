/* ================================================================
   CANVAS / CANVAS-GROUPS.JS  —  Group Boxes (virtual glass boxes)
   ----------------------------------------------------------------
   • Empty canvas par LONG-PRESS (~½ sec) + drag → dashed marquee;
     release par wahin ek GLASSFORM group box banta hai
     (long-press/marquee detection canvas-editor.js mein hai)
   • Box "virtual" hai : koi membership list nahi — jis card ka
     CENTER box ke rect ke andar hai, wahi uska member hai
   • Box ko drag karo → box + andar ke saare cards ek saath move
   • Andar ka card akela drag karo → wo akele move hota hai
     (box ke andar rahe to andar, bahar le jao to alag)
   • Box par TAP → mini toolbar : [Text] [Color] [Delete]
       - Text   : box ki khali jagah mein likho (contenteditable);
                  text cards ke PEECHE empty space mein dikhta hai
       - Color  : wahi shared color plate → glass par halka tint
       - Delete : do-click confirm; sirf box jata hai, cards rehte
   • se/e/s handles → box resize (cards apni jagah rehte hain)
   • Box ke 4 side ANCHORS (n/e/s/w) — normal cards jaise hi :
     anchor se drag karke line kisi card ya doosre group box tak
     le jao → card↔group aur group↔group connection banta hai
     (connect logic shared : CanvasCards.startConnect/anchorAtWorld)
   • Group delete hone par usse judi saari lines bhi delete
   • Data : canvas.groups = [ {id,x,y,w,h,color,text} ]
     lines ke endpoints {cid,side} mein cid group ka id bhi ho
     sakta hai (canvas-lines.js dono arrays mein resolve karta hai)
   ================================================================ */

(function () {
  'use strict';

  if (window.__achivaCanvasGroupsLoaded) return;
  window.__achivaCanvasGroupsLoaded = true;

  var el = UI.el, esc = UI.esc;

  var ICON_TEXT = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7V4h16v3M9 20h6M12 4v16"/></svg>';
  var ICON_TRASH = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>';
  var ICON_COLOR = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="13.5" cy="6.5" r="1.5" fill="currentColor"/><circle cx="17.5" cy="10.5" r="1.5" fill="currentColor"/><circle cx="8.5" cy="7.5" r="1.5" fill="currentColor"/><circle cx="6.5" cy="12.5" r="1.5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.9 0 1.8-.7 1.8-1.8 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-1 .8-1.8 1.8-1.8H17c2.8 0 5-2.2 5-5 0-5-4.5-9-10-9z"/></svg>';

  var E = null;
  var canvas = null;
  var editingGroup = null;
  var toolbar = null;
  var toolbarGroup = null;
  var activeCancel = null;   /* pending drag/resize — editor LP par cancel */

  /* ---------- glass look ---------- */
  function rgba(hex, a) {
    var m = /^#?([0-9a-fA-F]{6})$/.exec(hex || '');
    var n = m ? parseInt(m[1], 16) : 0x788291;
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }
  function glassCss(g) {
    var dark = document.documentElement.getAttribute('data-theme') === 'dark';
    var base = g.color || (dark ? '#aeb9c9' : '#6a7482');
    var f1 = g.color ? 0.14 : (dark ? 0.07 : 0.055);
    var bd = g.color ? 0.5 : (dark ? 0.26 : 0.24);
    return 'background:linear-gradient(135deg,' + rgba(base, f1) + ',' + rgba(base, f1 * 0.45) + ');' +
      'backdrop-filter:blur(5px);-webkit-backdrop-filter:blur(5px);' +
      'border:1.5px solid ' + rgba(base, bd) + ';' +
      'box-shadow:0 10px 26px -18px rgba(15,18,22,.45);';
  }
  function baseCss(g) {
    return 'position:absolute;left:' + g.x + 'px;top:' + g.y + 'px;width:' + g.w +
      'px;height:' + g.h + 'px;border-radius:18px;cursor:grab;touch-action:none;' + glassCss(g);
  }

  /* jsdom mein innerText nahi hota — browser + test dono chalein */
  function readText(n) {
    return (typeof n.innerText === 'string') ? n.innerText : (n.textContent || '');
  }

  /* ---------- membership : geometric (center-inside) ---------- */
  function containedCards(g) {
    return canvas.cards.filter(function (c) {
      var cx = c.x + c.w / 2, cy = c.y + c.h / 2;
      return cx >= g.x && cx <= g.x + g.w && cy >= g.y && cy <= g.y + g.h;
    });
  }

  /* ---------- group mini-toolbar ---------- */
  function buildToolbar() {
    toolbar = el('div');
    toolbar.style.cssText = 'position:absolute;z-index:20;display:none;gap:6px;padding:6px;' +
      'border-radius:14px;background:var(--tile-bg);border:1px solid var(--line);' +
      'box-shadow:0 12px 28px -14px rgba(20,23,28,.5)';
    var defs = [
      [ICON_TEXT, 'Text', function (g) { startGroupText(g); }],
      [ICON_COLOR, 'Color', function (g) {
        E.openColorPlate(g.color || '', function (col) {
          g.color = col;
          var node = E.groupsLayer.querySelector('[data-gid="' + g.id + '"]');
          if (node) node.style.cssText = baseCss(g);
        }, function () {
          E.commit();
          render();
        });
      }],
      [ICON_TRASH, 'Delete', null]
    ];
    defs.forEach(function (d) {
      var b = el('button', null, d[0]);
      b.type = 'button';
      b.setAttribute('aria-label', d[1]);
      b.title = d[1];
      b.style.cssText = 'width:32px;height:32px;border-radius:10px;border:1px solid var(--s2);' +
        'background:var(--chip-bg);color:var(--ink2);cursor:pointer;display:flex;' +
        'align-items:center;justify-content:center;font-size:10px;font-weight:700';
      b.addEventListener('pointerdown', function (e) { e.preventDefault(); e.stopPropagation(); });
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        if (!toolbarGroup) return;
        if (d[1] === 'Delete') {
          if (!b._armed) {
            b._armed = true;
            b.innerHTML = '✕!';
            b.style.background = 'var(--ink)';
            b.style.color = 'var(--paper)';
            return;
          }
          deleteGroup(toolbarGroup);
          return;
        }
        d[2](toolbarGroup);
      });
      toolbar.appendChild(b);
    });
    E.screen.appendChild(toolbar);
  }

  function hideToolbar() {
    if (toolbar) toolbar.style.display = 'none';
    toolbarGroup = null;
  }

  function showToolbar(g) {
    if (E.readOnly()) return;
    if (!toolbar) buildToolbar();
    if (window.CanvasCards) window.CanvasCards.hideToolbar();
    toolbarGroup = g;
    [...toolbar.children].forEach(function (b) {
      b._armed = false;
      if (b.getAttribute('aria-label') === 'Delete') {
        b.innerHTML = ICON_TRASH;
        b.style.background = 'var(--chip-bg)';
        b.style.color = 'var(--ink2)';
      }
    });
    var t = E.getT();
    var r = E.viewport.getBoundingClientRect();
    var sx = g.x * t.s + t.x + r.left;
    var sy = g.y * t.s + t.y + r.top;
    var sw = g.w * t.s;
    toolbar.style.display = 'flex';
    var tbW = 122;
    var left = Math.max(8, Math.min(sx + sw / 2 - tbW / 2, (r.width || 360) - tbW - 8));
    var top = sy - 48;
    if (top < 8) top = sy + g.h * t.s + 8;
    toolbar.style.left = left + 'px';
    toolbar.style.top = top + 'px';
  }

  function deleteGroup(g) {
    canvas.groups = canvas.groups.filter(function (x) { return x !== g; });
    /* group se judi lines bhi hatao (endpoint cid = group id) */
    canvas.lines = (canvas.lines || []).filter(function (l) {
      return l.from.cid !== g.id && l.to.cid !== g.id;
    });
    hideToolbar();
    E.commit();
    render();
    E.rerenderLines();
  }

  /* ---------- inline text (box ki khali jagah mein) ---------- */
  function startGroupText(g) {
    var node = E.groupsLayer.querySelector('[data-gid="' + g.id + '"]');
    if (!node) return;
    var txt = node.querySelector('[data-gtext]');
    if (!txt) return;
    editingGroup = g;
    txt.contentEditable = 'true';
    txt.setAttribute('contenteditable', 'true');
    txt.style.pointerEvents = 'auto';
    txt.style.outline = '1.5px solid var(--steel)';
    txt.style.borderRadius = '10px';
    txt.style.cursor = 'text';
    txt.focus();
    try {
      var range = document.createRange();
      range.selectNodeContents(txt);
      range.collapse(false);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (e) { /* ignore */ }
    txt.addEventListener('blur', function once() {
      txt.removeEventListener('blur', once);
      txt.contentEditable = 'false';
      txt.removeAttribute('contenteditable');
      txt.style.pointerEvents = '';
      txt.style.outline = '';
      txt.style.cursor = '';
      g.text = readText(txt);
      editingGroup = null;
      E.commit();
      render();
    });
  }

  /* ---------- init / render ---------- */
  function init(editor, cv) {
    E = editor;
    canvas = cv;
    editingGroup = null;
    activeCancel = null;
    if (toolbar && toolbar.parentNode) toolbar.parentNode.removeChild(toolbar);
    toolbar = null;
    toolbarGroup = null;
    if (!Array.isArray(canvas.groups)) canvas.groups = [];
    /* canvas par kahin bhi touch → group toolbar hide */
    E.viewport.addEventListener('pointerdown', function () { hideToolbar(); }, true);
    render();
  }

  function render() {
    E.groupsLayer.innerHTML = '';
    (canvas.groups || []).forEach(function (g) {
      E.groupsLayer.appendChild(groupEl(g));
    });
  }

  function groupEl(g) {
    var d = el('div');
    d.setAttribute('data-gid', g.id);
    d.style.cssText = baseCss(g);

    var txt = el('div', null, esc(g.text || ''));
    txt.setAttribute('data-gtext', '1');
    txt.style.cssText = 'position:absolute;inset:12px;font-size:13px;line-height:1.5;' +
      'color:var(--ink);opacity:.9;white-space:pre-wrap;word-break:break-word;' +
      'overflow:hidden;pointer-events:none';
    d.appendChild(txt);

    [['se', 'right:-7px;bottom:-7px;cursor:nwse-resize'],
     ['e', 'right:-7px;top:50%;margin-top:-6px;cursor:ew-resize'],
     ['s', 'bottom:-7px;left:50%;margin-left:-6px;cursor:ns-resize']].forEach(function (h) {
      var hd = el('div');
      hd.setAttribute('data-h', h[0]);
      hd.style.cssText = 'position:absolute;' + h[1] + ';width:12px;height:12px;border-radius:4px;' +
        'background:var(--tile-bg);border:1.5px solid var(--steel);touch-action:none';
      d.appendChild(hd);
    });

    /* 4 side anchors — group box bhi lines se connect hota hai
       (card↔group, group↔group); connect drag cards wala shared hai */
    [['n', 'top:-6px;left:50%;margin-left:-6px'],
     ['e', 'right:-6px;top:50%;margin-top:-6px'],
     ['s', 'bottom:-6px;left:50%;margin-left:-6px'],
     ['w', 'left:-6px;top:50%;margin-top:-6px']].forEach(function (a) {
      var an = el('div');
      an.setAttribute('data-side', a[0]);
      an.style.cssText = 'position:absolute;' + a[1] + ';width:12px;height:12px;border-radius:50%;' +
        'background:var(--tile-bg);border:1.5px solid var(--steel);cursor:crosshair;touch-action:none';
      an.addEventListener('pointerdown', function (e) {
        e.stopPropagation();
        hideToolbar();
        if (window.CanvasCards) {
          window.CanvasCards.hideToolbar();
          window.CanvasCards.startConnect(g, a[0], e);
        }
      });
      d.appendChild(an);
    });

    d.addEventListener('pointerdown', function (e) {
      if (E.readOnly()) return;
      if (editingGroup === g) return;   /* text editing chalu hai */
      var h = e.target.getAttribute && e.target.getAttribute('data-h');
      if (h) {
        startResize(g, d, h, e);
        return;
      }
      startMove(g, d, e);
      /* stopPropagation NAHI — editor ko event chahiye :
         long-press detection + pinch tracking chalte rahein */
    });

    return d;
  }

  /* ---------- group move (box + andar ke cards saath) ---------- */
  function startMove(g, dEl, e) {
    var s0 = E.getT().s;
    var sx = e.clientX, sy = e.clientY, ox = g.x, oy = g.y;
    var started = false, cancelled = false;
    var cards0 = [];
    function mv(ev) {
      if (cancelled) return;
      var dx = (ev.clientX - sx) / s0, dy = (ev.clientY - sy) / s0;
      if (!started) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        started = true;
        hideToolbar();
        if (window.CanvasCards) window.CanvasCards.hideToolbar();
        E.markMoved();
        cards0 = containedCards(g).map(function (c) {
          return {
            c: c, ox: c.x, oy: c.y,
            node: E.cardsLayer.querySelector('[data-cid="' + c.id + '"]')
          };
        });
      }
      g.x = Math.round(ox + dx);
      g.y = Math.round(oy + dy);
      dEl.style.left = g.x + 'px';
      dEl.style.top = g.y + 'px';
      cards0.forEach(function (m) {
        m.c.x = Math.round(m.ox + dx);
        m.c.y = Math.round(m.oy + dy);
        if (m.node) {
          m.node.style.left = m.c.x + 'px';
          m.node.style.top = m.c.y + 'px';
        }
      });
      E.rerenderLines();
    }
    function up() {
      window.removeEventListener('pointermove', mv);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      if (activeCancel === cancel) activeCancel = null;
      if (cancelled) return;
      if (started) E.commit();
      else showToolbar(g);
    }
    function cancel() { if (!started) cancelled = true; }
    activeCancel = cancel;
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  /* ---------- group resize ---------- */
  function startResize(g, dEl, h, e) {
    var s0 = E.getT().s;
    var sx = e.clientX, sy = e.clientY, ow = g.w, oh = g.h;
    var started = false, cancelled = false;
    function mv(ev) {
      if (cancelled) return;
      var dx = (ev.clientX - sx) / s0, dy = (ev.clientY - sy) / s0;
      if (!started) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        started = true;
        hideToolbar();
        E.markMoved();
      }
      if (h === 'se' || h === 'e') g.w = Math.max(80, Math.round(ow + dx));
      if (h === 'se' || h === 's') g.h = Math.max(60, Math.round(oh + dy));
      dEl.style.width = g.w + 'px';
      dEl.style.height = g.h + 'px';
      E.rerenderLines();   /* group anchors se judi lines follow karein */
    }
    function up() {
      window.removeEventListener('pointermove', mv);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      if (activeCancel === cancel) activeCancel = null;
      if (cancelled) return;
      if (started) E.commit();
      else showToolbar(g);
    }
    function cancel() { if (!started) cancelled = true; }
    activeCancel = cancel;
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  /* editor ka long-press fire hua → pending drag/resize cancel */
  function cancelDrag() {
    if (activeCancel) activeCancel();
  }

  window.CanvasGroups = {
    init: init,
    render: render,
    cancelDrag: cancelDrag,
    hideToolbar: hideToolbar,
    containedCards: containedCards,
    deleteGroup: deleteGroup
  };
})();
