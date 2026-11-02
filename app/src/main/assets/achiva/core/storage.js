/* ================================================================
   CORE / STORAGE.JS — IndexedDB persistence for achiva (v3)
   ----------------------------------------------------------------
   Responsibility:
     • App ke saare data ko persist karna — ab PRIMARY store
       IndexedDB hai (db 'achiva', object store 'kv'), pehle
       localStorage tha.
     • Features (subject tracker, canvas, goals, habits, timer…)
       is file ko call karke apna state persist karte hain.
     • Yahan koi UI logic NAHI hogi — sirf data storage.

   ARCHITECTURE — "memory cache + write-behind IDB":
     • Poora data ek in-memory cache (plain object) mein rehta hai.
       Saare get/set SYNC hain (purane API jaise hi) — isliye
       kisi feature file ko badalne ki zaroorat nahi padi.
     • Har write turant ek IndexedDB transaction queue karta hai
       (write-behind) + safety ke liye localStorage mein bhi
       likhta hai (dual-write; quota fail ho to ignore).
     • Boot par index.html ka loader `AppStorage.open()` ka wait
       karta hai — tab tak cache IDB se bhar jata hai. Uske baad
       hi feature scripts load hote hain (kuch features parse
       hote hi state padhte hain).
     • Pehli baar khulne par ek ONE-TIME verified migration hoti
       hai: localStorage ka saara achiva data IDB mein copy hota
       hai, read-back verify hota hai, tabhi flag lagta hai.
       Purane LS keys delete NAHI hote (rollback safety — purge
       baad ka phase hai).
     • IndexedDB na mile / fail ho → automatic localStorage
       fallback (engine 'ls') — app pehle jaisi hi chalti hai.
     • RESYNC SAFETY (v3.1): fallback session ke writes ya fail
       hue IDB writes (quota / closed db) ek LS flag
       ('achiva.idb.resync.v1') mein affected keys ke saath
       record hote hain. Agli healthy boot par wo keys LS mirror
       se IDB mein wapas sync (verify ke saath) hoti hain — warna
       IDB ki PURANI value fresh LS-mirror ko override kar deti
       aur fallback-session ke changes kho jate.
     • `flush()` : pending IDB writes commit hone ka wait —
       location.reload() se pehle call hota hai (backup restore,
       account-namespace change).

   PER-ACCOUNT ISOLATION (v2 se unchanged):
     • Har logged-in user ka data alag namespace mein:
         physical key = 'u/<uid>/<logical-key>'
     • Namespace uid localStorage['achiva.ns.v1'] mein rakha jata
       hai (meta key — device-level, hamesha LS mein hi rehti hai)
       taaki page parse hote hi (auth resolve hone se PEHLE) sahi
       account ka data padha jaye.
     • 'achiva.prefs.v1' (theme etc.) device-level rahta hai
       (shared, bina namespace ke).
     • Sign-out par namespace null → koi account data nahi dikhta.
     • adoptLegacy(): upgrade se pehle wala unprefixed data pehli
       login par us account ke namespace mein MOVE ho jata hai.
     • 'achiva.account.v1' / 'achiva.offline.v1' auth.js ki
       private LS keys hain — yahan cache/migrate NAHI hoti.
   ================================================================ */

