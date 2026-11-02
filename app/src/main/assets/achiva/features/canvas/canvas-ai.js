/* ================================================================
   CANVAS / CANVAS-AI.JS — AI Plan Generator (naya ai/ system)
   ----------------------------------------------------------------
   • Canvas editor ke ✨ AI button se khulti hai ab ek POORI NAYI
     SCREEN (modal nahi) :
       - head : BACK (← canvas main screen par wapas) + [Choose AI]
       - upar : prompt textarea (jitna chahe likho)
       - neeche : SEND button (purane AI jaisa up-arrow)
       - send → prompt + CANVAS KA LIVE DATA (board name, cards,
         groups) + is file ke instructions → ai/engine (Hub) ko
       - answer aate hi plan canvas mein banta hai aur screen
         AUTOMATICALLY COLLAPSE ho kar canvas par wapas jaati hai
       - error aaye to screen khuli rehti hai, status line mein
         Hinglish error
   • [Choose AI] : beech mein sheet — Settings → AI wali hi provider
     LIST (ai/engine ka store). Yahan se user CANVAS ke liye alag AI
     chun sakta hai (per-feature pick : 'achiva.canvas.aiPick.v1');
     "App default" = jo Settings mein chosen hai.
   • AI ka connection sirf ai/ folder se : AchivaAIHub.chatJson —
     is file mein sirf PROMPTS + plan pipeline + canvas layout hai.
   • Plan canvas mein materialize hota hai (groups/cards/lines),
     EK undo snapshot mein, existing content ke NEECHE, phir fit.
   • openKeyWizard(cb) purana export topic.js ke liye compatible
     hai — ab wo Choose-AI sheet / Settings→AI kholta hai.
   • ES5-only syntax
   ================================================================ */

