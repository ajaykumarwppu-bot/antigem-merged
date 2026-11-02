/* ================================================================
   BACKEND / CLOUD.JS — Firestore ka patla sa wrapper (thin layer)
   ----------------------------------------------------------------
   Responsibility:
     • Firebase app + Firestore ko ek hi baar initialize karna.
     • Doosri backend files (auth / backup / settings) ke liye
       chhote-chhote safe functions dena:
         init, status, ready, saveDoc, readDoc, readDocs,
         deleteDoc, message
     • Network ya permission ki galti aane par exception throw
       NAHI karta — {ok:false, code, message} object deta hai,
       taaki UI hamesha Hinglish mein saaf-saaf bata sake.
     • Yahan koi UI nahi banega — sirf data + connection.

   Firestore ka structure (har user ka data alag, rules se locked):
     users/{uid}                    → profile doc {email, createdAt, lastBackupAt}
     users/{uid}/data/<docId>       → {v:1, savedAt:<ms>, value:"<JSON string>"}

   <docId> ki list backup.js mein DOCS ke roop mein hai (6 docs).
   Value ko JSON *string* ki tarah rakha jata hai taaki localStorage
   ka data byte-to-byte same wapas mile.

   Load order (backend): 2/5
   ================================================================ */

(function () {
  'use strict';

  var db = null;
  var state = 'idle';        /* idle | ready | no-config | no-sdk */
  var lastError = null;

  /* ---------- init : ek hi baar Firebase chalu karo ---------- */
  function init() {
    if (state === 'ready') return true;

    var cfg = window.ACHIVA_FIREBASE_CONFIG;
    if (!cfg) { state = 'no-config'; return false; }

    if (!window.firebase || !window.firebase.apps) {
      /* SDK script block ho gaya / load nahi hua */
      state = 'no-sdk';
      return false;
    }

    try {
      if (!window.firebase.apps.length) window.firebase.initializeApp(cfg);
      var app = window.firebase.app();
      if (!window.firebase.firestore) { state = 'no-sdk'; return false; }
      db = window.firebase.firestore(app);
      /* offline cache ON : net chala jaye to bhi padha hua data
         turant mil jata hai (writes net aane par chali jaati hain) */
      try { db.enablePersistence({ synchronizeTabs: true }); } catch (e) { /* ignore */ }
      state = 'ready';
      return true;
    } catch (e) {
      state = 'no-sdk';
      lastError = e;
      return false;
    }
  }

  function status() { return state; }
  function ready() { return state === 'ready' || init(); }

  /* ---------- errors → Hinglish message ---------- */
  var MSG = {
    'unavailable': 'Internet connection nahi mil raha. Net check karke dobara koshish karein.',
    'permission-denied': 'Permission denied — Firestore rules deploy karna zaroori hai (FIREBASE_SETUP.md step 6).',
    'unauthenticated': 'Login session khatam ho gaya. Dobara login karein.',
    'failed-precondition': 'Firestore abhi taiyar nahi hai. Ek-do second baad dobara koshish karein.',
    'resource-exhausted': 'Aaj ki free limit khatam ho gayi hai. Kal dobara koshish karein.',
    'invalid-argument': 'Galat request gayi. App reload karke dobara koshish karein.',
    'data-loss': 'Data adhura pahuncha. Dobara backup karein.',
    'internal': 'Firebase mein kuch gadbad ho gayi. Thodi der baad dobara koshish karein.',
    'deadline-exceeded': 'Request time-out ho gayi. Net slow lag raha hai.',
    'not-found': 'Cloud par ye data nahi mila.',
    'already-exists': 'Ye data cloud par pehle se hai.'
  };

  function message(err) {
    if (!err) return 'Kuch gadbad ho gayi. Dobara koshish karein.';
    var code = err.code || '';
    if (MSG[code]) return MSG[code];
    var raw = String(err.message || err.code || err);
    if (/offline|network|unavailable|failed to fetch|fetch/i.test(raw)) return MSG['unavailable'];
    return 'Kuch gadbad ho gayi: ' + raw;
  }

  /* ---------- document helpers ---------- */
  function ref(path) { return db.doc(path); }

  /* path → 'users/<uid>/data/<id>' | data = plain object */
  function saveDoc(path, data) {
    if (!ready()) return Promise.resolve({ ok: false, code: state, message: message(null) });
    return ref(path).set(data)
      .then(function () { return { ok: true }; })
      .catch(function (e) {
        lastError = e;
        return { ok: false, code: e.code || 'unknown', message: message(e) };
      });
  }

  /* path → {ok:true, data:{...}} ya {ok:true, data:null} (doc nahi hai)
     opts.server = true → SIRF server se padho (Firestore local cache se nahi).
     Restore jaise critical reads mein ye zaroori hai: enablePersistence ON
     hone par default .get() offline mein purana cached data CHUP-CHAAP de
     deta hai — user ko lagta hai restore ho gaya, asal mein stale data
     apply hua hota hai (deleted cheezein wapas aa jati hain). */
  function readDoc(path, opts) {
    if (!ready()) return Promise.resolve({ ok: false, code: state, message: message(null) });
    var getOpts = (opts && opts.server) ? { source: 'server' } : undefined;
    return ref(path).get(getOpts)
      .then(function (snap) {
        return { ok: true, data: snap.exists ? snap.data() : null };
      })
      .catch(function (e) {
        lastError = e;
        return { ok: false, code: e.code || 'unknown', message: message(e) };
      });
  }

  /* collectionPath → {ok:true, docs:[{id, data}]}
     opts.server = true → sirf server se (restore ke liye — stale cache nahi) */
  function readDocs(collectionPath, opts) {
    if (!ready()) return Promise.resolve({ ok: false, code: state, message: message(null) });
    var getOpts = (opts && opts.server) ? { source: 'server' } : undefined;
    return db.collection(collectionPath).get(getOpts)
      .then(function (qs) {
        var out = [];
        qs.forEach(function (snap) { out.push({ id: snap.id, data: snap.data() }); });
        return { ok: true, docs: out };
      })
      .catch(function (e) {
        lastError = e;
        return { ok: false, code: e.code || 'unknown', message: message(e) };
      });
  }

  function deleteDoc(path) {
    if (!ready()) return Promise.resolve({ ok: false, code: state, message: message(null) });
    return ref(path).delete()
      .then(function () { return { ok: true }; })
      .catch(function (e) {
        lastError = e;
        return { ok: false, code: e.code || 'unknown', message: message(e) };
      });
  }

  window.AchivaCloud = {
    init: init,
    status: status,
    ready: ready,
    message: message,
    saveDoc: saveDoc,
    readDoc: readDoc,
    readDocs: readDocs,
    deleteDoc: deleteDoc,
    lastError: function () { return lastError; }
  };
})();
