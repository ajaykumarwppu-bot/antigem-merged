/* ================================================================
   BACKEND / SETTINGS.JS — header ka gear button + Settings SCREEN
   ----------------------------------------------------------------
   Responsibility:
     • Header ka purana theme-toggle button ab SETTINGS (gear) button
       hai. Theme toggle andar Settings mein chala gaya hai.
     • Settings ab POORI alag screen par khulti hai (pehle neeche se
       spread hone wali sheet thi) : head mein BACK button + title,
       back par user usi screen par wapas jaata hai jahan se khola.
     • Settings mein:
         - Appearance : Light / Dark (choice abhi yaad bhi rehti hai)
         - Backup     : Backup now / Restore + last backup time
         - Account    : email, user id, sign out
     • Theme ki pasand localStorage (achiva.prefs.v1) mein save hoti
       hai aur backup ke saath cloud par bhi chali jaati hai.
     • Backup SIRF button dabane par hota hai — koi auto-backup nahi.

   Note: gear icon ka SVG JS se button mein daala jata hai taaki
   index.html mein icon ka boilerplate na badhe. Button wahi purani
   class "theme-btn" use karta hai (CSS files FROZEN hain — 34px
   circle, gradient, :active rotate animation sab ready milta hai).

   Load order (backend): 5/5
   ================================================================ */

