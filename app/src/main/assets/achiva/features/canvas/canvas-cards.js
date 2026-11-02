/* ================================================================
   CANVAS / CANVAS-CARDS.JS  —  cards (nodes) ki poori duniya
   ----------------------------------------------------------------
   • Double-tap khali jagah → naya card (editor ki tap-detection)
   • Card : drag-move, resize (se/e/s handles)
   • Card par TAP → koi popup nahi : card ke just upar mini
     toolbar : [Focus] [Text] [Delete] [Color] [Tag]
       - Focus  : card screen ke beech mein aa jata hai
       - Text   : cursor card ke ANDAR blink karta hai, wahin likho
                  (contenteditable), bahar click par save
       - Delete : do-click confirm
       - Color  : poori color plate + saved colors (editor shared)
       - Tag    : universal tag symbol → popup list :
                  Daily task / Task–specific date / Task–date range
                  → card ko background mein tag (c.tag) lagta hai,
                  card par chhota chip dikhta hai (DAILY / date / range);
                  goal feature inhi tags ko future mein use karega
   • 4 side anchors → curved lines (canvas-lines.js)
   • Group boxes (virtual glass cards) par bhi wahi 4 anchors hote
     hain (canvas-groups.js) — startConnect + anchorAtWorld cards
     aur groups DONO ke liye shared hain : card↔group aur
     group↔group lines banti hain (endpoint = {cid,side}, cid
     card ka id bhi ho sakta hai aur group ka bhi)
   ================================================================ */

