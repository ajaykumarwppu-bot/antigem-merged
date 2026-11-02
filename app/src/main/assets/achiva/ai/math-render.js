/* ================================================================
   AI / MATH-RENDER.JS — Notes rendering engine (Markdown + KaTeX)
   ----------------------------------------------------------------
   Notes ke Read view + AI Preview ka SINGLE renderer (koi doosra
   competing renderer nahi). Do paths, ek hi entry point :

   renderText(container, text)
     ├─ RICH PATH  (markdown-it + DOMPurify + KaTeX loaded ho):
     │    1. tokenize() math spans ko PEHLE nikalta hai (exact
     │       offsets ke saath) — LaTeX kabhi markdown parser ko
     │       touch nahi karta, isliye _ * | \\ jaise markdown
     │       characters formulas ko corrupt nahi kar sakte
     │    2. math ki jagah invisible PUA sentinels (𝐀idx𝐁)
     │    3. markdown-it render: # headings, - / 1. lists (nested),
     │       GFM tables, ---, **bold**, breaks:true (single Enter =
     │       line break), html:false (raw HTML kabhi parse nahi —
     │       literal text ban kar dikhta hai), linkify:true
     │    4. DOMPurify.sanitize() — SIRF markdown-generated HTML
     │       sanitize hota hai; sanitizer fail/absent ho to rich
     │       path use hi nahi hota (unsanitized innerHTML kabhi nahi)
     │    5. sentinels → KaTeX HTML (data-mi wrapper ke saath —
     │       tap-to-edit formula editor isi se chalta hai)
     └─ PLAIN PATH (fallback — purana system 100% untouched):
          text → createTextNode lines (.nr-line, pre-wrap) + math
          spans/divs. markdown-it ya DOMPurify na load ho (404/slow)
          to ye path chalta hai — content KABHI lost nahi hota.

   Math rules (dono paths same):
     dollar-dollar...dollar-dollar → display block (multiline ok)
     single dollar...single dollar → inline (same line, non-greedy)
     backslash-dollar → literal dollar
     akela/bina-jodi dollar → literal text

   Fail-safe layers: KaTeX absent → math raw text + notes.js hint;
   broken LaTeX → throwOnError:false red text; markdown/DOMPurify
   absent → plain path; render crash → textContent dump.

   Depends: vendor/katex (+mhchem), vendor/markdown-it, vendor/purify
   — sab OPTIONAL hain (graceful degrade). UI (el/esc). ES5-only.
   window.MathRender par expose.
   ================================================================ */

