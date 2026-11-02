/* ================================================================
   FEATURES / SUBJECT TRACKER / TOPIC.JS
   ----------------------------------------------------------------
   Chapter view ke "Topic" bottom-tab ka poora content:
     • Add Topic button (upar) : popup mein ek line = ek topic,
       yaani ek saath multiple main topics add kar sakte ho
     • Parent-child tree : har topic ke andar sub-topics, unke
       andar aur sub-topics ... maximum 6 layers (recursive render,
       simple & halka code)
     • Level numbers : har card ke LEFT (khaali gutter space) mein
       main topics → 1, 2, 3... aur sub-topics → 1.1, 1.2, 2.1...
       3rd level aur gehre par sirf chhota bullet (•). Number
       absolute-positioned hai → card ki height/width/padding/margin
       par ZERO asar. Numbers render-time positional hain (kuch
       save nahi hota), add/delete par apne aap renumber ho jaate.
     • Har node (kisi bhi layer ka) ke liye:
       - + button se usi layer ke multiple sub-topics add karo
         (popup mein ek line = ek sub-topic)
       - Edit (rename) aur Delete (do-click confirm, poora subtree)
       - Tag : No Tag / Important / Very Very Important
         (default = no tag)
       - Done tick : node done karo to saare andar wale nodes
         (har depth tak) automatic done; leaf akela done hota hai;
         untick karne par node + uske descendants untick
     • Drag & drop (TOUCH-DRAG) : kisi bhi card par LONG-PRESS
       (~0.45s) karo → card "hover" (lift) ho jayega:
       - upar-neeche drag → position kahin bhi change (live gap —
         baaki cards real-time shift; list ke edge par auto-scroll)
       - RIGHT slide → ek level gehra (topic → subtopic category)
       - LEFT slide → ek level upar (subtopic → main topic; main
         topic par left slide = kuch nahi hota)
       Level SIRF horizontal slide se decide hota hai. Poora subtree
       hamesha saath chalta hai. 6-level cap strict — gehre subtree
       ka indent apne aap clamp hota hai, isliye drop kabhi invalid
       nahi hota. Node drag ke dauraan tree se detach rehta hai →
       apne hi andar drop karna impossible. Data format wahi purana
       nested children hai (kuch migrate nahi karna pada).
     • LIVE NUMBER ON GHOST : hover hote hi card ka level-number bhi
       ghost ke saath udta hai aur drop-target ke hisaab se LIVE
       badalta hai — 13 ke upar le jao to "13", card 13 (jiske 3
       sub hain) ke neeche right-slide karo to "13.4", bina sub
       wale 14 ke neeche "14.1", 3rd level+ par "•". Drag ke dauraan
       baaki cards ke numbers FIXED rehte hain; drop hote hi poori
       list apne aap renumber ho jati hai (numbers positional hain).
     • PHONE-FIX : Android par long-press ke baad ghost finger ke
       saath move nahi karta tha (finger utha kar dobara touch karna
       padta tha). Wajah — touchstart ka target row re-render mein
       DOM se detach ho jata tha, aur Android browser aage ke
       touchmove/touchend usi detached node par bhejta hai (document
       tak pahunchte hi nahi). Ab pressed row drag khatam hone tak ek
       invisible holder mein connected rehta hai + long-press ke
       waqt ke chhote jitter preventDefault hote hain (compositor
       scroll gesture "steal" na kar le). Laptop/mouse path untouched.
   Data chapter.topics mein save hota hai aur core/storage.js
   (window.AppStorage) ke through persist hota hai.
   List.js ke bottom tab se hook : window.Topic.renderChapterView.
   ================================================================ */