(function () {
  'use strict';

  var PREFS_KEY = 'achiva.prefs.v1';
  var THEMES = [
    { id: 'light', label: 'Light', sub: 'White paper look' },
    { id: 'dark',  label: 'Dark',  sub: 'Raaton ke liye aasan' }
  ];

  var GEAR_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<circle cx="12" cy="12" r="3"/>' +
    '<path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 ' +
    '1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.11-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06 ' +
    'a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09 ' +
    'A1.7 1.7 0 0 0 4.6 8.4a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.09 ' +
    'A1.7 1.7 0 0 0 10 2.91V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06 ' +
    'a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.09a1.7 1.7 0 0 0 1.56 1.03H21a2 2 0 1 1 0 4h-.09 ' +
    'a1.7 1.7 0 0 0-1.51 1.03z"/></svg>';

  var MOON_SVG = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';
  var SUN_SVG = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round">' +
    '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  var CLOUD_SVG = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M17.5 19a4.5 4.5 0 0 0 .5-8.97A6 6 0 0 0 6.2 9.5 4 4 0 0 0 7 19z"/></svg>';
  var DOWN_SVG = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M12 3v12M7 11l5 5 5-5M5 21h14"/></svg>';
  var USER_SVG = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';

  var root = document.documentElement;
  var screenEl = null, prevScreen = null;
  var stTheme = null, stBackup = null, stAccount = null, bannerEl = null;
  var backupStatus = null;
  var openFlag = false;
  var headerBtn = null;

  /* ================================================================
     THEME (prefs ke saath save)
  ================================================================ */
  /* IndexedDB v3: prefs AppStorage ke zariye padho/likho — wo cache +
     IDB + localStorage (dual-write) sab update karta hai, isliye
     index.html ka head theme-script (direct LS read) bhi sync rehta
     hai aur backup mein bhi fresh prefs jaate hain. AppStorage na
     mile (test etc.) to purana direct-LS raasta. */
  function lsGet(k) {
    if (window.AppStorage && window.AppStorage.rawGet) return window.AppStorage.rawGet(k);
    try { return window.localStorage.getItem(k); } catch (e) { return null; }
  }
  function lsSet(k, v) {
    if (window.AppStorage && window.AppStorage.rawSet) return window.AppStorage.rawSet(k, v);
    try { window.localStorage.setItem(k, v); return true; } catch (e) { return false; }
  }

  function readPrefs() {
    var raw = lsGet(PREFS_KEY);
    var p = null;
    try { p = raw ? JSON.parse(raw) : null; } catch (e) { p = null; }
    if (!p || typeof p !== 'object') p = {};
    if (p.theme !== 'dark' && p.theme !== 'light') {
      p.theme = (root.getAttribute('data-theme') === 'dark') ? 'dark' : 'light';
    }
    return p;
  }

  function savePrefs(p) { lsSet(PREFS_KEY, JSON.stringify(p || readPrefs())); }

  function applyTheme(name, persist) {
    var want = (name === 'dark') ? 'dark' : 'light';
    root.classList.add('theming');
    if (want === 'dark') root.setAttribute('data-theme', 'dark');
    else root.removeAttribute('data-theme');
    window.setTimeout(function () { root.classList.remove('theming'); }, 500);
    if (persist !== false) {
      var p = readPrefs();
      p.theme = want;
      savePrefs(p);
    }
    return want;
  }

  function currentTheme() {
    return (root.getAttribute('data-theme') === 'dark') ? 'dark' : 'light';
  }

  function applyThemeFromStorage() {
    var p = readPrefs();
    applyTheme(p.theme, false);
    return p.theme;
  }

  /* ================================================================
     HEADER BUTTON → gear
  ================================================================ */
  function wireHeader() {
    headerBtn = document.getElementById('settingsBtn') || document.getElementById('themeToggle');
    if (!headerBtn) return;
    headerBtn.innerHTML = GEAR_SVG;
    headerBtn.setAttribute('aria-label', 'Settings');
    headerBtn.setAttribute('title', 'Settings');
    headerBtn.addEventListener('click', function () { open(); });
  }

  /* ================================================================
     PANEL
  ================================================================ */
  function section(title) {
    var box = document.createElement('div');
    box.style.cssText = 'border:1px solid var(--line);border-radius:18px;background:var(--tile-bg);' +
      'padding:14px;margin-bottom:12px;box-shadow:inset 0 1px 0 var(--hl-soft)';
    var h = document.createElement('div');
    h.style.cssText = 'font-size:9.5px;letter-spacing:.16em;text-transform:uppercase;' +
      'color:var(--ash);font-weight:700;margin-bottom:10px';
    h.textContent = title;
    box.appendChild(h);
    return box;
  }

  function bigBtn(label, svg, tone) {
    var b = document.createElement('button');
    b.type = 'button';
    b.style.cssText = 'display:flex;align-items:center;gap:9px;width:100%;padding:12px 13px;' +
      'border-radius:12px;font:inherit;font-size:13px;font-weight:600;cursor:pointer;' +
      'margin-top:8px;box-sizing:border-box;' +
      (tone === 'danger'
        ? 'border:1px solid rgba(192,57,43,.35);background:rgba(192,57,43,.08);color:#c0392b'
        : tone === 'ghost'
          ? 'border:1px solid var(--s2);background:transparent;color:var(--ink2)'
          : 'border:0;background:var(--ink);color:var(--paper)');
    b.innerHTML = svg;
    var t = document.createElement('span');
    t.textContent = label;
    b.appendChild(t);
    return b;
  }

  function smallNote(text) {
    var d = document.createElement('div');
    d.style.cssText = 'font-size:11px;line-height:1.7;color:var(--ash);margin-top:8px';
    d.textContent = text;
    return d;
  }

  /* ================================================================
     SETTINGS SCREEN (pehle bottom-sheet thi)
     ----------------------------------------------------------------
     Presentation change : gear dabate ab POORI nayi screen khulti
     hai (neeche se spread hone wali sheet nahi). Upar head :
     BACK button + "Settings" title. Back dabane par user wahi
     wapas jaata hai jahan se settings khola tha. Andar ka saara
     logic (theme / backup / account) BILKUL unchanged.
  ================================================================ */
  function build() {
    var app = document.getElementById('app');
    if (!app) return;

    screenEl = document.createElement('section');
    screenEl.className = 'screen';
    screenEl.style.paddingTop = '58px';

    /* head : back + title */
    var head = document.createElement('div');
    head.style.cssText = 'display:flex;align-items:center;gap:10px;padding:12px 16px 6px';
    var back = UI.miniBtn(UI.icons.back, 'Back');
    back.style.cssText += ';width:34px;height:34px;border-radius:50%;border:1px solid var(--s2);background:var(--chip-bg)';
    back.addEventListener('click', function () { close(); });
    head.appendChild(back);
    /* AI button (back ke right mein) → ai/settings.js ki AI list screen */
    var aiB = UI.pillBtn('AI');
    aiB.style.cssText += ';padding:7px 13px;font-size:11px;font-weight:700;flex:none';
    aiB.addEventListener('click', function () {
      if (window.AchivaAIHubSettings) { window.AchivaAIHubSettings.open(); return; }
      var miss = (window.__ACHIVA_LOAD_ERRORS || []).join(', ');
      setBanner('AI module load nahi hua' + (miss ? ' (missing: ' + miss + ')' : '') +
        ' — page reload karo; deploy/copy mein ai/ folder ki files check karo.');
    });
    head.appendChild(aiB);
    var h3 = document.createElement('b');
    h3.style.cssText = 'flex:1;min-width:0;font-family:var(--f-disp);font-size:17px;font-weight:700;' +
      'color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
    h3.textContent = 'Settings';
    head.appendChild(h3);
    screenEl.appendChild(head);

    var scroll = document.createElement('div');
    scroll.className = 'scroll';

    bannerEl = document.createElement('div');
    bannerEl.style.cssText = 'display:none;font-size:11.5px;line-height:1.6;color:#a06a00;' +
      'background:rgba(160,106,0,.1);border:1px solid rgba(160,106,0,.25);border-radius:10px;' +
      'padding:8px 10px;margin:0 18px 12px';
    scroll.appendChild(bannerEl);

    scroll.appendChild(wrapSection(buildTheme()));
    scroll.appendChild(wrapSection(buildDayClock()));
    if (window.AchivaFocusUI && typeof window.AchivaFocusUI.buildSection === 'function') {
      scroll.appendChild(wrapSection(window.AchivaFocusUI.buildSection()));
    }
    scroll.appendChild(wrapSection(buildBackup()));
    scroll.appendChild(wrapSection(buildAccount()));

    screenEl.appendChild(scroll);
    app.appendChild(screenEl);
  }

  /* sections ko screen ke margins mein lapet do (sheet wale margins
     ab apply nahi hote) — logic boxes wahi purane hain */
  function wrapSection(box) {
    box.style.marginLeft = '18px';
    box.style.marginRight = '18px';
    return box;
  }

  /* ---------- Appearance ---------- */
  function buildTheme() {
    var box = section('Appearance');
    stTheme = document.createElement('div');
    stTheme.style.cssText = 'display:flex;gap:8px';
    box.appendChild(stTheme);
    box.appendChild(smallNote('Theme ki pasand backup ke saath cloud par bhi save hoti hai.'));
    paintTheme();
    return box;
  }

  function paintTheme() {
    if (!stTheme) return;
    stTheme.innerHTML = '';
    var cur = currentTheme();
    THEMES.forEach(function (t) {
      var on = t.id === cur;
      var b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('data-theme-id', t.id);
      b.style.cssText = 'flex:1;display:flex;align-items:center;gap:8px;padding:11px 12px;' +
        'border-radius:12px;cursor:pointer;font:inherit;text-align:left;' +
        (on
          ? 'border:1px solid var(--ink);background:var(--chip-bg);color:var(--ink);box-shadow:inset 0 1px 0 var(--hl-soft)'
          : 'border:1px solid var(--s2);background:transparent;color:var(--ash)');
      b.innerHTML = (t.id === 'dark' ? MOON_SVG : SUN_SVG);
      var tx = document.createElement('div');
      tx.innerHTML = '<div style="font-size:12.5px;font-weight:700">' + t.label + '</div>' +
        '<div style="font-size:9.5px;opacity:.75">' + t.sub + '</div>';
      b.appendChild(tx);
      b.addEventListener('click', function () {
        applyTheme(t.id, true);
        paintTheme();
      });
      stTheme.appendChild(b);
    });
  }

  /* ---------- Mera Din (DayClock) ----------
     USER ka apna din : "mera din kab shuru hota hai". Default raat 12:00
     (= purana behaviour). Koi bhi dusra time set karne par app ka din us
     waqt palatta hai — raat 12 baje nahi. Isse raat 12 ke baad ka kaam
     pichhle din mein gina jaata hai (jo user raat 2 baje tak padhta hai
     uske liye zaroori). Purana data untouched rehta hai (DayClock.enabledAt). */
  function buildDayClock() {
    var box = section('Mera Din');
    var DC = window.DayClock;

    var info = document.createElement('div');
    info.style.cssText = 'font-size:11.5px;line-height:1.6;color:var(--slate);margin-bottom:10px';
    info.innerHTML = 'Aapka din kab shuru hota hai? App <b style="color:var(--ink)">usi waqt</b> nayi ' +
      'tareekh par jaata hai (raat 12 baje nahi). Isse raat 12 ke baad ka kaam ' +
      '<b style="color:var(--ink)">pichhle din</b> mein gina jaata hai. ' +
      'Purana hisaab-kitaab bilkul nahi badalta.';
    box.appendChild(info);

    var preview = document.createElement('div');
    preview.style.cssText = 'font-size:11px;line-height:1.6;padding:8px 10px;border-radius:10px;' +
      'border:1px dashed var(--s2);color:var(--slate);margin-bottom:10px';
    box.appendChild(preview);

    function paintPreview() {
      if (!DC) { preview.textContent = 'DayClock load nahi hua.'; return; }
      var d = DC.describe();
      preview.innerHTML = 'Abhi asli ghadi : <b style="color:var(--ink)">' + d.nowLabel +
        ' · ' + d.realToday + '</b><br>Aapka aaj ka din : <b style="color:var(--ink)">' + d.appToday + '</b>' +
        (d.isCustom ? '' : '  (default — asli tareekh ke barabar)');
    }

    /* confirm bar : galat tap se din na badle */
    var pending = null;
    var confirmBar = document.createElement('div');
    confirmBar.style.cssText = 'display:none;margin-top:10px;padding:10px 12px;border-radius:12px;' +
      'border:1px solid rgba(160,106,0,.35);background:rgba(160,106,0,.1);font-size:11.5px;' +
      'line-height:1.5;color:#a06a00';
    var confirmTxt = document.createElement('div');
    var confirmBtns = document.createElement('div');
    confirmBtns.style.cssText = 'display:flex;gap:8px;margin-top:8px';
    confirmBar.appendChild(confirmTxt); confirmBar.appendChild(confirmBtns);

    var PRESETS = ['00:00', '04:00', '06:00', '08:00', '10:00'];
    var cur = DC ? DC.settings().dayStart : '00:00';
    var btns = [];

    function paintChips() {
      PRESETS.forEach(function (p, i) {
        var on = (p === cur), pend = (p === pending);
        btns[i].style.cssText = 'padding:8px 14px;border-radius:99px;cursor:pointer;font:inherit;' +
          'font-size:12px;font-weight:700;transition:.15s;' +
          (on ? 'background:var(--ink);color:var(--paper);border:1px solid var(--ink)'
            : pend ? 'background:var(--chip-bg);color:var(--ink);border:1px solid var(--ink)'
            : 'background:var(--chip-bg);color:var(--slate);border:1px solid var(--s2)');
      });
    }

    function hideConfirm() { pending = null; confirmBar.style.display = 'none'; paintChips(); }

    function stage(v) {
      pending = v;
      paintChips();
      confirmTxt.innerHTML = 'Din <b>' + (v === '00:00' ? 'raat 12:00 (default)' : v) +
        '</b> se shuru hoga.<br>Purana hisaab-kitaab <b>nahi</b> badlega — sirf naya data naye rule par chalega.';
      confirmBtns.innerHTML = '';
      var okb = document.createElement('button');
      okb.type = 'button'; okb.textContent = 'Pakka';
      okb.style.cssText = 'padding:7px 16px;border-radius:99px;border:0;background:var(--ink);' +
        'color:var(--paper);font:inherit;font-size:12px;font-weight:700;cursor:pointer';
      okb.addEventListener('click', function () {
        cur = pending;
        if (DC) DC.setDayStart(pending);
        hideConfirm(); paintPreview();
      });
      var nob = document.createElement('button');
      nob.type = 'button'; nob.textContent = 'Rehne do';
      nob.style.cssText = 'padding:7px 16px;border-radius:99px;border:1px solid var(--s2);' +
        'background:transparent;color:var(--slate);font:inherit;font-size:12px;font-weight:700;cursor:pointer';
      nob.addEventListener('click', hideConfirm);
      confirmBtns.appendChild(okb); confirmBtns.appendChild(nob);
      confirmBar.style.display = 'block';
    }

    var row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px';
    PRESETS.forEach(function (p, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = (p === '00:00' ? '12 AM' : p) + (p === '00:00' ? ' (default)' : '');
      b.addEventListener('click', function () { stage(p); });
      btns.push(b); row.appendChild(b);
    });
    box.appendChild(row);
    paintChips();

    var crow = document.createElement('div');
    crow.style.cssText = 'display:flex;gap:8px;align-items:center';
    var lab = document.createElement('span');
    lab.style.cssText = 'font-size:11px;color:var(--slate)';
    lab.textContent = 'Custom :';
    var tin = document.createElement('input');
    tin.type = 'time';
    tin.style.cssText = 'flex:1;padding:10px 12px;border-radius:12px;border:1px solid var(--s2);' +
      'background:var(--input-bg);font:inherit;font-size:13px;color:var(--ink);outline:none';
    tin.value = cur;
    tin.addEventListener('change', function () { if (tin.value) stage(tin.value); });
    crow.appendChild(lab); crow.appendChild(tin);
    box.appendChild(crow);

    box.appendChild(confirmBar);
    paintPreview();
    return box;
  }

  /* ---------- Backup ---------- */
  function buildBackup() {
    var box = section('Backup (cloud)');
    /* stBackup = info area (har refresh par rebuild hota hai)
       backupStatus = status line (rebuild se bacha rehta hai) */
    stBackup = document.createElement('div');
    box.appendChild(stBackup);
    backupStatus = document.createElement('div');
    backupStatus.setAttribute('data-status', '1');
    backupStatus.style.cssText = 'display:none;font-size:11.5px;line-height:1.6;color:var(--ink2);' +
      'margin-top:10px;padding:8px 10px;border-radius:10px;background:var(--chap-bg);' +
      'border:1px solid var(--line)';
    box.appendChild(backupStatus);

    var b1 = bigBtn('Backup now', CLOUD_SVG, 'solid');
    b1.id = 'backupNowBtn';
    b1.addEventListener('click', function () {
      if (!window.AchivaBackup) return;
      window.AchivaBackup.backupNow(function (t) { setStatus(t); });
    });
    box.appendChild(b1);

    var b2 = bigBtn('Restore', DOWN_SVG, 'ghost');
    b2.id = 'restoreBtn';
    b2.addEventListener('click', function () {
      if (!window.AchivaBackup) return;
      window.AchivaBackup.restoreNow(function (t) { setStatus(t); });
    });
    box.appendChild(b2);

    box.appendChild(smallNote('Backup sirf aapke dabane par hota hai — apne aap kabhi nahi. ' +
      'Restore par is phone ka data cloud wale backup se badal jata hai.'));

    refreshBackup();
    return box;
  }

  function setStatus(t) {
    if (!backupStatus) return;
    backupStatus.textContent = t || '';
    backupStatus.style.display = t ? '' : 'none';
  }

  function refreshBackup() {
    if (!stBackup || !window.AchivaBackup) return;
    var B = window.AchivaBackup;
    stBackup.innerHTML = '';

    var ses = (window.AchivaAuth && window.AchivaAuth.session) ? window.AchivaAuth.session() : null;

    var line1 = document.createElement('div');
    line1.style.cssText = 'font-size:12px;color:var(--ink2);font-weight:600';
    var line2 = document.createElement('div');
    line2.style.cssText = 'font-size:11px;color:var(--ash);margin-top:3px;line-height:1.6';

    if (!ses) {
      line1.textContent = 'Login zaroori hai';
      line2.textContent = 'Backup lene ke liye pehle apne account mein login karein.';
      stBackup.appendChild(line1); stBackup.appendChild(line2);
      return;
    }
    if (ses.offline) {
      line1.textContent = 'Offline mode chalu hai';
      line2.textContent = 'Net aane par app dobara kholein, phir backup / restore chalega.';
      stBackup.appendChild(line1); stBackup.appendChild(line2);
      return;
    }

    var at = B.lastBackupAt();
    line1.textContent = 'Last backup: ' + (at ? B.fmtTime(at) : 'kabhi nahi');
    line2.textContent = 'Phone ka data: ' + localText(B);
    stBackup.appendChild(line1);
    stBackup.appendChild(line2);

    if (!CLOUDREADY()) {
      var w = smallNote('Cloud abhi ready nahi hai — backend/firebase-config.js mein config daalein.');
      stBackup.appendChild(w);
      return;
    }

    var cloudLine = document.createElement('div');
    cloudLine.style.cssText = 'font-size:11px;color:var(--ash);margin-top:6px';
    cloudLine.textContent = 'Cloud check ho raha hai...';
    stBackup.appendChild(cloudLine);

    B.cloudSummary(ses).then(function (r) {
      if (!r.ok) { cloudLine.textContent = 'Cloud: ' + (r.message || 'padha nahi ja saka'); return; }
      cloudLine.textContent = r.count
        ? 'Cloud par ' + r.count + ' hisse saved · ' + (r.lastBackupAt ? B.agoText(r.lastBackupAt) : '—')
        : 'Cloud par abhi koi backup nahi hai';
      /* STALE-PART WARNING: kisi hisse ka savedAt profile ke lastBackupAt
         se kaafi purana hai → matlab us hisse ka pichla backup FAIL hua
         tha (data bada / net giri). User ko saaf dikhana zaroori hai —
         isi se "restore par delete nahi hota" wala confusion hota tha. */
      if (r.count && r.lastBackupAt) {
        var stale = (r.items || []).filter(function (i) {
          return i.savedAt && i.savedAt < r.lastBackupAt - 60000;
        });
        if (stale.length) {
          var warn = smallNote('⚠ Cloud par PURANA hissa: ' +
            stale.map(function (i) { return i.label + ' (' + B.agoText(i.savedAt) + ')'; }).join(', ') +
            '. Inka last backup fail hua tha — "Backup now" dabakar message padhein (data bada ho sakta hai).');
          warn.style.color = '#a06a00';
          stBackup.appendChild(warn);
        }
      }
    });
  }

  function CLOUDREADY() {
    return !!(window.AchivaCloud && window.AchivaCloud.ready && window.AchivaCloud.ready());
  }

  function localText(B) {
    var items = B.localSummary().filter(function (x) { return x.present && x.main; });
    if (!items.length) return 'khaali (abhi kuch save nahi)';
    return items.map(function (x) { return x.label; }).join(' · ');
  }

  /* ---------- Account ---------- */
  function buildAccount() {
    var box = section('Account');
    stAccount = document.createElement('div');
    box.appendChild(stAccount);
    paintAccount();
    return box;
  }

  function paintAccount() {
    if (!stAccount) return;
    stAccount.innerHTML = '';
    var ses = (window.AchivaAuth && window.AchivaAuth.session) ? window.AchivaAuth.session() : null;

    if (!ses) {
      var e = smallNote('Abhi koi account login nahi hai.');
      stAccount.appendChild(e);
      var lb = bigBtn('Login karein', USER_SVG, 'ghost');
      lb.addEventListener('click', function () {
        close();
        if (window.AchivaAuth) window.AchivaAuth.showGate();
      });
      stAccount.appendChild(lb);
      return;
    }

    var row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:10px 12px;' +
      'border:1px solid var(--line);border-radius:12px;background:var(--chap-bg)';
    row.innerHTML = USER_SVG;
    var tx = document.createElement('div');
    tx.style.cssText = 'min-width:0;flex:1';
    tx.innerHTML = '<div style="font-size:12.5px;font-weight:700;color:var(--ink);word-break:break-all">' +
        UI.esc(ses.email || '(email nahi mila)') + '</div>' +
      '<div style="font-size:10px;color:var(--ash);margin-top:3px;font-family:var(--f-mono);word-break:break-all">' +
        'uid: ' + UI.esc(ses.uid) + '</div>' +
      (ses.offline ? '<div style="font-size:10px;color:#a06a00;margin-top:4px">Offline mode</div>' : '');
    row.appendChild(tx);
    stAccount.appendChild(row);

    var out = bigBtn('Sign out', '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>' +
      '<path d="M16 17l5-5-5-5M21 12H9"/></svg>', 'danger');
    out.addEventListener('click', function () { signOutFlow(); });
    stAccount.appendChild(out);

    stAccount.appendChild(smallNote('Sign out karne par is phone ka data mit-ta NAHI hai. ' +
      'Dobara login karke aap use cloud backup se mila sakte hain.'));
  }

  function signOutFlow() {
    var m = UI.modal({ zWrap: 440, zScrim: 439, saveLabel: 'Sign out' });
    m.open('Sign out karein?', function (body) {
      body.appendChild(smallNote('App dobara khulne par login maangegi. ' +
        'Data safe rahega — chahein to pehle "Backup now" daba lein.'));
    }, function () {
      m.close();
      close();
      if (!window.AchivaAuth) return;
      window.AchivaAuth.signOut();
      window.setTimeout(doReload, 350);
    });
  }

  /* app ko dobara load karo (export ke zariye → test mein stub ho sakta hai) */
  function reload() { window.location.reload(); }
  function doReload() {
    var f = (window.AchivaSettings && window.AchivaSettings.reload) || reload;
    f();
  }

  /* ---------- open / close ---------- */
  function safe(fn) {
    try { fn(); } catch (e) {
      /* sheet kabhi bhi kisi paint/cloud error ki wajah se rukni NAHI chahiye */
      if (window.console && console.warn) console.warn('settings paint skip:', e && e.message);
    }
  }

  function open() {
    if (!screenEl) build();
    if (!screenEl) return;
    /* jahan se khola, wahi yaad rakho — back par wahi wapas */
    var act = document.querySelector('section.screen.active');
    if (act && act !== screenEl) prevScreen = act;
    openFlag = true;
    safe(paintTheme);
    safe(refreshBackup);
    safe(paintAccount);
    if (window.SubjectListBridge && window.SubjectListBridge.show) {
      window.SubjectListBridge.show(screenEl, true);
    } else {
      document.querySelectorAll('section.screen').forEach(function (s) { s.classList.remove('active'); });
      screenEl.classList.add('active');
    }
  }

  function close() {
    if (!screenEl) return;
    openFlag = false;
    var back = prevScreen;
    prevScreen = null;
    if (back && document.body.contains(back)) {
      if (window.SubjectListBridge && window.SubjectListBridge.show) window.SubjectListBridge.show(back, false);
      else back.classList.add('active');
      return;
    }
    if (window.SubjectListBridge && window.SubjectListBridge.subjectScreen) {
      window.SubjectListBridge.show(window.SubjectListBridge.subjectScreen(), false);
      return;
    }
    screenEl.classList.remove('active');
  }

  function isOpen() {
    return !!(screenEl && screenEl.classList.contains('active'));
  }

  function setBanner(text) {
    if (!bannerEl) return;
    if (!text) { bannerEl.style.display = 'none'; bannerEl.textContent = ''; return; }
    bannerEl.textContent = text;
    bannerEl.style.display = 'block';
  }

  /* ================================================================
     EXPORT + auto-wire
  ================================================================ */
  window.AchivaSettings = {
    PREFS_KEY: PREFS_KEY,
    open: open,
    close: close,
    isOpen: isOpen,
    setTheme: applyTheme,
    getTheme: currentTheme,
    toggleTheme: function () { return applyTheme(currentTheme() === 'dark' ? 'light' : 'dark', true); },
    applyThemeFromStorage: applyThemeFromStorage,
    readPrefs: readPrefs,
    savePrefs: savePrefs,
    refreshBackup: refreshBackup,
    reload: reload,
    setStatus: setStatus,
    setBanner: setBanner,
    wireHeader: wireHeader
  };

  /* header ka gear button turant wire karo (script body ke end mein load hoti hai) */
  if (document.getElementById('settingsBtn') || document.getElementById('themeToggle')) wireHeader();
})();
