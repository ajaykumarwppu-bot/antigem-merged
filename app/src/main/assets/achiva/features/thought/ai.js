/* ================================================================
   FEATURES / THOUGHT / AI.JS — Thought ka AI bridge (2 stages)
   ----------------------------------------------------------------
   STAGE 1 — TRANSCRIPT (AUDIO category ka AI) :
     Process button → recording blob → us provider ko jo AUDIO
     category mein chosen hai (thought ka apna pick > app audio
     default) → VERBATIM transcript, usi bhasha mein jo boli gayi.
   STAGE 2 — SUMMARY / STRUCTURED (NORMAL category ka AI) :
     "Extract Summary" button → transcript → NORMAL category ka
     chosen provider → JSON structured output (summary/points/
     mistakes/actions/suggestedCategories) — values SIMPLE HINGLISH.
   • Prompts isi file mein (feature ka dimaag); connection ai/ se.
   • Per-feature picks : 'achiva.thought.aiPick.v1' =
       { tr: <audio provider id>, st: <normal provider id> }
     (purana string format auto-migrate hota hai)
   • Hooks : window.ThoughtProcessRun (stage-1),
             window.ThoughtExtractRun (stage-2) — main.js dabata hai.
   • Test hook : window.__ACHIVA_THOUGHT_AI_TEST = fn(blob) → stage-1
     aur __ACHIVA_THOUGHT_EXTRACT_TEST = fn(transcript) → stage-2.
   • ES5-only.
   ================================================================ */