(function () {
  'use strict';

  if (window.__achivaTopicLoaded) return;
  window.__achivaTopicLoaded = true;

  var MAX_DEPTH = 6;   /* topic → sub-topic ki maximum layers */

  var hooks = null;
  var chapter = null;
  var container = null;

  /* ================================================================
     HELPERS
  ================================================================ */
  /* core/ui.js ke saanjhe tools (naam wahi → baaki code untouched) */
  var el = UI.el, esc = UI.esc, uid = UI.uid;

  function ensure(ch) {
    if (!Array.isArray(ch.topics)) ch.topics = [];
  }

  function ensureNode(n) {
    if (!Array.isArray(n.children)) n.children = [];
    if (n.tag == null) n.tag = '';
    n.done = !!n.done;
    /* NOTES (notes.js) : optional fields — purane nodes safe */
    if (n.notes == null) n.notes = '';
    if (n.notesTitle == null) n.notesTitle = '';
  }

  /* recursive walk : har node par fn(node, depth) */
  function walk(nodes, fn, depth) {
    nodes.forEach(function (n) {
      ensureNode(n);
      fn(n, depth);
      walk(n.children, fn, depth + 1);
    });
  }

  /* done / untick : node + poora subtree */
  function setDone(n, v) {
    n.done = v;
    n.children.forEach(function (c) { setDone(c, v); });
  }

  function removeNode(nodes, id) {
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].id === id) { nodes.splice(i, 1); return true; }
      if (removeNode(nodes[i].children || [], id)) return true;
    }
    return false;
  }

  function findNode(nodes, id) {
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].id === id) return nodes[i];
      var f = findNode(nodes[i].children || [], id);
      if (f) return f;
    }
    return null;
  }

  function commit() {
    if (hooks && hooks.persist) hooks.persist();
  }

  var TAG_LABEL = { imp: 'IMP', vvi: 'VVI' };

  /* inline SVG icons */
  var ICON_PLUS = UI.icons.plus;
  var ICON_KEBAB = UI.icons.kebab;
  var ICON_EDIT = UI.icons.edit;
  var ICON_TRASH = UI.icons.trash;
  var ICON_FLAG = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 22V4c4-2 8 2 12 0v10c-4 2-8-2-12 0"/></svg>';
  var ICON_CHECK = UI.icons.check;
  var ICON_MM = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><circle cx="4" cy="6" r="2"/><circle cx="20" cy="6" r="2"/><circle cx="4" cy="18" r="2"/><circle cx="20" cy="18" r="2"/><path d="M9.5 10.5L6 7.5M14.5 10.5l3.5-3M9.5 13.5L6 16.5M14.5 13.5l3.5 3"/></svg>';
  /* NOTES indicator (notes.js) : chhota file-text icon — kebab ke just
     neeche absolute dikhta hai (card size par zero asar) jab node ke
     andar notes/title likha ho */
  var ICON_NOTE = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h5"/></svg>';

  function hasNotes(n) {
    return !!((n.notes && String(n.notes).trim()) ||
              (n.notesTitle && String(n.notesTitle).trim()));
  }

  /* Topic tree ki FLAT DFS order — bilkul wahi jo screen par dikhti hai
     (drawRows: node → uske children → agla sibling). Notes ke Prev/Next
     ke liye. Har call par FRESH banti hai — add/delete/reorder/drag ke
     baad order apne aap sahi rehta hai. */
  function flatOrder() {
    var out = [];
    (function walk(nodes) {
      (nodes || []).forEach(function (x) {
        ensureNode(x);
        out.push(x);
        walk(x.children);
      });
    })(chapter ? chapter.topics : []);
    return out;
  }

  /* fromNode se delta (+1 = Next, -1 = Prev) door ka node — list ke end
     par WRAP: last par Next → first, first par Prev → last. */
  function navigateNode(fromNode, delta) {
    var list = flatOrder();
    if (!list.length || !fromNode) return null;
    var i = -1;
    for (var k = 0; k < list.length; k++) {
      if (list[k].id === fromNode.id) { i = k; break; }
    }
    if (i === -1) return null;               /* node delete ho chuka */
    return list[(i + delta + list.length) % list.length];
  }

  /* NOTES screen kholo (notes.js) — card ke middle click se.
     persist = commit (poora state save), onSaved = rerender
     (indicator turant refresh), navigate = Prev/Next ke liye. */
  function openNotes(n) {
    try {
      if (window.Notes && window.Notes.open) {
        window.Notes.open(n, {
          persist: commit,
          onSaved: rerender,
          navigate: navigateNode
        });
      }
    } catch (e) { }
  }

  var app = document.getElementById('app');

  /* ================================================================
     POPOVERS : kebab (Edit/Delete) + tag (3 options)
  ================================================================ */
  var closePops = UI.closePops, togglePop = UI.togglePop;

  function basePop() {
    var pop = el('div', 'pop');
    pop.style.top = '38px';
    pop.style.right = '6px';
    pop.addEventListener('click', function (e) { e.stopPropagation(); });
    return pop;
  }

  function popButton(cls, html) {
    var b = el('button', cls, html);
    b.type = 'button';
    return b;
  }

  function makeKebabPop(onEdit, onDelete) {
    return UI.makeKebabPop(onEdit, onDelete);
  }

  function makeTagPop(node) {
    var pop = basePop();
    [
      ['', 'No Tag'],
      ['imp', 'Important'],
      ['vvi', 'Very Very Important']
    ].forEach(function (opt) {
      var b = popButton(null, '<span>' + opt[1] + '</span>');
      if (node.tag === opt[0]) b.style.background = 'var(--mist)';
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        node.tag = opt[0];
        closePops();
        commit();
        rerender();
      });
      pop.appendChild(b);
    });
    return pop;
  }


  /* ================================================================
     MODAL (mid-screen) : multi-line add + single-line edit
  ================================================================ */
  var topicModal = UI.modal({ zScrim: 86, zWrap: 87 });
  var sheetBody = null;

  function openModal(title, build, saveFn) {
    topicModal.open(title, function (b) { sheetBody = b; build(b); }, saveFn);
  }

  function closeModal() { topicModal.close(); }

  var FIELD_CSS = UI.fieldCss;

  /* ek saath multiple topics/sub-topics : ek line = ek entry */
  function openAddModal(targetArray, title) {
    openModal(title, function (body) {
      var lab = el('label', null, 'Ek line mein ek topic:');
      var ta = el('textarea');
      ta.rows = 4;
      ta.placeholder = 'Topic 1\nTopic 2\nTopic 3';
      ta.style.cssText = FIELD_CSS + ';resize:vertical;line-height:1.6';
      body.appendChild(lab);
      body.appendChild(ta);
      body._get = function () {
        return ta.value.split('\n').map(function (s) { return s.trim(); })
          .filter(function (s) { return s; });
      };
      window.setTimeout(function () { if (topicModal.isOpen()) ta.focus(); }, 260);
    }, function () {
      var lines = sheetBody._get();
      if (!lines.length) return;
      lines.forEach(function (name) {
        targetArray.push({ id: uid(), name: name, done: false, tag: '', children: [] });
      });
      closeModal();
      commit();
      rerender();
    });
  }

  function openEditModal(node) {
    openModal('Edit Topic', function (body) {
      var lab = el('label', null, 'Topic name');
      var inp = el('input');
      inp.type = 'text';
      inp.autocomplete = 'off';
      inp.value = node.name;
      inp.style.cssText = FIELD_CSS;
      body.appendChild(lab);
      body.appendChild(inp);
      body._get = function () { return inp.value.trim(); };
      window.setTimeout(function () {
        if (topicModal.isOpen()) { inp.focus(); inp.select(); }
      }, 260);
    }, function () {
      var name = sheetBody._get();
      if (!name) return;
      node.name = name;
      closeModal();
      commit();
      rerender();
    });
  }

  /* ================================================================
     NODE ROW (recursive)
  ================================================================ */
  var roundCheck = UI.roundCheck;

  var smallBtn = UI.miniBtn;

  function nodeRow(n, depth, marker) {
    var row = el('div');
    row.style.cssText = 'position:relative;display:flex;align-items:flex-start;gap:9px;' +
      'padding:10px 10px 10px 12px;border:1px solid var(--line);border-radius:12px;' +
      'background:var(--chap-bg);margin:0 18px 8px ' + (18 + (depth - 1) * 14) + 'px';
    /* drag & drop ke liye pehchaan (geometry par ZERO asar) */
    row.setAttribute('data-tid', n.id);
    row.setAttribute('data-depth', String(depth));

    /* done tick : node + poora subtree */
    var tick = roundCheck(n.done);
    tick.addEventListener('click', function () {
      setDone(n, !n.done);
      commit();
      rerender();
    });
    row.appendChild(tick);

    /* name + tag chip — MIDDLE ZONE : yahan click = Notes screen khulti
       hai (cursor:pointer affordance ke liye) */
    var main = el('div');
    main.style.cssText = 'flex:1;min-width:0;display:flex;align-items:flex-start;gap:7px;flex-wrap:wrap;cursor:pointer';
    var name = el('div', null, esc(n.name));
    name.style.cssText = 'font-size:13.5px;line-height:1.5;color:var(--ink2);' +
      'white-space:pre-wrap;word-break:break-word;' +
      (n.done ? 'text-decoration:line-through;color:var(--ash)' : '');
    main.appendChild(name);
    if (n.tag) {
      var chip = el('span', 'chip-st', TAG_LABEL[n.tag]);
      if (n.tag === 'vvi') {
        chip.style.background = 'var(--ink)';
        chip.style.color = 'var(--paper)';
        chip.style.borderColor = 'var(--line-strong)';
      }
      main.appendChild(chip);
    }
    row.appendChild(main);

    /* right controls : + sub-topic, tag flag, kebab */
    var ctr = el('div');
    ctr.style.cssText = 'display:flex;align-items:center;gap:2px;flex:none';

    if (depth < MAX_DEPTH) {
      var addSub = smallBtn(ICON_PLUS, 'Add sub-topic');
      addSub.addEventListener('click', function (e) {
        e.stopPropagation();
        openAddModal(n.children, 'Add Sub-Topic');
      });
      ctr.appendChild(addSub);
    }

    var flag = smallBtn(ICON_FLAG, 'Tag topic');
    if (n.tag) flag.style.color = 'var(--ink)';
    var tagPop = makeTagPop(n);
    flag.addEventListener('click', function (e) {
      e.stopPropagation();
      togglePop(tagPop);
    });
    ctr.appendChild(flag);

    var kebabBtn = smallBtn(ICON_KEBAB, 'Edit or delete topic');
    var kebabPop = makeKebabPop(
      function () { openEditModal(n); },
      function () {
        removeNode(chapter.topics, n.id);
        commit();
        rerender();
      }
    );
    kebabBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      togglePop(kebabPop);
    });
    ctr.appendChild(kebabBtn);

    row.appendChild(ctr);
    row.appendChild(tagPop);
    row.appendChild(kebabPop);

    /* level number (1 / 1.1) ya bullet (3rd level+) : card ke LEFT
       gutter (khaali side space) mein absolute — card ki geometry
       (height/width/padding/margin/gap) par ZERO asar, koi reflow
       nahi. right:calc(100% + 5px) → number card se ~4px bahar,
       right-aligned; top:12px + line-height:22px → tick circle ke
       center se aligned. pointer-events:none → taps block nahi. */
    var mark = depth >= 3 ? '•' : (marker || '');
    if (mark) {
      var num = el('div', null, mark);
      num.setAttribute('aria-hidden', 'true');
      num.setAttribute('data-num', '1');   /* drag-ghost ka live number hook */
      num.style.cssText = 'position:absolute;right:calc(100% + 5px);top:12px;height:22px;' +
        'line-height:22px;white-space:nowrap;pointer-events:none;color:var(--ash);' +
        (depth >= 3
          ? 'font-size:9px'
          : 'font-size:10px;font-weight:600;font-variant-numeric:tabular-nums');
      row.appendChild(num);
    }

    /* NOTES indicator : 3-dot (kebab) ke JUST NEECHE — absolute, isliye
       card ki height/width/geometry par ZERO asar (level-number jaisa
       hi pattern). Kebab hamesha rightmost button hota hai (row ka
       right padding 10px + button 26px → center right:23px, bottom
       ~36px), isliye icon right:18px/top:36px par hamesha uske neeche
       hi aata hai — chahe name kitna bhi lamba ho.
       pointer-events:none → click row par hi jaata hai (notes khulti hai). */
    if (hasNotes(n)) {
      var noteIco = el('span', null, ICON_NOTE);
      noteIco.title = 'Notes';
      noteIco.setAttribute('aria-hidden', 'true');
      noteIco.style.cssText = 'position:absolute;right:18px;top:36px;width:10px;height:10px;' +
        'display:flex;align-items:center;justify-content:center;color:var(--ash);' +
        'pointer-events:none';
      row.appendChild(noteIco);
    }

    /* DRAG handle : long-press → lift & reorder (touch + mouse).
       Buttons (tick/+/flag/kebab) par long-press drag start NAHI
       hota — unka tap behaviour bilkul pehle jaisa rehta hai. */
    row.addEventListener('touchstart', function (e) {
      if (dnd || !e.touches || e.touches.length !== 1) return;
      if (onBtn(e.target)) return;
      var t = e.touches[0];
      scheduleLP(n, depth, row, t.clientX, t.clientY, true);
    }, { passive: true });
    row.addEventListener('mousedown', function (e) {
      if (dnd || e.button !== 0) return;
      if (onBtn(e.target)) return;
      scheduleLP(n, depth, row, e.clientX, e.clientY, false);
    });

    /* OPEN NOTES : card ke MIDDLE (name area / row body) par click →
       notes.js screen. Tick / + / flag / kebab BUTTONS par click se
       NAHI khulti (onBtn guard) — user tick karte waqt galti se
       andar na chala jaye. Drag ke turant baad ka accidental click
       bhi swallow hota hai (suppressClickUntil — container ka capture
       guard bhi hai, ye double safety). Popover ke andar ki click
       already stopPropagation hoti hai (UI.makeKebabPop / basePop),
       phir bhi .pop ancestor check extra safety hai. */
    row.addEventListener('click', function (e) {
      if (dnd || Date.now() < suppressClickUntil) return;
      if (onBtn(e.target)) return;
      var t = e.target;
      while (t && t !== row) {
        if (t.classList && t.classList.contains('pop')) return;
        t = t.parentNode;
      }
      openNotes(n);
    });
    return row;
  }

  /* ================================================================
     DRAG & DROP (TOUCH-DRAG) : long-press → lift → reorder + level
     ----------------------------------------------------------------
     • LONG-PRESS (450ms) par card "hover" hota hai : ek ghost clone
       finger/mouse follow karta hai aur asli card ki jagah dashed
       placeholder (gap) dikhta hai.
     • Upar-neeche drag → insertion gap live shift hota hai (baaki
       cards FLIP animation se real-time hilte hain); list ke top/
       bottom edge par AUTO-SCROLL chalta hai.
     • RIGHT slide → +1 level (subtopic), LEFT slide → -1 level
       (main topic par left = kuch nahi). Level SIRF horizontal
       slide se decide hota hai — card par drop karne se apne aap
       nesting NAHI hoti.
     • Ghost ka LEVEL NUMBER saath chalta hai aur drop-target ke
       hisaab se LIVE update hota hai (previewLabel) : "13" /
       "13.4" / "•" — yaani drop ke baad jo number render hoga wahi
       drag ke waqt dikhta hai. Baaki rows ke numbers drag ke dauraan
       change NAHI hote (drop par poori list renumber).
     • Poora subtree hamesha saath chalta hai. Node drag ke dauraan
       tree se DETACHED rehta hai → apne hi descendant ke andar drop
       karna structurally impossible.
     • 6-level cap STRICT : subtree ki gehraai ke hisaab se target
       depth clamp hota hai, isliye drop kabhi invalid hota hi nahi
       (card kabhi 6 se gehra nahi ja sakta).
     • Drop = tree mein splice + commit (persist) + re-render →
       level numbers apne aap renumber (render-time positional).
       Cancel (touchcancel / screen switch) = origin par wapas,
       bina persist.
     • Drop ke baad ~400ms click-guard : accidental tap swallow.
     • PHONE-FIX : pressed row (touchstart target) drag ke dauraan ek
       invisible holder mein CONNECTED rehta hai, warna Android aage
       ke touchmove/touchend detached node par bhej kar ghost ko
       freeze kar deta tha. Long-press pending ke chhote jitter bhi
       preventDefault hote hain (compositor gesture steal na kare).
     • Test seam : window.__TOPIC_DND_TEST (pure helpers + program-
       matic drag) — jsdom mein layout zero hota hai isliye real
       touch ki jagah seam se drive karte hain.
  ================================================================ */
  var LP_MS = 450;      /* long-press time */
  var SLOP = 12;        /* itna hilne par long-press cancel (scroll) —
                           real device par finger jitter 10px aaram se
                           cross kar deta tha, isliye 12 */
  var STEP_X = 40;      /* itne px horizontal slide = 1 level */
  var EDGE = 48;        /* auto-scroll edge zone (px) */
  var EDGE_SPD = 9;     /* auto-scroll px per frame */

  var dnd = null;              /* active drag state (null = drag nahi) */
  var suppressClickUntil = 0;  /* is time tak clicks swallow */
  var lpTimer = 0, lpRowEl = null, lpPending = null;

  /* press/drag ke dauraan text-selection + iOS callout band */
  (function () {
    var s = document.createElement('style');
    s.textContent = '.tp-nosel,.tp-nosel *{-webkit-user-select:none!important;' +
      'user-select:none!important;-webkit-touch-callout:none!important}';
    (document.head || document.documentElement).appendChild(s);
  })();

  /* subtree ki max relative gehraai (node khud = 1) */
  function subMaxDepth(n) {
    var m = 1;
    (n.children || []).forEach(function (c) {
      var k = subMaxDepth(c) + 1;
      if (k > m) m = k;
    });
    return m;
  }

  /* node ka current location : {arr, idx} (arr = parent ka children) */
  function findLoc(nodes, id) {
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].id === id) return { arr: nodes, idx: i };
      var r = findLoc(nodes[i].children || [], id);
      if (r) return r;
    }
    return null;
  }

  /* DOM mein dikhti rows (DFS order) : [{el,tid,depth,top,bottom,mid}] */
  function rowInfos() {
    var out = [];
    if (!container) return out;
    var els = container.querySelectorAll('[data-tid]');
    for (var i = 0; i < els.length; i++) {
      var r = els[i].getBoundingClientRect();
      out.push({
        el: els[i],
        tid: els[i].getAttribute('data-tid'),
        depth: parseInt(els[i].getAttribute('data-depth'), 10) || 1,
        top: r.top, bottom: r.bottom, mid: r.top + r.height / 2
      });
    }
    return out;
  }

  /* pointer Y → insertion gap index (0..rows.length) : row ke MIDPOINT
     se upar = uske pehle, neeche = uske baad */
  function computeGap(infos, y) {
    for (var i = 0; i < infos.length; i++) {
      if (y < infos[i].mid) return i;
    }
    return infos.length;
  }

  /* desired depth → legal depth :
     - gap 0 par sirf 1 (koi parent row upar hai hi nahi)
     - warna prevRow.depth + 1 tak (uske child ban sakte ho)
     - aur 6-level cap : depth + subMax - 1 <= MAX_DEPTH */
  function clampDepth(infos, gap, want, subMax) {
    var pd = (gap > 0 && gap <= infos.length) ? infos[gap - 1].depth : 0;
    var maxD = gap > 0 ? pd + 1 : 1;
    var capD = MAX_DEPTH - subMax + 1;
    if (maxD > capD) maxD = capD;
    if (maxD < 1) maxD = 1;
    var d = want < 1 ? 1 : want;
    return d > maxD ? maxD : d;
  }

  function countBefore(infos, gap, depth) {
    var c = 0;
    var g = Math.min(gap, infos.length);
    for (var i = 0; i < g; i++) if (infos[i].depth === depth) c++;
    return c;
  }

  /* LIVE PREVIEW NUMBER : (gap, depth) → wo number jo drop ke BAAD is
     card par render hoga — bilkul wahi rule jo drawRows use karta hai.
       depth 1 → "13"      (gap se pehle kitne depth-1 rows hain + 1)
       depth 2 → "13.4"    (parent = gap se peeche nearest depth-1 row;
                            4 = us parent ke neeche gap se pehle dikhne
                            wale depth-2 rows + 1)
       depth 3+ → "•"      (render mein bhi 3rd level par bullet hi hota hai)
     Drag ke dauraan baaki rows ke numbers FIXED rehte hain (user ka rule:
     sirf uthaya gaya card apna naya number dikhata hai); drop hote hi poori
     list positional renumber ho jaati hai. */
  function previewLabel(infos, gap, depth) {
    var g = gap < 0 ? 0 : Math.min(gap, infos.length);
    if (depth <= 1) return String(countBefore(infos, g, 1) + 1);
    if (depth === 2) {
      var p = -1;
      for (var i = g - 1; i >= 0; i--) {
        if (infos[i].depth === 1) { p = i; break; }
      }
      if (p < 0) return String(countBefore(infos, g, 1) + 1);
      var sub = 0;
      for (var j = p + 1; j < g; j++) if (infos[j].depth === 2) sub++;
      return countBefore(infos, p + 1, 1) + '.' + (sub + 1);
    }
    return '•';
  }

  /* (gap, depth) → {parentTid|null, index} : parent = gap se peeche
     nearest row jo depth-1 par ho; index = us parent ke utne children
     jo gap se pehle dikhte hain (DFS guarantee se wahi aage bhi count
     hote). depth 1 → root. */
  function resolveInsert(infos, gap, depth) {
    var g = Math.min(gap, infos.length);
    if (depth <= 1) return { parentTid: null, index: countBefore(infos, g, 1) };
    var p = -1;
    for (var i = g - 1; i >= 0; i--) {
      if (infos[i].depth === depth - 1) { p = i; break; }
    }
    if (p < 0) return { parentTid: null, index: countBefore(infos, g, 1) };
    var idx = 0;
    for (var j = p + 1; j < g; j++) if (infos[j].depth === depth) idx++;
    return { parentTid: infos[p].tid, index: idx };
  }

  /* FLIP : rows ki purani positions yaad karo → DOM change → ulta
     transform lagao → transition se nahi jagah slide karo. (jsdom
     mein rects zero hote hain → deltas 0 → animation no-op, safe.) */
  function flip(mutate) {
    var els = container ? container.querySelectorAll('[data-tid]') : [];
    var before = [];
    for (var i = 0; i < els.length; i++) before.push(els[i].getBoundingClientRect().top);
    mutate();
    for (var k = 0; k < els.length; k++) {
      var dy = before[k] - els[k].getBoundingClientRect().top;
      if (dy) {
        els[k].style.transition = 'none';
        els[k].style.transform = 'translateY(' + dy + 'px)';
      }
    }
    void (container && container.offsetHeight);   /* reflow */
    for (var m = 0; m < els.length; m++) {
      if (els[m].style.transform) {
        els[m].style.transition = 'transform .18s ease';
        els[m].style.transform = '';
      }
    }
  }

  function onBtn(t) {
    while (t && t !== document.body) {
      if (t.tagName === 'BUTTON') return true;
      t = t.parentNode;
    }
    return false;
  }

  /* ---------- long-press scheduling ---------- */
  function scheduleLP(node, depth, rowEl, x, y, touch) {
    cancelLP();
    lpRowEl = rowEl;
    if (rowEl.classList) rowEl.classList.add('tp-nosel');
    lpPending = { node: node, depth: depth, rowEl: rowEl, x: x, y: y, touch: touch };
    lpTimer = window.setTimeout(function () {
      lpTimer = 0;
      var p = lpPending;
      cancelLP();
      if (p && p.rowEl && p.rowEl.parentNode) {
        beginDrag(p.node, p.depth, p.rowEl, p.x, p.y, p.touch);
      }
    }, LP_MS);
  }

  function cancelLP() {
    if (lpTimer) { window.clearTimeout(lpTimer); lpTimer = 0; }
    if (lpRowEl && lpRowEl.classList) lpRowEl.classList.remove('tp-nosel');
    lpRowEl = null;
    lpPending = null;
  }

  /* ---------- drag lifecycle ---------- */
  function beginDrag(node, depth, rowEl, x, y, touch) {
    if (dnd || !chapter || !container) return;
    var loc = findLoc(chapter.topics, node.id);
    if (!loc) return;
    closePops();
    var rect = rowEl.getBoundingClientRect();

    /* ghost : row ka clone — sirf pops hatate hain. Level number
       (1 / 13.4 / •) ghost ke SAATH chalta hai aur drop-target ke
       hisaab se LIVE badalta hai. */
    var ghost = rowEl.cloneNode(true);
    var pops = ghost.querySelectorAll('.pop');
    for (var i = 0; i < pops.length; i++) {
      if (pops[i].parentNode) pops[i].parentNode.removeChild(pops[i]);
    }
    var ghostNum = ghost.querySelector('[data-num]');
    ghost.removeAttribute('data-tid');
    ghost.style.position = 'fixed';
    ghost.style.left = rect.left + 'px';
    ghost.style.top = rect.top + 'px';
    ghost.style.width = rect.width + 'px';
    ghost.style.margin = '0';
    ghost.style.zIndex = '120';
    ghost.style.pointerEvents = 'none';
    ghost.style.opacity = '.97';
    ghost.style.boxShadow = '0 14px 30px rgba(15,23,42,.30)';
    ghost.style.borderColor = 'var(--line-strong)';
    ghost.style.willChange = 'transform';
    document.body.appendChild(ghost);

    /* ============================================================
       PHONE-FIX (Android Chrome / WebView) — "ghost wahin atak jata
       hai, finger utha kar dobara touch karna padta hai"
       ------------------------------------------------------------
       Touch events ka target WO element hota hai jis par touchstart
       hua tha, aur browser use touch sequence ke dauraan BADALTA
       NAHI. Hum drag shuru hote hi rerender() karte hain, jisme
       pressed row DOM se detach ho jati thi → Android aage ke
       touchmove / touchend usi DETACHED node par bhejta raha, wo
       document tak pahunchte hi nahi the → hamare listeners ko kuch
       mila hi nahi → ghost freeze. (Laptop par mouse events har baar
       hit-test hote hain, isliye wahan sab sahi chalta tha —
       Chromium issue 41161160 yahi behaviour document karta hai.)
       Fix : pressed row ko drag khatam hone tak ek hidden holder
       mein CONNECTED rakho, taaki touchmove/touchend bubble ho kar
       document tak pahunchte rahen. Holder invisible + zero-size +
       pointer-events:none → layout/UX par ZERO asar, aur container
       ke bahar hone se rowInfos() (container-scoped) ise ignore
       karta hai.
       ============================================================ */
    var holder = el('div');
    holder.setAttribute('aria-hidden', 'true');
    holder.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;' +
      'overflow:hidden;visibility:hidden;opacity:0;pointer-events:none';
    if (rowEl.parentNode) rowEl.parentNode.removeChild(rowEl);
    holder.appendChild(rowEl);
    document.body.appendChild(holder);

    /* node ko tree se detach karo — drag ke dauraan list bina uske
       render hoti hai (apne-descendant par drop impossible) */
    removeNode(chapter.topics, node.id);
    dnd = {
      node: node, id: node.id, startDepth: depth, subMax: subMaxDepth(node),
      origin: loc, ghost: ghost, ph: null, raf: 0,
      numEl: ghostNum, holder: holder, srcRow: rowEl,
      startX: x, startY: y, px: x, py: y, touch: !!touch,
      gap: -1, depth: -1
    };
    rerender();

    /* placeholder (live gap) : dashed box, target level ke indent par */
    var ph = el('div');
    ph.style.cssText = 'height:' + (rect.height || 44) + 'px;margin:0 18px 8px 18px;' +
      'border:2px dashed var(--line-strong);border-radius:12px;background:var(--mist);' +
      'opacity:.6;box-sizing:border-box;transition:margin-left .15s ease;pointer-events:none';
    dnd.ph = ph;
    container.classList.add('tp-nosel');

    moveDrag(x, y);          /* initial gap + depth */
    startAuto();
    try { if (window.navigator && navigator.vibrate) navigator.vibrate(25); } catch (e) { }
    try {
      var sel = window.getSelection && window.getSelection();
      if (sel && sel.removeAllRanges) sel.removeAllRanges();
    } catch (e) { }
  }

  /* ghost ka level-number LIVE update : text + size (bullet chhota,
     number thoda bold taaki drag ke waqt saaf dikhe) */
  function setGhostNum(label, depth) {
    var g = dnd && dnd.numEl;
    if (!g) return;
    if (g.textContent !== label) g.textContent = label;
    g.style.fontSize = depth >= 3 ? '9px' : '10.5px';
    g.style.fontWeight = depth >= 3 ? '400' : '700';
    g.style.color = depth >= 3 ? 'var(--ash)' : 'var(--ink2)';
  }

  function placeGap(infos, gap, d) {
    var ph = dnd.ph;
    ph.style.marginLeft = (18 + (d - 1) * 14) + 'px';
    var ref = gap < infos.length ? infos[gap].el : null;
    flip(function () {
      if (ref && ref.parentNode === container) container.insertBefore(ph, ref);
      else container.appendChild(ph);
    });
    dnd.gap = gap;
    dnd.depth = d;
    setGhostNum(previewLabel(infos, gap, d), d);   /* number ghost ke saath */
  }

  function moveDrag(x, y) {
    if (!dnd) return;
    dnd.px = x; dnd.py = y;
    var dx = x - dnd.startX;
    dnd.ghost.style.transform = 'translate(' + dx + 'px,' + (y - dnd.startY) + 'px) scale(1.02)';
    var infos = rowInfos();
    var gap = computeGap(infos, y);
    var want = dnd.startDepth + Math.round(dx / STEP_X);
    var d = clampDepth(infos, gap, want, dnd.subMax);
    if (gap !== dnd.gap || d !== dnd.depth || !dnd.ph.parentNode) placeGap(infos, gap, d);
  }

  function startAuto() {
    var raf = window.requestAnimationFrame ||
      function (f) { return window.setTimeout(function () { f(Date.now()); }, 16); };
    function tick() {
      if (!dnd) return;
      /* sirf tab scroll karo jab list actually scrollable ho */
      if (container && container.scrollHeight > container.clientHeight + 4) {
        var cr = container.getBoundingClientRect();
        var y = dnd.py;
        if (y < cr.top + EDGE && container.scrollTop > 0) {
          container.scrollTop -= EDGE_SPD;
          moveDrag(dnd.px, dnd.py);
        } else if (y > cr.bottom - EDGE) {
          container.scrollTop += EDGE_SPD;
          moveDrag(dnd.px, dnd.py);
        }
      }
      dnd.raf = raf(tick);
    }
    dnd.raf = raf(tick);
  }

  function cleanupDom(d) {
    if (d.ghost && d.ghost.parentNode) d.ghost.parentNode.removeChild(d.ghost);
    if (d.ph && d.ph.parentNode) d.ph.parentNode.removeChild(d.ph);
    /* PHONE-FIX : hidden holder (pressed row ka touch-event anchor) hatao */
    if (d.holder && d.holder.parentNode) d.holder.parentNode.removeChild(d.holder);
    if (container && container.classList) container.classList.remove('tp-nosel');
  }

  function endDrag(doDrop) {
    if (!dnd) return;
    var d = dnd;
    var infos = rowInfos();          /* DOM se final positions (ph ke bina) */
    dnd = null;
    if (d.raf) {
      if (window.cancelAnimationFrame) window.cancelAnimationFrame(d.raf);
      else window.clearTimeout(d.raf);
      d.raf = 0;
    }
    cleanupDom(d);

    if (!doDrop) {
      /* cancel : origin par wapas, bina persist */
      d.origin.arr.splice(Math.min(d.origin.idx, d.origin.arr.length), 0, d.node);
      rerender();
      return;
    }

    /* drop : (gap, depth) → parent array + index → splice */
    var t = resolveInsert(infos, d.gap < 0 ? infos.length : d.gap, d.depth < 1 ? 1 : d.depth);
    var arr = chapter.topics;
    if (t.parentTid) {
      var pn = findNode(chapter.topics, t.parentTid);
      if (pn) { ensureNode(pn); arr = pn.children; }
    }
    var idx = Math.max(0, Math.min(t.index, arr.length));
    arr.splice(idx, 0, d.node);
    suppressClickUntil = Date.now() + 400;
    commit();
    rerender();
  }

  /* ---------- global pointer wiring (ek hi baar register) ---------- */
  /* ANDROID/iOS HARDENING : long-press par native text-selection,
     context-menu (Android ~500ms par fire hota hai) aur native
     dragstart browser ko touchcancel bhejne par majboor karte hain —
     touchcancel hamara long-press timer / active drag maar deta tha
     (real device par "long-press kaam nahi karta" ka main reason).
     Press pending ya drag active ho → teeno ko block karo. */
  document.addEventListener('contextmenu', function (e) {
    if (lpPending || dnd) { e.preventDefault(); return false; }
  });
  document.addEventListener('selectstart', function (e) {
    if (lpPending || dnd) e.preventDefault();
  });
  document.addEventListener('dragstart', function (e) {
    if (lpPending || dnd) { e.preventDefault(); return false; }
  });

  document.addEventListener('touchmove', function (e) {
    if (dnd && dnd.touch) {
      if (e.cancelable) e.preventDefault();     /* page scroll roko */
      var t = e.touches && e.touches[0];
      if (t) moveDrag(t.clientX, t.clientY);
      return;
    }
    if (lpPending && lpPending.touch) {
      var t2 = e.touches && e.touches[0];
      if (!t2) return;
      var mx = Math.abs(t2.clientX - lpPending.x);
      var my = Math.abs(t2.clientY - lpPending.y);
      if (mx > SLOP || my > SLOP) { cancelLP(); return; }   /* scroll jeeta */
      /* LONG-PRESS BACHAO (PHONE-FIX #2) : slop ke andar ke chhote jitter ko
         prevent karo — warna Android compositor use scroll gesture maan kar
         poori touch sequence "steal" kar leta hai aur touchcancel bhej kar
         long-press maar deta hai. 3px se kam movement par kuch nahi karte,
         isliye normal tap ka click kabhi suppress nahi hota. */
      if (e.cancelable && (mx > 3 || my > 3)) e.preventDefault();
    }
  }, { passive: false });

  document.addEventListener('touchend', function (e) {
    if (dnd && dnd.touch) {
      if (e.cancelable) e.preventDefault();     /* synthetic click roko */
      endDrag(true);
      return;
    }
    cancelLP();
  });

  document.addEventListener('touchcancel', function () {
    if (dnd && dnd.touch) { endDrag(false); return; }
    cancelLP();
  });

  document.addEventListener('mousemove', function (e) {
    if (dnd && !dnd.touch) {
      e.preventDefault();
      moveDrag(e.clientX, e.clientY);
      return;
    }
    if (lpPending && !lpPending.touch) {
      if (Math.abs(e.clientX - lpPending.x) > SLOP ||
          Math.abs(e.clientY - lpPending.y) > SLOP) cancelLP();
    }
  });

  document.addEventListener('mouseup', function () {
    if (dnd && !dnd.touch) { endDrag(true); return; }
    cancelLP();
  });

  document.addEventListener('keydown', function (e) {
    if (dnd && (e.key === 'Escape' || e.keyCode === 27)) endDrag(false);
  });

  /* test seam : pure helpers + programmatic drag (jsdom ke liye) */
  window.__TOPIC_DND_TEST = {
    CONST: { LP_MS: LP_MS, SLOP: SLOP, STEP_X: STEP_X, EDGE: EDGE, MAX_DEPTH: MAX_DEPTH },
    subMaxDepth: subMaxDepth,
    findLoc: function (id) { return chapter ? findLoc(chapter.topics, id) : null; },
    computeGap: computeGap,
    clampDepth: clampDepth,
    resolveInsert: resolveInsert,
    previewLabel: previewLabel,
    isDragging: function () { return !!dnd; },
    state: function () {
      return dnd ? { id: dnd.id, gap: dnd.gap, depth: dnd.depth, subMax: dnd.subMax } : null;
    },
    gapEl: function () { return dnd ? dnd.ph : null; },
    ghostEl: function () { return dnd ? dnd.ghost : null; },
    /* ghost par LIVE dikh raha level-number (1 / 13.4 / •) */
    ghostNum: function () { return dnd && dnd.numEl ? dnd.numEl.textContent : null; },
    ghostNumDepthStyle: function () {
      return dnd && dnd.numEl ? dnd.numEl.style.fontSize : null;
    },
    /* PHONE-FIX guard : touchstart ka target row drag ke dauraan document
       se CONNECTED rehna chahiye (warna Android touchmove bhejna band) */
    srcConnected: function () {
      return dnd && dnd.srcRow ? !!(dnd.srcRow.isConnected ||
        (dnd.srcRow.ownerDocument && dnd.srcRow.ownerDocument.contains(dnd.srcRow))) : null;
    },
    holderEl: function () { return dnd ? dnd.holder : null; },
    begin: function (id, x, y) {
      if (!container || dnd) return false;
      var rowEl = container.querySelector('[data-tid="' + id + '"]');
      var node = chapter ? findNode(chapter.topics, id) : null;
      if (!rowEl || !node) return false;
      beginDrag(node, parseInt(rowEl.getAttribute('data-depth'), 10) || 1, rowEl, x, y, false);
      return true;
    },
    move: function (x, y) { if (dnd) moveDrag(x, y); },
    end: function (drop) { endDrag(!!drop); }
  };

  /* ================================================================
     AUTO MIND MAP : topic tree → canvas cards + curved lines
     (canvas editor fullscreen mein khulta hai, Draw list mein
     save NAHI hota — back par topic screen par wapas)
  ================================================================ */

  /* POSITIONAL NUMBERING — list aur mind-map DONO ka single source of truth.
       depth 1 → "1","2",...      depth 2 → "1.1","2.3",...      depth 3+ → "•"
     Numbers render-time POSITIONAL hain (kuch save nahi hota), isliye list
     mein reorder/add/delete karte hi agla mind-map generation sahi numbers
     aur sahi order ke saath banega. */
  function markerFor(depth, parentNum, index) {
    if (depth === 1) return String(index + 1);
    if (depth === 2) return (parentNum || '') + '.' + (index + 1);
    return '•';
  }

  /* pehli baar kholne par mind-map ka default template (structured).
     User settings se badle to chapter.mindmapTemplate mein persist hota hai. */
  var DEFAULT_MINDMAP_TEMPLATE = 'bothsides';

  function sidePair(a, b) {
    var ax = a.x + a.w / 2, ay = a.y + a.h / 2;
    var bx = b.x + b.w / 2, by = b.y + b.h / 2;
    var dx = bx - ax, dy = by - ay;
    if (Math.abs(dx) > Math.abs(dy)) {
      return dx > 0 ? { a: 'e', b: 'w' } : { a: 'w', b: 'e' };
    }
    return dy > 0 ? { a: 's', b: 'n' } : { a: 'n', b: 's' };
  }

  function buildMindMap(ch) {
    var cards = [];
    var lines = [];
    var pairs = [];
    var DEPTH_COLORS = ['#fef3c7', '#dbeafe', '#dcfce7', '#fce7f5', '#e5e7eb', '#fef3c7'];

    function mkCard(x, y, w, h, color, text) {
      var c = { id: UI.uid(), x: Math.round(x), y: Math.round(y), w: w, h: h, color: color, text: text };
      cards.push(c);
      return c;
    }

    function mkLine(a, b) {
      var sp = sidePair(a, b);
      lines.push({
        id: UI.uid(),
        from: { cid: a.id, side: sp.a },
        to: { cid: b.id, side: sp.b },
        text: '', arrow: 'none', color: ''
      });
    }

    /* subtree ke leaf count → angular space (bade branches ko zyada jagah) */
    function leaves(n) {
      var k = n.children || [];
      if (!k.length) return 1;
      var sum = 0;
      k.forEach(function (c) { sum += leaves(c); });
      return sum;
    }

    /* AUTO-FIT helper : CanvasCards ka shared fit logic */
    function fitVia(text, w, h) {
      return (window.CanvasCards && window.CanvasCards.fitSize)
        ? window.CanvasCards.fitSize(text, w, h)
        : { w: w, h: h };
    }

    /* radial placement : har branch ko leaf-count ke hisaab se sector.
       parentNum saath leke chalta hai taaki har card par positional number
       (1 / 1.2 / •) lag sake — list wale numbers se exactly match. */
    function placeKids(kids, parentCard, angStart, angSpan, depth, parentNum) {
      if (!kids.length) return;
      var tot = 0;
      kids.forEach(function (k) { tot += leaves(k); });
      var a = angStart;
      kids.forEach(function (k, idx) {
        var span = angSpan * (leaves(k) / tot);
        var ang = a + span / 2;
        var R = depth === 0 ? 340 : (depth === 1 ? 250 : 210);
        /* NUMBERING : list jaisa hi positional marker */
        var num = markerFor(depth + 1, parentNum, idx);
        var text = num ? (num + '  ' + k.name) : k.name;
        /* fitted card bada ho to thoda door rakho (overlap kam ho) */
        var f = fitVia(text, 140, 52);
        R += Math.max(0, Math.max(f.w - 140, f.h - 52)) / 2;
        var cx = parentCard.x + parentCard.w / 2 + Math.cos(ang) * R;
        var cy = parentCard.y + parentCard.h / 2 + Math.sin(ang) * R;
        var kc = mkCard(cx - f.w / 2, cy - f.h / 2, f.w, f.h,
          DEPTH_COLORS[Math.min(depth + 1, DEPTH_COLORS.length - 1)], text);
        /* CANVAS-PRESENT: reveal-order + numbering ke liye hierarchy metadata.
           Purely additive — editor/renderer isse kuch nahi karte. */
        kc.mm = { depth: depth + 1, num: num, parentId: parentCard.id };
        pairs.push([parentCard, kc]);
        placeKids(k.children || [], kc, a, span, depth + 1, num);
        a += span;
      });
    }

    /* RULE : koi bhi do cards overlap NA karein —
       iterative collision resolution (radial look preserved) */
    function resolveOverlaps(all) {
      var PAD = 30;
      for (var it = 0; it < 200; it++) {
        var moved = false;
        for (var i = 0; i < all.length; i++) {
          for (var j = i + 1; j < all.length; j++) {
            var a = all[i], b = all[j];
            var dx = (b.x + b.w / 2) - (a.x + a.w / 2);
            var dy = (b.y + b.h / 2) - (a.y + a.h / 2);
            var ox = (a.w + b.w) / 2 + PAD - Math.abs(dx);
            var oy = (a.h + b.h) / 2 + PAD - Math.abs(dy);
            if (ox > 0 && oy > 0) {
              moved = true;
              var wa = (i === 0) ? 0 : 1;   /* root pinned */
              var wb = (j === 0) ? 0 : 1;
              var tw = wa + wb || 1;
              if (ox < oy) {
                var sg = dx > 0 ? 1 : -1;
                a.x -= sg * ox * (wa / tw);
                b.x += sg * ox * (wb / tw);
              } else {
                var sg2 = dy > 0 ? 1 : -1;
                a.y -= sg2 * oy * (wa / tw);
                b.y += sg2 * oy * (wb / tw);
              }
            }
          }
        }
        if (!moved) break;
      }
      all.forEach(function (c) { c.x = Math.round(c.x); c.y = Math.round(c.y); });
    }

    var fr = fitVia(ch.name, 200, 80);
    var root = mkCard(-fr.w / 2, -fr.h / 2, fr.w, fr.h, DEPTH_COLORS[0], ch.name);
    root.mm = { depth: 0, num: '', parentId: null };   /* CANVAS-PRESENT: root */
    placeKids(ch.topics || [], root, -Math.PI, 2 * Math.PI, 0, '');
    resolveOverlaps(cards);
    pairs.forEach(function (p) { mkLine(p[0], p[1]); });

    return {
      id: 'mindmap-' + (ch.id || 'x'),
      name: 'Mind Map: ' + ch.name,
      category: 'Auto',
      date: UI.fmtDate(UI.todayISO()),
      cards: cards,
      lines: lines
    };
  }

  function openMindMap() {
    if (!chapter || !window.CanvasEditor) return;
    var mm = buildMindMap(chapter);
    /* TEMPLATE PREFERENCE (per-chapter, subject-store mein persist) :
         • pehli baar (koi preference saved nahi)  → DEFAULT structured template
         • user ne settings se kuch chuna          → wahi yaad rakha jaata hai,
           back / tab-band / app-restart ke baad bhi wahi khulega
       Cards har baar topic-tree se FRESH bante hain, isliye list ka order aur
       numbers hamesha current rehte hain — template sirf positions tay karta hai. */
    var tid = chapter.mindmapTemplate || DEFAULT_MINDMAP_TEMPLATE;
    if (window.CanvasTemplates && window.CanvasTemplates.apply) {
      try { window.CanvasTemplates.apply(mm, tid); } catch (e) { /* ignore */ }
    }
    window.CanvasEditor.open(mm, function () {
      window.SubjectListBridge.openChapterViewTab('topic');
    });
  }

  /* ================================================================
     RENDER
  ================================================================ */
  function render() {
    container.innerHTML = '';

    var head = el('div');
    head.style.cssText = 'display:flex;align-items:center;padding:12px 18px 8px;gap:8px;flex-wrap:wrap';
    var addBtn = el('button', null, ICON_PLUS + ' <span>Add Topic</span>');
    addBtn.type = 'button';
    addBtn.style.cssText = 'display:inline-flex;align-items:center;gap:7px;padding:9px 16px;' +
      'border-radius:99px;border:1px solid var(--s2);background:var(--chip-bg);font:inherit;' +
      'font-size:12.5px;font-weight:600;color:var(--ink2);cursor:pointer;' +
      'box-shadow:inset 0 1px 0 var(--hl-soft)';
    addBtn.addEventListener('click', function () {
      openAddModal(chapter.topics, 'Add Topic');
    });
    head.appendChild(addBtn);


    /* Auto Mind Map : topic tree se automatic mind map → canvas editor */
    var mmBtn = el('button', null, ICON_MM + ' <span>Auto Mind Map</span>');
    mmBtn.type = 'button';
    mmBtn.style.cssText = 'display:inline-flex;align-items:center;gap:7px;padding:9px 16px;' +
      'border-radius:99px;border:1px solid var(--s2);background:var(--chip-bg);' +
      'font:inherit;font-size:12.5px;font-weight:600;color:var(--ink2);cursor:pointer;' +
      'box-shadow:inset 0 1px 0 var(--hl-soft)';
    mmBtn.addEventListener('click', function () { openMindMap(); });
    head.appendChild(mmBtn);
    container.appendChild(head);

    /* drag ke dauraan empty-state mat dikhao (node detached hai —
       list temporarily khali dikh sakti hai) */
    if (!chapter.topics.length && !dnd) {
      var empty = el('div', 'empty',
        'No topics yet.<br>Add Topic se ek saath multiple topics add karo (ek line = ek topic).');
      empty.style.margin = '0 18px 12px';
      container.appendChild(empty);
      return;
    }

    /* numbered tree walk — numbering ab markerFor() se (mind-map ke saath
       shared), taaki list aur mind-map ke numbers kabhi mismatch na hon.
       Numbers POSITIONAL hain : reorder/add/delete par apne aap renumber. */
    (function drawRows(nodes, prefix, depth) {
      nodes.forEach(function (n, i) {
        ensureNode(n);
        var label = markerFor(depth, prefix, i);
        container.appendChild(nodeRow(n, depth, depth >= 3 ? '' : label));
        drawRows(n.children, label, depth + 1);
      });
    })(chapter.topics, '', 1);
  }

  function rerender() {
    if (!container || !chapter) return;
    var st = container.scrollTop;
    render();
    container.scrollTop = st;
  }

  function renderChapterView(cont, ch, hk) {
    if (dnd) endDrag(false);   /* safety : beech mein screen/tab switch */
    container = cont;
    chapter = ch;
    hooks = hk || hooks;
    /* drop ke baad accidental click swallow (capture) — ek hi baar */
    if (cont && !cont.__tpDndGuard) {
      cont.__tpDndGuard = true;
      cont.addEventListener('click', function (e) {
        if (dnd || Date.now() < suppressClickUntil) {
          e.stopPropagation();
          e.preventDefault();
        }
      }, true);
    }
    ensure(ch);
    rerender();
  }

  window.Topic = {
    renderChapterView: renderChapterView,
    /* MIND-MAP + NUMBERING : tests aur cross-feature reuse ke liye expose */
    buildMindMap: buildMindMap,
    openMindMap: openMindMap,
    markerFor: markerFor,
    DEFAULT_MINDMAP_TEMPLATE: DEFAULT_MINDMAP_TEMPLATE
  };
})();
