/* ================================================================
   BACKEND / BACKUP.JS — manual backup + restore (koi auto-backup nahi)
   ----------------------------------------------------------------
   Responsibility:
     • App ka poora data 8 localStorage keys mein hai (+ prefs). Inhe
       alag-alag Firestore docs mein JSON *string* ki tarah save karna,
       taaki restore par data byte-to-byte wapas mile.
     • Backup SIRF user ke button dabane par hota hai (Settings →
       "Backup now") — app khud kabhi upload nahi karti.
     • Restore bhi sirf user ki haan se hota hai.
     • SILENT-PARTIAL-BACKUP FIX: koi ek doc fail hone par profile
       doc (lastBackupAt) update NAHI hota aur message mein hisse ka
       naam + wajah dikhti hai. Limit se bade docs gzip ('GZ1:...')
       hokar jate hain; restore server-fresh (source:'server') hota
       hai — stale Firestore cache se kabhi nahi.
     • Login ke baad ek baar "firstRunFlow" : cloud aur local data
       dekh kar 3 mein se ek sawaal poochta hai (kabhi auto nahi).
     • Settings panel ko status dena: lastBackupAt, cloudSummary,
       localSummary, hasLocal.

   Firestore layout:
     users/{uid}                    → profile doc {email, createdAt, lastBackupAt, app:'achiva', v:1}
     users/{uid}/data/<docId>       → {v:1, savedAt:<ms>, value:"<JSON string>"}

   Load order (backend): 4/5
   ================================================================ */