(function () {
  'use strict';

  if (window.__achivaThoughtAiLoaded) return;
  window.__achivaThoughtAiLoaded = true;

  var el = UI.el, esc = UI.esc;
  var PICK_KEY = 'achiva.thought.aiPick.v1';

  /* ---------- prompts ----------
     NOTE : ye dono prompts USER KI DI HUI app.js (Rhizome) se
     SAME-TO-SAME liye gaye hain — sirf prompts, baaki kuch nahi.
     Prompt #2 = verbatim transcript · Prompt #3 = refinement */
  var TRANSCRIPT_PROMPT =
    'You are a professional transcription assistant. Your ONLY task is to transcribe the audio file word-for-word.\n' +
    'CRITICAL REQUIREMENTS:\n' +
    '- Transcribe EVERY single word from start to finish without exception\n' +
    '- Include ALL filler words (um, uh, like, you know, etc.), false starts, repetitions, and stutters exactly as spoken\n' +
    '- Do NOT summarize, paraphrase, condense, or omit ANY portion of the audio\n' +
    '- Do NOT add any commentary, analysis, or structured formatting\n' +
    '- Continue transcribing until the audio ends completely\n' +
    '- If the audio is long, use your full token capacity to capture everything\n' +
    '- Return ONLY the raw transcript text, nothing else\n' +
    '\n' +
    'Your output must be the complete verbatim transcript of the entire audio.';

  var STRUCT_SYSTEM =
    'You are a knowledge refinement assistant. You will receive a raw transcript.\n' +
    'Your task is to transform it into a clean, structured version:\n' +
    '- Organize content into clear PARTS (major themes) and POINTS (specific ideas)\n' +
    '- Remove all filler words, false starts, repetitions, and verbal tics\n' +
    '- Structure ideas hierarchically with logical flow\n' +
    '- Use numbered points, bullet points, and clear paragraph breaks\n' +
    '- Label each major section with descriptive headers (Part 1, Part 2, etc.)\n' +
    '- Preserve the EXACT meaning without adding external information\n' +
    '- Extract key insights and conclusions\n' +
    '\n' +
    'Return ONLY the refined text, no explanations.';

  /* ---------- per-feature picks (do roles) ---------- */
  function readPick() {
    var v = null;
    try { v = window.AppStorage.loadAt(PICK_KEY); } catch (e) { v = null; }
    if (typeof v === 'string') v = { tr: v, st: v };      /* purana format migrate */
    if (!v || typeof v !== 'object') v = { tr: '', st: '' };
    return v;
  }
  function writePick(v) { window.AppStorage.saveAt(PICK_KEY, v); }
  function pickedId(role) { return readPick()[role === 'tr' ? 'tr' : 'st'] || ''; }
  function setPickedId(role, id) {
    var v = readPick();
    if (role === 'tr') v.tr = id || '';
    else v.st = id || '';
    writePick(v);
  }
  /* role 'st' → NORMAL category (thought pick → app normal default)
     role 'tr' → user ka audio pick; AGAR KUCH NAHI CHUNA to wahi AI
     jo refinement ('st') ke liye hai — user ka apna decision */
  function pickedCfg(role) {
    if (!window.AchivaAIHub) return null;
    if (role === 'tr') {
      var idTr = pickedId('tr');
      if (idTr) {
        var cTr = window.AchivaAIHub.get(idTr);
        if (cTr) return cTr;
      }
      return pickedCfg('st');
    }
    var id = pickedId('st');
    if (id) {
      var c = window.AchivaAIHub.get(id);
      if (c) return c;
    }
    return window.AchivaAIHub.getActive('normal');
  }

  /* ---------- Choose sheet : do groups (audio + normal) ---------- */
  function openChoose() {
    var m = UI.modal({ zScrim: 94, zWrap: 95 });
    m.open('Choose AI — Thought', function (body) {
      var info = el('div', null, 'Do roles : AUDIO (transcript) aur NORMAL (refinement/summary). ' +
        'Audio mein kuch NAHI chuna to transcript bhi usi AI se banegi jo refinement ke liye hai — ' +
        'yani ek hi AI dono kaam karega. Alag chahiye to audio ke liye alag card chuno.');
      info.style.cssText = 'font-size:11px;color:var(--ash);line-height:1.6;margin-bottom:10px';
      body.appendChild(info);

      function group(title, role, cat) {
        var t = el('div', null, title);
        t.style.cssText = 'font-size:9.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;' +
          'color:var(--slate);margin:10px 0 4px';
        body.appendChild(t);
        var cur = pickedId(role);
        function row(label, id, isDefault) {
          var on = (id === '' && !cur) || (id !== '' && cur === id);
          var r = el('div');
          r.style.cssText = 'display:flex;align-items:center;gap:9px;padding:8px 2px;cursor:pointer;' +
            'border-bottom:1px solid var(--line)';
          r.appendChild(UI.roundCheck(on));
          var nm = el('div', null, UI.esc(label));
          nm.style.cssText = 'flex:1;font-size:12.5px;font-weight:' + (on ? '700' : '500') + ';color:var(--ink)';
          r.appendChild(nm);
          if (isDefault) {
            var d = UI.chip('default');
            d.style.cssText += ';font-size:9px';
            r.appendChild(d);
          }
          r.addEventListener('click', function () { setPickedId(role, id); m.close(); });
          body.appendChild(r);
        }
        if (role === 'tr') {
          /* NOTHING = transcript bhi refinement wale AI se */
          row('Kuch nahi — refinement wala hi AI use hoga', '', true);
        } else {
          var def = window.AchivaAIHub.getActive('normal');
          row('App default' + (def ? ' (' + def.provider + ' · ' + (def.model || def.audioModel || 'default') + ')' : ' (koi nahi)'), '', true);
        }
        window.AchivaAIHub.list().forEach(function (c) {
          var ck = window.AchivaAIHub.catOf(c);
          if (!(ck === 'both' || ck === cat)) return;
          var mName = (cat === 'audio') ? (c.audioModel || c.model || 'default') : (c.model || c.audioModel || 'default');
          row(c.provider + ' · ' + mName, c.id, false);
        });
      }
      group('Audio AI (transcript) — alag AI chahiye to chuno, warna kuch nahi', 'tr', 'audio');
      group('Normal AI (refinement/summary)', 'st', 'normal');
      if (!window.AchivaAIHub.list().length) {
        var add = UI.pillBtn('+ Settings → AI mein add karo');
        add.style.marginTop = '10px';
        add.addEventListener('click', function () {
          m.close();
          if (window.AchivaAIHubSettings) window.AchivaAIHubSettings.open();
        });
        body.appendChild(add);
      }
    }, null);
  }

  /* ---------- helpers ---------- */
  function fail(msg) { return { ok: false, error: msg }; }
  function arr(v) { return Array.isArray(v) ? v : (v ? [String(v)] : []); }
  function normStruct(st) {
    st = st || {};
    return {
      summary: String(st.summary || ''),
      points: arr(st.points).map(String),
      mistakes: arr(st.mistakes).map(String),
      actions: arr(st.actions).map(String),
      suggestedCategories: arr(st.suggestedCategories).map(String)
    };
  }

  /* normal-text fallback parse (sections) — JSON na ban to */
  function parseSections(text) {
    var t = String(text || '').trim();
    if (!t) return null;
    var asJson = window.AchivaAIHub.extractJson(t);
    if (asJson && (asJson.summary || asJson.points)) {
      return { language: String(asJson.language || ''), structured: normStruct(asJson.structured || asJson) };
    }
    var out = { language: '', structured: { summary: '', points: [], mistakes: [], actions: [], suggestedCategories: [] } };
    var cur = null, saw = false;
    var HEAD = /^\s*(LANGUAGE|SUMMARY|POINTS?|MISTAKES?|ACTIONS?|(?:SUGGESTED\s+)?CATEGORIES)\s*:\s*(.*)$/i;
    t.split(/\r?\n/).forEach(function (line) {
      var m = line.match(HEAD);
      if (m) {
        saw = true;
        var k = m[1].toLowerCase().replace(/s$/, '');
        cur = (k === 'point') ? 'points' : (k === 'mistake') ? 'mistakes' : (k === 'action') ? 'actions'
          : (k.indexOf('categor') === 0) ? 'suggestedCategories' : k;
        var rest = m[2].trim();
        if (rest) push(rest);
        return;
      }
      if (!cur) return;
      var v = line.replace(/^\s*[-*•]\s*/, '').trim();
      if (v) push(v);
    });
    function push(v) {
      if (cur === 'points' || cur === 'mistakes' || cur === 'actions' || cur === 'suggestedCategories') out.structured[cur].push(v);
      else if (cur === 'summary') out.structured.summary = out.structured.summary ? out.structured.summary + ' ' + v : v;
      else if (cur === 'language') out.language = v;
    }
    if (!saw) out.structured.summary = t;
    return out;
  }

  /* ---------- STAGE 1 : transcript (AUDIO AI) ---------- */
  function process(rec) {
    try {
      var hook = window.__ACHIVA_THOUGHT_AI_TEST;
      if (hook && typeof hook === 'function') {
        return Promise.resolve(hook(rec && rec.blob)).then(function (res) {
          if (!res || res.ok === false) return fail((res && res.error) || 'Test provider fail');
          return { ok: true, transcript: String(res.transcript || res.text || ''), language: String(res.language || ''), provider: 'test' };
        });
      }
      var blobDirect = (rec && rec.blob) ? rec.blob : null;
      var blobP = blobDirect
        ? Promise.resolve(blobDirect)
        : ((rec && rec.audioId && window.ThoughtStore)
          ? new Promise(function (res) { window.ThoughtStore.audioGet(rec.audioId, function (b) { res(b || null); }); })
          : Promise.resolve(null));
      return blobP.then(function (blob) {
        if (!blob) return fail('Recording blob nahi mili — audio save nahi thi ya delete ho chuki hai.');
        if (!window.AchivaAIHub || !window.AchivaAIAudio) return fail('AI system load nahi hua — page reload karo.');
        var cfg = pickedCfg('tr');
        if (!cfg || !cfg.key) {
          return fail('Koi AI available nahi — Settings → AI mein provider add karo, ya Thought ke [AI] button se chuno.');
        }
        if (cfg.provider === 'gemini') {
          /* gemini : is file ka apna TRANSCRIPT_PROMPT (verbatim + same language) */
          return window.AchivaAIAudio.audioText(blob, TRANSCRIPT_PROMPT, cfg, rec && rec.ext).then(function (res) {
            if (!res.ok) return res;
            var t = String(res.text || '').trim().replace(/^\s*TRANSCRIPT\s*:\s*/i, '');
            if (!t) return fail('Transcript khali aayi — audio saaf nahi hai?');
            return { ok: true, transcript: t, language: '', provider: cfg.provider };
          });
        }
        return window.AchivaAIAudio.transcribe(blob, cfg, rec && rec.ext).then(function (res) {
          if (!res.ok) return res;
          if (!res.text) return fail('Transcript khali aayi — audio saaf nahi hai?');
          return { ok: true, transcript: String(res.text), language: '', provider: cfg.provider };
        });
      });
    } catch (e) {
      return Promise.resolve(fail('AI call shuru nahi hui — ' + (e && e.message ? e.message : 'unknown')));
    }
  }

  /* ---------- STAGE 2 : summary/structured (NORMAL AI) ---------- */
  function extract(rec) {
    try {
      var hook = window.__ACHIVA_THOUGHT_EXTRACT_TEST;
      if (hook && typeof hook === 'function') {
        return Promise.resolve(hook(rec && rec.transcript)).then(function (res) {
          if (!res || res.ok === false) return fail((res && res.error) || 'Test provider fail');
          return { ok: true, structured: normStruct(res.structured), language: String(res.language || '') };
        });
      }
      var tr = (rec && rec.transcript) || '';
      if (!tr) return fail('Pehle transcript chahiye — Process (stage 1) poora karo.');
      if (!window.AchivaAIHub) return fail('AI system load nahi hua — page reload karo.');
      var cfg = pickedCfg('st');
      if (!cfg || !cfg.key) {
        return fail('NORMAL category mein koi AI selected nahi — Settings → AI mein Normal category ka card chuno/add karo.');
      }
      /* refinement prompt NORMAL text maangta hai ("Return ONLY the
         refined text") — isliye JSON force NAHI; wahi user-message
         wrap jo source app use karti thi */
      return window.AchivaAIHub.chat({
        system: STRUCT_SYSTEM,
        user: 'Refine this transcript:\n\n' + tr,
        maxTokens: 8192,
        cfg: cfg
      }).then(function (res) {
        if (!res.ok) return res;
        var ps = parseSections(res.text);
        if (!ps) return fail('AI ka refined jawab samajh nahi aaya — dobara try karo.');
        return { ok: true, structured: ps.structured, language: ps.language };
      });
    } catch (e) {
      return Promise.resolve(fail('AI call shuru nahi hui — ' + (e && e.message ? e.message : 'unknown')));
    }
  }

  window.ThoughtProcessRun = process;      /* stage 1 */
  window.ThoughtExtractRun = extract;      /* stage 2 */
  window.ThoughtAI = {
    process: process,
    extract: extract,
    parse: parseSections,
    openChoose: openChoose,
    pickedCfg: pickedCfg,
    pickedId: pickedId,
    setPickedId: setPickedId
  };
})();
