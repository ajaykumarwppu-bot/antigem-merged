/* ================================================================
   AI / NOTES-AI.JS — Notes screen ka ✨ AI button (Phase 2)
   ----------------------------------------------------------------
   ZERO-API design : app kisi AI ko call NAHI karta. Flow :

     1. Notes screen ka AI button → ye popup khulta hai
     2. [Copy Prompt] → 3-level prompt clipboard par :
          • universal rules (kab FINALIZE karna hai, markers)
          • EXACT output format — MARKDOWN (headings/lists/tables/hr)
            + wahi Phase-1 verified $...$/$...$ KaTeX math
            (\ce chemistry, \text, matrices) — renderer math ko
            markdown se PEHLE extract karta hai, isliye mix safe hai
          • current context (subject → chapter → topic + existing
            notes taaki AI duplicate na kare, aage badhaye)
     3. User kisi bhi AI (ChatGPT/Claude/Gemini/Grok) mein prompt
        paste kare → baat kare → "FINALIZE FOR ACHIVA" bole
     4. AI output ko (markers ke saath ya bina) paste-box mein
        paste kare → [Preview] → EXACT wahi KaTeX render jo Read
        view mein hota hai (math-render.js) — jo dikhega wahi save
     5. [Save to Notes] → append (default) ya replace mode mein
        node.notes mein merge → notes.js callback se persist +
        Read view par switch

   • Extraction order : ===ACHIVA-NOTES-START/END=== markers →
     ```text fence → poora pasted text (fail-safe)
   • Prompt AI ko kehta hai final output ke SAATH ek short PREVIEW
     (sections + formulas list) markers ke BAHAR bhi de — user
     copy karne se pehle verify kar sake.
   • Clipboard : navigator.clipboard + execCommand fallback
     (Android WebView safe), dono fail to prompt paste-box mein.
   ES5-only. window.NotesAI = { open(opts), buildPrompt, extractNotes }
   ================================================================ */