(function () {
  'use strict';

  var CLOUD = window.AchivaCloud;

  /* ---------- app ke saare data keys (backup mein yahi jayenge) ----------
     docId = Firestore document ka naam | key = localStorage key
     label = Settings mein dikhne wala naam | main = asli study data hai?  */
  /* NOTE: AI provider keys ('achiva.ai.providers.v1', aur purana
     'achiva.ai.keys.v1') JAAN-BOOJH KAR yahan NAHI hain — user ki AI
     API keys device se bahar (cloud) kabhi nahi jaani chahiye.
     Galti se bhi inhe DOCS mein add mat karna. */
  var DOCS = [
    { docId: 'subjectTracker', key: 'achiva.subjectTracker.v1',   label: 'Subjects + chapters', main: true },
    { docId: 'canvas',         key: 'achiva.canvas.v1',           label: 'Canvas boards',       main: true },
    { docId: 'timerStudy',     key: 'achiva.timer.study.v1',      label: 'Screen-time log',     main: true },
    { docId: 'timerManual',    key: 'achiva.timer.manual.v1',     label: 'Manual time entries', main: true },
    { docId: 'canvasColors',   key: 'achiva.canvas.savedColors',  label: 'Canvas colours',      main: false },
    { docId: 'goals',          key: 'achiva.goals.v1',            label: 'Goals + sessions',    main: true },
    { docId: 'goodHabits',     key: 'achiva.goodHabits.v1',       label: 'Good habits',         main: true },
    { docId: 'badHabits',      key: 'achiva.badHabits.v1',        label: 'Bad habits',          main: true },
    { docId: 'challenges',     key: 'achiva.challenges.v1',       label: 'Challenges',          main: true },
    { docId: 'exams',          key: 'achiva.exams.v1',            label: 'Exams (subject widget)', main: true },
    { docId: 'tasks',          key: 'achiva.tasks.v1',            label: 'Tasks',             main: true },
    { docId: 'thoughts',       key: 'achiva.thoughts.v1',         label: 'Thoughts (meta)',   main: true },
    { docId: 'thoughtCats',    key: 'achiva.thoughtCats.v1',      label: 'Thought categories', main: true },
    { docId: 'prefs',          key: 'achiva.prefs.v1',            label: 'App settings',        main: false },
    /* DAY-CLOCK : 'Mera Din' (dayStart) setting. main:false kyunki ye study
       data nahi hai — lekin backup/restore mein jaana zaroori hai, warna naye
       phone par restore ke baad din wapas raat-12-baje par chala jata. */
    { docId: 'dayClock',       key: 'achiva.dayclock.v1',         label: 'Mera Din (day start)', main: false },
    /* FOCUS SHIELD : app-blocking rules + unlock log. main:false (study data
       nahi), lekin restore zaroori hai warna naye phone par blocking chali
       jayegi. */
    { docId: 'focus',          key: 'achiva.focus.v1',            label: 'Focus Shield (app blocking)', main: false }
  ];

  function hasCloud() { return !!(CLOUD && CLOUD.ready && CLOUD.ready()); }
  function msg(e) { return CLOUD && CLOUD.message ? CLOUD.message(e) : 'Cloud se baat nahi ho payi.'; }

  /* namespace-aware raw access (per-account data) — AppStorage ke zariye */
  function lsGet(k) {
    if (window.AppStorage) return window.AppStorage.rawGet(k);
    try { return window.localStorage.getItem(k); } catch (e) { return null; }
  }
  function lsSet(k, v) {
    if (window.AppStorage) return window.AppStorage.rawSet(k, v);
    try { window.localStorage.setItem(k, v); return true; } catch (e) { return false; }
  }
  function lsDel(k) {
    if (window.AppStorage) { window.AppStorage.rawDel(k); return; }
    try { window.localStorage.removeItem(k); } catch (e) { /* ignore */ }
  }

  function sess() {
    return (window.AchivaAuth && window.AchivaAuth.session) ? window.AchivaAuth.session() : null;
  }

  /* ================================================================
     SIZE LIMIT + GZIP COMPRESSION
     ----------------------------------------------------------------
     firestore.rules mein hai: value.size() <= 900000  (characters)
     aur Firestore ka hard limit ~1 MiB per doc.
     Pehle ka bug: data bada hone par EK doc chup-chaap reject ho
     jata tha, baaki docs + profile (lastBackupAt) succeed ho jate
     the → Settings "sab fresh" dikhata, par cloud par wo hissa
     PURANA reh jata → restore par deletions wapas nahi hoti thin.
     Ab:
       • limit se bada data gzip karke 'GZ1:<base64>' string ban kar
         jata hai (JSON aksar 5-10x chhota ho jata hai).
       • chhote docs PLAIN rehte hain — purane backups aur purane
         (cached) app versions dono compatible rehte hain.
       • compression ke baad bhi na fit ho → backup SAAF fail hota
         hai, hisse ka naam + size message mein.
     ================================================================ */
  var RULE_CHAR_LIMIT = 900000;         /* firestore.rules wali limit */
  var HARD_BYTE_LIMIT = 1000000;        /* Firestore ~1MiB (safe side) */
  var GZ_PREFIX = 'GZ1:';

  function byteLen(s) {
    try {
      if (window.TextEncoder) return new window.TextEncoder().encode(s).length;
    } catch (e) { /* ignore */ }
    return s.length;
  }

  function fits(s) {
    return typeof s === 'string' && s.length <= RULE_CHAR_LIMIT && byteLen(s) <= HARD_BYTE_LIMIT;
  }

  function mb(n) { return (n / 1048576).toFixed(2) + ' MB'; }

  function streamToBytes(readable) {
    return new Promise(function (resolve, reject) {
      try {
        var reader = readable.getReader();
        var chunks = [], total = 0;
        var pump = function () {
          reader.read().then(function (o) {
            if (!o || o.done) {
              var out = new Uint8Array(total), off = 0;
              chunks.forEach(function (c) { out.set(c, off); off += c.length; });
              resolve(out);
              return;
            }
            if (o.value) { chunks.push(o.value); total += o.value.length; }
            pump();
          }, reject);
        };
        pump();
      } catch (e) { reject(e); }
    });
  }

  function bytesToStream(u8) {
    var RS = window.ReadableStream;
    if (typeof RS !== 'function') return null;
    return new RS({ start: function (c) { c.enqueue(u8); c.close(); } });
  }

  function bytesToB64(u8) {
    var CH = 0x8000, s = '';
    for (var i = 0; i < u8.length; i += CH) {
      s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
    }
    return window.btoa(s);
  }

  function b64ToBytes(b64) {
    var s = window.atob(b64);
    var u8 = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
    return u8;
  }

  /* str → Promise<'GZ1:...'|null>   (null = compression available nahi / fail) */
  function gzCompress(str) {
    try {
      if (typeof window.CompressionStream !== 'function' || !window.TextEncoder) return Promise.resolve(null);
      var src = bytesToStream(new window.TextEncoder().encode(str));
      if (!src) return Promise.resolve(null);
      return streamToBytes(src.pipeThrough(new window.CompressionStream('gzip')))
        .then(function (u8) { return GZ_PREFIX + bytesToB64(u8); })
        .catch(function () { return null; });
    } catch (e) { return Promise.resolve(null); }
  }

  /* 'GZ1:...' → Promise<str|null> */
  function gzDecompress(payload) {
    try {
      if (typeof window.DecompressionStream !== 'function' || !window.TextDecoder) return Promise.resolve(null);
      var src = bytesToStream(b64ToBytes(String(payload).slice(GZ_PREFIX.length)));
      if (!src) return Promise.resolve(null);
      return streamToBytes(src.pipeThrough(new window.DecompressionStream('gzip')))
        .then(function (u8) { return new window.TextDecoder('utf-8').decode(u8); })
        .catch(function () { return null; });
    } catch (e) { return Promise.resolve(null); }
  }

  function isGz(v) { return typeof v === 'string' && v.indexOf(GZ_PREFIX) === 0; }

  /* doc ke raw JSON string se upload-payload banao (bada ho to gzip) */
  function makePayload(raw) {
    if (fits(raw)) return Promise.resolve({ payload: raw });
    return gzCompress(raw).then(function (gz) {
      if (gz && fits(gz)) return { payload: gz };
      return { tooBig: true, bytes: byteLen(raw), gzBytes: gz ? byteLen(gz) : null };
    });
  }

  /* ---------- local summary ---------- */
  function localSummary() {
    var out = [];
    DOCS.forEach(function (d) {
      var raw = lsGet(d.key);
      var n = 0;
      if (raw) {
        try {
          var v = JSON.parse(raw);
          if (Array.isArray(v)) n = v.length;
          else if (v && typeof v === 'object') n = Object.keys(v).length;
          else n = 1;
        } catch (e) { n = 1; }
      }
      out.push({ docId: d.docId, label: d.label, main: !!d.main, present: !!raw, count: n });
    });
    return out;
  }

  function hasLocal() {
    return DOCS.some(function (d) {
      if (!d.main) return false;
      var raw = lsGet(d.key);
      return !!raw && raw !== 'null' && raw !== '{}' && raw !== '[]';
    });
  }

  /* prefs ko pehle localStorage mein likh do, phir backup lo —
     isse theme choice bhi cloud par chali jaati hai */
  function flushPrefs() {
    try {
      if (window.AchivaSettings && window.AchivaSettings.readPrefs) {
        var p = window.AchivaSettings.readPrefs();
        lsSet('achiva.prefs.v1', JSON.stringify(p));
      }
    } catch (e) { /* ignore */ }
  }

  function lastBackupAt() {
    var raw = lsGet('achiva.lastBackupAt');
    var n = raw ? parseInt(raw, 10) : 0;
    return n || null;
  }

  /* ---------- BACKUP (upload) ----------
     Naya behaviour (silent-partial-backup bug fix):
       1. har doc ka payload bano (limit se bada → gzip 'GZ1:...').
       2. SAARE data docs cloud par likho.
       3. profile doc (lastBackupAt) SIRF tab jab sab succeed ho —
          warna cloud "fresh" dikhta tha jabki ek hissa stale tha,
          aur restore par deletions apply nahi hoti thin.
       4. koi bhi hissa fail → ok:false + hisse ka NAAM + wajah.  */
  function push(s) {
    s = s || sess();
    if (!s || !s.uid) return Promise.resolve({ ok: false, code: 'no-account', message: 'Pehle login karein, phir backup lein.' });
    if (s.offline) return Promise.resolve({ ok: false, code: 'offline', message: 'Offline mode mein backup nahi ho sakta. Net aane par dobara karein.' });
    if (!hasCloud()) return Promise.resolve({ ok: false, code: 'no-cloud', message: 'Cloud ready nahi hai (Firebase config / SDK check karein).' });

    flushPrefs();
    var now = Date.now();
    var toSend = [];      /* [{d, payload}] */
    var tooBig = [];      /* [{label, bytes, gzBytes}] */

    var prep = DOCS.map(function (d) {
      var raw = lsGet(d.key);
      if (raw === null || raw === undefined) return Promise.resolve();  /* jo key hi nahi hai, wo doc nahi banega */
      return makePayload(raw).then(function (p) {
        if (p.tooBig) tooBig.push({ label: d.label, bytes: p.bytes, gzBytes: p.gzBytes });
        else toSend.push({ d: d, payload: p.payload });
      });
    });

    return Promise.all(prep).then(function () {
      var jobs = toSend.map(function (x) {
        return CLOUD.saveDoc('users/' + s.uid + '/data/' + x.d.docId, {
          v: 1,
          savedAt: now,
          value: x.payload              /* JSON string (ya GZ1:...) — byte-exact round trip */
        }).then(function (r) { return { x: x, r: r }; });
      });

      return Promise.all(jobs).then(function (res) {
        var writeFails = [];
        res.forEach(function (rr) {
          if (!rr.r.ok) writeFails.push({ label: rr.x.d.label, message: rr.r.message || msg(rr.r) });
        });

        if (tooBig.length || writeFails.length) {
          /* ADHURA backup — profile/lastBackupAt update NAHI hoga */
          var parts = [];
          tooBig.forEach(function (t) {
            parts.push('"' + t.label + '" ka data bahut bada hai (' + mb(t.bytes) +
              (t.gzBytes ? '; compression ke baad bhi ' + mb(t.gzBytes) : '') +
              ' — limit ~0.9 MB)');
          });
          writeFails.forEach(function (w) { parts.push('"' + w.label + '" save nahi hua: ' + w.message); });
          var okN = toSend.length - writeFails.length;
          return {
            ok: false,
            code: tooBig.length ? 'too-big' : 'partial',
            failedParts: parts,
            message: 'Backup ADHURA hai — ' + parts.join('; ') + '. ' +
              (okN > 0 ? okN + ' hisse cloud par chale gaye, par ' : '') +
              '"Last backup" time JAAN-BOOJH kar update nahi hua taaki saaf pata rahe ki backup adhura hai.'
          };
        }

        /* saare data docs succeed → ab profile doc (lastBackupAt).
           Pehle 'users/<uid>/profile' (3 segments) tha jo Firestore mein
           invalid hai — ab 2 segments = valid DocumentReference. */
        return CLOUD.saveDoc('users/' + s.uid, {
          app: 'achiva',
          v: 1,
          email: s.email || '',
          uid: s.uid,
          createdAt: now,
          lastBackupAt: now
        }).then(function (pr) {
          if (!pr.ok) {
            return { ok: false, code: pr.code, message: 'Data docs chale gaye, par profile doc save nahi hua: ' + (pr.message || msg(pr)) + ' — dobara koshish karein.' };
          }
          lsSet('achiva.lastBackupAt', String(now));
          return { ok: true, at: now, docs: toSend.length + 1 };
        });
      });
    }).catch(function (e) {
      return { ok: false, code: 'unknown', message: msg(e) };
    });
  }

  /* ---------- cloud se poora data padho ----------
     opts.server = true → SIRF server se (restore ke liye zaroori —
     Firestore offline-cache ON hai, aur default .get() net na milne
     par PURANA cached data chup-chaap de deta hai; usse "restore ho
     gaya" dikhta tha par delete ki hui cheezein wapas aa jati thin). */
  function fetchCloud(s, opts) {
    s = s || sess();
    if (!s || !s.uid) return Promise.resolve({ ok: false, code: 'no-account', message: 'Pehle login karein.' });
    if (!hasCloud()) return Promise.resolve({ ok: false, code: 'no-cloud', message: 'Cloud ready nahi hai.' });

    var rd = (opts && opts.server) ? { server: true } : undefined;
    return Promise.all([
      CLOUD.readDoc('users/' + s.uid, rd),          /* profile doc = users/<uid> (2 segments, valid) */
      CLOUD.readDocs('users/' + s.uid + '/data', rd)
    ]).then(function (r) {
      var prof = r[0], docsRes = r[1];
      if (!prof.ok) return { ok: false, code: prof.code, message: prof.message || msg(prof) };
      if (!docsRes.ok) return { ok: false, code: docsRes.code, message: docsRes.message || msg(docsRes) };

      var map = {};
      (docsRes.docs || []).forEach(function (d) {
        if (d.data && typeof d.data.value === 'string') map[d.id] = d.data;
      });
      var items = [];
      DOCS.forEach(function (d) {
        if (map[d.docId]) {
          items.push({ docId: d.docId, label: d.label, value: map[d.docId].value, savedAt: map[d.docId].savedAt || 0 });
        }
      });
      return {
        ok: true,
        items: items,
        profile: prof.data || null,
        lastBackupAt: (prof.data && prof.data.lastBackupAt) || null
      };
    }).catch(function (e) {
      return { ok: false, code: 'unknown', message: msg(e) };
    });
  }

  function cloudSummary(s) {
    return fetchCloud(s).then(function (r) {
      if (!r.ok) return r;
      return {
        ok: true,
        lastBackupAt: r.lastBackupAt,
        items: r.items.map(function (i) { return { docId: i.docId, label: i.label, savedAt: i.savedAt }; }),
        count: r.items.length
      };
    });
  }

  /* ---------- RESTORE (download → localStorage → reload) ---------- */
  function applyItems(items) {
    var n = 0;
    (items || []).forEach(function (it) {
      if (typeof it.value !== 'string') return;
      if (lsSet(it.key || keyOf(it.docId), it.value)) n++;
    });
    return n;
  }

  /* app ko dobara load karo.
     Export ke zariye call hota hai taaki automated test mein ise
     count karne wale function se badla ja sake (production mein
     ye bilkul window.location.reload() hi karta hai).
     IndexedDB v3: reload se PEHLE AppStorage.flush() — pending
     write-behind writes commit ho jayein, warna restore/backup
     ke baad reload par data loss ho sakta hai. */
  function reload() { window.location.reload(); }
  function doReload() {
    var f = (window.AchivaBackup && window.AchivaBackup.reload) || reload;
    var done = false;
    var go = function () { if (!done) { done = true; f(); } };
    if (window.AppStorage && window.AppStorage.flush) {
      window.AppStorage.flush().then(go, go);
      window.setTimeout(go, 2500);   /* failsafe: flush atke to bhi reload ho */
    } else {
      go();
    }
  }

  function keyOf(docId) {
    for (var i = 0; i < DOCS.length; i++) if (DOCS[i].docId === docId) return DOCS[i].key;
    return null;
  }

  function pull(s, opts) {
    s = s || sess();
    opts = opts || {};
    if (!s || !s.uid) return Promise.resolve({ ok: false, code: 'no-account', message: 'Pehle login karein.' });
    if (s.offline) return Promise.resolve({ ok: false, code: 'offline', message: 'Offline mode mein restore nahi ho sakta.' });
    if (!hasCloud()) return Promise.resolve({ ok: false, code: 'no-cloud', message: 'Cloud ready nahi hai.' });

    return fetchCloud(s, { server: true }).then(function (r) {
      if (!r.ok) {
        /* server tak pahunch nahi hui → cache se restore NAHI karenge
           (stale cache = deleted cheezein wapas aane ka dusra zariya tha) */
        if (r.code === 'unavailable' || /unavailable|offline|network|fetch/i.test(r.message || '')) {
          return {
            ok: false, code: 'server-unreachable',
            message: 'Restore ke liye internet zaroori hai — data SERVER se padha jata hai (purana cache use nahi hota, warna delete ki hui cheezein wapas aa sakti hain). Net check karke dobara karein.'
          };
        }
        return r;
      }
      if (!r.items.length) {
        return { ok: false, code: 'empty', message: 'Cloud par abhi koi backup nahi mila. Pehle "Backup now" dabayein.' };
      }
      /* compressed (GZ1:...) values ko kholo, phir apply */
      return Promise.all(r.items.map(function (i) {
        if (!isGz(i.value)) {
          return { docId: i.docId, key: keyOf(i.docId), value: i.value };
        }
        return gzDecompress(i.value).then(function (v) {
          return { docId: i.docId, key: keyOf(i.docId), value: v, bad: (v === null || v === undefined) };
        });
      })).then(function (decoded) {
        var bad = decoded.filter(function (x) { return x.bad; });
        var n = applyItems(decoded.filter(function (x) { return !x.bad; }));
        if (bad.length) {
          return {
            ok: false, count: n, code: 'decode',
            message: 'Backup ke ' + bad.length + ' hisse (compressed) is browser mein khule nahi — app ka naya version load karein (hard refresh) phir dobara restore karein.'
          };
        }
        /* theme turant lagao (reload se pehle bhi sahi dikhe) */
        try {
          if (window.AchivaSettings && window.AchivaSettings.applyThemeFromStorage) {
            window.AchivaSettings.applyThemeFromStorage();
          }
        } catch (e) { /* ignore */ }
        if (r.lastBackupAt) lsSet('achiva.lastBackupAt', String(r.lastBackupAt));
        if (opts.reload !== false) {
          window.setTimeout(doReload, 350);
        }
        return { ok: true, count: n, at: r.lastBackupAt };
      });
    });
  }

  /* ---------- time ko readable banao ---------- */
  function fmtTime(ts) {
    if (!ts) return '—';
    var d = new Date(ts);
    if (isNaN(d.getTime())) return '—';
    var p = function (x) { return String(x).padStart(2, '0'); };
    var mon = (window.UI && UI.MONTHS) ? UI.MONTHS[d.getMonth()] : ('M' + (d.getMonth() + 1));
    return d.getDate() + ' ' + mon +
      ' ' + d.getFullYear() + ' · ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function agoText(ts) {
    if (!ts) return 'kabhi nahi';
    var diff = Date.now() - ts;
    if (diff < 0) diff = 0;
    var m = Math.floor(diff / 60000);
    if (m < 1) return 'abhi';
    if (m < 60) return m + ' min pehle';
    var h = Math.floor(m / 60);
    if (h < 24) return h + ' ghante pehle';
    var dd = Math.floor(h / 24);
    if (dd < 30) return dd + ' din pehle';
    return fmtTime(ts);
  }

  /* ================================================================
     DIALOGS (UI.modal ka use — CSS frozen, isliye sab builder se)
  ================================================================ */
  function dlg(zWrap) {
    return UI.modal({ zWrap: zWrap || 430, zScrim: (zWrap || 430) - 1 });
  }

  function choiceModal(o) {
    var m = dlg(o.z || 430);
    var status = null;
    m.open(o.title, function (body) {
      if (o.text) {
        var p = UI.el('div', null, UI.esc(o.text));
        p.style.cssText = 'font-size:12.5px;line-height:1.7;color:var(--ink2);margin-bottom:10px';
        body.appendChild(p);
      }
      if (o.bullets && o.bullets.length) {
        var ul = UI.el('div');
        ul.style.cssText = 'font-size:11.5px;line-height:1.9;color:var(--ash);margin:0 0 10px;' +
          'padding:8px 12px;border:1px solid var(--line);border-radius:12px;background:var(--chap-bg)';
        o.bullets.forEach(function (b) { ul.appendChild(UI.el('div', null, '• ' + UI.esc(b))); });
        body.appendChild(ul);
      }
      (o.buttons || []).forEach(function (b) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = b.label;
        btn.className = b.cls || 'btn-solid';
        btn.style.cssText = 'width:100%;flex:none;margin-top:8px;padding:12px;border-radius:12px;' +
          'font:inherit;font-size:13px;font-weight:600;cursor:pointer;' +
          (b.cls === 'btn-ghost'
            ? 'border:1px solid var(--s2);background:transparent;color:var(--ink2)'
            : 'border:0;background:var(--ink);color:var(--paper)');
        btn.addEventListener('click', function () {
          if (status) status.textContent = '';
          var setStat = function (t) {
            if (!status) {
              status = UI.el('div');
              status.style.cssText = 'font-size:11.5px;color:var(--ash);text-align:center;margin-top:10px';
              body.appendChild(status);
            }
            status.textContent = t;
          };
          b.onClick(btn, setStat, b.finish);
        });
        body.appendChild(btn);
      });
    }, null);          /* saveFn null → modal ke apne Save/Cancel buttons nahi dikhenge */
    return m;
  }

  /* ---------- login ke baad ka faisla (sirf ek baar) ---------- */
  function firstRunFlow(s) {
    if (!s || !s.uid) return Promise.resolve(null);
    if (s.offline) return Promise.resolve({ action: 'offline' });
    if (!hasCloud()) return Promise.resolve({ action: 'no-cloud' });

    return fetchCloud(s).then(function (r) {
      if (!r.ok) return r;

      var cloudHas = r.items.length > 0;
      var localHas = hasLocal();
      var cloudAt = r.lastBackupAt ? agoText(r.lastBackupAt) : '—';

      /* 1) cloud khali + local khali → kuch nahi karna */
      if (!cloudHas && !localHas) return { action: 'none' };

      /* 2) cloud khali + local bhara → upload ka offer */
      if (!cloudHas && localHas) {
        return ask({
          title: 'Data cloud par bhejein?',
          text: 'Is phone mein pehle se data saved hai, lekin cloud par abhi koi backup nahi hai.',
          buttons: [
            { label: 'Haan, abhi backup karein', cls: 'btn-solid', onClick: function (btn, setStat, finish) {
                setStat('Backup ho raha hai...');
                btn.disabled = true;
                push(s).then(function (res) {
                  if (res.ok) { setStat('Backup ho gaya ✔'); doReload(); }
                  else { setStat(res.message || msg(res)); btn.disabled = false; finish(); }
                });
              } },
            { label: 'Abhi nahi', cls: 'btn-ghost', done: false, onClick: function (btn, setStat, finish) { finish({ action: 'skip' }); } }
          ],
          result: { action: 'offer-upload' }
        });
      }

      /* 3) cloud bhara + local khali → restore ka offer */
      if (cloudHas && !localHas) {
        return ask({
          title: 'Cloud backup mila',
          text: 'Aapke account mein pehle se data save hai. Use is phone par wapas laayein?',
          bullets: ['Last backup: ' + cloudAt, 'Cloud par ' + r.items.length + ' hisse saved hain'],
          buttons: [
            { label: 'Haan, data wapas laayein', cls: 'btn-solid', onClick: function (btn, setStat, finish) {
                setStat('Restore ho raha hai...');
                btn.disabled = true;
                pull(s).then(function (res) {
                  if (res.ok) setStat('Restore ho gaya ✔ App reload ho rahi hai...');
                  else { setStat(res.message || msg(res)); btn.disabled = false; finish(); }
                });
              } },
            { label: 'Nahi, khaali se shuru karein', cls: 'btn-ghost', done: false, onClick: function (btn, setStat, finish) { finish({ action: 'skip' }); } }
          ],
          result: { action: 'offer-restore' }
        });
      }

      /* 4) dono bhare → teen raaste */
      return ask({
        title: 'Data ka faisla aapka',
        text: 'Is phone par bhi data hai aur cloud par bhi. Kya karna hai?',
        bullets: ['Cloud backup: ' + cloudAt, 'Phone ka data: ' + localCountText()],
        buttons: [
          { label: 'Cloud wala data yahan laayein', cls: 'btn-solid', onClick: function (btn, setStat, finish) {
              setStat('Restore ho raha hai...');
              btn.disabled = true;
              pull(s).then(function (res) {
                if (res.ok) setStat('Restore ho gaya ✔ App reload ho rahi hai...');
                else { setStat(res.message || msg(res)); btn.disabled = false; finish(); }
              });
            } },
          { label: 'Phone wala data cloud par bhejein', cls: 'btn-ghost', onClick: function (btn, setStat, finish) {
              setStat('Backup ho raha hai...');
              btn.disabled = true;
              push(s).then(function (res) {
                if (res.ok) setStat('Ho gaya ✔ Ab data cloud par safe hai.');
                else { setStat(res.message || msg(res)); btn.disabled = false; finish(); }
              });
            } },
          { label: 'Kuch nahi, phone wala data hi rakhein', cls: 'btn-ghost', done: false, onClick: function (btn, setStat, finish) { finish({ action: 'skip' }); } }
        ],
        result: { action: 'offer-merge' }
      });
    });

    /* modal khola; button ka kaam pure hone par modal band + result resolve */
    function ask(o) {
      return new Promise(function (resolve) {
        var m = null;
        var settled = false;
        var finish = function (r) {
          if (m) m.close();
          if (!settled) { settled = true; resolve(r); }
        };
        var wrapped = (o.buttons || []).map(function (b) {
          return {
            label: b.label,
            cls: b.cls,
            finish: finish,
            done: b.done,
            onClick: function (btn, setStat) {
              /* button apna kaam kare; kaam pure hone par finish() */
              b.onClick(btn, setStat, finish);
            }
          };
        });
        m = choiceModal({ title: o.title, text: o.text, bullets: o.bullets, buttons: wrapped, z: o.z });
        /* modal khula hi hai — caller ko bata do (user abhi soch raha hai) */
        window.setTimeout(function () {
          if (!settled) { settled = true; resolve(o.result || { action: 'shown' }); }
        }, 100);
      });
    }
  }

  function localCountText() {
    var s = localSummary().filter(function (x) { return x.main && x.present; });
    if (!s.length) return 'khaali';
    return s.map(function (x) { return x.label; }).join(', ');
  }

  /* ---------- Settings panel ke buttons ---------- */
  function backupNow(setStat) {
    var s = sess();
    if (!s) { setStat('Pehle login karein.'); return; }
    setStat('Backup ho raha hai...');
    push(s).then(function (r) {
      if (r.ok) setStat('Backup ho gaya ✔ ' + fmtTime(r.at) + ' · ' + r.docs + ' hisse cloud par.');
      else setStat(r.message ? ('⚠ ' + r.message) : ('Backup fail: ' + msg(r)));
      try { window.AchivaSettings.refreshBackup(); } catch (e) { /* ignore */ }
    });
  }

  function restoreNow(setStat) {
    var s = sess();
    if (!s) { setStat('Pehle login karein.'); return; }
    choiceModal({
      title: 'Cloud se restore karein?',
      text: 'Is phone ka data cloud wale backup se BADAL jayega (jo bhi aakhri backup tha).',
      bullets: ['App restore ke baad apne aap reload ho jayegi.'],
      buttons: [
        { label: 'Haan, restore karein', cls: 'btn-solid', onClick: function (btn, st) {
            setStat('Restore ho raha hai...');
            btn.disabled = true;
            pull(s).then(function (r) {
              if (r.ok) setStat('Restore ho gaya ✔ App reload ho rahi hai...');
              else { setStat('Restore fail: ' + (r.message || msg(r))); st(''); btn.disabled = false; }
            });
          } },
        { label: 'Cancel', cls: 'btn-ghost', done: false, onClick: function (btn, setStat, finish) { finish({ action: 'cancel' }); } }
      ]
    });
  }

  window.AchivaBackup = {
    DOCS: DOCS,
    push: push,
    pull: pull,
    fetchCloud: fetchCloud,
    cloudSummary: cloudSummary,
    localSummary: localSummary,
    hasLocal: hasLocal,
    lastBackupAt: lastBackupAt,
    firstRunFlow: firstRunFlow,
    backupNow: backupNow,
    restoreNow: restoreNow,
    fmtTime: fmtTime,
    agoText: agoText,
    reload: reload,
    clearLastBackup: function () { lsDel('achiva.lastBackupAt'); },
    /* compression internals — tests/debug ke liye */
    _gz: {
      PREFIX: GZ_PREFIX,
      RULE_CHAR_LIMIT: RULE_CHAR_LIMIT,
      compress: gzCompress,
      decompress: gzDecompress,
      fits: fits,
      byteLen: byteLen,
      isGz: isGz
    }
  };
})();
