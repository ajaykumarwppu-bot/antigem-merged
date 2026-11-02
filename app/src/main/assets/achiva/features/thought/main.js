/* ================================================================
   FEATURES / THOUGHT / MAIN.JS — Thought feature ki MAIN screen
   ----------------------------------------------------------------
   Layout (upar se neeche, poori screen SCROLLABLE) :
     • head : title + [AI] (feature ka apna provider pick) +
              [Knowledge Graph]
     • center box : do parallel tiles — [Recording] [Upload]
     • PENDING row : jo recordings abhi process nahi hui —
       yahin [Process] button; process hote hi row hat jaati hai
     • CALENDAR strip : horizontal scrollable date boxes + upar
       usi ka MONTH/YEAR label jo date focus/selected hai; scroll
       karo ya date tap karo → neeche usi din ke thoughts
     • DATE CARDS : us date ki processed recordings — naam,
       duration/time, aur ARROW button → detail screen
       (detail.js : audio replay + transcript + summary + connect)
   • AI ka output (transcript/summary) main screen par NAHI dikhta
     — sab detail screen par jaata hai (user ka rule).
   • Recording/thought sab PERMANENT save : ThoughtStore (store.js)
     — meta AppStorage mein, audio blobs IndexedDB mein.
   • ES5-only.
   ================================================================ */

