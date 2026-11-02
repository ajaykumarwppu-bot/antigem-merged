/* ================================================================
   FEATURES / SUBJECT TRACKER / NOTES.JS — per-topic detailed notes
   ----------------------------------------------------------------
   Topic tab (topic.js) ke kisi bhi topic/sub-topic card ke MIDDLE
   (name area) par click karte hi ye NOTES screen khulti hai.
   Tick / + / flag / kebab buttons par click se NAHI khulti —
   wo guard topic.js ke row-click handler mein hai (onBtn).

   SCREEN :
     • Back (←)      : topic list par wapas (close par pending save
                       turant flush hota hai)
     • Heading       : node ka naam — YAHAN EDIT KARNE SE sirf notes
                       ka apna title badalta hai (node.notesTitle);
                       BAHAR topic list ka naam waisa hi rehta hai
     • Eyebrow       : "NOTES" (chhota uppercase label)
     • Gear button   : Settings — abhi PLACEHOLDER (kaam baad mein)
     • AI button     : icon-only round button (gear jitna) —
                       PLACEHOLDER: Copy Prompt / Preview popup plan
                       hai (Phase 2 — AI protocol)
     • WRITE / READ  : toggle chips.
                       Write = full-screen textarea, AUTO-SAVE
                       (~350ms debounce), koi Save button nahi;
                       back/close par flush.
                       Read  = rendered view — text ke andar $...$
                       (inline) aur $$...$$ (block) math KaTeX se
                       typeset hote hain (ai/math-render.js +
                       vendor/katex). Rendered formula par TAP →
                       LaTeX editor modal (live preview + cheatsheet).
     • PREV / NEXT   : Write/Read chips ke parallel (right end) —
                       topic list ke EXACT order (DFS) mein pichla/
                       agla note isi screen par; end par WRAP. View
                       mode preserve rehta hai, pending save pehle
                       flush hota hai (kuch lost nahi).
     • Data          : node.notes (text) + node.notesTitle (string) —
                       chapter.topics ke saath main state mein persist
                       (AppStorage) + Firebase backup. Purana data
                       safe: dono optional fields.

   Screen pattern SubjectSetting.js jaisa : section.screen +
   SubjectListBridge.show (prev screen yaad, back par wahi).
   ES5-only. window.Notes = { open(node, opts), close(), isOpen() }
   opts : { persist(), onSaved() }  — topic.js bhejta hai.
   ================================================================ */

