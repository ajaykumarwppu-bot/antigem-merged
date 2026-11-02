/* ================================================================
   AI / AUDIO.JS — audio transport (engine ke active provider par)
   ----------------------------------------------------------------
   • transcribe(blob, cfg?)  → { ok, text }  (verbatim transcript)
       - openai / custom : /v1/audio/transcriptions (multipart)
       - gemini          : audioText se transcript-section parse karke
       - anthropic       : audio support nahi → saaf Hinglish error
   • audioText(blob, prompt, cfg?) → { ok, text }
       - sirf Gemini (inline audio) — response NORMAL TEXT hota hai,
         JSON force NAHI hota (feature khud parse karta hai)
   • cfg na do to engine ka ACTIVE (green tick wala) provider use
     hota hai — yaani feature ko provider choose karne ka kaam
     nahi, sirf blob + prompt bhejna hai.
   • ES5-only.
   ================================================================ */

(function () {
  'use strict';

  if (window.__achivaAiAudioLoaded) return;
  window.__achivaAiAudioLoaded = true;

  function fail(msg) { return { ok: false, error: msg }; }

  /* ---------- file extension sanitize ----------
     MediaRecorder ka mime 'audio/webm;codecs=opus' jaisa hota hai —
     ';codecs=...' ke saath filename bhejo to transcription server
     400 deta hai ("file must be one of the following types").
     Isliye : upload ka asli filename extension > blob.type ka
     saaf hissa > whitelist > fallback 'webm'. */
  var OK_EXT = { flac: 1, mp3: 1, mp4: 1, mpeg: 1, mpga: 1, m4a: 1, ogg: 1, wav: 1, webm: 1 };
  function extOf(blob, hint) {
    var h = String(hint || '').split('?')[0];
    var m = h.match(/\.([a-z0-9]{2,5})$/i);
    if (m && OK_EXT[m[1].toLowerCase()]) return m[1].toLowerCase();
    var t = String((blob && blob.type) || '').split(';')[0].split('/')[1] || '';
    t = t.toLowerCase();
    if (OK_EXT[t]) return t;
    return 'webm';
  }
  function cfgOf(cfg) {
    if (cfg) return cfg;
    return (window.AchivaAIHub && window.AchivaAIHub.getActive()) || null;
  }
  function toBase64(blob) {
    return new Promise(function (resolve, reject) {
      try {
        var fr = new FileReader();
        fr.onload = function () {
          var s = String(fr.result || '');
          var i = s.indexOf(',');
          resolve(i >= 0 ? s.slice(i + 1) : s);
        };
        fr.onerror = function () { reject(new Error('read-fail')); };
        fr.readAsDataURL(blob);
      } catch (e) { reject(e); }
    });
  }
  function httpErr(r, label) {
    return r.text().then(function (body) {
      var msg = '';
      try {
        var d = JSON.parse(body);
        msg = (d.error && (d.error.message || d.error)) || d.message || '';
        if (typeof msg !== 'string') msg = '';
      } catch (e) { msg = String(body || '').slice(0, 160); }
      var hint;
      if (r.status === 401 || r.status === 403) hint = 'API key reject ho gayi (' + r.status + ')';
      else if (r.status === 404) hint = 'Audio endpoint/model nahi mila (404)';
      else if (r.status === 413) hint = 'Audio bahut bada hai — chhoti recording bhejo';
      else if (r.status === 429) hint = 'Rate-limit/quota (429) — thodi der baad try karo';
      else hint = label + ' error (' + r.status + ')';
      return fail(hint + (msg ? ' — ' + msg.slice(0, 160) : ''));
    }, function () { return fail(label + ' error (' + r.status + ')'); });
  }

  /* Gemini : inline audio + NORMAL text response (JSON forced nahi) */
  function audioText(blob, prompt, cfg, extHint) {
    cfg = cfgOf(cfg);
    if (!cfg || !cfg.key) return Promise.resolve(fail('Koi AI provider selected nahi — Settings → AI se chuno.'));
    if (!window.fetch) return Promise.resolve(fail('Is browser mein fetch support nahi — audio bhejna possible nahi.'));
    if (cfg.provider !== 'gemini') {
      return Promise.resolve(fail('Audio sirf Gemini provider par chalta hai — Settings → AI mein Gemini card chuno.'));
    }
    return toBase64(blob).then(function (b64) {
      var model = audioModelFor(cfg);
      var url = 'https://generativelanguage.googleapis.com/v1beta/models/' +
        encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(cfg.key);
      var body = {
        contents: [{ role: 'user', parts: [
          { inline_data: { mime_type: 'audio/' + extOf(blob, extHint), data: b64 } },
          { text: prompt }
        ] }],
        generationConfig: { maxOutputTokens: 4000 }
      };
      return window.fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }).then(function (r) {
        if (!r.ok) return httpErr(r, 'Gemini audio');
        return r.json().then(function (d) {
          var s = '';
          var parts = (((d.candidates || [])[0] || {}).content || {}).parts || [];
          parts.forEach(function (p) { if (p && p.text) s += p.text; });
          return { ok: true, text: s };
        });
      });
    }, function () { return fail('Audio read nahi ho paya.'); });
  }

  /* Transcription/audio model = USER KI CHOICE :
     cfg.audioModel (Add AI form ka alag field) sabse pehle.
     Khali ho to purpose-default (override nahi, bas default) :
       - openai : 'whisper-1'  (OpenAI ka transcription endpoint chat
                   models leta hi nahi — isliye alag field hai)
       - custom : cfg.model || 'whisper-1' (custom server ka alias)
       - gemini : cfg.model (gemini ka chat model hi audio model hai)
     Chat calls hamesha cfg.model (user ka chuna) hi use karti hain. */
  function audioModelFor(cfg) {
    var am = String(cfg.audioModel || '').trim();
    if (am) return am;                              /* user ki explicit choice */
    if (cfg.provider === 'openai') return 'whisper-1';
    if (cfg.provider === 'gemini') return String(cfg.model || '').trim() || 'gemini-2.0-flash';
    return String(cfg.model || '').trim() || 'whisper-1';   /* custom */
  }
  function whisper(cfg, blob, extHint) {
    var fd = new FormData();
    fd.append('file', blob, 'audio.' + extOf(blob, extHint));
    fd.append('model', audioModelFor(cfg));
    var url = cfg.provider === 'custom'
      ? (String(cfg.baseUrl || '').replace(/\/+$/, '') + '/audio/transcriptions')
      : 'https://api.openai.com/v1/audio/transcriptions';
    if (cfg.provider === 'custom' && !cfg.baseUrl) {
      return Promise.resolve(fail('Custom provider ka Base URL saved nahi hai.'));
    }
    return window.fetch(url, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + cfg.key },
      body: fd
    }).then(function (r) {
      if (!r.ok) return httpErr(r, 'Audio transcription');
      return r.json().then(function (d) { return { ok: true, text: String(d.text || '') }; });
    });
  }

  function transcribe(blob, cfg, extHint) {
    cfg = cfgOf(cfg);
    if (!cfg || !cfg.key) return Promise.resolve(fail('Koi AI provider selected nahi — Settings → AI se chuno.'));
    if (!window.fetch) return Promise.resolve(fail('Is browser mein fetch support nahi — audio bhejna possible nahi.'));
    if (!blob) return Promise.resolve(fail('Audio blob khali hai.'));
    if (cfg.provider === 'gemini') {
      return audioText(blob,
        'Listen to this audio carefully and completely. Write the VERBATIM transcript ' +
        '(exact words, in the SAME language the speaker used — do NOT convert it into ' +
        'pure/formal Hindi). Start your reply with the line "TRANSCRIPT:" ' +
        'and then write only the transcript — normal plain text, no JSON.', cfg)
        .then(function (res) {
          if (!res.ok) return res;
          var t = String(res.text || '');
          var i = t.search(/^\s*TRANSCRIPT\s*:/im);
          if (i >= 0) t = t.slice(i).replace(/^\s*TRANSCRIPT\s*:\s*/i, '');
          /* agar model ne section bana diye to pehla section hi transcript */
          var m = t.split(/\r?\n\s*(?:SUMMARY|POINTS|MISTAKES|ACTIONS)\s*:/i)[0];
          t = (m || t).trim();
          if (!t) return fail('Gemini se transcript khali aayi.');
          return { ok: true, text: t };
        });
    }
    if (cfg.provider === 'openai' || cfg.provider === 'custom') return whisper(cfg, blob, extHint);
    return Promise.resolve(fail('Anthropic audio support nahi karta — Settings → AI mein Gemini/OpenAI card chuno.'));
  }

  window.AchivaAIAudio = {
    transcribe: transcribe,
    audioText: audioText,
    extOf: extOf
  };
})();