(function () {
  'use strict';

  if (window.__achivaMathRenderLoaded) return;
  window.__achivaMathRenderLoaded = true;

  var UIx = window.UI || {};
  function el(tag, cls) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    return node;
  }
  function escHtml(s) {
    if (UIx.esc) return UIx.esc(s);
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function katexReady() { return !!window.katex; }

  /* ---------- single formula → safe HTML ---------- */
  function renderMathHtml(latex, display) {
    if (!katexReady()) {
      /* engine abhi load nahi hua — raw dikhao (fail-safe) */
      return '<span class="nr-math-err">' +
        escHtml(display ? '\u0024\u0024' + latex + '\u0024\u0024' : '\u0024' + latex + '\u0024') + '</span>';
    }
    try {
      return window.katex.renderToString(latex, {
        throwOnError: false,     /* galat LaTeX → red text, crash nahi */
        displayMode: !!display,
        errorColor: '#c0392b'
      });
    } catch (e) {
      return '<span class="nr-math-err">' + escHtml(latex) + '</span>';
    }
  }

  /* ---------- tokenizer ----------
     Math tokens ke start/end ORIGINAL text ke offsets hain
     (delimiters sahit) — tap-edit par slice-replace isi se hota hai.
     Ye RICH aur PLAIN dono paths ka shared source hai. */
  function tokenize(text) {
    var tokens = [];
    var src = String(text == null ? '' : text);
    var n = src.length, i = 0;
    var buf = '', bufStart = 0;

    function flushText(end) {
      if (buf) { tokens.push({ type: 'text', value: buf, start: bufStart, end: end }); buf = ''; }
    }

    while (i < n) {
      var ch = src.charAt(i);

      /* backslash-dollar → literal dollar */
      if (ch === '\\' && src.charAt(i + 1) === '\u0024') {
        if (!buf) bufStart = i;
        buf += '\u0024'; i += 2; continue;
      }

      if (ch === '\u0024') {
        /* display block — closing pair dhoondho (multiline ok) */
        if (src.charAt(i + 1) === '\u0024') {
          var closeD = src.indexOf('\u0024\u0024', i + 2);
          if (closeD !== -1) {
            flushText(i);
            tokens.push({ type: 'display', value: src.slice(i + 2, closeD), start: i, end: closeD + 2 });
            i = closeD + 2; bufStart = i; continue;
          }
          /* jodi nahi mili → literal */
          if (!buf) bufStart = i;
          buf += '\u0024\u0024'; i += 2; continue;
        }
        /* inline — closing dollar SAME LINE par hona chahiye */
        var j = i + 1, found = -1;
        while (j < n) {
          var c = src.charAt(j);
          if (c === '\\' && src.charAt(j + 1) === '\u0024') { j += 2; continue; }
          if (c === '\n') break;
          if (c === '\u0024') { found = j; break; }
          j++;
        }
        if (found > i + 1) {   /* kam se kam 1 char beech mein */
          flushText(i);
          tokens.push({ type: 'inline', value: src.slice(i + 1, found), start: i, end: found + 1 });
          i = found + 1; bufStart = i; continue;
        }
        /* akela dollar → literal */
      }

      if (!buf) bufStart = i;
      buf += ch; i++;
    }
    flushText(n);
    return tokens;
  }

  /* ================================================================
     MARKDOWN (rich path) — markdown-it + DOMPurify
     ================================================================ */
  var mdInstance = null;
  function md() {
    if (!mdInstance && window.markdownit) {
      try {
        mdInstance = window.markdownit({
          html: false,        /* raw HTML parse NAHI — literal text (safe) */
          breaks: true,       /* single Enter = <br> (notes jaisa feel) */
          linkify: true,      /* URLs auto-link */
          typographer: false  /* quotes waise hi rahein (LaTeX fidelity) */
        });
      } catch (e) { mdInstance = null; }
    }
    return mdInstance;
  }
  function purifyReady() {
    try { return !!(window.DOMPurify && window.DOMPurify.sanitize); } catch (e) { return false; }
  }
  function richReady() { return !!(md() && purifyReady()); }

  /* PUA (private-use) sentinel characters — normal text mein kabhi
     nahi aate, markdown/DOMPurify inhe untouched text ki tarah
     pass karte hain, aur end mein exact index se replace hote hain. */
  var S_START = '\uE000', S_END = '\uE001';
  var S_RE = /\uE000(\d+)\uE001/g;

  function mathWrapperHtml(idx, katexHtml, display) {
    /* span hi rakhte hain (div nahi) — <p> ke andar bhi valid HTML;
       display:block CSS se (.nr-math-display) */
    return '<span class="' + (display ? 'nr-math-display' : 'nr-math-inline') + '"' +
      ' data-mi="' + idx + '" role="button" aria-label="Edit formula">' + katexHtml + '</span>';
  }

  /* rich path : true = success, false = caller plain path par jaye */
  function renderRich(container, tokens) {
    var m = md();
    if (!m || !purifyReady()) return false;

    var sentinelText = '';
    var mathHtml = [];
    tokens.forEach(function (t) {
      if (t.type === 'text') { sentinelText += t.value; return; }
      var idx = lastSpans.length;
      lastSpans.push({
        latex: t.value, start: t.start, end: t.end,
        display: t.type === 'display'
      });
      mathHtml.push(mathWrapperHtml(idx,
        renderMathHtml(t.value, t.type === 'display'),
        t.type === 'display'));
      sentinelText += S_START + idx + S_END;
    });

    var html;
    try { html = m.render(sentinelText); } catch (e) { return false; }
    try { html = window.DOMPurify.sanitize(html); } catch (e) { return false; }
    if (typeof html !== 'string') return false;

    html = html.replace(S_RE, function (_, i) {
      var h = mathHtml[parseInt(i, 10)];
      return h == null ? '' : h;
    });
    container.innerHTML = html;
    return true;
  }

  /* ================================================================
     PLAIN PATH (fallback) — purana renderer, bilkul untouched
     ================================================================ */
  var lastSpans = [];

  function renderPlain(container, tokens) {
    var line = null;

    function ensureLine() {
      if (!line) { line = el('div', 'nr-line'); container.appendChild(line); }
      return line;
    }

    tokens.forEach(function (t) {
      if (t.type === 'text') {
        var parts = t.value.split('\n');
        for (var k = 0; k < parts.length; k++) {
          if (k > 0) line = null;              /* newline → nayi line */
          if (parts[k]) ensureLine().appendChild(document.createTextNode(parts[k]));
          else if (k > 0) ensureLine();        /* khaali line → blank row */
        }
        return;
      }
      var idx = lastSpans.length;
      lastSpans.push({
        latex: t.value, start: t.start, end: t.end,
        display: t.type === 'display'
      });
      var holder = el(t.type === 'display' ? 'div' : 'span',
        t.type === 'display' ? 'nr-math-display' : 'nr-math-inline');
      holder.setAttribute('data-mi', String(idx));
      holder.setAttribute('role', 'button');
      holder.setAttribute('aria-label', 'Edit formula');
      holder.innerHTML = renderMathHtml(t.value, t.type === 'display');
      if (t.type === 'display') { line = null; container.appendChild(holder); }
      else ensureLine().appendChild(holder);
    });
  }

  /* ---------- main entry (dono paths) ----------
     Return: mathSpans[] — tap-to-edit registry. */
  function renderText(container, text) {
    container.innerHTML = '';
    lastSpans = [];
    var tokens = tokenize(text);

    var ok = false;
    if (richReady()) {
      try { ok = renderRich(container, tokens); } catch (e) { ok = false; }
    }
    if (!ok) {
      /* rich path unavailable/fail → PLAIN fallback (content safe) */
      container.innerHTML = '';
      lastSpans = [];
      try {
        renderPlain(container, tokens);
      } catch (e2) {
        /* absolute last resort : raw text as text node (kabhi lost nahi) */
        container.appendChild(document.createTextNode(String(text == null ? '' : text)));
      }
    }

    if (!container.childNodes.length) {
      var ph = el('div', 'nr-empty', 'Abhi kuch nahi likha — Write mein jao.');
      container.appendChild(ph);
    }
    return lastSpans;
  }

  window.MathRender = {
    available: katexReady,
    richReady: richReady,          /* markdown+purify ready? (tests/debug) */
    tokenize: tokenize,
    renderText: renderText,
    renderMathHtml: renderMathHtml,
    getSpans: function () { return lastSpans; }
  };
})();
