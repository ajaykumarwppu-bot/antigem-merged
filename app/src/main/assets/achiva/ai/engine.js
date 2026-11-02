/* ================================================================
   AI / ENGINE.JS — sabka saanjha AI engine (sirf connection)
   ----------------------------------------------------------------
   • Is engine ko YE NAHI PATA ki kis feature ko kaisa answer ya
     prompt chahiye — wo sab har FEATURE ki apni file decide karti
     hai. Engine ka kaam sirf :
       - AI providers ki LIST rakhna (kitne bhi : provider, baseURL,
         model, API key)
       - user jo card CHOOSE kare (green tick), sab calls usi par
         bhejna
       - text chat ka poora transport + reply system EK jagah
         (OpenAI / Gemini / Anthropic / Custom)
       - JSON extract + repair-retry (chatJson) sab ke liye same
       - errors Hinglish mein normalize
   • Features apna system-prompt / payload / output-contract apni
     file mein rakhte hain aur yahan sirf call karte hain :
       AchivaAIHub.chat({ system, user, json, search, maxTokens, signal })
       AchivaAIHub.chatJson({ ... })   → json + repair retry
   • Selection : jo card user chunta hai (green tick), app ki saari
     AI calls usi par jaati hain. Purana single-config system
     (core/ai-client.js) hata diya gaya — ab sirf yahi engine hai.
   • Test hook : window.__ACHIVA_AI_HUB_TEST = fn(opts) → {text}
   • ES5-only. Screens : ai/settings.js · Audio : ai/audio.js
   ================================================================ */

