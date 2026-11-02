/* ================================================================
   FEATURES / THOUGHT / STORE.JS — thoughts ka permanent store
   ----------------------------------------------------------------
   • Recording/thought ka META : AppStorage key 'achiva.thoughts.v1'
       { thoughts: [ { id, date (YYYY-MM-DD), createdAt, duration,
           size, mime, audioId, status: pending|processing|done|error,
           error, language, transcript, structured, name,
           catIds: [catId…] } ] }
   • AUDIO BLOBS : alag IndexedDB (db 'achiva-thoughts', store
     'audio') — AppStorage strings mein nahi (base64 bloat + LS
     5MB quota se bachne ke liye). IDB na mile to session-memory
     fallback (graceful).
   • Category links thought.catIds mein rehte hain — knowledge
     graph (graph.js) inhe padh kar thought↔category edges banata
     hai; Connect sheet (detail.js) inhe likhti hai.
   • Naam : user rename kar sakta hai; default = summary ki pehli
     line (ya transcript ka tukda) — process ke baad set hota hai.
   • Koi UI nahi — sirf data (GoodSystem/BadSystem wali philosophy).
   • ES5-only.
   ================================================================ */

(function () {
  'use strict';

  if (window.__achivaThoughtStoreLoaded) return;
  window.__achivaThoughtStoreLoaded = true;

  var META_KEY = 'achiva.thoughts.v1';

  var meta = window.AppStorage.loadAt(META_KEY) || { thoughts: [] };
  if (!Array.isArray(meta.thoughts)) meta.thoughts = [];
  function persist() { window.AppStorage.saveAt(META_KEY, meta); }

  /* ---------- audio blobs : alag IndexedDB ---------- */
  var DB = 'achiva-thoughts', STORE = 'audio';
  var idb = null, tried = false, mem = {};
  function idbOpen(cb) {
    if (tried) { cb(idb); return; }
    tried = true;
    try {
      if (!window.indexedDB) { cb(null); return; }
      var req = window.indexedDB.open(DB, 1);
      req.onupgradeneeded = function () {
        var d = req.result;
        if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE);
      };
      req.onsuccess = function () { idb = req.result; cb(idb); };
      req.onerror = function () { cb(null); };
    } catch (e) { cb(null); }
  }
  function audioPut(id, blob, cb) {
    cb = cb || function () { };
    idbOpen(function (d) {
      if (d) {
        try {
          var tx = d.transaction(STORE, 'readwrite');
          tx.objectStore(STORE).put(blob, id);
          tx.oncomplete = function () { cb(true); };
          tx.onerror = function () { mem[id] = blob; cb(false); };
          return;
        } catch (e) { /* memory fallback */ }
      }
      mem[id] = blob;
      cb(false);
    });
  }
  function audioGet(id, cb) {
    idbOpen(function (d) {
      if (d) {
        try {
          var tx = d.transaction(STORE, 'readonly');
          var r = tx.objectStore(STORE).get(id);
          r.onsuccess = function () { cb(r.result || mem[id] || null); };
          r.onerror = function () { cb(mem[id] || null); };
          return;
        } catch (e) { /* memory fallback */ }
      }
      cb(mem[id] || null);
    });
  }
  function audioDel(id) {
    delete mem[id];
    idbOpen(function (d) {
      if (d) {
        try { d.transaction(STORE, 'readwrite').objectStore(STORE).delete(id); } catch (e) { /* ignore */ }
      }
    });
  }

  /* ---------- thoughts CRUD ---------- */
  function all() { return meta.thoughts; }
  function get(id) {
    for (var i = 0; i < meta.thoughts.length; i++) if (meta.thoughts[i].id === id) return meta.thoughts[i];
    return null;
  }
  function onDate(iso) {
    return meta.thoughts.filter(function (t) { return t.date === iso; })
      .sort(function (a, b) { return b.createdAt - a.createdAt; });
  }
  function datesWithThoughts() {
    var m = {};
    meta.thoughts.forEach(function (t) { m[t.date] = true; });
    return Object.keys(m).sort();
  }
  function add(o) {
    o.id = o.id || window.UI.uid();
    o.createdAt = o.createdAt || Date.now();
    o.date = o.date || (window.DayClock ? window.DayClock.today() : window.UI.todayISO());   /* DAY-CLOCK */
    o.status = o.status || 'pending';
    o.catIds = o.catIds || [];
    meta.thoughts.push(o);
    persist();
    return o;
  }
  function update(id, patch) {
    var t = get(id);
    if (!t) return null;
    for (var k in patch) if (Object.prototype.hasOwnProperty.call(patch, k)) t[k] = patch[k];
    persist();
    return t;
  }
  function remove(id) {
    var t = get(id);
    meta.thoughts = meta.thoughts.filter(function (x) { return x.id !== id; });
    persist();
    if (t && t.audioId) audioDel(t.audioId);
  }
  /* default naam : summary ki pehli line → transcript ka tukda → time */
  function defaultName(t) {
    var s = (t.structured && t.structured.summary) || '';
    if (!s) s = String(t.transcript || '').replace(/\s+/g, ' ');
    s = s.trim().slice(0, 42);
    if (s) return s;
    var d = new Date(t.createdAt);
    return 'Thought · ' + d.getDate() + ' ' + window.UI.MONTHS[d.getMonth()] + ' ' +
      String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  /* ---------- category links (knowledge graph ke liye) ---------- */
  function linkCat(id, catId) {
    var t = get(id);
    if (!t) return;
    if (!t.catIds) t.catIds = [];
    if (t.catIds.indexOf(catId) < 0) t.catIds.push(catId);
    persist();
  }
  function unlinkCat(id, catId) {
    var t = get(id);
    if (!t) return;
    t.catIds = (t.catIds || []).filter(function (c) { return c !== catId; });
    persist();
  }
  function catsOf(id) {
    var t = get(id);
    if (!t || !window.ThoughtGraph) return [];
    return (t.catIds || []).map(function (cid) { return window.ThoughtGraph.getCat(cid); })
      .filter(function (c) { return !!c; });
  }

  window.ThoughtStore = {
    META_KEY: META_KEY,
    all: all, get: get, onDate: onDate, datesWithThoughts: datesWithThoughts,
    add: add, update: update, remove: remove, defaultName: defaultName,
    audioPut: audioPut, audioGet: audioGet, audioDel: audioDel,
    linkCat: linkCat, unlinkCat: unlinkCat, catsOf: catsOf
  };
})();