(function () {
  'use strict';

  if (window.__achivaCanvasAiLoaded) return;
  window.__achivaCanvasAiLoaded = true;

  var el = UI.el, esc = UI.esc, uid = UI.uid;
  var PICK_KEY = 'achiva.canvas.aiPick.v1';

  var currentAbort = null;
  var aiScreen = null, openerScreen = null;

  function E() { return (window.CanvasEditor && window.CanvasEditor.api) || null; }
  function H() { return window.AchivaAIHub; }

  /* ---------- per-feature AI pick ---------- */
  function pickedId() {
    try { return window.AppStorage.loadAt(PICK_KEY) || ''; } catch (e) { return ''; }
  }
  function setPickedId(id) { window.AppStorage.saveAt(PICK_KEY, id || ''); }
  function pickedCfg() {
    var id = pickedId();
    if (id && H()) { var c = H().get(id); if (c) return c; }
    return H() ? H().getActive() : null;
  }

  /* ================================================================
     PROMPTS + PIPELINE (feature ka dimaag — isi file mein)
  ================================================================ */
  var SYSTEM_BASE =
    'You are an expert study planner for Indian students. ' +
    'Respond ONLY with valid JSON — no markdown fences, no extra text. ' +
    'Write titles/notes in the SAME language as the user topic (Hinglish topics → Hinglish). ' +
    'If canvas live data diya gaya ho to uska context dhyan mein rakho.';

  var SCHEMA =
    '{"title":"plan ka naam","groups":[{"id":"g1","title":"Phase 1: …","note":"1-line summary",' +
    '"nodes":[{"id":"n1","title":"step/topic","note":"actionable details"}]}],' +
    '"edges":[{"from":"n1","to":"n2","label":"chhota reason"}]}';

  function topicBlock(topic) { return 'Topic / prompt: ' + topic + '\n\n'; }

  var RULES_FULL =
    'Rules:\n' +
    '- 3 se 6 groups (phases/stages), har group mein 3 se 8 nodes\n' +
    '- node.note = actionable steps (kya karna hai, kaise, kitna time)\n' +
    '- edges = prerequisites/order (from pehle karo, to baad mein) — 5 se 15 edges\n' +
    '- sab ids unique hon (g1,g2,… / n1,n2,…)\n' +
    '- SIRF valid JSON do, exactly is schema mein:\n' + SCHEMA;

  function promptQuick(topic) {
    return topicBlock(topic) +
      'Is topic par ek COMPLETE study plan banao — phases (groups), har phase mein steps (nodes), aur steps ke beech order (edges).\n' +
      RULES_FULL;
  }
  function promptOutline(topic) {
    return topicBlock(topic) +
      'Is topic par research karke plan ka OUTLINE banao (abhi sirf structure):\n' +
      '- 3 se 6 groups (phases), har group mein 3 se 8 nodes\n' +
      '- har node ki note abhi SIRF 1 short line\n' +
      '- edges MAT do\n' +
      '- sab ids unique hon (g1,g2,… / n1,n2,…)\n' +
      '- SIRF valid JSON do, is schema mein (edges array khaali chhodo):\n' + SCHEMA;
  }
  function promptExpand(outlineJson) {
    return 'Ye plan ka outline hai:\n' + outlineJson + '\n\n' +
      'Ab DEEP RESEARCH karke har node ki note ko 3-6 actionable lines mein expand karo ' +
      '(concrete steps, quantities, examples/numericals, revision pointers).\n' +
      'Wapas EXACTLY same structure aur SAME ids do — nodes add/remove/rename mat karo. ' +
      'edges abhi bhi mat do. SIRF valid JSON.';
  }
  function promptEdges(compactJson) {
    return 'Ye study plan hai:\n' + compactJson + '\n\n' +
      'Ab iske nodes ke beech prerequisite/order connections (dependencies) do — ' +
      'kaunsa step kis se pehle hona chahiye (same group ke andar bhi aur groups ke beech bhi).\n' +
      'SIRF un ids ka use karo jo plan mein hain. 5 se 20 edges.\n' +
      'SIRF valid JSON do: {"edges":[{"from":"id","to":"id","label":"chhota reason"}]}';
  }

  /* canvas ka LIVE data (feature context) — AI ko saath jaata hai */
  function canvasSnapshot() {
    var api = E();
    if (!api || !api.getCanvas) return '';
    var c = api.getCanvas();
    if (!c) return '';
    var parts = [];
    parts.push('Board: ' + (c.name || 'canvas'));
    (c.cards || []).slice(0, 40).forEach(function (cd) {
      var t = String(cd.text || '').replace(/\s+/g, ' ').slice(0, 80);
      if (t) parts.push('- card: ' + t);
    });
    (c.groups || []).slice(0, 20).forEach(function (g) {
      var t = String(g.text || '').replace(/\s+/g, ' ').slice(0, 60);
      if (t) parts.push('- group: ' + t);
    });
    return parts.length > 1 ? parts.join('\n') : '';
  }

  /* ek AI call : naya engine (chatJson = json + repair-retry andar) */
  function callJson(prompt, opts, maxTokens) {
    return H().chatJson({
      system: SYSTEM_BASE,
      user: prompt,
      search: !!opts.search,
      signal: opts.signal,
      maxTokens: maxTokens,
      cfg: opts.cfg || pickedCfg()
    });
  }

  /* plan ko safe shape mein lao (clamp + validate) */
  function normalizePlan(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var rawGroups = Array.isArray(raw.groups) ? raw.groups : [];
    if (!rawGroups.length) return null;
    var out = { title: String(raw.title || 'AI Plan').slice(0, 80), groups: [], edges: [] };
    var nodeIds = {};
    rawGroups.slice(0, 8).forEach(function (g, gi) {
      if (!g || typeof g !== 'object') return;
      var rawNodes = Array.isArray(g.nodes) ? g.nodes : [];
      var gg = {
        id: 'aig' + (gi + 1),
        title: String(g.title || ('Phase ' + (gi + 1))).slice(0, 60),
        note: String(g.note || '').slice(0, 200),
        nodes: []
      };
      rawNodes.slice(0, 10).forEach(function (n, ni) {
        if (!n) return;
        var isStr = (typeof n === 'string');
        var t = String(isStr ? n : (n.title || '')).slice(0, 80);
        if (!t) return;
        var id = String((!isStr && n.id) || ('n' + gi + '_' + ni));
        if (nodeIds[id]) id = id + '_x' + gi + '_' + ni;   /* collision guard */
        nodeIds[id] = true;
        gg.nodes.push({
          id: id,
          title: t,
          note: String((!isStr && n.note) || '').slice(0, 600)
        });
      });
      if (gg.nodes.length) out.groups.push(gg);
    });
    if (!out.groups.length) return null;
    var seen = {};
    (Array.isArray(raw.edges) ? raw.edges : []).forEach(function (e) {
      if (!e || !nodeIds[e.from] || !nodeIds[e.to] || e.from === e.to) return;
      var k = e.from + '>' + e.to;
      if (seen[k] || out.edges.length >= 40) return;
      seen[k] = 1;
      out.edges.push({ from: String(e.from), to: String(e.to), label: String(e.label || '').slice(0, 40) });
    });
    return out;
  }

  /* poori pipeline : prompt → normalized plan */
  function generatePlan(topic, opts) {
    opts = opts || {};
    var deep = (opts.depth === 'deep');
    var phase = opts.onPhase || function () { };
    var snap = canvasSnapshot();
    var ctx = snap ? (topic + '\n\nCanvas live data:\n' + snap) : topic;
    var quickCall = function (p, mt) { return callJson(p, opts, mt); };

    if (!deep) {
      phase('Research + plan ban raha hai… (1 AI call)');
      return quickCall(promptQuick(ctx), 3500).then(function (res) {
        if (!res.ok) return res;
        var plan = normalizePlan(res.json);
        if (!plan) return { ok: false, error: 'AI ke jawab se plan nahi ban paya — dobara try karo.' };
        return { ok: true, plan: plan, note: res.note };
      });
    }

    /* DEEP : pass1 outline → pass2 expand → pass3 edges */
    var outline = null;
    phase('Deep research 1/3 : outline…');
    return quickCall(promptOutline(ctx), 2500).then(function (res1) {
      if (!res1.ok) return res1;
      outline = normalizePlan(res1.json);
      if (!outline) return { ok: false, error: 'AI ke outline se plan nahi ban paya — dobara try karo.' };
      phase('Deep research 2/3 : notes expand…');
      return callJson(promptExpand(JSON.stringify(outline)), opts, 4000).then(function (res2) {
        var expanded = (res2.ok && res2.json) ? normalizePlan(res2.json) : null;
        if (!expanded) expanded = outline;   /* expand fail → outline se hi chalao */
        phase('Deep research 3/3 : connections…');
        return callJson(promptEdges(JSON.stringify({ groups: expanded.groups })), opts, 1500).then(function (res3) {
          var plan = expanded;
          if (res3.ok && res3.json && Array.isArray(res3.json.edges)) {
            var merged = normalizePlan({ title: plan.title, groups: plan.groups, edges: res3.json.edges });
            if (merged) plan = merged;
          }
          return { ok: true, plan: plan, note: res3.note || (res2 && res2.note) };
        });
      });
    });
  }

  /* ================================================================
     LAYOUT — plan → canvas (groups + cards + lines)  [unchanged]
  ================================================================ */
  var CW = 180, CH = 100, GAP = 18, PAD = 18, TITLE_H = 40, FLOW_GAP = 70;

  function contentBBox(canvas) {
    var has = false, minx = 1e9, maxy = -1e9;
    canvas.cards.forEach(function (c) {
      has = true; minx = Math.min(minx, c.x); maxy = Math.max(maxy, c.y + c.h);
    });
    (canvas.groups || []).forEach(function (g) {
      has = true; minx = Math.min(minx, g.x); maxy = Math.max(maxy, g.y + g.h);
    });
    return has ? { minx: minx, maxy: maxy } : null;
  }

  function anchorFor(a, b) {
    var acx = a.x + a.w / 2, acy = a.y + a.h / 2;
    var bcx = b.x + b.w / 2, bcy = b.y + b.h / 2;
    if (bcy > acy + 40) return ['s', 'n'];
    if (bcy < acy - 40) return ['n', 's'];
    if (bcx >= acx) return ['e', 'w'];
    return ['w', 'e'];
  }

  function fitVia(text, w, h, hasTag) {
    return (window.CanvasCards && window.CanvasCards.fitSize)
      ? window.CanvasCards.fitSize(text, w, h, !!hasTag)
      : { w: w, h: h };
  }

  function placePlan(plan) {
    var api = E();
    if (!api) return false;
    var canvas = api.getCanvas();
    if (!canvas || !plan || !plan.groups || !plan.groups.length) return false;
    if (!Array.isArray(canvas.groups)) canvas.groups = [];
    if (!Array.isArray(canvas.cards)) canvas.cards = [];
    if (!Array.isArray(canvas.lines)) canvas.lines = [];

    var bb = contentBBox(canvas);
    var ox = bb ? bb.minx : 40;
    var oy = bb ? bb.maxy + 120 : 40;

    var y = oy;
    var nodeCard = {};
    var connected = {};

    var tf = fitVia(plan.title, 340, 64);
    var titleCard = { id: uid(), x: ox, y: y, w: tf.w, h: tf.h, color: '#ffffff', text: plan.title };
    canvas.cards.push(titleCard);
    y += tf.h + FLOW_GAP;

    var groupBoxes = [];
    plan.groups.forEach(function (g) {
      var fits = g.nodes.map(function (n) {
        return fitVia(n.title + (n.note ? '\n\n' + n.note : ''), CW, CH);
      });
      var cols = Math.min(3, g.nodes.length);
      var rows = Math.ceil(g.nodes.length / cols);
      var colW = [], rowH = [];
      for (var ci = 0; ci < cols; ci++) colW.push(CW);
      for (var ri = 0; ri < rows; ri++) rowH.push(CH);
      fits.forEach(function (f, ni) {
        var c2 = ni % cols, r2 = Math.floor(ni / cols);
        if (f.w > colW[c2]) colW[c2] = f.w;
        if (f.h > rowH[r2]) rowH[r2] = f.h;
      });
      var sumW = 0, sumH = 0;
      colW.forEach(function (v) { sumW += v; });
      rowH.forEach(function (v) { sumH += v; });
      var gw = PAD * 2 + sumW + (cols - 1) * GAP;
      var gh = TITLE_H + PAD + sumH + (rows - 1) * GAP + PAD;
      var box = { id: uid(), x: ox, y: y, w: gw, h: gh, color: '', text: g.title };
      canvas.groups.push(box);
      groupBoxes.push(box);

      var colX = [];
      var accX = PAD;
      for (var cj = 0; cj < cols; cj++) { colX.push(accX); accX += colW[cj] + GAP; }
      var rowY = [];
      var accY = y + TITLE_H + PAD;
      for (var rj = 0; rj < rows; rj++) { rowY.push(accY); accY += rowH[rj] + GAP; }

      g.nodes.forEach(function (n, ni) {
        var col = ni % cols, row = Math.floor(ni / cols);
        var f = fits[ni];
        var card = {
          id: uid(),
          x: colX[col] + Math.round((colW[col] - f.w) / 2),
          y: rowY[row] + Math.round((rowH[row] - f.h) / 2),
          w: f.w, h: f.h, color: '#ffffff',
          text: n.title + (n.note ? '\n\n' + n.note : '')
        };
        canvas.cards.push(card);
        nodeCard[n.id] = card;
      });

      for (var ni2 = 0; ni2 < g.nodes.length - 1; ni2++) {
        var a = nodeCard[g.nodes[ni2].id], b = nodeCard[g.nodes[ni2 + 1].id];
        if (!a || !b) continue;
        var sides = (a.y === b.y) ? ['e', 'w'] : ['s', 'n'];
        canvas.lines.push({
          id: uid(), from: { cid: a.id, side: sides[0] }, to: { cid: b.id, side: sides[1] },
          text: '', arrow: 'end', color: ''
        });
        connected[a.id + '>' + b.id] = 1;
      }
      y += gh + FLOW_GAP;
    });

    for (var gi = 0; gi < groupBoxes.length - 1; gi++) {
      canvas.lines.push({
        id: uid(),
        from: { cid: groupBoxes[gi].id, side: 's' },
        to: { cid: groupBoxes[gi + 1].id, side: 'n' },
        text: '', arrow: 'end', color: ''
      });
    }

    (plan.edges || []).forEach(function (e) {
      var a = nodeCard[e.from], b = nodeCard[e.to];
      if (!a || !b || a.id === b.id) return;
      if (connected[a.id + '>' + b.id] || connected[b.id + '>' + a.id]) return;
      connected[a.id + '>' + b.id] = 1;
      var sides2 = anchorFor(a, b);
      canvas.lines.push({
        id: uid(), from: { cid: a.id, side: sides2[0] }, to: { cid: b.id, side: sides2[1] },
        text: e.label || '', arrow: 'end', color: ''
      });
    });

    api.commit();
    if (window.CanvasCards) window.CanvasCards.render();
    if (window.CanvasLines) window.CanvasLines.render();
    if (window.CanvasGroups) window.CanvasGroups.render();

    focusRect(api, ox, oy, Math.max(340, PAD * 2 + 3 * CW + 2 * GAP), y - FLOW_GAP - oy);
    return true;
  }

  function focusRect(api, x, y, w, h) {
    if (!api.viewport) return;
    var vw = api.viewport.clientWidth || 360;
    var vh = api.viewport.clientHeight || 640;
    var t = api.getT();
    var s = Math.max(0.25, Math.min(vw / w, vh / h, 1) * 0.92);
    t.s = s;
    t.x = (vw - w * s) / 2 - x * s;
    t.y = (vh - h * s) / 2 - y * s;
    api.applyT();
  }

  /* ================================================================
     CHOOSE AI sheet (Settings→AI wali hi list, per-feature pick)
  ================================================================ */
  /* Choose AI sheet : ai/settings.js ka GENERIC pick-sheet use karo
     (har feature ki apni copy nahi — ek hi list-UI poori app mein) */
  function openChooseSheet(onPicked) {
    if (window.AchivaAIHubSettings && window.AchivaAIHubSettings.openPickSheet) {
      /* canvas sirf NORMAL category use karta hai — audio list bekaar hai */
      window.AchivaAIHubSettings.openPickSheet(pickedId(), function (id) {
        setPickedId(id);
        if (onPicked) onPicked();
      }, 'normal');
      return;
    }
    /* fallback : engine hai par settings screen load nahi hui */
    var m = UI.modal({ zScrim: 94, zWrap: 95 });
    m.open('Choose AI', function (body) {
      var cur = pickedId();
      function row(label, id) {
        var on = (id === '' && !cur) || (id !== '' && cur === id);
        var r = el('div');
        r.style.cssText = 'display:flex;align-items:center;gap:9px;padding:9px 4px;cursor:pointer;border-bottom:1px solid var(--line)';
        r.appendChild(UI.roundCheck(on));
        var nm = el('div', null, esc(label));
        nm.style.cssText = 'flex:1;font-size:13px;font-weight:' + (on ? '700' : '500') + ';color:var(--ink)';
        r.appendChild(nm);
        r.addEventListener('click', function () {
          setPickedId(id);
          m.close();
          if (onPicked) onPicked();
        });
        body.appendChild(r);
      }
      var act = H().getActive();
      row('App default' + (act ? ' (' + act.provider + ')' : ''), '');
      H().list().forEach(function (c) { row(c.provider + ' · ' + (c.model || 'default'), c.id); });
    }, null);
  }

  /* ================================================================
     AI SCREEN (prompt + send)
  ================================================================ */
  var SEND_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="M5 12l7-7 7 7"/></svg>';

  function buildScreen() {
    aiScreen = el('section', 'screen');
    aiScreen.style.paddingTop = '58px';
    document.getElementById('app').appendChild(aiScreen);
  }

  function renderScreen() {
    aiScreen.innerHTML = '';
    var head = el('div');
    head.style.cssText = 'display:flex;align-items:center;gap:10px;padding:12px 16px 6px';
    var back = UI.miniBtn(UI.icons.back, 'Back to canvas');
    back.style.cssText += ';width:34px;height:34px;border-radius:50%;border:1px solid var(--s2);background:var(--chip-bg)';
    back.addEventListener('click', function () { backToCanvas(); });
    head.appendChild(back);
    var tt = el('b', null, 'AI');
    tt.style.cssText = 'flex:1;font-family:var(--f-disp);font-size:17px;font-weight:700;color:var(--ink)';
    head.appendChild(tt);
    var chooseB = UI.pillBtn('Choose AI');
    chooseB.style.cssText += ';padding:7px 13px;font-size:11.5px;font-weight:700';
    chooseB.addEventListener('click', function () { openChooseSheet(function () { renderScreen(); }); });
    head.appendChild(chooseB);
    aiScreen.appendChild(head);

    var scroll = el('div', 'scroll');

    var cfg = pickedCfg();
    var who = el('div', null, cfg
      ? ('AI: ' + esc(cfg.provider) + ' · ' + esc(cfg.model || 'default model') + (pickedId() ? ' (canvas pick)' : ' (app default)'))
      : 'Koi AI provider nahi — Choose AI se add/select karo.');
    who.style.cssText = 'font-size:10.5px;color:var(--ash);margin:2px 18px 8px';
    scroll.appendChild(who);

    /* prompt : upar, jitna chahe likho */
    var ta = el('textarea');
    ta.placeholder = 'Apna prompt likho… e.g. Electrochemistry ka 20 din ka revision plan banao';
    ta.style.cssText = 'width:calc(100% - 36px);margin:0 18px;min-height:130px;resize:vertical;' +
      'padding:12px 14px;border-radius:14px;border:1px solid var(--s2);background:var(--input-bg);' +
      'font:inherit;font-size:13.5px;line-height:1.6;color:var(--ink);box-sizing:border-box;outline:none';
    scroll.appendChild(ta);

    /* options row : depth + web search */
    var optRow = el('div');
    optRow.style.cssText = 'display:flex;align-items:center;gap:8px;margin:10px 18px;flex-wrap:wrap';
    var depthR = UI.chipRow(['Quick', 'Deep'], 'Quick');
    optRow.appendChild(depthR.row);
    var searchLbl = el('label');
    searchLbl.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:11px;color:var(--slate)';
    var searchBox = el('input');
    searchBox.type = 'checkbox';
    searchLbl.appendChild(searchBox);
    searchLbl.appendChild(el('span', null, 'web search'));
    optRow.appendChild(searchLbl);
    scroll.appendChild(optRow);

    /* send : purane AI jaisa up-arrow */
    var sendRow = el('div');
    sendRow.style.cssText = 'display:flex;justify-content:flex-end;margin:0 18px 6px';
    var sendB = el('button');
    sendB.type = 'button';
    sendB.setAttribute('aria-label', 'Send prompt');
    sendB.style.cssText = 'width:44px;height:44px;border-radius:50%;border:0;background:var(--ink);' +
      'color:var(--paper);cursor:pointer;display:flex;align-items:center;justify-content:center;' +
      'box-shadow:0 8px 18px -8px rgba(0,0,0,.5)';
    sendB.innerHTML = SEND_SVG;
    sendRow.appendChild(sendB);
    scroll.appendChild(sendRow);

    var status = el('div');
    status.style.cssText = 'font-size:11.5px;line-height:1.6;color:var(--slate);margin:4px 18px 16px;min-height:16px;white-space:pre-wrap';
    scroll.appendChild(status);

    aiScreen.appendChild(scroll);

    function show(msg, isErr) {
      status.textContent = msg || '';
      status.style.color = isErr ? '#c0392b' : 'var(--ink2)';
    }

    sendB.addEventListener('click', function () {
      var t = String(ta.value || '').trim();
      if (!t) { show('Pehle prompt likho 🙂', true); return; }
      if (!H() || !pickedCfg()) {
        show('Koi AI provider selected nahi — Choose AI dabao.', true);
        return;
      }
      currentAbort = window.AbortController ? new AbortController() : { signal: undefined, abort: function () { } };
      sendB.disabled = true;
      sendB.style.opacity = '.55';
      show('Bheja gaya — AI soch raha hai…');
      generatePlan(t, {
        depth: depthR.get() === 'Deep' ? 'deep' : 'quick',
        search: searchBox.checked,
        signal: currentAbort.signal,
        onPhase: function (m) { show(m, false); }
      }).then(function (res) {
        sendB.disabled = false;
        sendB.style.opacity = '1';
        if (res && res.aborted) { show('Cancel ho gaya.', true); return; }
        if (!res || !res.ok) { show((res && res.error) || 'Kuch gadbad ho gayi — dobara try karo.', true); return; }
        if (!placePlan(res.plan)) { show('Canvas ready nahi — editor mein se dobara try karo.', true); return; }
        /* answer aa gaya → screen automatically collapse */
        show('');
        backToCanvas();
      }, function () {
        sendB.disabled = false;
        sendB.style.opacity = '1';
        show('Unexpected error — dobara try karo.', true);
      });
    });
  }

  function backToCanvas() {
    if (openerScreen && document.body.contains(openerScreen)) {
      if (window.SubjectListBridge) window.SubjectListBridge.show(openerScreen, false);
      else openerScreen.classList.add('active');
      return;
    }
    var api = E();
    if (api && api.screen) {
      if (window.SubjectListBridge) window.SubjectListBridge.show(api.screen, false);
    }
  }

  function open() {
    var api = E();
    if (!api || !api.getCanvas || !api.getCanvas()) return;   /* editor khula hi nahi */
    if (api.readOnly && api.readOnly()) return;              /* read-only mein band */
    if (!H()) {
      /* ai/ engine load nahi hua — chup rehne ke bajaye batao */
      var miss = (window.__ACHIVA_LOAD_ERRORS || []).join(', ');
      var m0 = UI.modal({ zScrim: 96, zWrap: 97 });
      m0.open('AI module missing', function (body) {
        var d = el('div', null, 'AI engine (ai/ folder) load nahi hua' +
          (miss ? ' — missing: ' + miss : '') + '. Page reload karo ya deployment/copy mein ai/ folder ki files check karo.');
        d.style.cssText = 'font-size:12px;line-height:1.7;color:var(--ink2)';
        body.appendChild(d);
      }, null);
      return;
    }
    var act = document.querySelector('section.screen.active');
    if (act && act !== aiScreen) openerScreen = act;
    if (!aiScreen) buildScreen();
    renderScreen();
    if (window.SubjectListBridge) window.SubjectListBridge.show(aiScreen, true);
    else aiScreen.classList.add('active');
  }

  /* ---------- purana export (topic.js compatible) ---------- */
  function openKeyWizard(onDone) {
    if (H() && H().list().length) {
      openChooseSheet(onDone || null);
    } else if (window.AchivaAIHubSettings) {
      window.AchivaAIHubSettings.open();
    }
  }

  window.CanvasAI = {
    open: open,
    openKeyWizard: openKeyWizard,
    openChooseSheet: openChooseSheet,
    pickedCfg: pickedCfg,
    _test: {
      generatePlan: function (topic, opts) { return generatePlan(topic, opts || {}); },
      placePlan: placePlan,
      normalizePlan: normalizePlan,
      canvasSnapshot: canvasSnapshot
    }
  };
})();