(function () {
  'use strict';

  if (window.__achivaNotesAiLoaded) return;
  window.__achivaNotesAiLoaded = true;

  var el = UI.el;

  var MARK_START = '===ACHIVA-NOTES-START===';
  var MARK_END = '===ACHIVA-NOTES-END===';
  var EXISTING_CAP = 4000;   /* prompt mein existing notes ka max size */

  var ICON_COPY = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
  var ICON_EYE = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>';

  /* ================================================================
     PROMPT BUILDER — 3 levels (universal + format + context)
     Format wahi hai jo Phase 1 mein live verify hua (52/52 formulas)
  ================================================================ */
  function buildPrompt(ctx) {
    ctx = ctx || {};
    var existing = String(ctx.existingText || '').trim();
    if (existing.length > EXISTING_CAP) existing = existing.slice(0, EXISTING_CAP) + '\n…(truncated)';

    var P = [];
    P.push('You are writing study notes for ACHIVA, a study-tracker app.');
    P.push('The user will paste your FINAL output directly into the app.');
    P.push('The app renders it as PLAIN TEXT + KaTeX math. Follow everything below exactly.');
    P.push('');
    P.push('--- CURRENT CONTEXT ---');
    P.push('Subject: ' + (ctx.subjectName || '(not set)'));
    P.push('Chapter: ' + (ctx.chapterName || '(not set)'));
    P.push('Topic: ' + (ctx.topicName || '(not set)'));
    P.push('Existing notes of this topic (improve/extend these, do NOT duplicate):');
    P.push('"""');
    P.push(existing || '(none yet)');
    P.push('"""');
    P.push('');
    P.push('--- OUTPUT FORMAT (strict — the app can render ONLY this) ---');
    P.push('1. Language: write notes in the SAME language the user is using (Hinglish question → Hinglish notes).');
    P.push('2. Markdown IS supported and encouraged: # / ## / ### headings, "- " bullets, "1. " numbered lists, nested lists (2-space indent), GitHub tables (| A | B | with a |---|---| separator row), "---" horizontal rules, **bold**, *italic*, > quotes, and ``` code blocks.');
    P.push('3. Do NOT use raw HTML tags (<b>, <div>, <br> etc.) — they are NOT parsed and will show as literal text.');
    P.push('4. A single line break stays a visible line break (breaks mode is ON) — write naturally, line by line. Use a blank line between sections.');
    P.push('5. Inline math: SINGLE dollar signs, stays on ONE line:  $E = h\\nu$');
    P.push('6. Block math: DOUBLE dollar signs on their own line, blank line above and below:');
    P.push('$$K_{max} = h\\nu - \\phi$$');
    P.push('7. Inside $...$ / $$...$$ use standard LaTeX (KaTeX-compatible):');
    P.push('   \\frac{a}{b}   \\sqrt{x}   \\sqrt[3]{x}   x^{2}   x_{i}   \\vec{F}');
    P.push('   \\int_{a}^{b}   \\sum_{i=1}^{n}   \\lim_{x \\to 0}   \\log_{10}');
    P.push('   Greek: \\alpha \\beta \\gamma \\theta \\nu \\phi \\lambda \\mu \\omega');
    P.push('   Symbols: \\times \\div \\pm \\approx \\neq \\leq \\geq \\infty \\rightarrow \\propto');
    P.push('   Text inside math: \\text{eV·nm}');
    P.push('   Chemistry equations: \\ce{H2SO4 + 2NaOH -> Na2SO4 + 2H2O}');
    P.push('   Matrix: \\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}');
    P.push('8. A literal dollar sign in normal text must be escaped:  \\$');
    P.push('9. Keep formulas exact; numbers in decimals where natural.');
    P.push('10. Math and Markdown mix freely: formulas can live inside headings, list items, table cells or bold lines — the app extracts all math BEFORE markdown parsing, so LaTeX never breaks.');
    P.push('');
    P.push('--- WORKFLOW ---');
    P.push('- First talk normally: explain, discuss, ask clarifying questions, use anything the user shares (PDFs, text, ideas). While discussing, do NOT use the strict format above.');
    P.push('- ONLY when the user says "FINALIZE FOR ACHIVA" (or clearly asks for final app-ready notes), reply in TWO parts:');
    P.push('  PART 1 — PREVIEW (outside the markers): a short summary so the user can verify BEFORE copying:');
    P.push('     • list of sections included');
    P.push('     • list of every formula used (plain readable form)');
    P.push('     • approximate length');
    P.push('  PART 2 — the COMPLETE final notes between these exact marker lines:');
    P.push(MARK_START);
    P.push('(full final notes here, in the exact format above)');
    P.push(MARK_END);
    P.push('- Inside the markers: ONLY the notes text. No comments, no explanations.');
    P.push('- The app auto-extracts whatever is between the markers.');
    return P.join('\n');
  }

  /* ================================================================
     EXTRACTION : markers → ```fence → full text
  ================================================================ */
  function extractNotes(pasted) {
    var s = String(pasted == null ? '' : pasted);
    var i = s.indexOf(MARK_START);
    if (i !== -1) {
      var j = s.indexOf(MARK_END, i + MARK_START.length);
      if (j !== -1) return s.slice(i + MARK_START.length, j).replace(/^\s+|\s+$/g, '');
      /* start mila, end nahi — start ke baad ka sab le lo */
      return s.slice(i + MARK_START.length).replace(/^\s+|\s+$/g, '');
    }
    var f = s.match(/```(?:text|txt|plain|notes)?\s*\n([\s\S]*?)```/);
    if (f) return f[1].replace(/^\s+|\s+$/g, '');
    return s.replace(/^\s+|\s+$/g, '');
  }

  /* ================================================================
     CLIPBOARD (WebView-safe : navigator.clipboard + execCommand)
  ================================================================ */
  function copyText(text, cb) {
    try {
      if (window.navigator && navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { cb(true); }, function () { fallbackCopy(text, cb); });
        return;
      }
    } catch (e) { }
    fallbackCopy(text, cb);
  }
  function fallbackCopy(text, cb) {
    try {
      var t = document.createElement('textarea');
      t.value = text;
      t.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
      document.body.appendChild(t);
      t.focus(); t.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e2) { ok = false; }
      document.body.removeChild(t);
      cb(!!ok);
    } catch (e) { cb(false); }
  }

  /* ================================================================
     POPUP UI
  ================================================================ */
  var modal = UI.modal({ zScrim: 90, zWrap: 91, width: 'min(560px, calc(100% - 24px))', saveLabel: 'Save to Notes' });
  var saveMode = 'append';
  var curOpts = null;

  function actionBtn(iconHtml, label) {
    var b = el('button', null, iconHtml + ' <span>' + label + '</span>');
    b.type = 'button';
    b.style.cssText = 'display:inline-flex;align-items:center;gap:7px;padding:9px 16px;' +
      'border-radius:99px;border:1px solid var(--s2);background:var(--chip-bg);font:inherit;' +
      'font-size:12.5px;font-weight:600;color:var(--ink2);cursor:pointer;' +
      'box-shadow:inset 0 1px 0 var(--hl-soft)';
    return b;
  }

  function open(opts) {
    curOpts = opts || {};
    saveMode = 'append';

    modal.open('AI Notes', function (mb) {
      mb.style.cssText = 'max-height:58vh;overflow-y:auto';

      /* step hint */
      var hint = el('div', null,
        '1. Copy Prompt → kisi bhi AI (ChatGPT/Claude/Gemini) mein paste karo<br>' +
        '2. Baat karo; final mein bolo: <b>FINALIZE FOR ACHIVA</b><br>' +
        '3. AI ka output yahan paste karo → Preview → Save');
      hint.style.cssText = 'font-size:11.5px;line-height:1.6;color:var(--ash);margin-bottom:10px';
      mb.appendChild(hint);

      /* status line */
      var status = el('div', '');
      status.style.cssText = 'font-size:11.5px;line-height:1.5;color:var(--steel);min-height:16px;margin:6px 0 2px';
      function say(msg) { status.innerHTML = msg; }

      /* Copy Prompt row */
      var copyRow = el('div');
      copyRow.style.cssText = 'display:flex;gap:8px;align-items:center;flex-wrap:wrap';
      var copyBtn = actionBtn(ICON_COPY, 'Copy Prompt');
      copyBtn.addEventListener('click', function () {
        var prompt = buildPrompt({
          subjectName: (curOpts.context || {}).subjectName,
          chapterName: (curOpts.context || {}).chapterName,
          topicName: (curOpts.context || {}).topicName,
          existingText: curOpts.existingText
        });
        copyText(prompt, function (ok) {
          if (ok) say('Prompt copy ho gaya ✓ — ab kisi bhi AI mein paste karo.');
          else {
            say('Copy fail hua — prompt paste-box mein daal diya, manual copy kar lo.');
            pasteTa.value = prompt;
          }
        });
      });
      copyRow.appendChild(copyBtn);
      mb.appendChild(copyRow);
      mb.appendChild(status);

      /* save mode chips */
      mb.appendChild(el('label', null, 'Save mode'));
      var modeRow = el('div', 'chips');
      modeRow.style.cssText = 'padding:0';
      var appendChip = el('button', 'chip sel', 'Neeche jodo (append)');
      var replaceChip = el('button', 'chip', 'Poora badlo (replace)');
      appendChip.type = 'button'; replaceChip.type = 'button';
      function paintMode() {
        appendChip.classList.toggle('sel', saveMode === 'append');
        replaceChip.classList.toggle('sel', saveMode === 'replace');
      }
      appendChip.addEventListener('click', function () { saveMode = 'append'; paintMode(); });
      replaceChip.addEventListener('click', function () { saveMode = 'replace'; paintMode(); });
      modeRow.appendChild(appendChip);
      modeRow.appendChild(replaceChip);
      mb.appendChild(modeRow);

      /* paste box */
      mb.appendChild(el('label', null, 'AI ka output paste karo'));
      var pasteTa = el('textarea');
      pasteTa.rows = 7;
      pasteTa.placeholder = 'AI ka poora jawab yahan paste kar do — markers (===ACHIVA-NOTES-…) ke saath ya bina, app khud nikaal lega.';
      pasteTa.style.cssText = UI.fieldCss + ';resize:vertical;line-height:1.55;font-size:12.5px';
      mb.appendChild(pasteTa);

      /* Preview row */
      var prevRow = el('div');
      prevRow.style.cssText = 'display:flex;gap:8px;align-items:center;margin-top:10px';
      var prevBtn = actionBtn(ICON_EYE, 'Preview');
      prevRow.appendChild(prevBtn);
      var stats = el('span', '');
      stats.style.cssText = 'font-size:11px;color:var(--ash)';
      prevRow.appendChild(stats);
      mb.appendChild(prevRow);

      /* preview area — Read view jaisa hi KaTeX render */
      var preview = el('div', 'notes-read');
      preview.style.cssText = 'margin-top:8px;padding:12px 14px;border:1.5px dashed var(--s3);' +
        'border-radius:12px;background:var(--card-bg);max-height:220px;overflow-y:auto;' +
        'font-size:13px;line-height:1.7';
      preview.appendChild(el('div', 'nr-empty', 'Preview yahan dikhega'));
      mb.appendChild(preview);

      prevBtn.addEventListener('click', function () {
        var text = extractNotes(pasteTa.value);
        if (!text) { say('Pehle AI ka output paste karo — box khaali hai.'); return; }
        try {
          if (window.MathRender && window.MathRender.renderText) {
            window.MathRender.renderText(preview, text);
            var nMath = preview.querySelectorAll('.katex').length;
            var nErr = preview.querySelectorAll('.katex-error, .nr-math-err').length;
            say(nErr
              ? 'Preview ready — ' + nErr + ' formula mein dikkat hai (red dikhega), AI se theek karwao.'
              : 'Preview ready ✓ — ' + nMath + ' formulas render hue.');
            stats.textContent = nMath + ' math · ' + text.split('\n').length + ' lines';
          } else {
            say('MathRender load nahi hua — preview plain dikha rahe hain.');
          }
        } catch (e) {
          say('Preview mein error: ' + (e && e.message ? e.message : 'unknown'));
        }
      });

      mb._getPaste = function () { return pasteTa.value; };
      mb._getStatus = function () { return status; };
    }, function () {
      /* SAVE */
      var text = extractNotes(mb_get());
      if (!text) {
        var st = modal.body._getStatus ? modal.body._getStatus() : null;
        if (st) st.innerHTML = 'Paste box khaali hai — save kuch nahi hua.';
        return;                                   /* modal khula rahe */
      }
      var existing = String(curOpts.existingText || '');
      var finalText = saveMode === 'replace'
        ? text
        : (existing.replace(/\s+$/, '') ? existing.replace(/\s+$/, '') + '\n\n' + text : text);
      if (curOpts.onSave) curOpts.onSave(finalText);
      modal.close();
    });

    function mb_get() {
      return modal.body && modal.body._getPaste ? modal.body._getPaste() : '';
    }
  }

  window.NotesAI = {
    open: open,
    buildPrompt: buildPrompt,
    extractNotes: extractNotes,
    MARK_START: MARK_START,
    MARK_END: MARK_END
  };
})();