(function () {
  'use strict';

  if (window.__achivaAiHubLoaded) return;
  window.__achivaAiHubLoaded = true;

  var KEY = 'achiva.ai.providers.v1';

  var PROVIDERS = [
    { id: 'openai', label: 'OpenAI' },
    { id: 'gemini', label: 'Google Gemini' },
    { id: 'anthropic', label: 'Anthropic Claude' },
    { id: 'custom', label: 'Custom (OpenAI-jaisa API)' }
  ];

  var db = window.AppStorage.loadAt(KEY) || { list: [], activeId: null };
  if (!Array.isArray(db.list)) db.list = [];
  /* category normalize : 'normal' | 'audio' | 'both' */
  function catOf(c) {
    if (!c) return 'normal';
    if (c.cat === 'audio') return 'audio';
    if (c.cat === 'normal') return 'normal';
    return 'both';
  }
  function rolesOf(c) {
    var k = catOf(c);
    return k === 'both' ? ['normal', 'audio'] : [k];
  }
  function matches(c, role) {
    var k = catOf(c);
    return k === 'both' || k === role;
  }

  /* MIGRATION : purana single activeId → category-wise activeIds;
     category se PEHLE wale cards = 'both' (normal+audio) taaki audio
     section kabhi khali na lage purane users ke liye */
  (function migrate() {
    var changed = false;
    db.list.forEach(function (c) {
      if (c.cat !== 'audio' && c.cat !== 'normal' && c.cat !== 'both') { c.cat = 'both'; changed = true; }
    });
    if (!db.activeIds) {
      db.activeIds = { normal: null, audio: null };
      if (db.activeId) {
        var c0 = null;
        db.list.forEach(function (c) { if (c.id === db.activeId) c0 = c; });
        if (c0) rolesOf(c0).forEach(function (r) { db.activeIds[r] = c0.id; });
      }
      delete db.activeId;
      changed = true;
    }
    if (changed) window.AppStorage.saveAt(KEY, db);
  })();
  function persist() { window.AppStorage.saveAt(KEY, db); }

  /* ---------- provider list CRUD ---------- */
  function list() { return db.list; }
  function get(id) {
    for (var i = 0; i < db.list.length; i++) if (db.list[i].id === id) return db.list[i];
    return null;
  }
  function add(cfg) {
    var c = {
      id: window.UI.uid(),
      provider: cfg.provider || 'openai',
      baseUrl: String(cfg.baseUrl || ''),
      model: String(cfg.model || ''),
      audioModel: String(cfg.audioModel || ''),
      cat: (cfg.cat === 'audio' || cfg.cat === 'normal' || cfg.cat === 'both') ? cfg.cat : 'both',
      key: String(cfg.key || ''),
      createdAt: Date.now()
    };
    db.list.push(c);
    persist();
    return c;
  }
  function update(id, patch) {
    var c = get(id);
    if (!c) return null;
    if (patch.provider !== undefined) c.provider = patch.provider;
    if (patch.baseUrl !== undefined) c.baseUrl = String(patch.baseUrl || '');
    if (patch.model !== undefined) c.model = String(patch.model || '');
    if (patch.audioModel !== undefined) c.audioModel = String(patch.audioModel || '');
    if (patch.cat !== undefined) c.cat = (patch.cat === 'audio' || patch.cat === 'normal' || patch.cat === 'both') ? patch.cat : 'both';
    if (patch.key !== undefined) c.key = String(patch.key || '');
    persist();
    return c;
  }
  function remove(id) {
    var c = get(id);
    db.list = db.list.filter(function (x) { return x.id !== id; });
    if (c && db.activeIds) {
      rolesOf(c).forEach(function (r) { if (db.activeIds[r] === id) db.activeIds[r] = null; });
    }
    persist();
  }
  /* role: 'normal' (text/summary/canvas) | 'audio' (transcript).
     tick wala → warna us category ka pehla card → warna null */
  function getActive(role) {
    role = (role === 'audio') ? 'audio' : 'normal';
    if (!db.activeIds) db.activeIds = { normal: null, audio: null };
    var id = db.activeIds[role];
    if (id) { var c = get(id); if (c && matches(c, role)) return c; }
    for (var i = 0; i < db.list.length; i++) {
      if (matches(db.list[i], role)) return db.list[i];
    }
    return null;
  }
  function hasActive(role) { return !!getActive(role); }

  /* category-wise selection : normal aur audio ka apna-apna chosen */
  function setActive(id) {
    var c = get(id);
    if (!c) return null;
    if (!db.activeIds) db.activeIds = { normal: null, audio: null };
    rolesOf(c).forEach(function (r) { db.activeIds[r] = id; });
    persist();
    return c;
  }

  /* ---------- reply system (sab features ke liye ek jaisa) ---------- */
  function extractJson(text) {
    if (!text) return null;
    var s = String(text).trim();
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    try { return JSON.parse(s); } catch (e) { /* aage */ }
    var i = s.indexOf('{'), j = s.lastIndexOf('}');
    if (i >= 0 && j > i) {
      try { return JSON.parse(s.slice(i, j + 1)); } catch (e2) { /* null */ }
    }
    return null;
  }

  function fail(msg) { return { ok: false, error: msg }; }

  function httpErr(r, label) {
    return r.text().then(function (body) {
      var msg = '';
      try {
        var d = JSON.parse(body);
        msg = (d.error && (d.error.message || d.error)) || d.message || '';
        if (typeof msg !== 'string') msg = '';
      } catch (e) { msg = String(body || '').slice(0, 160); }
      var hint;
      if (r.status === 401 || r.status === 403) hint = 'API key reject ho gayi (' + r.status + ') — key check karo.';
      else if (r.status === 404) hint = 'Model ya endpoint nahi mila (404) — model/Base URL check karo.';
      else if (r.status === 429) hint = 'Rate-limit ya quota khatam (429) — thodi der baad try karo.';
      else if (r.status >= 500) hint = label + ' server error (' + r.status + ') — baad mein try karo.';
      else hint = label + ' ne error diya (' + r.status + ')';
      return fail(hint + (msg ? ' — ' + msg.slice(0, 200) : ''));
    }, function () { return fail(label + ' ne error diya (' + r.status + ')'); });
  }
  function netErr(label, e) {
    if (e && (e.name === 'AbortError' || e.aborted)) return fail('cancelled');
    return fail(label + ' se connect nahi ho paya — internet / VPN / firewall check karo.');
  }

  /* ---------- provider transports (text) ---------- */
  function callOpenAI(cfg, opts) {
    var body = {
      model: cfg.model || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: opts.system || 'You are a helpful assistant.' },
        { role: 'user', content: opts.user }
      ]
    };
    if (opts.maxTokens) body.max_tokens = opts.maxTokens;
    if (opts.json) body.response_format = { type: 'json_object' };
    return window.fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST', signal: opts.signal,
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.key },
      body: JSON.stringify(body)
    }).then(function (r) {
      if (!r.ok) return httpErr(r, 'OpenAI');
      return r.json().then(function (d) {
        var c = (d.choices && d.choices[0] && d.choices[0].message) || {};
        return { ok: true, text: String(c.content || '') };
      });
    });
  }
  function callGemini(cfg, opts) {
    var model = cfg.model || 'gemini-2.0-flash';
    var url = 'https://generativelanguage.googleapis.com/v1beta/models/' +
      encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(cfg.key);
    var body = { contents: [{ role: 'user', parts: [{ text: opts.user }] }] };
    if (opts.system) body.systemInstruction = { parts: [{ text: opts.system }] };
    var gc = {};
    if (opts.json) gc.responseMimeType = 'application/json';
    if (opts.maxTokens) gc.maxOutputTokens = opts.maxTokens;
    var has = false; for (var k in gc) has = true;
    if (has) body.generationConfig = gc;
    if (opts.search) body.tools = [{ google_search: {} }];
    return window.fetch(url, {
      method: 'POST', signal: opts.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (r) {
      if (!r.ok) return httpErr(r, 'Gemini');
      return r.json().then(function (d) {
        var s = '';
        var parts = (((d.candidates || [])[0] || {}).content || {}).parts || [];
        parts.forEach(function (p) { if (p && p.text) s += p.text; });
        return { ok: true, text: s };
      });
    });
  }
  function callAnthropic(cfg, opts) {
    var body = {
      model: cfg.model || 'claude-3-5-sonnet-latest',
      max_tokens: opts.maxTokens || 4000,
      system: opts.system || 'You are a helpful assistant.',
      messages: [{ role: 'user', content: opts.user }]
    };
    if (opts.search) body.tools = [{ type: 'web_search_20250301', name: 'web_search', max_uses: 5 }];
    return window.fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal: opts.signal,
      headers: {
        'Content-Type': 'application/json', 'x-api-key': cfg.key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify(body)
    }).then(function (r) {
      if (!r.ok) return httpErr(r, 'Anthropic');
      return r.json().then(function (d) {
        var s = '';
        (d.content || []).forEach(function (b) { if (b && b.type === 'text' && b.text) s += b.text; });
        return { ok: true, text: s };
      });
    });
  }
  function callCustom(cfg, opts) {
    var base = String(cfg.baseUrl || '').replace(/\/+$/, '');
    if (!base) return Promise.resolve(fail('Custom provider ke liye Base URL zaroori hai.'));
    var body = {
      model: cfg.model || 'default',
      messages: [
        { role: 'system', content: opts.system || 'You are a helpful assistant.' },
        { role: 'user', content: opts.user }
      ]
    };
    if (opts.maxTokens) body.max_tokens = opts.maxTokens;
    function attempt(withJson) {
      var b = body;
      if (withJson && opts.json) {
        b = JSON.parse(JSON.stringify(body));
        b.response_format = { type: 'json_object' };
      }
      return window.fetch(base + '/chat/completions', {
        method: 'POST', signal: opts.signal,
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.key },
        body: JSON.stringify(b)
      }).then(function (r) {
        if (!r.ok) {
          if (withJson && opts.json && r.status === 400) return attempt(false);
          return httpErr(r, 'Custom API');
        }
        return r.json().then(function (d) {
          var c = (d.choices && d.choices[0] && d.choices[0].message) || {};
          return { ok: true, text: String(c.content || '') };
        });
      });
    }
    return attempt(true);
  }

  /* ---------- main chat() ---------- */
  function chat(opts) {
    opts = opts || {};
    try {
      var hook = window.__ACHIVA_AI_HUB_TEST;
      if (hook && typeof hook === 'function') {
        return Promise.resolve(hook(opts)).then(function (res) {
          res = res || {};
          if (res.ok === false) return res;
          var out = { ok: true, text: String(res.text || '') };
          if (opts.json) out.json = extractJson(out.text);
          return out;
        });
      }
      if (!window.fetch) return Promise.resolve(netErr('AI provider', new Error('no-fetch')));
      var cfg = opts.cfg || getActive();
      if (!cfg || !cfg.key) {
        return Promise.resolve(fail('Koi AI provider selected nahi hai — Settings → AI mein add karke card chuno.'));
      }
      var p;
      if (cfg.provider === 'gemini') p = callGemini(cfg, opts);
      else if (cfg.provider === 'anthropic') p = callAnthropic(cfg, opts);
      else if (cfg.provider === 'custom') p = callCustom(cfg, opts);
      else p = callOpenAI(cfg, opts);
      return p.then(function (res) {
        if (res && res.ok && opts.json && res.json === undefined) res.json = extractJson(res.text);
        return res;
      }, function (e) { return netErr('AI provider', e); });
    } catch (e) {
      return Promise.resolve(netErr('AI provider', e));
    }
  }

  /* ---------- chatJson : json + repair-retry (sab features ke liye same) ---------- */
  function chatJson(opts) {
    opts = opts || {};
    opts.json = true;
    return chat(opts).then(function (res) {
      if (!res.ok) return res;
      if (res.json) return res;
      return chat({
        system: opts.system,
        user: 'Ye JSON invalid tha. Ise theek karke SIRF valid JSON wapas do (koi text/fences nahi):\n' +
          String(res.text || '').slice(0, 2500),
        json: true, search: false, signal: opts.signal, maxTokens: opts.maxTokens, cfg: opts.cfg
      }).then(function (res2) {
        if (!res2.ok) return res2;
        if (res2.json) return res2;
        return fail('AI ne valid JSON nahi diya — dobara try karo.');
      });
    });
  }

  window.AchivaAIHub = {
    KEY: KEY, PROVIDERS: PROVIDERS, catOf: catOf,
    list: list, get: get, add: add, update: update, remove: remove,
    setActive: setActive, getActive: getActive, hasActive: hasActive,
    chat: chat, chatJson: chatJson, extractJson: extractJson
  };
})();
