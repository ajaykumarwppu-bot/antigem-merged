/* ================================================================
   FEATURES / FOCUS / FOCUS-UI.JS — Focus Shield ka Settings section
   ----------------------------------------------------------------
   Entry SIRF Settings ⚙️ se (user ka choice) — koi naya nav item nahi,
   koi CSS file change nahi (sab inline styles, settings.js ke jaise).

   Section mein :
     1. Status       : service chalu/band, usage-access, overlay permission
     2. Rules        : list + add/edit/delete/on-off (editor sheet se)
     3. Settings     : strictness level (Normal/Strict/Ultra Strict),
                       cooldown, boot-start, lock-screen message,
                       emergency unlock (ultra mein band), unlock+mode log
   Enforcement Android par FocusService karti hai; yahan sirf authoring.
   ================================================================ */

(function () {
  'use strict';

  if (window.__achivaFocusUILoaded) return;
  window.__achivaFocusUILoaded = true;

  function F() { return window.AchivaFocus; }
  function U() { return window.UI || null; }
  function el(tag, text) {
    var n = document.createElement(tag);
    if (text != null) n.textContent = text;
    return n;
  }
  function note(text) {
    var n = el('div');
    n.style.cssText = 'font-size:11px;line-height:1.6;color:var(--slate);margin:6px 0';
    n.innerHTML = text;
    return n;
  }

  /* ---------- atoms ---------- */
  function row(labelText, right) {
    var r = el('div');
    r.style.cssText = 'display:flex;align-items:center;gap:8px;padding:9px 0;' +
      'border-bottom:1px dashed var(--s2)';
    var l = el('div');
    l.style.cssText = 'flex:1;min-width:0;font-size:11.5px;line-height:1.45;color:var(--slate)';
    l.innerHTML = labelText;
    r.appendChild(l);
    if (right) {
      var v = el('div');
      v.style.cssText = 'display:flex;align-items:center;gap:6px;flex-wrap:wrap;justify-content:flex-end';
      if (typeof right === 'string') {
        var s = el('span', right);
        s.style.cssText = 'font-size:11px;font-weight:700;color:var(--ink)';
        v.appendChild(s);
      } else v.appendChild(right);
      r.appendChild(v);
    }
    return r;
  }
  function pill(text, fn, primary) {
    var b = el('button', text);
    b.type = 'button';
    b.style.cssText = 'padding:7px 13px;border-radius:99px;cursor:pointer;font:inherit;' +
      'font-size:11.5px;font-weight:700;transition:.15s;' +
      (primary
        ? 'background:var(--ink);color:var(--paper);border:1px solid var(--ink)'
        : 'background:var(--chip-bg);color:var(--slate);border:1px solid var(--s2)');
    b.addEventListener('click', fn);
    return b;
  }
  function chip(text, on, fn) {
    var c = pill(text, fn, on);
    c.style.padding = '7px 12px';
    return c;
  }
  function toggle(on, fn) {
    var t = pill(on ? 'On' : 'Off', fn, !!on);
    t.style.minWidth = '52px';
    return t;
  }
  function field(type, value, opts) {
    opts = opts || {};
    var i = el('input');
    i.type = type;
    if (value != null) i.value = value;
    if (opts.min != null) i.min = opts.min;
    if (opts.max != null) i.max = opts.max;
    if (opts.placeholder) i.placeholder = opts.placeholder;
    i.style.cssText = 'font:inherit;font-size:12px;color:var(--ink);background:var(--chip-bg);' +
      'border:1px solid var(--s2);border-radius:10px;padding:8px 10px;' +
      (opts.width ? 'width:' + opts.width : 'width:100%') + ';box-sizing:border-box';
    return i;
  }
  function group(title, inner) {
    var g = el('div');
    g.style.cssText = 'margin:10px 0';
    var h = el('div', title);
    h.style.cssText = 'font-size:9.5px;letter-spacing:.14em;text-transform:uppercase;' +
      'color:var(--ash);font-weight:700;margin-bottom:7px';
    g.appendChild(h);
    if (inner) g.appendChild(inner);
    return g;
  }

  var DAYS = [[1, 'Sun'], [2, 'Mon'], [3, 'Tue'], [4, 'Wed'], [5, 'Thu'], [6, 'Fri'], [7, 'Sat']];
  var MODES = [['time', 'Time window'], ['target', 'Target tak'], ['timer', 'Timer chal raha ho']];

  /* ---------- 1. status ---------- */
  function statusBlock(host) {
    var f = F();
    var g = group('Status');
    if (!f.hasNative()) {
      g.appendChild(note('Ye feature <b style="color:var(--ink)">Android app (APK)</b> mein ' +
        'enforce hota hai. Web/desktop par aap rules bana aur dekh sakte ho, lekin apps ' +
        'block nahi hongi.'));
      return g;
    }
    var perm = f.permissions();
    var st = f.currentState();
    g.appendChild(row('Blocking service', f.running() ? 'CHALU' : 'band'));
    g.appendChild(row('Usage access (kaun si app khuli hai)', perm.usage ? 'allowed' : 'chahiye'));
    g.appendChild(row('Display over other apps (lock screen)', perm.overlay ? 'allowed' : 'chahiye'));
    g.appendChild(row('Aaj ki padhai', Math.round(st.studyMinutes) + ' / ' + Math.round(st.targetMinutes) +
      ' min' + (st.targetDone ? ' ✅' : '')));
    var bar = el('div');
    bar.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;margin-top:9px';
    if (!perm.usage) bar.appendChild(pill('Usage access kholo', function () {
      try { window.AchivaNative.focusOpenUsage(); } catch (e) { }
      window.setTimeout(function () { refresh(host); }, 400);
    }, true));
    if (!perm.overlay) bar.appendChild(pill('Overlay permission kholo', function () {
      try { window.AchivaNative.focusRequestOverlay(); } catch (e) { }
      window.setTimeout(function () { refresh(host); }, 400);
    }, true));
    bar.appendChild(pill(f.running() ? 'Service band karo' : 'Service chalu karo', function () {
      if (f.running()) f.stop(); else f.start();
      window.setTimeout(function () { refresh(host); }, 300);
    }));
    bar.appendChild(pill('Refresh', function () { refresh(host); }));
    g.appendChild(bar);
    return g;
  }

  /* ---------- 2. rules ---------- */
  function describe(r) {
    var apps = (r.apps || []).length;
    var t = '';
    if (r.mode === 'target') t = 'jab tak aaj ka study target poora na ho';
    else if (r.mode === 'timer') t = 'jab tak study timer chal raha ho';
    else t = (r.start || '00:00') + '–' + (r.end || '00:00') +
      ((r.days && r.days.length) ? ' · ' + r.days.length + ' din' : ' · rozana');
    return apps + ' app · ' + t;
  }

  function rulesBlock(host) {
    var f = F();
    var g = group('Rules');
    var rs = f.rules();
    if (!rs.length) {
      g.appendChild(note('Abhi koi rule nahi. Banaiye — jaise ' +
        '<b style="color:var(--ink)">"Exam week: Instagram 19:00–24:00 band"</b> ya ' +
        '<b style="color:var(--ink)">"Jab tak aaj ka target poora na ho, YouTube band"</b>.'));
    }
    var now = Date.now(), st = f.currentState();
    rs.forEach(function (r) {
      var live = f.evaluateRule(r, now, st);
      var label = '<b style="color:var(--ink)">' + esc(r.name || 'Rule') + '</b>' +
        (live ? ' &nbsp;<span style="color:#c2453f;font-weight:700">● ABHI BLOCK</span>' : '') +
        '<br><span style="font-size:10.5px">' + esc(describe(r)) + '</span>';
      var bar = el('div');
      bar.style.cssText = 'display:flex;gap:6px';
      bar.appendChild(pill(r.active === false ? 'on' : 'off', function () {
        f.toggleRule(r.id); refresh(host);
      }));
      bar.appendChild(pill('edit', function () { openEditor(host, r.id); }));
      bar.appendChild(pill('✕', function () { confirmDelete(host, r); }));
      var rr = row(label, bar);
      if (r.active === false) rr.style.opacity = '.55';
      g.appendChild(rr);
    });
    var add = el('div');
    add.style.cssText = 'margin-top:10px';
    add.appendChild(pill('＋ Naya rule', function () { openEditor(host, null); }, true));
    g.appendChild(add);
    return g;
  }
  function esc(s) { return U() ? U().esc(String(s)) : String(s); }

  /* ---------- 3. settings ---------- */
  function settingsBlock(host) {
    var f = F();
    var s = f.settings();
    var curLvl = (s.strictLevel === 'strict' || s.strictLevel === 'ultra') ? s.strictLevel : 'normal';
    var g = group('Settings');

    /* ---------- STRICTNESS LEVEL (3 chips) ---------- */
    var lvlBox = el('div');
    lvlBox.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap';
    [['normal', 'Normal'], ['strict', 'Strict'], ['ultra', 'Ultra Strict']].forEach(function (L) {
      lvlBox.appendChild(chip(L[1], curLvl === L[0], function () {
        if (curLvl === L[0]) return;
        if (L[0] === 'ultra') { confirmUltra(host, L[0]); return; }   /* confirm zaroori */
        f.setStrictLevel(L[0]);
        refresh(host);
      }));
    });
    var LVL_DESC = {
      normal: 'Emergency unlock: ek tap · cooldown ke saath · log banta hai.',
      strict: 'Emergency unlock: <b>5 second daba ke rakho</b> · <b>2× cooldown</b> · log banta hai.',
      ultra: '<b>Koi emergency unlock NAHI.</b> Lock par sirf [Achiva kholo] aur [Back]. ' +
        'Nikalne ka raasta: yahan Settings mein rule OFF / mode badlo (log banta hai) ya app uninstall.'
    };
    g.appendChild(row('Strictness', lvlBox));
    g.appendChild(note(LVL_DESC[curLvl]));

    /* cooldown */
    var cool = field('number', s.cooldownMin, { min: 0, max: 240, width: '76px' });
    cool.addEventListener('change', function () {
      var v = parseInt(cool.value, 10);
      if (isNaN(v) || v < 0) v = 0;
      if (v > 240) v = 240;
      cool.value = v;
      f.setSettings({ cooldownMin: v });
      refresh(host);
    });
    if (curLvl === 'ultra') { cool.disabled = true; cool.style.opacity = '.5'; }
    var coolLabel = 'Emergency unlock cooldown (min)' +
      (curLvl === 'strict'
        ? ' <span style="font-size:10.5px">(strict: asli 2× = ' + ((s.cooldownMin || 0) * 2) + ' min)</span>'
        : (curLvl === 'ultra'
          ? ' <span style="font-size:10.5px">(ultra mein lagu nahi — unlock hi nahi)</span>' : ''));
    g.appendChild(row(coolLabel, cool));

    /* boot start */
    g.appendChild(row('Reboot ke baad service khud chalu', toggle(s.bootStart !== false, function () {
      f.setSettings({ bootStart: f.settings().bootStart === false });
      refresh(host);
    })));

    /* overlay message */
    var msg = field('text', s.overlayText || '', { placeholder: 'jaise "Pehle padhai, baad mein scroll"' });
    msg.addEventListener('change', function () { f.setSettings({ overlayText: msg.value }); });
    g.appendChild(row('Lock screen ka message', msg));

    /* emergency unlock + log */
    var lg = f.log();
    var last = null;
    for (var li = lg.length - 1; li >= 0; li--) { if (lg[li].type === 'unlock') { last = lg[li]; break; } }
    var ubar = el('div');
    ubar.style.cssText = 'display:flex;gap:6px';
    var ultraOn = curLvl === 'ultra';
    var unlockPill = pill(ultraOn ? 'Abhi unlock (Ultra mein band)' : 'Abhi unlock', function () {
      if (f.strictLevel() === 'ultra') return;      /* store-level guard bhi hai */
      f.unlock(f.settings().cooldownMin);
      refresh(host);
    }, f.hasNative() && !ultraOn);
    if (ultraOn) {
      unlockPill.disabled = true;
      unlockPill.style.opacity = '.45';
      unlockPill.style.cursor = 'not-allowed';
    }
    ubar.appendChild(unlockPill);
    ubar.appendChild(pill('Log (' + lg.length + ')', function () { openLog(); }));
    g.appendChild(row('Emergency unlock<br><span style="font-size:10.5px">' +
      (last ? 'aakhri: ' + new Date(last.at).toLocaleString() : 'koi attempt nahi') +
      '</span>', ubar));

    g.appendChild(note('<b style="color:var(--ink)">Sach baat:</b> Android normal apps ko ' +
      'dusri apps ko poora "kill" karne ka API nahi deta. Ye ek <b>mazboot soft-lock</b> hai — ' +
      'full-screen lock + home-push + unlock log, teen levels tak (Ultra Strict = bina unlock ' +
      'wala lock). Poora hard-block Phase 2 (Shizuku/ADB) se aa sakta hai.'));
    return g;
  }

  /* Ultra Strict select par CONFIRM modal — galti se chun-ne par lock mein
     phasne ka darr hai, isliye ek baar saaf-saaf bata kar poochte hain */
  function confirmUltra(host, lvl) {
    var U2 = U(), f = F();
    if (!U2 || !U2.modal) { f.setStrictLevel(lvl); refresh(host); return; }
    var m = U2.modal({ zScrim: 85, zWrap: 86, saveLabel: 'Haan, Ultra Strict' });
    m.open('Ultra Strict chalu karein?', function (body) {
      body.appendChild(note('<b style="color:var(--ink)">Emergency unlock BAND ho jayega.</b> ' +
        'Blocked app ka lock sirf tab khulega jab rule ka time khatam ho, study target poora ho, ' +
        'ya aap jaan-boojh kar Settings mein rule OFF / mode change karo (log banta hai).'));
      body.appendChild(note('Lock screen par sirf do button rahenge: ' +
        '<b>Achiva kholo</b> aur <b>Back (app band karo)</b>.'));
    }, function () {
      f.setStrictLevel(lvl);
      m.close();
      refresh(host);
    });
  }

  /* ---------- rule editor ---------- */
  function getRule(id) {
    var rs = F().rules(), out = null;
    rs.forEach(function (r) { if (r.id === id) out = r; });
    return out;
  }
  function blankRule() {
    return { id: '', name: '', mode: 'time', apps: [], days: [],
      start: '19:00', end: '23:00', timerMin: 45, active: true };
  }

  function openEditor(host, id) {
    var f = F(), UI = U();
    if (!UI || !UI.modal) return;
    var existing = id ? getRule(id) : null;
    var d = existing ? JSON.parse(JSON.stringify(existing)) : blankRule();
    var m = UI.modal({ zScrim: 85, zWrap: 86, saveLabel: existing ? 'Save' : 'Banaiye' });
    m.sheet.style.maxHeight = 'calc(100% - 26px)';
    m.sheet.style.boxSizing = 'border-box';
    m.sheet.style.display = 'flex';
    m.sheet.style.flexDirection = 'column';
    m.body.style.overflowY = 'auto';
    m.body.style.flex = '1 1 auto';
    m.body.style.minHeight = '0';

    var nameIn = field('text', d.name, { placeholder: 'Rule ka naam' });

    /* mode chips */
    var modeBox = el('div');
    modeBox.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap';
    function paintModes() {
      modeBox.innerHTML = '';
      MODES.forEach(function (mo) {
        modeBox.appendChild(chip(mo[1], d.mode === mo[0], function () {
          d.mode = mo[0]; paintModes(); paintExtra(); paintPreview();
        }));
      });
    }

    /* day chips */
    var dayBox = el('div');
    dayBox.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap';
    function paintDays() {
      dayBox.innerHTML = '';
      DAYS.forEach(function (dy) {
        var on = (d.days || []).indexOf(dy[0]) !== -1;
        dayBox.appendChild(chip(dy[1], on, function () {
          var i = d.days.indexOf(dy[0]);
          if (i === -1) d.days.push(dy[0]); else d.days.splice(i, 1);
          paintDays(); paintPreview();
        }));
      });
    }

    /* mode-specific extra */
    var extra = el('div');
    function paintExtra() {
      extra.innerHTML = '';
      if (d.mode === 'time') {
        var w = el('div');
        w.style.cssText = 'display:flex;gap:8px;align-items:center;margin-top:4px';
        var s1 = field('time', d.start || '19:00', { width: '112px' });
        var s2 = field('time', d.end || '23:00', { width: '112px' });
        s1.addEventListener('change', function () { d.start = s1.value; paintPreview(); });
        s2.addEventListener('change', function () { d.end = s2.value; paintPreview(); });
        w.appendChild(s1); w.appendChild(el('span', 'se')); w.appendChild(s2); w.appendChild(el('span', 'tak'));
        w.children[1].style.cssText = 'font-size:11px;color:var(--slate)';
        w.children[3].style.cssText = 'font-size:11px;color:var(--slate)';
        extra.appendChild(w);
        extra.appendChild(note('Raat 12 ke paar bhi chalega (23:00–02:00 jaisa window allowed hai).'));
      } else if (d.mode === 'timer') {
        var t = field('number', d.timerMin || 45, { min: 5, max: 300, width: '96px' });
        t.addEventListener('change', function () { d.timerMin = parseInt(t.value, 10) || 45; });
        extra.appendChild(t);
        extra.appendChild(note('Study timer chalne ke dauraan ye apps band rahengi.'));
      } else {
        extra.appendChild(note('Aaj ka study target (Study card) poora hone tak ye apps band rahengi. ' +
          'Target poora hote hi lock khud khul jaata hai.'));
      }
    }

    /* app picker */
    var appsBox = el('div');
    function paintApps() {
      appsBox.innerHTML = '';
      var sel = d.apps || [];
      var cnt = el('div');
      cnt.style.cssText = 'font-size:11px;color:var(--slate);margin-bottom:6px';
      cnt.textContent = sel.length + ' app selected';
      appsBox.appendChild(cnt);
      var list = f.listApps();
      if (!list.length) {
        appsBox.appendChild(note('App list sirf <b style="color:var(--ink)">Android app</b> mein aati hai. ' +
          'Neeche package naam type karke bhi add kar sakte ho (testing ke liye).'));
      } else {
        var scroll = el('div');
        scroll.style.cssText = 'max-height:210px;overflow-y:auto;border:1px solid var(--s2);' +
          'border-radius:12px;padding:4px';
        list.forEach(function (a) {
          var on = sel.indexOf(a.pkg) !== -1;
          var r2 = el('div');
          r2.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 6px;' +
            'border-bottom:1px dashed var(--s2);cursor:pointer;font-size:11.5px;color:var(--ink)';
          var tick = el('span', on ? '✓' : '○');
          tick.style.cssText = 'font-weight:700;width:14px;color:' + (on ? 'var(--ink)' : 'var(--slate)');
          r2.appendChild(tick);
          r2.appendChild(el('span', a.label));
          var pk = el('span', a.pkg);
          pk.style.cssText = 'margin-left:auto;font-size:9.5px;color:var(--ash);max-width:40%;' +
            'overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
          r2.appendChild(pk);
          r2.addEventListener('click', function () {
            var i = sel.indexOf(a.pkg);
            if (i === -1) sel.push(a.pkg); else sel.splice(i, 1);
            d.apps = sel; paintApps(); paintPreview();
          });
          scroll.appendChild(r2);
        });
        appsBox.appendChild(scroll);
      }
      /* manual entry (desktop/testing) */
      var man = field('text', '', { placeholder: 'manual: com.instagram.android, com.google.android.youtube' });
      man.style.marginTop = '8px';
      man.addEventListener('change', function () {
        String(man.value || '').split(',').forEach(function (p) {
          p = p.trim();
          if (p && d.apps.indexOf(p) === -1) d.apps.push(p);
        });
        man.value = ''; paintApps(); paintPreview();
      });
      appsBox.appendChild(man);
    }

    /* live preview */
    var prev = el('div');
    function paintPreview() {
      var live = f.evaluateRule(d, Date.now());
      prev.innerHTML = (live
        ? '<b style="color:#c2453f">● Ye rule ABHI active hai</b>'
        : '<b style="color:var(--slate)">○ Abhi active nahi</b>') +
        ' &nbsp;<span style="font-size:10.5px">' + esc(describe(d)) + '</span>';
      prev.style.cssText = 'margin-top:10px;padding:9px 11px;border-radius:11px;font-size:11.5px;' +
        'line-height:1.5;border:1px dashed var(--s2);color:var(--slate)';
    }

    paintModes(); paintDays(); paintExtra(); paintApps(); paintPreview();

    m.open(existing ? 'Rule edit' : 'Naya focus rule', function (body) {
      body.appendChild(UI.label('Naam'));
      body.appendChild(nameIn);
      body.appendChild(UI.label('Kab block ho'));
      body.appendChild(modeBox);
      body.appendChild(UI.label('Din (kuch na chunein = rozana)'));
      body.appendChild(dayBox);
      body.appendChild(extra);
      body.appendChild(UI.label('Kaun si apps'));
      body.appendChild(appsBox);
      body.appendChild(prev);
    }, function () {
      d.name = nameIn.value.trim() ||
        (d.mode === 'time' ? ((d.start || '19:00') + '–' + (d.end || '23:00') + ' block') : 'Focus rule');
      d.start = d.start || '19:00';
      d.end = d.end || '23:00';
      d.active = existing ? existing.active !== false : true;
      if (existing) f.updateRule(existing.id, d);
      else f.addRule(d);
      m.close();
      refresh(host);
    });
  }

  /* ---------- delete confirm ---------- */
  function confirmDelete(host, r) {
    var f = F(), UI = U();
    if (!UI || !UI.modal) { f.removeRule(r.id); refresh(host); return; }
    var m = UI.modal({ zScrim: 85, zWrap: 86, saveLabel: 'Delete' });
    m.open('Rule delete karein?', function (body) {
      body.appendChild(note('<b style="color:var(--ink)">' + esc(r.name || 'Rule') + '</b> hata diya ' +
        'jayega. Undo nahi hoga.'));
    }, function () {
      f.removeRule(r.id);
      m.close();
      refresh(host);
    });
  }

  /* ---------- unlock log ---------- */
  function openLog() {
    var f = F(), UI = U();
    if (!UI || !UI.modal) return;
    var m = UI.modal({ zScrim: 85, zWrap: 86, saveLabel: 'Log clear' });
    var lg = f.log();
    m.open('Unlock log', function (body) {
      if (!lg.length) {
        body.appendChild(note('Koi unlock attempt record nahi hua. Matlab aapne lock todne ki ' +
          'koshish nahi ki 👍'));
        return;
      }
      var wrap = el('div');
      wrap.style.cssText = 'max-height:280px;overflow-y:auto';
      lg.slice().reverse().forEach(function (e) {
        var r2 = el('div');
        r2.style.cssText = 'padding:8px 0;border-bottom:1px dashed var(--s2);font-size:11.5px;color:var(--slate)';
        var what = (e.type === 'mode')
          ? 'mode badla: <b style="color:var(--ink)">' + String(e.from || '?') + ' → ' + String(e.to || '?') + '</b>'
          : 'unlock ' + (e.min || 0) + ' min';
        r2.innerHTML = '<b style="color:var(--ink)">' + new Date(e.at).toLocaleString() + '</b>' +
          ' &nbsp;·&nbsp; ' + what;
        wrap.appendChild(r2);
      });
      body.appendChild(wrap);
    }, function () {
      var d = f.load();
      d.log = [];
      f.save(d);
      f.syncAll();
      m.close();
    });
  }

  /* ---------- section ---------- */
  var hostEl = null;
  function buildSection() {
    var sec = el('div');
    sec.id = 'setFocusShield';
    sec.style.cssText = 'border:1px solid var(--line);border-radius:18px;background:var(--tile-bg);' +
      'padding:14px;margin-bottom:12px;box-shadow:inset 0 1px 0 var(--hl-soft)';
    var h = el('div', 'Focus Shield — app blocking');
    h.style.cssText = 'font-size:9.5px;letter-spacing:.16em;text-transform:uppercase;' +
      'color:var(--ash);font-weight:700;margin-bottom:6px';
    sec.appendChild(h);
    sec.appendChild(note('Chuni hui apps ko chune hue waqt/target par band rakho. ' +
      'Lock todne ki koshish log hoti hai.'));
    hostEl = el('div');
    sec.appendChild(hostEl);
    refresh(hostEl);
    return sec;
  }
  function refresh(host) {
    host = host || hostEl;
    if (!host) return;
    host.innerHTML = '';
    if (!F()) return;
    host.appendChild(statusBlock(host));
    host.appendChild(rulesBlock(host));
    host.appendChild(settingsBlock(host));
  }

  window.AchivaFocusUI = {
    buildSection: buildSection,
    refresh: refresh,
    describe: describe,
    openEditor: openEditor,
    openLog: openLog
  };
})();