(function () {
  'use strict';

  if (window.__achivaNotesLoaded) return;
  window.__achivaNotesLoaded = true;

  var el = UI.el;

  /* wahi icons jo canvas-editor.js use karta hai (consistent look) */
  var ICON_GEAR = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h0a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55h0a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v0a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1z"/></svg>';
  var ICON_AI = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.8 4.9L18.7 9.7l-4.9 1.8L12 16.4l-1.8-4.9L5.3 9.7l4.9-1.8z"/><path d="M18.5 15l.9 2.3 2.3.9-2.3.9-.9 2.3-.9-2.3-2.3-.9 2.3-.9z"/></svg>';
  var ICON_BACK = UI.icons.back;
  /* view toggle : Write (pencil) / Read (eye) */
  var ICON_WRITE = UI.icons.edit;
  var ICON_READ = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  /* Prev/Next navigation (topic list ke order mein) */
  var ICON_PREV = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>';
  var ICON_NEXT = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>';

  var SAVE_DEBOUNCE = 350;   /* ms — type karte hi auto-save */

  var screen = null;
  var prevScreen = null;
  var current = null;        /* { node, opts } */
  var titleInput = null, ta = null;
  var body = null, readWrap = null, readBody = null;
  var writeBtn = null, readBtn = null;
  var prevBtn = null, nextBtn = null, navSpacer = null;
  var viewMode = 'write';
  var saveTimer = null;
  var touched = false;       /* user ne textarea mein type kiya */
  var titleTouched = false;  /* user ne heading edit ki */

  /* ================================================================
     SCREEN (ek hi instance — har node ke liye reuse, values refill)
  ================================================================ */
  function roundBtn(html, ariaLabel) {
    var b = UI.miniBtn(html, ariaLabel);
    b.style.cssText += ';width:34px;height:34px;border-radius:50%;border:1px solid ' +
      'var(--s2);background:var(--chip-bg)';
    return b;
  }

  function ensureScreen() {
    if (screen) return screen;
    var app = document.getElementById('app');
    if (!app) return null;

    screen = el('section', 'screen');
    screen.id = 'screen-topic-notes';
    screen.style.paddingTop = '58px';

    /* ---------- head : back · title (editable) · gear · AI ---------- */
    var head = el('div');
    head.style.cssText = 'display:flex;align-items:center;gap:10px;padding:12px 16px 6px';

    var back = roundBtn(ICON_BACK, 'Back');
    back.addEventListener('click', function () { close(); });
    head.appendChild(back);

    var titleWrap = el('div');
    titleWrap.style.cssText = 'flex:1;min-width:0';
    titleWrap.appendChild(el('div', 'eyebrow', 'Notes'));

    titleInput = el('input');
    titleInput.type = 'text';
    titleInput.autocomplete = 'off';
    titleInput.setAttribute('aria-label', 'Notes title');
    /* heading = topic ka naam; edit karne par sirf notesTitle badalta
       hai (node.name untouched). Neeche dashed line sirf focus par
       dikhti hai — layout shift zero (border hamesha reserved). */
    titleInput.style.cssText = 'width:100%;padding:0;border:none;border-bottom:1px dashed transparent;' +
      'outline:none;background:transparent;font-family:var(--f-disp);font-size:18px;font-weight:700;' +
      'color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
    titleInput.addEventListener('focus', function () {
      titleInput.style.borderBottomColor = 'var(--s3)';
    });
    titleInput.addEventListener('blur', function () {
      titleInput.style.borderBottomColor = 'transparent';
    });
    titleInput.addEventListener('input', function () {
      titleTouched = true;
      scheduleSave();
    });
    titleInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); ta.focus(); }
    });
    titleWrap.appendChild(titleInput);
    head.appendChild(titleWrap);

    /* Settings (gear) — PLACEHOLDER: kaam baad mein add hoga */
    var gearBtn = roundBtn(ICON_GEAR, 'Settings');
    head.appendChild(gearBtn);

    /* AI button → NotesAI popup (ai/notes-ai.js — Phase 2) :
       Copy Prompt → bahar ka AI → output paste → Preview (wahi
       KaTeX render jo Read view mein) → Save (append/replace).
       gear jitna hi 34px round, sirf icon. */
    var aiBtn = roundBtn(ICON_AI, 'AI');
    aiBtn.addEventListener('click', function () { openAiPopup(); });
    head.appendChild(aiBtn);

    screen.appendChild(head);

    /* ---------- VIEW TOGGLE : Write / Read ----------
       Write = raw textarea (auto-save, jaisa pehle tha).
       Read  = rendered view — $...$ / $$...$$ formulas KaTeX se
       typeset (math-render.js). Rendered formula par TAP →
       LaTeX editor modal (live preview + cheatsheet). */
    var viewRow = el('div', 'chips');
    viewRow.style.padding = '6px 16px 8px';

    function viewChip(iconHtml, label) {
      var b = el('button', 'chip', iconHtml + '<span>' + label + '</span>');
      b.type = 'button';
      b.style.cssText += ';display:inline-flex;align-items:center;gap:6px';
      return b;
    }
    writeBtn = viewChip(ICON_WRITE, 'Write');
    readBtn = viewChip(ICON_READ, 'Read');
    writeBtn.addEventListener('click', function () { setView('write'); });
    readBtn.addEventListener('click', function () { setView('read'); });
    viewRow.appendChild(writeBtn);
    viewRow.appendChild(readBtn);

    /* ---------- PREV / NEXT : Write/Read chips ke parallel (right end) ----------
       Topic list ke EXACT order mein pichla/agla note isi screen par kholta hai
       (back-jaakar-card-kholne ki zaroorat nahi). Order topic.js ka flatOrder()
       (DFS — jaise list dikhti hai); end par WRAP (last→first, first→last).
       Sirf tab dikhte hain jab opener ne opts.navigate diya ho; ek hi node ho
       to disabled. Switch se pehle current notes ka pending save flush hota
       hai (open() ka existing pattern) — kuch lost nahi hota. */
    navSpacer = el('div');
    navSpacer.style.cssText = 'flex:1';
    viewRow.appendChild(navSpacer);
    prevBtn = viewChip(ICON_PREV, 'Prev');
    nextBtn = viewChip(ICON_NEXT, 'Next');
    prevBtn.addEventListener('click', function () { gotoSibling(-1); });
    nextBtn.addEventListener('click', function () { gotoSibling(+1); });
    viewRow.appendChild(prevBtn);
    viewRow.appendChild(nextBtn);

    screen.appendChild(viewRow);

    /* ---------- WRITE view : full-height textarea (auto-save) ---------- */
    body = el('div');
    body.style.cssText = 'flex:1;min-height:0;display:flex;padding-top:2px';

    ta = el('textarea');
    ta.setAttribute('aria-label', 'Notes');
    ta.placeholder = 'Yahan apne notes likho… (math ke liye $...$ ya $$...$$)';
    ta.style.cssText = 'flex:1;width:100%;resize:none;border:none;outline:none;background:transparent;' +
      'font:inherit;font-size:14px;line-height:1.75;color:var(--ink);' +
      'padding:10px 18px calc(28px + env(safe-area-inset-bottom,0px));' +
      '-webkit-user-select:text;user-select:text;overscroll-behavior:contain';
    ta.addEventListener('input', function () {
      touched = true;
      scheduleSave();
    });
    body.appendChild(ta);
    screen.appendChild(body);

    /* ---------- READ view : rendered notes (KaTeX math) ---------- */
    readWrap = el('div');
    readWrap.style.cssText = 'flex:1;min-height:0;overflow-y:auto;display:none;overscroll-behavior:contain';
    readBody = el('div', 'notes-read');
    readBody.style.cssText = 'padding:8px 18px calc(28px + env(safe-area-inset-bottom,0px))';
    /* rendered formula par tap → editor modal (data-mi = span index) */
    readBody.addEventListener('click', function (e) {
      var t = e.target;
      while (t && t !== readBody) {
        if (t.getAttribute && t.getAttribute('data-mi') != null) {
          var spans = window.MathRender ? window.MathRender.getSpans() : [];
          var mi = parseInt(t.getAttribute('data-mi'), 10);
          if (spans[mi]) openFormulaEditor(spans[mi]);
          return;
        }
        t = t.parentNode;
      }
    });
    readWrap.appendChild(readBody);
    screen.appendChild(readWrap);

    app.appendChild(screen);
    return screen;
  }

  /* ================================================================
     WRITE / READ SWITCH + READ RENDER
  ================================================================ */
  function setView(mode) {
    viewMode = mode;
    var writing = mode !== 'read';
    if (writeBtn) writeBtn.classList.toggle('sel', writing);
    if (readBtn) readBtn.classList.toggle('sel', !writing);
    if (body) body.style.display = writing ? 'flex' : 'none';
    if (readWrap) readWrap.style.display = writing ? 'none' : 'block';
    if (!writing) renderRead();
  }

  function renderRead() {
    if (!readBody) return;
    try {
      if (window.MathRender && window.MathRender.renderText) {
        window.MathRender.renderText(readBody, ta.value);
        /* KaTeX abhi load nahi hua (vendor slow/404) aur text mein $
           hai → chhoti hint, warna user ko lagega render toota hai */
        if (!window.MathRender.available() && String(ta.value).indexOf('\u0024') !== -1) {
          var warn = el('div', 'nr-empty',
            'Math engine (KaTeX) load nahi hua — formulas raw dikh rahe hain.');
          readBody.insertBefore(warn, readBody.firstChild);
        }
      } else {
        /* MathRender hi nahi hai → plain pre-wrap text (fail-safe) */
        readBody.innerHTML = '';
        var pre = el('div', 'nr-line');
        pre.appendChild(document.createTextNode(ta.value || 'Abhi kuch nahi likha — Write mein jao.'));
        readBody.appendChild(pre);
      }
    } catch (e) {
      readBody.innerHTML = '';
      readBody.appendChild(el('div', 'nr-empty', 'Read view render nahi ho paya.'));
    }
  }

  /* ================================================================
     PREV / NEXT NAVIGATION (topic list ke order mein, wrap ke saath)
  ================================================================ */
  function paintNavState() {
    var hasNav = !!(current && current.opts && current.opts.navigate);
    if (navSpacer) navSpacer.style.display = hasNav ? '' : 'none';
    if (prevBtn) prevBtn.style.display = hasNav ? '' : 'none';
    if (nextBtn) nextBtn.style.display = hasNav ? '' : 'none';
    if (!hasNav) return;
    /* single node → wrap par wahi node wapas aata hai → disabled */
    var single = true;
    try {
      var nx = current.opts.navigate(current.node, 1);
      single = !nx || nx === current.node || nx.id === current.node.id;
    } catch (e) { single = true; }
    if (prevBtn) { prevBtn.disabled = single; prevBtn.style.opacity = single ? '.45' : '1'; }
    if (nextBtn) { nextBtn.disabled = single; nextBtn.style.opacity = single ? '.45' : '1'; }
  }

  function gotoSibling(delta) {
    if (!current || !current.opts || !current.opts.navigate) return;
    if (prevBtn && prevBtn.disabled) return;
    var target = null;
    try { target = current.opts.navigate(current.node, delta); } catch (e) { target = null; }
    if (!target || target === current.node || target.id === current.node.id) return;
    var keep = viewMode;              /* Read→Read, Write→Write (user ka flow na toote) */
    var opts = current.opts;
    open(target, opts);               /* open() purane node ka pending save PEHLE flush karta hai */
    setView(keep);
  }

  /* ================================================================
     FORMULA EDITOR MODAL — Read view ke rendered formula par tap
     ------------------------------------------------------------
     • LaTeX source textarea + LIVE KaTeX preview (200ms debounce)
     • "Common patterns" cheatsheet chips — tap = cursor par insert
       (LaTeX na jaanne wale user ke liye trial-error aasan)
     • Save → notes text mein span ki jagah naya formula replace +
       auto-save + Read view re-render
  ================================================================ */
  var formulaModal = UI.modal({ zScrim: 92, zWrap: 93 });
  var editingSpan = null;

  var CHEATS = [
    { l: 'a⁄b', c: '\\frac{a}{b}' },
    { l: '√x', c: '\\sqrt{x}' },
    { l: 'x²', c: 'x^{2}' },
    { l: 'xᵢ', c: 'x_{i}' },
    { l: '∫', c: '\\int_{a}^{b} f(x)\\,dx' },
    { l: 'Σ', c: '\\sum_{i=1}^{n}' },
    { l: 'vec', c: '\\vec{a}' },
    { l: '±', c: '\\pm' },
    { l: '×', c: '\\times' },
    { l: '÷', c: '\\div' },
    { l: '≠', c: '\\neq' },
    { l: '≤', c: '\\leq' },
    { l: '≥', c: '\\geq' },
    { l: '≈', c: '\\approx' },
    { l: '∞', c: '\\infty' },
    { l: 'θ', c: '\\theta' },
    { l: 'ν', c: '\\nu' },
    { l: 'φ', c: '\\phi' },
    { l: 'ω', c: '\\omega' },
    { l: 'λ', c: '\\lambda' },
    { l: 'μ', c: '\\mu' },
    { l: '∂y⁄∂x', c: '\\frac{\\partial y}{\\partial x}' },
    { l: 'lim', c: '\\lim_{x \\to 0}' },
    { l: 'log', c: '\\log_{10}' },
    { l: '→', c: '\\rightarrow' },
    { l: 'chem', c: '\\ce{A + B -> C}' },
    { l: 'matrix', c: '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}' }
  ];

  function openFormulaEditor(span) {
    editingSpan = span;
    formulaModal.open(span.display ? 'Edit Formula (block)' : 'Edit Formula', function (mb) {
      mb.appendChild(el('label', null, 'LaTeX'));
      var src = el('textarea');
      src.rows = 3;
      src.value = span.latex;
      src.style.cssText = UI.fieldCss + ';resize:vertical;line-height:1.6;' +
        'font-family:var(--f-mono);font-size:13px';
      mb.appendChild(src);

      mb.appendChild(el('label', null, 'Preview'));
      var prev = el('div');
      prev.style.cssText = 'min-height:52px;padding:12px;border-radius:12px;' +
        'border:1px solid var(--s2);background:var(--card-bg);overflow-x:auto;text-align:center';
      mb.appendChild(prev);

      var prevTimer = null;
      function paintPrev() {
        try {
          prev.innerHTML = window.MathRender
            ? window.MathRender.renderMathHtml(src.value, span.display)
            : '';
        } catch (e) { }
      }
      function updatePreview() {
        if (prevTimer) window.clearTimeout(prevTimer);
        prevTimer = window.setTimeout(function () { prevTimer = null; paintPrev(); }, 200);
      }
      src.addEventListener('input', updatePreview);
      paintPrev();                     /* pehla render turant */

      /* cheatsheet : tap = cursor par insert */
      mb.appendChild(el('label', null, 'Common patterns (tap = insert)'));
      var cWrap = el('div', 'chips');
      cWrap.style.cssText = 'padding:0;flex-wrap:wrap;max-height:110px;overflow-y:auto';
      CHEATS.forEach(function (ch) {
        var b = el('button', 'chip', ch.l);
        b.type = 'button';
        b.style.fontSize = '11px';
        b.style.padding = '5px 10px';
        b.addEventListener('click', function () {
          var pos = src.selectionStart == null ? src.value.length : src.selectionStart;
          var posEnd = src.selectionEnd == null ? pos : src.selectionEnd;
          src.value = src.value.slice(0, pos) + ch.c + src.value.slice(posEnd);
          var np = pos + ch.c.length;
          src.focus();
          try { src.setSelectionRange(np, np); } catch (e) { }
          updatePreview();
        });
        cWrap.appendChild(b);
      });
      mb.appendChild(cWrap);

      mb._get = function () { return src.value; };
      window.setTimeout(function () { if (formulaModal.isOpen()) src.focus(); }, 260);
    }, function () {
      /* SAVE : notes text mein span replace */
      var newLatex = formulaModal.body._get ? formulaModal.body._get() : '';
      applyFormulaEdit(newLatex);
      formulaModal.close();
    });
  }

  function applyFormulaEdit(newLatex) {
    if (!editingSpan || !ta) return;
    var s = editingSpan;
    var d = s.display ? '\u0024\u0024' : '\u0024';   /* $$ ya $ */
    ta.value = ta.value.slice(0, s.start) + d + newLatex + d + ta.value.slice(s.end);
    editingSpan = null;
    touched = true;
    persistNow();          /* turant save (debounce ka wait nahi) */
    renderRead();          /* Read view fresh spans ke saath */
  }

  /* ================================================================
     AI POPUP (Phase 2) — ✨ button → ai/notes-ai.js
     Context ST.getStudyContext() se (subject/chapter naam tab set
     hote hain jab chapter view khulta hai) + node ka naam.
     Save par: text ta mein → auto-save persist → Read view par
     switch (result turant rendered dikhe).
  ================================================================ */
  function openAiPopup() {
    try {
      if (!window.NotesAI || !window.NotesAI.open) return;   /* file load na hui ho */
      var ctx = {};
      try {
        var sc = window.ST && window.ST.getStudyContext ? window.ST.getStudyContext() : null;
        if (sc) {
          ctx.subjectName = sc.subjectName || '';
          ctx.chapterName = sc.chapterName || '';
        }
      } catch (e) { }
      ctx.topicName = (current && current.node) ? (current.node.name || '') : '';
      window.NotesAI.open({
        context: ctx,
        existingText: ta ? ta.value : '',
        onSave: function (finalText) {
          if (!ta) return;
          ta.value = finalText;
          touched = true;
          persistNow();          /* turant save */
          setView('read');       /* AI notes turant rendered dikhein */
        }
      });
    } catch (e) { }
  }

  /* ================================================================
     AUTO-SAVE (debounce) + flush
  ================================================================ */
  function scheduleSave() {
    if (saveTimer) window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(function () {
      saveTimer = null;
      persistNow();
    }, SAVE_DEBOUNCE);
  }

  /* sirf tab likhte hain jab user ne kuch edit kiya ho — screen sirf
     KHOLNE se data touch nahi hota (indicator bhi nahi jalta) */
  function persistNow() {
    if (saveTimer) { window.clearTimeout(saveTimer); saveTimer = null; }
    if (!current || (!touched && !titleTouched)) return;
    try {
      var n = current.node;
      var o = current.opts || {};
      if (touched) n.notes = ta.value;
      if (titleTouched) n.notesTitle = titleInput.value;
      if (o.persist) o.persist();
      if (o.onSaved) o.onSaved();     /* topic.js rows refresh (indicator) */
    } catch (e) { }
  }

  /* ================================================================
     OPEN / CLOSE (SubjectSetting.js wala screen pattern)
  ================================================================ */
  function open(node, opts) {
    if (!node) return;
    if (current) persistNow();       /* pichla node pending tha to flush */
    current = { node: node, opts: opts || {} };
    touched = false;
    titleTouched = false;

    var s = ensureScreen();
    if (!s) return;

    titleInput.value = node.notesTitle || node.name || '';
    ta.value = node.notes || '';
    ta.scrollTop = 0;
    setView('write');                /* har open Write tab se shuru */
    paintNavState();                 /* Prev/Next : nav mila? single node? */

    /* jahan se khola, wahi yaad rakho — back par wahi wapas */
    var act = document.querySelector('section.screen.active');
    if (act && act !== s) prevScreen = act;

    if (window.SubjectListBridge && window.SubjectListBridge.show) {
      window.SubjectListBridge.show(s, true);
    } else {
      Array.prototype.forEach.call(document.querySelectorAll('section.screen'), function (x) {
        x.classList.remove('active');
      });
      s.classList.add('active');
    }
  }

  function close() {
    persistNow();                    /* back dabate hi pending save flush */
    if (!screen) return;
    var back = prevScreen;
    prevScreen = null;
    current = null;
    if (window.SubjectListBridge && window.SubjectListBridge.show) {
      if (back && document.body.contains(back)) { window.SubjectListBridge.show(back, false); return; }
      if (window.ST && window.ST.subjectScreen) { window.SubjectListBridge.show(window.ST.subjectScreen(), false); return; }
    }
    /* fallback (bridge ke bina) : notes hatao, prev screen wapas active */
    screen.classList.remove('active');
    if (back && document.body.contains(back)) back.classList.add('active');
  }

  function isOpen() {
    return !!(screen && screen.classList.contains('active'));
  }

  window.Notes = {
    open: open,
    close: close,
    isOpen: isOpen
  };
})();