(function () {
  'use strict';

  if (window.__achivaCanvasCardsLoaded) return;
  window.__achivaCanvasCardsLoaded = true;

  var el = UI.el, esc = UI.esc, uid = UI.uid;

  var ICON_FOCUS = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></svg>';
  var ICON_TEXT = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7V4h16v3M9 20h6M12 4v16"/></svg>';
  var ICON_TRASH = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>';
  var ICON_COLOR = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="13.5" cy="6.5" r="1.5" fill="currentColor"/><circle cx="17.5" cy="10.5" r="1.5" fill="currentColor"/><circle cx="8.5" cy="7.5" r="1.5" fill="currentColor"/><circle cx="6.5" cy="12.5" r="1.5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.9 0 1.8-.7 1.8-1.8 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-1 .8-1.8 1.8-1.8H17c2.8 0 5-2.2 5-5 0-5-4.5-9-10-9z"/></svg>';

  var ICON_TAG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.6 13.4L11 3.8A2 2 0 0 0 9.6 3H4a1 1 0 0 0-1 1v5.6c0 .5.2 1 .6 1.4l9.6 9.6a2 2 0 0 0 2.8 0l4.6-4.6a2 2 0 0 0 0-2.8z"/><circle cx="7.5" cy="7.5" r="1.3" fill="currentColor"/></svg>';

  var E = null;
  var canvas = null;
  var editingCard = null;

  /* ================================================================
     AUTO-FIT — text ke hisaab se card ka size (45° diagonal growth)
     ----------------------------------------------------------------
     • Text box se bada ho to card X aur Y dono mein BARABAR (t) badhta
       hai → growth vector 45° diagonal hota hai, aur center anchor
       rehta hai (x/y center se adjust) — card beech se phailta hai.
     • t binary-search se nikalta hai (12 steps, ~1 measurement each):
       smallest t jisme measuredHeight(w+t) + padding <= h+t.
     • Measurement: hidden sizer div mein same text-css (13px/1.45,
       pre-wrap) — koi library nahi.
     • Caps: w<=560, h<=480; cap ke baad bhi text bache to height
       utni de dete hain jitni chahiye (width cap par).
     • Manual resize karne par card.fit='manual' → auto-fit hat jaata
       hai (user ka size respect); text edit par wapas fit hota hai.
     • Idempotent : fit ho chuka card dobara nahi badhta.
     ================================================================ */
  var FIT_PADX = 16, FIT_PADY = 16, FIT_TAGY = 12;
  var FIT_MAXW = 560, FIT_MAXH = 480, FIT_MAXT = 420;
  var sizer = null;

  function ensureSizer() {
    if (sizer) return sizer;
    sizer = el('div');
    sizer.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;left:-99999px;top:0;' +
      'width:100px;font-size:13px;line-height:1.45;white-space:pre-wrap;word-break:break-word;';
    (document.getElementById('app') || document.body).appendChild(sizer);
    return sizer;
  }

  function measureHeight(text, innerW) {
    var s = ensureSizer();
    s.style.width = Math.max(40, innerW) + 'px';
    s.textContent = text || '';
    return s.scrollHeight || 0;
  }

  function fitSize(text, w0, h0, hasTag) {
    var out = { w: w0, h: h0, changed: false };
    if (!text) return out;
    var extra = hasTag ? FIT_TAGY : 0;
    function need(w) { return measureHeight(text, w - FIT_PADX) + FIT_PADY + extra; }
    if (need(w0) <= h0) return out;
    var lo = 0, hi = FIT_MAXT, best = hi;
    for (var i = 0; i < 12; i++) {
      var mid = Math.round((lo + hi) / 2);
      var wt = Math.min(FIT_MAXW, w0 + mid);
      var ht = Math.min(FIT_MAXH, h0 + mid);
      if (need(wt) <= ht) { best = mid; hi = mid - 1; } else { lo = mid + 1; }
    }
    var w = Math.min(FIT_MAXW, w0 + best);
    var h = Math.min(FIT_MAXH, h0 + best);
    var nh = need(w);
    if (nh > h) h = Math.min(FIT_MAXH, Math.ceil(nh));
    out.w = Math.round(w);
    out.h = Math.round(h);
    out.changed = true;
    return out;
  }

  /* center-anchored diagonal growth : center (cx,cy) same rehta hai */
  function autoFitCard(c) {
    if (!c || c.fit === 'manual') return false;
    var f = fitSize(c.text, c.w, c.h, !!c.tag);
    if (!f.changed) return false;
    var cx = c.x + c.w / 2, cy = c.y + c.h / 2;
    c.w = f.w;
    c.h = f.h;
    c.x = Math.round(cx - f.w / 2);
    c.y = Math.round(cy - f.h / 2);
    return true;
  }

  /* ---------- card mini-toolbar ---------- */
  var toolbar = null;
  var toolbarCard = null;

  function buildToolbar() {
    toolbar = el('div');
    toolbar.style.cssText = 'position:absolute;z-index:20;display:none;gap:6px;padding:6px;' +
      'border-radius:14px;background:var(--tile-bg);border:1px solid var(--line);' +
      'box-shadow:0 12px 28px -14px rgba(20,23,28,.5)';
    var defs = [
      [ICON_FOCUS, 'Focus', function (c) { E.focusCard(c); hideToolbar(); }],
      [ICON_TEXT, 'Text', function (c) { startInlineText(c); }],
      [ICON_TRASH, 'Delete', null],
      [ICON_COLOR, 'Color', function (c) {
        E.openColorPlate(c.color, function (col) {
          c.color = col;
          liveRecolor(c, col);
        }, function () {
          E.commit();
          render();
        });
      }],
      [ICON_TAG, 'Tag', function (c) { hideToolbar(); openTagPopup(c); }]
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
        if (!toolbarCard) return;
        if (d[1] === 'Delete') {
          if (!b._armed) {
            b._armed = true;
            b.textContent = '✓?';
            b.innerHTML = '✕!';
            b.style.background = 'var(--ink)';
            b.style.color = 'var(--paper)';
            return;
          }
          deleteCard(toolbarCard);
          return;
        }
        d[2](toolbarCard);
      });
      toolbar.appendChild(b);
    });
    E.screen.appendChild(toolbar);
  }

  function hideToolbar() {
    if (toolbar) toolbar.style.display = 'none';
    toolbarCard = null;
  }

  function showToolbar(c) {
    if (!toolbar) buildToolbar();
    toolbarCard = c;
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
    /* TOOLBAR-FIX : toolbar E.screen ke ANDAR position:absolute hai,
       isliye coordinates screen-relative chahiye — page/viewport offset
       (r.left/r.top) ghalna galat tha (desktop stage / wide WebView mein
       toolbar card ke side mein shift ho jaata tha). */
    var sr = E.screen.getBoundingClientRect ? E.screen.getBoundingClientRect() : r;
    var ox = r.left - sr.left, oy = r.top - sr.top;
    var sx = c.x * t.s + t.x + ox;
    var sy = c.y * t.s + t.y + oy;
    var sw = c.w * t.s;
    toolbar.style.display = 'flex';
    var tbW = 208;
    var left = Math.max(8, Math.min(sx + sw / 2 - tbW / 2, (sr.width || r.width || 360) - tbW - 8));
    var top = sy - 48;
    if (top < 8) top = sy + c.h * t.s + 8;
    toolbar.style.left = left + 'px';
    toolbar.style.top = top + 'px';
  }

  function liveRecolor(c, col) {
    var node = E.cardsLayer.querySelector('[data-cid="' + c.id + '"]');
    if (node) node.style.background = col;
  }

  /* ---------- TAG popup : card ko background tag dena ---------- */
  function tagLabel(t) {
    if (!t) return '';
    if (t.type === 'daily') return 'DAILY';
    if (t.type === 'date') return UI.fmtDate(t.date);
    if (t.type === 'range') return UI.fmtDate(t.from) + ' \u2192 ' + UI.fmtDate(t.to);
    return '';
  }

  function applyTag(c, tag) {
    c.tag = tag;
    if (window.CanvasList) window.CanvasList.persistNow();
    if (E && E.commit) E.commit();
    if (E) render();
  }

  function openTagPopup(c) {
    var m = UI.modal({ zScrim: 90, zWrap: 91 });
    m.open('Task tag', function (body) {
      var info = el('div', null, 'Is card ko ek task tag do — goal mein kaam aayega.');
      info.style.cssText = 'font-size:11.5px;color:var(--slate);line-height:1.6;margin-bottom:12px';
      body.appendChild(info);

      function row(label, sub, onPick) {
        var b = el('button');
        b.type = 'button';
        b.style.cssText = 'width:100%;text-align:left;padding:11px 12px;border-radius:12px;cursor:pointer;' +
          'border:1px solid var(--s2);background:var(--chip-bg);font:inherit;margin-bottom:8px';
        var t1 = el('div', null, label);
        t1.style.cssText = 'font-size:12.5px;font-weight:700;color:var(--ink)';
        var t2 = el('div', null, sub);
        t2.style.cssText = 'font-size:10.5px;color:var(--slate);margin-top:2px';
        b.appendChild(t1); b.appendChild(t2);
        b.addEventListener('click', function () { m.close(); onPick(); });
        body.appendChild(b);
      }

      row('Daily task', 'roz lagataar chalne wala task', function () {
        applyTag(c, { type: 'daily' });
      });
      row('Task — specific date', 'ek fix date ke liye task', function () {
        window.AchivaCalendar.open('Task date', c.tag && c.tag.date, function (iso) {
          applyTag(c, { type: 'date', date: iso });
        });
      });
      row('Task — date range', 'from → to ke beech chalne wala task', function () {
        var fromISO = (c.tag && c.tag.from) || null;
        window.AchivaCalendar.open('From', fromISO, function (f) {
          window.AchivaCalendar.open('To', (c.tag && c.tag.to) || f, function (t0) {
            applyTag(c, { type: 'range', from: f, to: t0 });
          });
        });
      });
      if (c.tag) {
        var clr = el('button', 'btn-ghost', 'Remove tag');
        clr.style.width = '100%';
        clr.addEventListener('click', function () { m.close(); applyTag(c, null); });
        body.appendChild(clr);
      }
    }, null);
    var sv = m.sheet.querySelector('.sheet-actions .btn-solid');
    if (sv) sv.style.display = 'none';
  }

  function deleteCard(c) {
    canvas.cards = canvas.cards.filter(function (x) { return x !== c; });
    canvas.lines = canvas.lines.filter(function (l) {
      return l.from.cid !== c.id && l.to.cid !== c.id;
    });
    hideToolbar();
    E.commit();
    render();
    E.rerenderLines();
  }

  /* ---------- inline text (cursor card ke andar) ---------- */
  function startInlineText(c) {
    var node = E.cardsLayer.querySelector('[data-cid="' + c.id + '"]');
    if (!node) return;
    var txt = node.querySelector('div');
    editingCard = c;
    txt.contentEditable = 'true';
    txt.setAttribute('contenteditable', 'true');
    txt.style.overflow = 'auto';
    txt.style.outline = '1.5px solid var(--steel)';
    txt.style.borderRadius = '6px';
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
      txt.setAttribute('contenteditable', 'false');
      txt.style.outline = '';
      c.text = txt.innerText;
      autoFitCard(c);          /* user ka likha text bhi fit ho */
      editingCard = null;
      E.commit();
      render();
    });
  }

  /* ---------- init / render ---------- */
  function init(editor, cv) {
    E = editor;
    canvas = cv;
    editingCard = null;
    if (toolbar && toolbar.parentNode) toolbar.parentNode.removeChild(toolbar);
    toolbar = null;
    toolbarCard = null;
    render();
    /* bahar / pan / zoom par toolbar hide */
    E.viewport.addEventListener('pointerdown', function () { hideToolbar(); }, true);
  }

  function createAt(w) {
    var c = {
      id: uid(),
      x: Math.round(w.x - 80), y: Math.round(w.y - 50),
      w: 160, h: 100, color: '#ffffff', text: ''
    };
    canvas.cards.push(c);
    autoFitCard(c);
    E.commit();
    render();
  }

  function render() {
    E.cardsLayer.innerHTML = '';
    canvas.cards.forEach(function (c) {
      autoFitCard(c);          /* load/refresh par overflow fix (idempotent) */
      E.cardsLayer.appendChild(cardEl(c));
    });
  }

  function cardEl(c) {
    var d = el('div');
    d.setAttribute('data-cid', c.id);
    d.style.cssText = 'position:absolute;left:' + c.x + 'px;top:' + c.y + 'px;width:' + c.w +
      'px;height:' + c.h + 'px;background:' + (c.color || '#ffffff') + ';' +
      'border:1px solid var(--line);border-radius:12px;box-shadow:0 8px 20px -12px rgba(20,23,28,.4);' +
      'cursor:grab;touch-action:none';

    var txt = el('div', null, esc(c.text || ''));
    txt.style.cssText = 'position:absolute;inset:8px;font-size:13px;line-height:1.45;color:#22262c;' +
      'white-space:pre-wrap;word-break:break-word;overflow:hidden';
    d.appendChild(txt);

    /* tag chip (top-right) : daily / date / range */
    if (c.tag) {
      var chipT = el('div', null, esc(tagLabel(c.tag)));
      chipT.style.cssText = 'position:absolute;top:4px;right:6px;max-width:70%;overflow:hidden;' +
        'text-overflow:ellipsis;white-space:nowrap;padding:2px 8px;border-radius:99px;font-size:8.5px;' +
        'font-weight:700;letter-spacing:.05em;pointer-events:none;' +
        (c.tag.type === 'daily'
          ? 'background:rgba(31,111,235,.14);color:#1f6feb;border:1px solid rgba(31,111,235,.4)'
          : c.tag.type === 'date'
            ? 'background:rgba(160,106,0,.14);color:#a06a00;border:1px solid rgba(160,106,0,.4)'
            : 'background:rgba(46,160,67,.14);color:#2ea043;border:1px solid rgba(46,160,67,.4)');
      d.appendChild(chipT);
    }

    [['se', 'right:-6px;bottom:-6px;cursor:nwse-resize'],
     ['e', 'right:-6px;top:50%;margin-top:-6px;cursor:ew-resize'],
     ['s', 'bottom:-6px;left:50%;margin-left:-6px;cursor:ns-resize']].forEach(function (h) {
      var hd = el('div');
      hd.setAttribute('data-h', h[0]);
      hd.style.cssText = 'position:absolute;' + h[1] + ';width:12px;height:12px;border-radius:4px;' +
        'background:var(--tile-bg);border:1.5px solid var(--steel);touch-action:none';
      d.appendChild(hd);
    });

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
        startConnect(c, a[0], e);
      });
      d.appendChild(an);
    });

    d.addEventListener('pointerdown', function (e) {
      if (E.readOnly()) return;
      if (editingCard === c) return;   /* text editing chalu hai */
      var h = e.target.getAttribute && e.target.getAttribute('data-h');
      if (h) {
        e.stopPropagation();
        hideToolbar();
        startResize(c, h, e);
        return;
      }
      if (e.target.getAttribute && e.target.getAttribute('data-side')) return;
      e.stopPropagation();
      startMove(c, d, e);
    });

    return d;
  }

  /* ---------- move + tap → toolbar ---------- */
  function startMove(c, dEl, e) {
    var s0 = E.getT().s;
    var sx = e.clientX, sy = e.clientY, ox = c.x, oy = c.y;
    var moved = false;
    function mv(ev) {
      var dx = (ev.clientX - sx) / s0, dy = (ev.clientY - sy) / s0;
      if (!moved && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
      moved = true;
      c.x = Math.round(ox + dx);
      c.y = Math.round(oy + dy);
      dEl.style.left = c.x + 'px';
      dEl.style.top = c.y + 'px';
      E.rerenderLines();
    }
    function up() {
      window.removeEventListener('pointermove', mv);
      window.removeEventListener('pointerup', up);
      if (moved) E.commit();
      else showToolbar(c);
    }
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
  }

  /* ---------- resize ---------- */
  function startResize(c, h, e) {
    var s0 = E.getT().s;
    var sx = e.clientX, sy = e.clientY, ow = c.w, oh = c.h;
    function mv(ev) {
      c.fit = 'manual';        /* user ne size khud chuna → auto-fit off */
      var dx = (ev.clientX - sx) / s0, dy = (ev.clientY - sy) / s0;
      if (h === 'se' || h === 'e') c.w = Math.max(80, Math.round(ow + dx));
      if (h === 'se' || h === 's') c.h = Math.max(56, Math.round(oh + dy));
      render();
      E.rerenderLines();
    }
    function up() {
      window.removeEventListener('pointermove', mv);
      window.removeEventListener('pointerup', up);
      E.commit();
    }
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
  }

  /* ---------- connect drag ----------
     node = card YA group box (dono ka {id,x,y,w,h} same shape) —
     groups ke anchors bhi yahin se connect drag shuru karte hain */
  function startConnect(node, side, e) {
    if (E.readOnly()) return;
    var from = { cid: node.id, side: side };
    window.CanvasLines.tempStart(from, E.toWorld(e.clientX, e.clientY));
    function mv(ev) {
      window.CanvasLines.tempMove(E.toWorld(ev.clientX, ev.clientY));
    }
    function up(ev) {
      window.removeEventListener('pointermove', mv);
      window.removeEventListener('pointerup', up);
      var to = anchorAtWorld(E.toWorld(ev.clientX, ev.clientY));
      if (to && to.cid !== from.cid) {
        canvas.lines.push({
          id: uid(), from: from, to: to,
          text: '', arrow: 'end', color: ''
        });
        window.CanvasLines.tempEnd(true);
        E.commit();
        window.CanvasLines.render();
      } else {
        window.CanvasLines.tempEnd(false);
      }
    }
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
  }

  /* ---------- anchors math (card + group dono ke liye — {x,y,w,h}) ---------- */
  function anchorPoint(node, side) {
    if (side === 'n') return { x: node.x + node.w / 2, y: node.y, nx: 0, ny: -1 };
    if (side === 'e') return { x: node.x + node.w, y: node.y + node.h / 2, nx: 1, ny: 0 };
    if (side === 's') return { x: node.x + node.w / 2, y: node.y + node.h, nx: 0, ny: 1 };
    return { x: node.x, y: node.y + node.h / 2, nx: -1, ny: 0 };
  }

  /* anchor dhundho — cards PEHLE (wo groups ke upar dikhte hain),
     phir group boxes (virtual cards). Return {cid, side} — cid
     card ka id bhi ho sakta hai aur group ka bhi. */
  function anchorAtWorld(w) {
    var thr = 16 / E.getT().s;
    var sides = ['n', 'e', 's', 'w'];
    var i, j, p;
    for (i = 0; i < canvas.cards.length; i++) {
      for (j = 0; j < 4; j++) {
        p = anchorPoint(canvas.cards[i], sides[j]);
        if (Math.abs(w.x - p.x) < thr && Math.abs(w.y - p.y) < thr) {
          return { cid: canvas.cards[i].id, side: sides[j] };
        }
      }
    }
    var groups = canvas.groups || [];
    for (i = 0; i < groups.length; i++) {
      for (j = 0; j < 4; j++) {
        p = anchorPoint(groups[i], sides[j]);
        if (Math.abs(w.x - p.x) < thr && Math.abs(w.y - p.y) < thr) {
          return { cid: groups[i].id, side: sides[j] };
        }
      }
    }
    return null;
  }

  function cardById(id) {
    var c = null;
    canvas.cards.forEach(function (x) { if (x.id === id) c = x; });
    return c;
  }

  window.CanvasCards = {
    init: init,
    render: render,
    createAt: createAt,
    anchorPoint: anchorPoint,
    anchorAtWorld: anchorAtWorld,
    cardById: cardById,
    startConnect: startConnect,
    hideToolbar: hideToolbar,
    tagLabel: tagLabel,
    applyTag: applyTag,
    openTagPopup: openTagPopup,
    /* AUTO-FIT API : jahan bhi canvas cards auto-bante hain
       (AI plan, mind-map, goal boards) wahi fit logic use karein */
    fitSize: fitSize,
    autoFitCard: autoFitCard,
    showToolbar: showToolbar,
    _sizer: ensureSizer
  };
})();