(function () {
  'use strict';

  var KEY = 'achiva.subjectTracker.v1';
  var NSKEY = 'achiva.ns.v1';
  var PREFS_KEY = 'achiva.prefs.v1';   /* device-level, shared */

  /* IDB layout */
  var DB_NAME = 'achiva';
  var DB_VERSION = 1;
  var STORE = 'kv';
  var MIGRATED_KEY = 'achiva.idb.migrated.v1';  /* sirf IDB mein rehta hai */
  var RESYNC_KEY = 'achiva.idb.resync.v1';      /* sirf LS mein — meta flag (SKIP_KEYS mein bhi hai) */
  var OPEN_TIMEOUT = 4000;             /* itne ms mein IDB na khule → LS fallback */

  /* ye saari app-data keys account-namespace mein rahti hain */
  var DATA_KEYS = [
    'achiva.subjectTracker.v1',
    'achiva.canvas.v1',
    'achiva.timer.study.v1',
    'achiva.timer.manual.v1',
    'achiva.canvas.savedColors',
    'achiva.goals.v1',
    'achiva.goodHabits.v1',
    'achiva.exams.v1',
    'achiva.tasks.v1',
    'achiva.thoughts.v1',
    'achiva.thoughtCats.v1'
  ];

  /* auth.js ki private keys + resync meta flag — inhe kabhi mat chhedo */
  var SKIP_KEYS = { 'achiva.account.v1': 1, 'achiva.offline.v1': 1, 'achiva.idb.resync.v1': 1 };

  /* ---------- in-memory cache : physical key → string ---------- */
  var cache = {};
  function cHas(k) { return Object.prototype.hasOwnProperty.call(cache, k); }

  /* ---------- engine state ---------- */
  var engine = 'ls';       /* 'ls' | 'idb' — open() ke baad pata chalta hai */
  var db = null;           /* IDBDatabase jab khul jaye */
  var pending = [];        /* in-flight IDB write transactions */
  var dirty = {};          /* open() se PEHLE likhe gaye keys (merge mein protect) */
  var openP = null;        /* open() ka memoized promise */

  /* ---------- safe localStorage helpers ---------- */
  function lsGetItem(pk) { try { return window.localStorage.getItem(pk); } catch (e) { return null; } }
  function lsSetItem(pk, v) { try { window.localStorage.setItem(pk, v); return true; } catch (e) { return false; } }
  function lsDelItem(pk) { try { window.localStorage.removeItem(pk); } catch (e) { /* ignore */ } }

  /* ---------- namespace (v2 jaisa hi — meta key hamesha LS mein) ---------- */
  function readNs() { return lsGetItem(NSKEY) || null; }
  var NS = readNs();

  function ns() { return NS; }

  function setNamespace(uid) {
    NS = uid || null;
    if (NS) {
      cache[NSKEY] = NS;
      lsSetItem(NSKEY, NS);
      idbPut(NSKEY, NS);
      noteDirty(NSKEY);
    } else {
      delete cache[NSKEY];
      lsDelItem(NSKEY);
      idbDel(NSKEY);
      noteDirty(NSKEY);
    }
  }

  /* logical key → physical (account-scoped) key */
  function phys(key) {
    if (!NS || key === PREFS_KEY) return key;
    return 'u/' + NS + '/' + key;
  }

  /* ---------- write-behind IDB ---------- */
  function trackTx(tx, pk) {
    var p = new Promise(function (res) {
      tx.oncomplete = function () { res(); };
      tx.onerror = function () { if (pk) markResync(pk); res(); };   /* reject nahi — app chalti rahe */
      tx.onabort = function () { if (pk) markResync(pk); res(); };   /* quota-full wghairah — resync mein recover hoga */
    });
    pending.push(p);
    p.then(function () {
      var i = pending.indexOf(p);
      if (i >= 0) pending.splice(i, 1);
    });
  }

  /* ---------- resync flag (device-level LS meta) ----------
     Jab koi write IDB tak NA pahunch paye (db closed/quota fail,
     ya session LS-fallback engine par chal raha ho) to affected
     physical key yahan record hoti hai. Agli healthy boot par
     open() → resyncFromLS() inhe LS mirror se IDB mein wapas
     likhta hai (verify ke saath), phir flag hata deta hai. */
  function resyncList() {
    try {
      var l = JSON.parse(lsGetItem(RESYNC_KEY) || '[]');
      return Array.isArray(l) ? l : [];
    } catch (e) { return []; }
  }
  function markResync(pk) {
    try {
      var l = resyncList();
      if (l.indexOf(pk) < 0) l.push(pk);
      lsSetItem(RESYNC_KEY, JSON.stringify(l));
    } catch (e) { /* LS bhi fail ho to kuch nahi ho sakta */ }
  }
  function clearResync() { lsDelItem(RESYNC_KEY); }

  function idbPut(pk, val) {
    if (!db) return;
    try {
      var tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(val, pk);
      trackTx(tx, pk);
    } catch (e) { markResync(pk); }   /* quota/closed db — LS mirror mein data safe hai, resync recover karega */
  }

  function idbDel(pk) {
    if (!db) return;
    try {
      var tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(pk);
      trackTx(tx, pk);
    } catch (e) { markResync(pk); }   /* ignore nahi — resync flag lagao */
  }

  /* pending writes commit hone ka wait (reload se pehle zaroori) */
  function flush(round) {
    if (!db || !pending.length) return Promise.resolve(true);
    round = round || 0;
    return Promise.all(pending.slice()).then(function () {
      if (pending.length && round < 10) return flush(round + 1);
      return true;
    }, function () { return false; });
  }

  /* ---------- parse-time seed : LS se cache bhar do ----------
     Isse (a) purane tests/scripts jo open() se pehle padhte hain
     kaam karte rehte hain, aur (b) IDB fail ho to LS fallback
     mein data turant available hota hai. IDB values open() par
     is seed ko OVERRIDE karti hain (IDB hi primary hai). */
  function lsSnapshot() {
    var out = {};
    try {
      var ls = window.localStorage;
      for (var i = 0; i < ls.length; i++) {
        var k = ls.key(i);
        if (!k || SKIP_KEYS[k]) continue;
        if (k.indexOf('achiva.') === 0 || k.indexOf('u/') === 0) out[k] = ls.getItem(k);
      }
    } catch (e) { /* ignore */ }
    return out;
  }

  (function seedFromLS() {
    var snap = lsSnapshot();
    Object.keys(snap).forEach(function (k) { cache[k] = snap[k]; });
  })();

  /* ---------- raw (string) access, namespace-aware ---------- */
  function rawGet(key) {
    var pk = phys(key);
    if (cHas(pk)) return cache[pk];
    /* cache miss → LS se live padho (external writers / ls-engine
       ke liye purana behaviour same rahe) */
    var v = lsGetItem(pk);
    if (v !== null) cache[pk] = v;
    return v;
  }

  function noteDirty(pk) {
    /* db khulne se pehle hua write — open() complete hone par
       pushDirtyToIdb() ise IDB mein push karega aur mergeIdbIntoCache
       is key par IDB ki purani value se cache override NAHI karega. */
    if (!db) dirty[pk] = 1;
  }

  function rawSet(key, val) {
    var pk = phys(key);
    var s = (typeof val === 'string') ? val : String(val);  /* LS jaisa coerce */
    cache[pk] = s;
    if (db) idbPut(pk, s);
    else {
      noteDirty(pk);
      /* open() ho chuka hai aur engine LS-fallback hai → ye write
         IDB tak kabhi nahi pahunchega; resync flag mein record karo
         (open se PEHLE ke writes pushDirtyToIdb sambhalta hai). */
      if (openP && engine === 'ls') markResync(pk);
    }
    var lsOk = lsSetItem(pk, s);                            /* dual-write (safety mirror) */
    if (engine === 'idb') return true;                      /* primary IDB hai */
    return lsOk;                                            /* pure-LS mode : purani semantics */
  }

  function rawDel(key) {
    var pk = phys(key);
    delete cache[pk];
    if (db) idbDel(pk);
    else {
      noteDirty(pk);
      if (openP && engine === 'ls') markResync(pk);         /* delete bhi resync hona chahiye */
    }
    lsDelItem(pk);                                          /* mirror se bhi hatao */
  }

  /* ---------- load : subject-tracker state padho ---------- */
  function load() {
    try {
      var raw = rawGet(KEY);
      if (!raw) return null;
      var data = JSON.parse(raw);
      if (!data || !Array.isArray(data.subjects)) return null;
      return data;
    } catch (e) {
      return null; /* corrupt data */
    }
  }

  /* ---------- save : state likho ---------- */
  function save(state) {
    return rawSet(KEY, JSON.stringify(state));
  }

  /* ---------- clear : saved data hatao ---------- */
  function clear() {
    rawDel(KEY);
  }

  /* ---------- generic keys (canvas, goals, habits, timer…) ---------- */
  function loadAt(key) {
    try {
      var raw = rawGet(key);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function saveAt(key, value) {
    return rawSet(key, JSON.stringify(value));
  }

  /* ---------- upgrade migration: purana unprefixed data →
     current account namespace (v2 wala behaviour, ab cache +
     dono stores par) ---------- */
  function adoptLegacy() {
    if (!NS) return;
    DATA_KEYS.forEach(function (k) {
      var pk = phys(k);
      var hasPk = cHas(pk) || lsGetItem(pk) !== null;
      if (hasPk) return;
      var v = cHas(k) ? cache[k] : lsGetItem(k);
      if (v !== null && v !== undefined) {
        cache[pk] = v;
        idbPut(pk, v);
        lsSetItem(pk, v);
        delete cache[k];
        idbDel(k);
        lsDelItem(k);
        noteDirty(pk);
        noteDirty(k);
      }
    });
  }

  /* ================================================================
     OPEN — boot par ek hi baar (index.html ka loader isi ka wait
     karta hai). Kabhi reject NAHI hota — IDB fail hone par LS
     fallback ke saath resolve hota hai, taaki app hamesha khule.
     ================================================================ */
  function idbOpenDb() {
    return new Promise(function (resolve, reject) {
      var idb = window.indexedDB;
      if (!idb || typeof idb.open !== 'function') { reject(new Error('no-indexeddb')); return; }
      var req;
      try { req = idb.open(DB_NAME, DB_VERSION); } catch (e) { reject(e); return; }
      req.onupgradeneeded = function () {
        try {
          var d = req.result;
          if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE);
        } catch (e) { /* onerror sambhal lega */ }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject((req && req.error) || new Error('idb-open-failed')); };
      req.onblocked = function () { reject(new Error('idb-blocked')); };
    });
  }

  function idbLoadAll(d) {
    return new Promise(function (resolve, reject) {
      try {
        var tx = d.transaction(STORE, 'readonly');
        var os = tx.objectStore(STORE);
        var keysReq = os.getAllKeys();
        var valsReq = os.getAll();
        tx.oncomplete = function () {
          var out = {};
          var ks = keysReq.result || [], vs = valsReq.result || [];
          for (var i = 0; i < ks.length && i < vs.length; i++) out[ks[i]] = vs[i];
          resolve(out);
        };
        tx.onerror = function () { reject((tx.error) || new Error('idb-read-failed')); };
      } catch (e) { reject(e); }
    });
  }

  /* LS → IDB ek-baari migration : ek hi transaction mein copy,
     phir read-back VERIFY, phir hi flag. Verify fail → reject →
     engine 'ls' hi rahega, agli boot par dobara koshish. */
  function migrateLS(d) {
    var snap = lsSnapshot();
    var todo = Object.keys(snap).map(function (k) { return [k, snap[k]]; });
    return new Promise(function (resolve, reject) {
      try {
        var tx = d.transaction(STORE, 'readwrite');
        var os = tx.objectStore(STORE);
        todo.forEach(function (kv) { os.put(kv[1], kv[0]); });
        os.put(JSON.stringify({ v: 1, at: Date.now(), keys: todo.length }), MIGRATED_KEY);
        tx.oncomplete = function () { resolve(todo); };
        tx.onerror = function () { reject((tx.error) || new Error('migrate-write-failed')); };
      } catch (e) { reject(e); }
    }).then(function (items) {
      return idbLoadAll(d).then(function (all) {
        for (var i = 0; i < items.length; i++) {
          if (all[items[i][0]] !== items[i][1]) throw new Error('migrate-verify-failed: ' + items[i][0]);
        }
        return items.length;
      });
    });
  }

  function mergeIdbIntoCache(all, protect) {
    var prot = {};
    if (protect) protect.forEach(function (k) { prot[k] = 1; });
    Object.keys(all).forEach(function (k) {
      if (SKIP_KEYS[k]) return;
      if (dirty[k]) return;         /* open() se pehle user ne likha tha — fresh value jeetegi */
      if (prot[k]) return;          /* resync pending hai — LS seed (fresh) hi rahega, IDB ki purani value NAHI */
      cache[k] = all[k];            /* IDB primary hai → LS seed ko override karta hai */
    });
  }

  /* RESYNC: pichli session(s) mein kuch writes IDB tak nahi pahunch
     paye the (LS-fallback ya quota/closed-db fail). Flag mein listed
     keys ko LS mirror se IDB mein wapas likho — jo LS mein hai wo
     put, jo LS se delete hua tha wo IDB se bhi delete — phir verify
     karke flag hatao. Safety: agar listed keys LS mein ek bhi na
     mile (LS khud toota/clear hua lagta hai) to IDB ko chheda nahi
     jata. Fail hone par flag rehta hai — agli boot dobara koshish. */
  function resyncFromLS(d, list) {
    var found = 0;
    list.forEach(function (pk) { if (lsGetItem(pk) !== null) found++; });
    if (!found) {                   /* LS khali/tuta — IDB bacha ke rakho */
      clearResync();
      return Promise.resolve(0);
    }
    return new Promise(function (resolve, reject) {
      try {
        var tx = d.transaction(STORE, 'readwrite');
        var os = tx.objectStore(STORE);
        list.forEach(function (pk) {
          var v = lsGetItem(pk);
          if (v !== null) os.put(v, pk);
          else os.delete(pk);
        });
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error || new Error('resync-write-failed')); };
      } catch (e) { reject(e); }
    }).then(function () {
      return idbLoadAll(d).then(function (all) {
        for (var i = 0; i < list.length; i++) {
          var v = lsGetItem(list[i]);
          if (v !== null) {
            if (all[list[i]] !== v) throw new Error('resync-verify-failed: ' + list[i]);
          } else if (Object.prototype.hasOwnProperty.call(all, list[i])) {
            throw new Error('resync-verify-del-failed: ' + list[i]);
          }
        }
        clearResync();
        return list.length;
      });
    });
  }

  function pushDirtyToIdb() {
    Object.keys(dirty).forEach(function (pk) {
      if (cHas(pk)) idbPut(pk, cache[pk]);
      else idbDel(pk);
    });
    dirty = {};
  }

  function open() {
    if (openP) return openP;
    var settled = false;
    function closeQuiet(d) { try { d.close(); } catch (e) { /* ignore */ } }

    var flow = idbOpenDb().then(function (d) {
      if (settled) { closeQuiet(d); return null; }
      return idbLoadAll(d).then(function (all) {
        if (settled) { closeQuiet(d); return null; }
        if (all[MIGRATED_KEY]) {          /* pehle hi migrate ho chuka */
          var list = resyncList();
          if (!list.length) {             /* normal boot — koi resync pending nahi */
            mergeIdbIntoCache(all);
            return d;
          }
          /* pichli session mein kuch writes IDB miss hue the →
             LS mirror se wapas sync karo, phir fresh IDB state merge.
             Resync fail ho to purani 'all' se hi merge hoga, lekin
             flagged keys PROTECTED rahengi (cache mein LS wali fresh
             value jeetegi) aur flag agli boot ke liye bacha rahega. */
          return resyncFromLS(d, list).then(function () {
            if (settled) { closeQuiet(d); return null; }
            return idbLoadAll(d);
          }, function () {
            return all;
          }).then(function (all2) {
            if (!all2) return null;
            mergeIdbIntoCache(all2, resyncList());
            return d;
          });
        }
        return migrateLS(d).then(function () {   /* pehli boot : LS → IDB copy+verify */
          if (settled) { closeQuiet(d); return null; }
          clearResync();                         /* sab kuch abhi copy hua — purana flag bekaar */
          return idbLoadAll(d);
        }).then(function (all2) {
          if (!all2) return null;
          mergeIdbIntoCache(all2);
          return d;
        });
      }).then(function (okDb) {
        if (settled || !okDb) { if (okDb) closeQuiet(okDb); return; }
        db = okDb;
        engine = 'idb';
        db.onversionchange = function () { closeQuiet(db); };
        pushDirtyToIdb();
      });
    });

    var timeout = new Promise(function (_, reject) {
      var t = window.setTimeout(function () { reject(new Error('idb-open-timeout')); }, OPEN_TIMEOUT);
      /* flow jeet jaye to timer saaf kar do (warna 4s tak atka rahega) */
      flow.then(function () { window.clearTimeout(t); }, function () { window.clearTimeout(t); });
    });

    openP = Promise.race([flow, timeout]).then(function () {
      settled = true;
      return engine === 'idb';   /* true = IDB engine ready */
    }, function (err) {
      settled = true;
      try { if (window.console && console.warn) console.warn('[achiva] IDB unavailable, localStorage fallback:', err && err.message); } catch (e) { /* ignore */ }
      /* fallback session: open() se PEHLE likhe gaye keys bhi resync
         flag mein daal do (ye IDB tak kabhi nahi pahunchenge) */
      Object.keys(dirty).forEach(function (k) { markResync(k); });
      return false;              /* LS fallback — cache LS seed se bhara hua hai */
    });
    return openP;
  }

  /* ---------- TIMER/STORAGE-FIX (Batch 41, Bug D) ----------
     Page background mein jaate hi (ya band hote hi) pending IDB writes
     commit karne ki koshish — "save ke turant baad app band → write-behind
     transaction adhura → agli boot par stale IDB jeeta" wali race window
     ko milliseconds tak sikod deta hai. (Poora fix nahi — process-kill
     ms-window mein ho to LS mirror + resync v3.1 hi bachata hai.) */
  try {
    window.addEventListener('pagehide', function () { try { flush(); } catch (e) { } });
    if (window.document) {
      window.document.addEventListener('visibilitychange', function () {
        if (window.document.hidden) { try { flush(); } catch (e) { } }
      });
    }
  } catch (e) { /* purane environments — ignore */ }

  window.AppStorage = {
    /* purana sync API — bilkul unchanged */
    load: load,
    save: save,
    clear: clear,
    loadAt: loadAt,
    saveAt: saveAt,
    rawGet: rawGet,
    rawSet: rawSet,
    rawDel: rawDel,
    ns: ns,
    setNamespace: setNamespace,
    adoptLegacy: adoptLegacy,
    DATA_KEYS: DATA_KEYS,
    PREFS_KEY: PREFS_KEY,
    /* naya (v3) — sirf index.html loader + reload-points use karte hain */
    open: open,               /* Promise<true=idb, false=ls-fallback> — kabhi reject nahi */
    flush: flush,             /* pending IDB writes commit karo (reload se pehle) */
    engine: function () { return engine; },
    OPEN_TIMEOUT: OPEN_TIMEOUT
  };
})();
