/* ================================================================
   CANVAS / TEMPLATE.JS  —  canvas layout-template system
   ----------------------------------------------------------------
   Canvas ka data model FREE-FORM graph hai (cards + lines, koi
   hierarchy store nahi). Isliye koi bhi "structured" template lagane
   ke liye pehle graph se hierarchy INFER karni padti hai :

     inferHierarchy()  →  roots + BFS spanning-tree + cross-links
                          (cycles BFS khud tod deta hai; back-edges
                          cross-link ban jaati hain)

   Har template ek alag entry hai (aage alag files mein bhi batti ja
   sakti hain) jo ye interface deti hai :

     { id, label, desc, kind:'free'|'structured', layout(canvas) }

   kind 'free'       = koi auto-layout nahi (current behaviour)
   kind 'structured' = positions engine compute karta hai

   Apply karne par sirf card.x / card.y aur line sides badalte hain —
   color / text / size untouched. Editor ka commit() use hota hai
   isliye UNDO button se wapas ho sakta hai.

   SETTINGS : canvas-editor ka gear button is file ka buildSettings()
   dikhata hai (template chooser).
   ================================================================ */

(function () {
  'use strict';

  if (window.__achivaCanvasTemplateLoaded) return;
  window.__achivaCanvasTemplateLoaded = true;

  var el = UI.el, esc = UI.esc;

  var VGAP = 26;        /* vertical gap between sibling rows */
  var GAPX = 80;        /* horizontal gap between depth columns */
  var COMP_GAP = 90;    /* gap between disconnected components */

  /* line ke liye anchor sides — topic.js ke sidePair() jaisa hi rule */
  function sidePair(a, b) {
    var ax = a.x + a.w / 2, ay = a.y + a.h / 2;
    var bx = b.x + b.w / 2, by = b.y + b.h / 2;
    var dx = bx - ax, dy = by - ay;
    if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? { a: 'e', b: 'w' } : { a: 'w', b: 'e' };
    return dy > 0 ? { a: 's', b: 'n' } : { a: 'n', b: 's' };
  }

  /* ================================================================
     HIERARCHY INFERENCE  (free-form graph → forest)
     ================================================================ */
  function inferHierarchy(canvas) {
    var cards = canvas.cards || [];
    var lines = canvas.lines || [];
    var byId = {};
    cards.forEach(function (c) { byId[c.id] = c; });

    var adj = {}, deg = {};
    cards.forEach(function (c) { adj[c.id] = []; deg[c.id] = 0; });
    lines.forEach(function (l) {
      var a = l.from && l.from.cid, b = l.to && l.to.cid;
      if (!byId[a] || !byId[b] || a === b) return;
      adj[a].push(b); adj[b].push(a);
      deg[a]++; deg[b]++;
    });

    var visited = {};
    var children = {};             /* parentId → [childId] (tree edges) */
    var parent = {};               /* childId → parentId */
    cards.forEach(function (c) { children[c.id] = []; });

    function edgeKey(a, b) { return a < b ? a + '|' + b : b + '|' + a; }
    var treeEdges = {};

    var roots = [];
    /* har component ka root = us component ka sabse zyada connected card */
    function pickRoot() {
      var best = null;
      cards.forEach(function (c) {
        if (visited[c.id]) return;
        if (!best || deg[c.id] > deg[best.id]) best = c;
      });
      return best;
    }
    var guard = 0;
    while (cards.length && guard++ < 5000) {
      var r = pickRoot();
      if (!r) break;
      roots.push(r.id);
      var q = [r.id];
      visited[r.id] = true;
      while (q.length) {
        var u = q.shift();
        (adj[u] || []).forEach(function (v) {
          if (visited[v]) return;
          visited[v] = true;
          children[u].push(v);
          parent[v] = u;
          treeEdges[edgeKey(u, v)] = true;
          q.push(v);
        });
      }
    }
    return {
      roots: roots,
      children: children,
      parent: parent,
      isTreeEdge: function (l) {
        var a = l.from && l.from.cid, b = l.to && l.to.cid;
        return !!treeEdges[edgeKey(a, b)];
      }
    };
  }

  function leaves(h, id) {
    var k = h.children[id] || [];
    if (!k.length) return 1;
    var s = 0;
    k.forEach(function (c) { s += leaves(h, c); });
    return s;
  }

  /* ================================================================
     BOTH-SIDES LAYOUT  (screenshot wala template)
     root center mein, aadhi branches left aadhi right.
     Zero line-crossings + zero card-overlap (by construction).
     ================================================================ */
  function layoutBothSides(canvas) {
    var cards = canvas.cards || [];
    if (cards.length < 2) return { moved: 0 };

    var byId = {};
    cards.forEach(function (c) { byId[c.id] = c; });
    var H = inferHierarchy(canvas);

    /* per-depth max width → column x positions */
    var depthOf = {};
    function setDepth(id, d) {
      if (depthOf[id] != null) return;      /* cycle-guard */
      depthOf[id] = d;
      (H.children[id] || []).forEach(function (c) { setDepth(c, d + 1); });
    }
    H.roots.forEach(function (rid) { setDepth(rid, 0); });

    var maxW = {};
    cards.forEach(function (c) {
      var d = depthOf[c.id];
      if (d == null) return;
      maxW[d] = Math.max(maxW[d] || 0, c.w);
    });
    var maxDepth = 0;
    cards.forEach(function (c) {
      if (depthOf[c.id] != null) maxDepth = Math.max(maxDepth, depthOf[c.id]);
    });
    /* colX depth ke hisaab se DYNAMIC (deep trees par undefined na aaye) */
    var colX = [0];
    for (var d = 1; d <= maxDepth + 2; d++) {
      colX[d] = colX[d - 1] + (maxW[d - 1] || 140) + GAPX;
    }
    function colAt(dd) {
      if (colX[dd] != null) return colX[dd];
      return colX[colX.length - 1] + (dd - (colX.length - 1)) * 220;
    }

    var pos = {};       /* id → {x, y} */

    function tidy(id, depth, cur) {
      var c = byId[id];
      var kids = H.children[id] || [];
      if (!kids.length) {
        pos[id] = { y: cur.v + c.h / 2 };
        cur.v += c.h + VGAP;
      } else {
        kids.forEach(function (k) { tidy(k, depth + 1, cur); });
        pos[id] = { y: (pos[kids[0]].y + pos[kids[kids.length - 1]].y) / 2 };
      }
      pos[id].depth = depth;
    }

    var cursor = 0;   /* component stacking */

    H.roots.forEach(function (rid) {
      var root = byId[rid];
      var kids = H.children[rid] || [];

      /* leaves ke hisaab se balance karke do halves */
      var tot = kids.reduce(function (s, k) { return s + leaves(H, k); }, 0);
      var acc = 0, split = kids.length;
      for (var i = 0; i < kids.length; i++) {
        acc += leaves(H, kids[i]);
        if (acc >= tot / 2) { split = i + 1; break; }
      }
      var sidesList = [kids.slice(0, split), kids.slice(split)];
      var sideSign = [+1, -1];

      var compIds = [rid];
      pos[rid] = { y: 0, depth: 0 };

      sidesList.forEach(function (list, si) {
        if (!list.length) return;
        var cur = { v: 0 };
        list.forEach(function (kid) { tidy(kid, 1, cur); });
        /* is side ka y-range nikaal ke 0 ke around center karo */
        var minY = Infinity, maxY = -Infinity;
        list.forEach(function collect(id) {
          (H.children[id] || []).forEach(collect);
          compIds.push(id);
          minY = Math.min(minY, pos[id].y - byId[id].h / 2);
          maxY = Math.max(maxY, pos[id].y + byId[id].h / 2);
        });
        var mid = (minY + maxY) / 2;
        list.forEach(function shift(id) {
          (H.children[id] || []).forEach(shift);
          pos[id].y -= mid;
        });
        /* x : side ke hisaab se */
        list.forEach(function setx(id) {
          (H.children[id] || []).forEach(setx);
          var dd = pos[id].depth;
          var cx0 = colAt(dd);
          pos[id].x = sideSign[si] > 0 ? cx0 : (-cx0 - byId[id].w);
        });
      });

      /* root center mein */
      pos[rid].x = -root.w / 2;
      pos[rid].y = 0;

      /* component ko vertical stack mein rakho */
      var cMin = Infinity, cMax = -Infinity;
      compIds.forEach(function (id) {
        cMin = Math.min(cMin, pos[id].y - byId[id].h / 2);
        cMax = Math.max(cMax, pos[id].y + byId[id].h / 2);
      });
      var dy = cursor - cMin;
      compIds.forEach(function (id) { pos[id].y += dy; });
      cursor += (cMax - cMin) + COMP_GAP;
    });

    /* positions apply */
    var moved = 0;
    cards.forEach(function (c) {
      var p = pos[c.id];
      if (!p) return;
      c.x = Math.round(p.x);
      c.y = Math.round(p.y - c.h / 2);
      moved++;
    });

    /* line sides : tree edges fixed (e/w), cross-links smart */
    (canvas.lines || []).forEach(function (l) {
      var a = byId[l.from && l.from.cid], b = byId[l.to && l.to.cid];
      if (!a || !b) return;
      if (H.isTreeEdge(l)) {
        var lr = (cxOf(b) > cxOf(a)) ? { a: 'e', b: 'w' } : { a: 'w', b: 'e' };
        l.from.side = lr.a; l.to.side = lr.b;
      } else {
        var sp = sidePair(a, b);
        l.from.side = sp.a; l.to.side = sp.b;
      }
    });
    function cxOf(c) { return c.x + c.w / 2; }

    return { moved: moved };
  }

  /* ================================================================
     TEMPLATE REGISTRY
     ================================================================ */
  var TEMPLATES = [];
  function register(t) { TEMPLATES.push(t); return t; }

  register({
    id: 'free',
    label: 'Free Canvas',
    desc: 'Koi auto-layout nahi — cards kahin bhi, lines kaise bhi. Ye default hai.',
    kind: 'free',
    layout: function () { return { moved: 0 }; }
  });

  register({
    id: 'bothsides',
    label: 'Both-Sides Mind Map',
    desc: 'Root beech mein, aadhi branches left aadhi right. Lines kabhi nahi kaatti, cards overlap nahi hote. Add/position engine sambhalta hai.',
    kind: 'structured',
    layout: layoutBothSides
  });

  function byIdTpl(id) {
    for (var i = 0; i < TEMPLATES.length; i++) if (TEMPLATES[i].id === id) return TEMPLATES[i];
    return null;
  }

  /* ================================================================
     APPLY
     ================================================================ */
  function apply(canvas, id) {
    var t = byIdTpl(id);
    if (!t) return { ok: false, msg: 'Template nahi mila: ' + id };
    if (!canvas || !canvas.cards || !canvas.cards.length) {
      return { ok: false, msg: 'Is canvas mein koi card nahi hai.' };
    }
    var r = t.layout(canvas);
    canvas.template = id;
    return { ok: true, moved: r.moved || 0, template: t };
  }

  /* topic-screen ke auto mind-maps ka id 'mindmap-<chapterId>' hota hai.
     Aise canvas par template chunte hi preference CHAPTER par persist karo
     (subject-store), taaki back / reopen / tab-band / app-restart ke baad bhi
     wahi layout aaye. Generic (user-made) canvases ke liye canvas.template
     field kaafi hai — wo canvas object ke saath chalta hai. */
  function rememberPreference(canvas, id) {
    try {
      if (!canvas || !canvas.id) return;
      if (canvas.id.indexOf('mindmap-') !== 0) return;
      var chId = canvas.id.slice('mindmap-'.length);
      var ST = window.ST;
      if (!ST || !ST.state || !Array.isArray(ST.state.subjects)) return;
      var found = null;
      ST.state.subjects.forEach(function (s) {
        (s.chapters || []).forEach(function (c) { if (c && c.id === chId) found = c; });
      });
      if (!found) return;
      found.mindmapTemplate = id;
      if (ST.persist) ST.persist();
    } catch (e) { /* preference save na ho paaye to koi baat nahi */ }
  }

  function applyToCurrent(id) {
    var api = window.CanvasEditor && window.CanvasEditor.api;
    if (!api) return { ok: false, msg: 'Canvas editor nahi khula.' };
    if (api.readOnly && api.readOnly()) {
      return { ok: false, msg: 'Read-only mode mein layout apply nahi hota.' };
    }
    var c = api.getCanvas();
    if (!c) return { ok: false, msg: 'Canvas nahi mila.' };
    var r = apply(c, id);
    if (!r.ok) return r;
    rememberPreference(c, id);          /* mind-map ho to chapter par yaad rakho */
    api.commit();                       /* undo-able + persist */
    if (window.CanvasCards) window.CanvasCards.render();
    if (window.CanvasLines) window.CanvasLines.render();
    if (window.CanvasGroups) window.CanvasGroups.render();
    return r;
  }

  /* ================================================================
     SETTINGS UI  (canvas-editor ke gear button ke liye)
     ================================================================ */
  function buildSettings(closeFn) {
    var wrap = el('div');

    var head = el('div', null, 'Layout template');
    head.style.cssText = 'font-size:9.5px;font-weight:700;letter-spacing:.16em;' +
      'text-transform:uppercase;color:var(--ash);margin:2px 0 8px';
    wrap.appendChild(head);

    var api = window.CanvasEditor && window.CanvasEditor.api;
    var cur = (api && api.getCanvas() && api.getCanvas().template) || 'free';

    var note = el('div');
    note.style.cssText = 'font-size:11px;line-height:1.5;color:var(--slate);margin-bottom:10px';
    note.innerHTML = 'Template chunte hi cards ki positions <b style="color:var(--ink)">auto-set</b> ho ' +
      'jayengi (color/text safe). <b style="color:var(--ink)">Undo</b> button se wapas ho sakta hai.';
    wrap.appendChild(note);

    TEMPLATES.forEach(function (t) {
      var row = el('button');
      row.type = 'button';
      var on = (t.id === cur);
      row.style.cssText = 'display:block;width:100%;text-align:left;padding:11px 12px;margin-bottom:8px;' +
        'border-radius:13px;cursor:pointer;font:inherit;border:1px solid ' +
        (on ? 'var(--ink)' : 'var(--s2)') + ';background:var(--chip-bg);' +
        (on ? 'box-shadow:inset 0 0 0 1px var(--ink);' : '');
      var nm = el('div', null, esc(t.label) + (on ? '  ✓' : ''));
      nm.style.cssText = 'font-size:13px;font-weight:700;color:var(--ink)';
      var ds = el('div', null, esc(t.desc));
      ds.style.cssText = 'font-size:10.5px;line-height:1.45;color:var(--slate);margin-top:2px';
      row.appendChild(nm); row.appendChild(ds);
      row.addEventListener('click', function () {
        var r = applyToCurrent(t.id);
        if (closeFn) closeFn();
        if (!r.ok && window.GoodList && window.GoodList.toast) window.GoodList.toast(r.msg);
      });
      wrap.appendChild(row);
    });

    return wrap;
  }

  window.CanvasTemplates = {
    register: register,
    list: function () { return TEMPLATES.slice(); },
    get: byIdTpl,
    inferHierarchy: inferHierarchy,
    apply: apply,
    applyToCurrent: applyToCurrent,
    rememberPreference: rememberPreference,
    buildSettings: buildSettings,
    layouts: { bothSides: layoutBothSides }
  };
})();