(function () {
  'use strict';

  if (window.__achivaThoughtMainLoaded) return;
  window.__achivaThoughtMainLoaded = true;

  var el = UI.el, esc = UI.esc;
  var S = function () { return window.ThoughtStore; };

  var ICON_MIC = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z"/><path d="M19 11a7 7 0 0 1-14 0"/><path d="M12 18v4M8 22h8"/></svg>';
  var ICON_UP = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4"/><path d="M6 10l6-6 6 6"/><path d="M4 20h16"/></svg>';
  var ICON_CHEV = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>';

  var screen = el('section', 'screen');
  screen.style.cssText += ';padding-top:58px';
  document.getElementById('app').appendChild(screen);

  /* DAY-CLOCK : 'aaj' app ke apne din se */
  function appToday() { return window.DayClock ? window.DayClock.today() : UI.todayISO(); }

  var selDate = appToday();
  var statusEl = null;
  function statusLine(m) { if (statusEl) statusEl.textContent = m || ''; }

  /* ================================================================
     THOUGHT CHROME : graph screen par header/FAB chhupo (graph.js
     ka data-thought-full attribute), baaki screens par normal.
  ================================================================ */
  function applyChrome() {
    var act = document.querySelector('section.screen.active');
    var inFull = !!(act && act.getAttribute && act.getAttribute('data-thought-full'));
    var top = document.querySelector('.home-top');
    var fab = document.getElementById('fab');
    if (top) top.style.display = inFull ? 'none' : '';
    if (fab) fab.style.visibility = inFull ? 'hidden' : '';
  }
  try {
    if (window.MutationObserver) {
      var mo = new MutationObserver(function () { applyChrome(); });
      mo.observe(document.getElementById('app'), { subtree: true, attributes: true, attributeFilter: ['class'] });
    }
  } catch (e) { /* purana browser */ }

  /* ================================================================
     CAPTURE : record popup + upload
  ================================================================ */
  function fmtT(s) {
    return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  }

  function addFromBlob(blob, duration, fileName) {
    var audioId = UI.uid();
    var ext = (window.AchivaAIAudio && window.AchivaAIAudio.extOf)
      ? window.AchivaAIAudio.extOf(blob, fileName) : 'webm';
    var t = S().add({
      type: 'audio', audioId: audioId, mime: blob.type || '', ext: ext,
      size: blob.size || 0, duration: duration || 0, status: 'pending'
    });
    S().audioPut(audioId, blob);
    render();
    return t;
  }

  /* ---------- delete : do-click confirm wala trash button ---------- */
  function deleteBtn(getThought, label) {
    var b = UI.miniBtn(UI.icons.trash, label || 'Delete');
    b.style.cssText += ';border:1px solid var(--s2);background:var(--chip-bg);color:var(--slate)';
    var armed = false, timer = null;
    b.addEventListener('click', function (e) {
      e.stopPropagation();
      if (!armed) {
        armed = true;
        b.innerHTML = UI.icons.trash + '<span style="font-size:9px;font-weight:700">Pakka?</span>';
        b.style.color = '#c0392b';
        timer = window.setTimeout(function () {
          armed = false;
          b.innerHTML = UI.icons.trash;
          b.style.color = 'var(--slate)';
        }, 3000);
        return;
      }
      window.clearTimeout(timer);
      var t = getThought();
      if (t) S().remove(t.id);
      render();
    });
    return b;
  }

  /* ---------- AI provider guard : role-wise (tr = audio, st = normal) ---------- */
  function ensureProvider(role) {
    var cfg = (window.ThoughtAI && window.ThoughtAI.pickedCfg) ? window.ThoughtAI.pickedCfg(role) : null;
    if (cfg) return true;
    statusLine(role === 'tr'
      ? 'Transcript ke liye koi AI nahi mila — NORMAL ya AUDIO category mein AI add/choose karo.'
      : 'Pehle NORMAL category ka AI chuno/add karo — phir summary banegi.');
    if (window.AchivaAIHub && window.AchivaAIHub.list().length) {
      if (window.ThoughtAI && window.ThoughtAI.openChoose) window.ThoughtAI.openChoose();
    } else if (window.AchivaAIHubSettings) {
      window.AchivaAIHubSettings.open();
    }
    return false;
  }

  /* STAGE 1 : AUDIO category ka AI → transcript */
  function processThought(t) {
    if (!window.ThoughtProcessRun) return;
    S().update(t.id, { status: 'processing', error: '' });
    render();
    Promise.resolve(window.ThoughtProcessRun(t)).then(function (res) {
      if (res && res.ok) {
        S().update(t.id, {
          status: 'transcribed',
          transcript: res.transcript || '',
          language: res.language || '',
          usedTr: res.provider || ''
        });
        statusLine('Transcript aa gayi — ab "Extract Summary" se summary banegi.');
      } else {
        var em = (res && res.error) || 'Transcript nahi ban payi';
        S().update(t.id, { status: 'error', error: em });
        if (/selected nahi|key/i.test(em)) {
          statusLine('AUDIO category ka AI add/choose karo (Settings → AI ya AI button) — phir Retry karo.');
        }
      }
      render();
    }, function () {
      S().update(t.id, { status: 'error', error: 'AI call fail ho gayi' });
      render();
    });
  }

  /* STAGE 2 : NORMAL category ka AI → summary/structured */
  function extractThought(t) {
    if (!window.ThoughtExtractRun) return;
    S().update(t.id, { status: 'processing', error: '' });
    render();
    Promise.resolve(window.ThoughtExtractRun(t)).then(function (res) {
      if (res && res.ok) {
        var patch = {
          status: 'done',
          structured: res.structured || null,
          language: res.language || t.language || ''
        };
        patch.name = S().defaultName({ createdAt: t.createdAt, structured: patch.structured, transcript: t.transcript });
        S().update(t.id, patch);
        statusLine('Summary taiyaar — detail mein padho.');
      } else {
        var em = (res && res.error) || 'Summary nahi ban payi';
        S().update(t.id, { status: 'transcribed', error: em });
        if (/selected nahi|key/i.test(em)) {
          statusLine('NORMAL category ka AI add/choose karo — phir Extract Summary dabao.');
        }
      }
      render();
    }, function () {
      S().update(t.id, { status: 'transcribed', error: 'AI call fail ho gayi' });
      render();
    });
  }

  function openRecPopup() {
    var m = UI.modal({ zScrim: 90, zWrap: 91 });
    var rec = null, chunks = [], t0 = 0, pausedAt = 0, pausedTotal = 0, iv = 0, stopped = false;
    m.open('Recording', function (body) {
      var dot = el('div', null, '●');
      dot.style.cssText = 'color:#c0392b;font-size:26px;text-align:center;line-height:1';
      body.appendChild(dot);
      var timer = el('div', null, '00:00');
      timer.style.cssText = 'font-family:var(--f-mono);font-size:30px;font-weight:700;color:var(--ink);' +
        'text-align:center;margin:6px 0 2px';
      body.appendChild(timer);
      var sub = el('div', null, 'Recording jaari hai…');
      sub.style.cssText = 'font-size:10.5px;color:var(--ash);text-align:center;margin-bottom:14px';
      body.appendChild(sub);

      var row = el('div');
      row.style.cssText = 'display:flex;gap:8px;justify-content:center;flex-wrap:wrap';
      var pauseB = UI.pillBtn('Pause');
      var stopB = UI.pillBtn('Stop & Save');
      stopB.style.cssText += ';background:var(--ink);color:var(--paper);border-color:var(--ink)';
      row.appendChild(pauseB);
      row.appendChild(stopB);
      body.appendChild(row);

      var msg = el('div');
      msg.style.cssText = 'font-size:11px;color:var(--slate);text-align:center;margin-top:10px;min-height:14px';
      body.appendChild(msg);

      function paintTimer() {
        var s = Math.floor(((pausedAt || Date.now()) - t0 - pausedTotal) / 1000);
        timer.textContent = fmtT(Math.max(0, s));
      }
      pauseB.addEventListener('click', function () {
        if (!rec) return;
        try {
          if (rec.state === 'recording') {
            rec.pause(); pausedAt = Date.now();
            pauseB.innerHTML = 'Resume';
            sub.textContent = 'Paused — timer ruka hua hai';
          } else if (rec.state === 'paused') {
            pausedTotal += Date.now() - pausedAt; pausedAt = 0;
            rec.resume();
            pauseB.innerHTML = 'Pause';
            sub.textContent = 'Recording jaari hai…';
          }
        } catch (e) { msg.textContent = 'Pause/resume support nahi hai is device par.'; }
      });
      stopB.addEventListener('click', function () {
        if (stopped) return;
        stopped = true;
        if (iv) window.clearInterval(iv);
        if (rec && rec.state !== 'inactive') {
          try { rec.stop(); } catch (e) { finish(null, 0); }
        } else finish(null, 0);
      });
      function finish(blob, dur) {
        m.close();
        if (blob) addFromBlob(blob, dur);
      }
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) {
        msg.textContent = 'Is browser/device mein recording support nahi — Upload use karo.';
        stopB.innerHTML = 'Band karo';
        return;
      }
      navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
        try { rec = new MediaRecorder(stream); } catch (e) {
          msg.textContent = 'Recorder shuru nahi hua — Upload use karo.';
          return;
        }
        chunks = [];
        rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
        rec.onstop = function () {
          stream.getTracks().forEach(function (t) { t.stop(); });
          finish(new Blob(chunks, { type: rec.mimeType || 'audio/webm' }),
            Math.max(1, Math.round((Date.now() - t0 - pausedTotal) / 1000)));
        };
        rec.start();
        t0 = Date.now(); pausedTotal = 0; pausedAt = 0;
        iv = window.setInterval(paintTimer, 400);
      }, function () {
        msg.textContent = 'Mic permission nahi mili — settings mein allow karo.';
      });
    }, null);
  }

  /* ================================================================
     CALENDAR STRIP : scrollable dates + month/year label
  ================================================================ */
  function stripRange() {
    var dates = S().datesWithThoughts();
    var start = dates.length ? dates[0] : UI.addDays(appToday(), -13);
    if (start > selDate) start = selDate;
    if (selDate < start) start = selDate;
    var end = appToday();
    if (end < selDate) end = selDate;
    return { start: start, end: end };
  }

  function monthLabel(iso) {
    var d = UI.fromISO(iso);
    return UI.MONTHS[d.getMonth()] + ' ' + d.getFullYear();
  }

  function buildStrip(scroll) {
    var wrap = el('div');
    wrap.style.cssText = 'margin:14px 18px 4px';
    var lab = el('div', null, monthLabel(selDate));
    lab.style.cssText = 'font-family:var(--f-disp);font-size:13px;font-weight:700;color:var(--ink);margin-bottom:6px';
    wrap.appendChild(lab);

    var strip = el('div');
    strip.style.cssText = 'display:flex;gap:6px;overflow-x:auto;padding:2px 0 6px;' +
      'scrollbar-width:thin;-webkit-overflow-scrolling:touch';
    wrap.appendChild(strip);

    var r = stripRange();
    var cells = [];
    var d = r.start;
    var guard = 0;
    while (d <= r.end && guard < 800) {
      (function (iso) {
        var has = S().onDate(iso).length > 0;
        var on = iso === selDate;
        var b = el('button');
        b.type = 'button';
        b.setAttribute('data-date', iso);
        b.style.cssText = 'flex:none;width:44px;padding:7px 0;border-radius:12px;cursor:pointer;font:inherit;' +
          'display:flex;flex-direction:column;align-items:center;gap:3px;transition:.15s;' +
          (on
            ? 'background:var(--ink);color:var(--paper);border:1px solid var(--ink)'
            : 'background:var(--chip-bg);color:var(--ink2);border:1px solid var(--s2)');
        var dn = el('span', null, String(UI.fromISO(iso).getDate()));
        dn.style.cssText = 'font-size:13px;font-weight:700';
        b.appendChild(dn);
        var dot = el('span');
        dot.style.cssText = 'width:5px;height:5px;border-radius:50%;' +
          (has ? 'background:' + (on ? 'var(--paper)' : '#2ea043') : 'background:transparent');
        b.appendChild(dot);
        b.addEventListener('click', function () { selDate = iso; render(); });
        cells.push(b);
        strip.appendChild(b);
      })(d);
      d = UI.addDays(d, 1);
      guard++;
    }

    /* scroll : beech wali date select + uska month/year label */
    var scrollTimer = null;
    strip.addEventListener('scroll', function () {
      if (scrollTimer) window.clearTimeout(scrollTimer);
      scrollTimer = window.setTimeout(function () {
        var mid = strip.scrollLeft + strip.clientWidth / 2;
        var best = null, bd = 1e9;
        cells.forEach(function (c) {
          var cx = c.offsetLeft + c.offsetWidth / 2;
          var dd = Math.abs(cx - mid);
          if (dd < bd) { bd = dd; best = c; }
        });
        if (best && best.getAttribute('data-date') !== selDate) {
          selDate = best.getAttribute('data-date');
          render();
        } else {
          lab.textContent = monthLabel(selDate);
        }
      }, 140);
    });

    scroll.appendChild(wrap);
    /* selected date view mein lao */
    window.setTimeout(function () {
      var sel = strip.querySelector('button[data-date="' + selDate + '"]');
      if (sel && strip.scrollWidth > strip.clientWidth) {
        try { strip.scrollLeft = Math.max(0, sel.offsetLeft - strip.clientWidth / 2 + 22); } catch (e) { /* jsdom */ }
      }
    }, 0);
    return strip;
  }

  /* ================================================================
     RENDER
  ================================================================ */
  function render() {
    screen.innerHTML = '';
    var scroll = el('div', 'scroll');

    /* head */
    var head = el('div');
    head.style.cssText = 'display:flex;align-items:center;gap:8px;padding:12px 16px 6px';
    var tt = el('b', null, 'Thought');
    tt.style.cssText = 'flex:1;font-family:var(--f-disp);font-size:17px;font-weight:700;color:var(--ink)';
    head.appendChild(tt);
    var aiB = UI.pillBtn('AI');
    aiB.style.cssText += ';padding:8px 12px;font-size:11.5px;font-weight:700';
    aiB.addEventListener('click', function () {
      if (window.ThoughtAI && window.ThoughtAI.openChoose) { window.ThoughtAI.openChoose(); return; }
      var miss = (window.__ACHIVA_LOAD_ERRORS || []).join(', ');
      statusLine('AI module load nahi hua' + (miss ? ' (missing: ' + miss + ')' : '') +
        ' — reload karo; ai/ folder ki files check karo.');
    });
    head.appendChild(aiB);
    var kgB = UI.pillBtn('Knowledge Graph');
    kgB.style.cssText += ';padding:8px 12px;font-size:11.5px;font-weight:700';
    kgB.addEventListener('click', function () {
      if (window.ThoughtGraph) window.ThoughtGraph.open();
    });
    head.appendChild(kgB);
    scroll.appendChild(head);

    /* center box : tiles */
    var center = el('div');
    center.style.cssText = 'margin:6px 18px 0;padding:16px;border:1px solid var(--line);border-radius:20px;' +
      'background:var(--tile-bg);box-shadow:inset 0 1px 0 var(--hl-soft)';
    var tiles = el('div');
    tiles.style.cssText = 'display:flex;gap:12px';
    function tile(icon, label) {
      var b = el('button');
      b.type = 'button';
      b.style.cssText = 'flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;' +
        'gap:9px;height:104px;border-radius:16px;border:1px solid var(--s2);background:var(--chip-bg);' +
        'color:var(--ink2);cursor:pointer;font:inherit;box-shadow:inset 0 1px 0 var(--hl-soft)';
      b.appendChild(el('span', null, icon));
      var l = el('span', null, label);
      l.style.cssText = 'font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase';
      b.appendChild(l);
      return b;
    }
    var recTile = tile(ICON_MIC, 'Recording');
    var upTile = tile(ICON_UP, 'Upload');
    recTile.addEventListener('click', openRecPopup);
    tiles.appendChild(recTile);
    tiles.appendChild(upTile);
    center.appendChild(tiles);
    statusEl = el('div');
    statusEl.style.cssText = 'font-size:11px;color:var(--slate);line-height:1.6;margin-top:10px;min-height:14px';
    center.appendChild(statusEl);
    scroll.appendChild(center);

    var fileIn = el('input');
    fileIn.type = 'file';
    fileIn.accept = 'audio/*';
    fileIn.style.display = 'none';
    fileIn.addEventListener('change', function () {
      var f = fileIn.files && fileIn.files[0];
      if (!f) return;
      if (f.size > 25 * 1024 * 1024) { statusLine('File 25MB se badi hai — chhoti audio chuno.'); return; }
      addFromBlob(f, 0, f.name);
      statusLine('Upload save ho gayi — Process dabao.');
      fileIn.value = '';
    });
    upTile.addEventListener('click', function () { fileIn.click(); });
    scroll.appendChild(fileIn);

    /* PENDING row : bina process recordings (Process button yahin) */
    var pending = S().all().filter(function (t) {
      return t.status === 'pending' || t.status === 'processing' || t.status === 'transcribed';
    });
    if (pending.length) {
      var pwrap = el('div');
      pwrap.style.cssText = 'margin:10px 18px 0';
      pending.forEach(function (t) {
        var row = el('div');
        row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:10px 12px;margin-bottom:8px;' +
          'border:1px dashed var(--s2);border-radius:14px;background:var(--chap-bg)';
        var nm = el('div');
        nm.style.cssText = 'flex:1;min-width:0';
        var l1 = el('div', null, esc('Recording · ' + new Date(t.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })));
        l1.style.cssText = 'font-size:12px;font-weight:700;color:var(--ink)';
        nm.appendChild(l1);
        var l2txt = t.status === 'processing' ? 'AI chal raha hai…'
          : t.status === 'transcribed' ? 'transcript ready — summary baaki'
          : 'process baaki hai';
        var l2 = el('div', null, l2txt);
        l2.style.cssText = 'font-size:10px;color:var(--ash);margin-top:2px';
        nm.appendChild(l2);
        if (t.error) {
          var el2 = el('div', null, esc(t.error));
          el2.style.cssText = 'font-size:10px;color:#c0392b;margin-top:2px;line-height:1.4';
          nm.appendChild(el2);
        }
        row.appendChild(nm);
        if (t.status === 'transcribed') {
          var xb = UI.pillBtn('Extract Summary');
          xb.style.cssText += ';padding:7px 12px;font-size:11px';
          xb.addEventListener('click', function () { if (ensureProvider('st')) extractThought(t); });
          row.appendChild(xb);
          var ab2 = UI.miniBtn(UI.icons && window.UI.icons.back ? '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>' : '>', 'Open detail');
          ab2.style.cssText += ';border:1px solid var(--s2);background:var(--chip-bg)';
          ab2.addEventListener('click', function (ev) { ev.stopPropagation(); openDetail(t.id); });
          row.appendChild(ab2);
        } else {
          var pb = UI.pillBtn(t.status === 'processing' ? '…' : 'Process');
          pb.style.cssText += ';padding:7px 12px;font-size:11px';
          pb.disabled = t.status === 'processing';
          pb.addEventListener('click', function () { if (ensureProvider('tr')) processThought(t); });
          row.appendChild(pb);
        }
        row.appendChild(deleteBtn(function () { return S().get(t.id); }, 'Delete recording'));
        pwrap.appendChild(row);
      });
      scroll.appendChild(pwrap);
    }

    /* CALENDAR strip */
    buildStrip(scroll);

    /* DATE CARDS : selDate ke processed thoughts */
    var cardsWrap = el('div');
    cardsWrap.style.cssText = 'margin:4px 18px 18px';
    var dayList = S().onDate(selDate).filter(function (t) {
      return t.status !== 'pending' && t.status !== 'processing' && t.status !== 'transcribed';
    });
    if (!dayList.length) {
      var e = el('div', null, 'Is date par koi thought nahi.');
      e.style.cssText = 'font-size:11px;color:var(--slate);padding:10px 2px;line-height:1.6';
      cardsWrap.appendChild(e);
    }
    dayList.forEach(function (t) {
      var c = el('div');
      c.style.cssText = 'position:relative;display:flex;align-items:center;gap:10px;padding:12px 44px 12px 14px;' +
        'margin-bottom:10px;border:1px solid var(--line);border-radius:16px;background:var(--tile-bg);' +
        'box-shadow:inset 0 1px 0 var(--hl-soft);cursor:pointer';
      var main = el('div');
      main.style.cssText = 'flex:1;min-width:0';
      var nm = el('div', null, esc(t.name || 'Thought'));
      nm.style.cssText = 'font-size:13px;font-weight:700;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
      main.appendChild(nm);
      var bits = [];
      if (t.duration) bits.push(fmtT(t.duration));
      if (t.size) bits.push(Math.round(t.size / 1024) + 'KB');
      bits.push(new Date(t.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
      var mt = el('div', null, esc(bits.join(' · ')));
      mt.style.cssText = 'font-size:10.5px;color:var(--ash);margin-top:3px';
      main.appendChild(mt);
      if (t.status === 'error') {
        var er = UI.chip('error');
        er.style.cssText += ';font-size:9px;background:rgba(192,57,43,.12);color:#c0392b;border-color:rgba(192,57,43,.35);margin-top:5px';
        main.appendChild(er);
      }
      /* error ka ASLI reason bhi card par (taaki agli baar andha guess na ho) */
      if (t.status === 'error' && t.error) {
        var et = el('div', null, esc(t.error));
        et.style.cssText = 'font-size:10px;color:#c0392b;margin-top:4px;line-height:1.45;' +
          'display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden';
        main.appendChild(et);
      }
      c.appendChild(main);
      if (t.status === 'error') {
        var rb = UI.pillBtn('Retry');
        rb.style.cssText += ';padding:6px 10px;font-size:10.5px';
        rb.addEventListener('click', function (ev) {
          ev.stopPropagation();
          if (ensureProvider('tr')) processThought(t);
        });
        c.appendChild(rb);
      }
      c.appendChild(deleteBtn(function () { return S().get(t.id); }, 'Delete thought'));
      var ab = el('button', null, ICON_CHEV);
      ab.type = 'button';
      ab.setAttribute('aria-label', 'Open thought detail');
      ab.style.cssText = 'position:absolute;right:10px;top:50%;transform:translateY(-50%);width:28px;height:28px;' +
        'border-radius:8px;border:0;background:transparent;color:var(--slate);cursor:pointer;' +
        'display:flex;align-items:center;justify-content:center';
      ab.addEventListener('click', function (ev) { ev.stopPropagation(); openDetail(t.id); });
      c.appendChild(ab);
      c.addEventListener('click', function () { openDetail(t.id); });
      cardsWrap.appendChild(c);
    });
    scroll.appendChild(cardsWrap);

    screen.appendChild(scroll);
    applyChrome();
  }

  function openDetail(id) {
    if (window.ThoughtDetail) window.ThoughtDetail.open(id);
  }

  function open() {
    render();
    if (window.SubjectListBridge) window.SubjectListBridge.show(screen, true);
  }

  window.ThoughtMain = {
    open: open,
    render: render,
    addFromBlob: addFromBlob,
    processThought: processThought,
    extractThought: extractThought,
    selectedDate: function () { return selDate; },
    setSelectedDate: function (iso) { selDate = iso; }
  };
  /* FAB → THOUGHT : main screen pehle */
  window.ThoughtFeature = { open: open };
})();
