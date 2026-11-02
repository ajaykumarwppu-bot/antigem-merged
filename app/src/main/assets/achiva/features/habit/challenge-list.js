/* ================================================================
   FEATURES / HABIT / CHALLENGE-LIST.JS — challenges (single file)
   ----------------------------------------------------------------
   Habits entry screen par Good Habit / Bad Habit badges ke NEECHE
   ek same-styled "Challenges" badge card (entryCard()). Tap →
   challenges ki list.

   1) ENTRY : entryCard() — good-list.js ke entry screen par lagta
              hai (tile 'C'), count ke saath. Tap → andar.
   2) LIST  : upar [Add Challenge] button → modal :
                - Challenge name (zaroori)
                - Purpose : is challenge ka maqsad
                - Rules   : MULTIPLE rules (chip editor — Enter ya
                  + se add, chip tap se remove)
                - Time    : challenge kitne lambe — hours se lekar
                  kitne bhi din tak. Ready presets (2h, 6h, 8h, 10h,
                  12h, 1d, 7d, 10d, 100d, 1000d) YA custom number +
                  unit (Hours / Days).
              Save → neeche challenge card banta hai jisme
              challenge ka NAAM dikhta hai (+ purpose line,
              duration chip, rules count chip).
   3) DETAIL : abhi NAHI — "itna hi" banaya hai jo user ne kaha :
              add + list + naam wala card. Aage andar wala banega.

   Storage : 'achiva.challenges.v1' → { challenges: [ {id, name,
             purpose, rules:[...], duration:{unit:'hours'|'days',
             value:N}, createdAt} ] }
   Depends on : UI, SubjectListBridge, GoodList (entry/back)
   ================================================================ */

(function () {
  'use strict';

  if (window.__achivaChallengeListLoaded) return;
  window.__achivaChallengeListLoaded = true;

  var el = UI.el, esc = UI.esc;
  var KEY = 'achiva.challenges.v1';
  var data = window.AppStorage.loadAt(KEY) || { challenges: [] };
  if (!Array.isArray(data.challenges)) data.challenges = [];

  function persist() { window.AppStorage.saveAt(KEY, data); }
  function bridge() { return window.SubjectListBridge; }

  /* ---------- store ---------- */
  function all() { return data.challenges; }
  function get(id) { return data.challenges.filter(function (c) { return c.id === id; })[0] || null; }
  function addChallenge(o) {
    o.id = o.id || UI.uid();
    o.createdAt = o.createdAt || Date.now();
    o.rules = o.rules || [];
    o.duration = o.duration || { unit: 'days', value: 7 };
    data.challenges.push(o);
    persist();
    return o;
  }
  function removeChallenge(id) {
    data.challenges = data.challenges.filter(function (c) { return c.id !== id; });
    persist();
  }
  function durationLabel(c) {
    var d = c.duration || {};
    var u = d.unit === 'hours' ? 'hours' : 'days';
    return (d.value || 0) + ' ' + u;
  }

  /* ---------- screens ---------- */
  var listScreen = el('section', 'screen');
  listScreen.style.paddingTop = '58px';
  document.getElementById('app').appendChild(listScreen);

  /* ---------- 1) ENTRY badge card (Good/Bad ke neeche) ---------- */
  function entryCard() {
    var card = el('div', 'sub-card');
    card.style.cssText += ';margin:0 20px 26px;padding:26px 20px;align-items:center;cursor:pointer';
    var tile = el('div', 'sub-tile t2', 'C');
    tile.style.cssText += ';width:56px;height:56px;font-size:24px;border-radius:18px';
    card.appendChild(tile);
    var main = el('div', 'sub-main');
    main.style.cssText = 'width:100%;text-align:center';
    var t = el('div', null, 'Challenges');
    t.style.cssText = 'font-family:var(--f-disp);font-size:20px;font-weight:700;color:var(--ink);margin-top:10px';
    var sub = el('div', 'sub-meta', data.challenges.length + ' challenge' + (data.challenges.length === 1 ? '' : 's'));
    sub.style.marginTop = '4px';
    main.appendChild(t);
    main.appendChild(sub);
    card.appendChild(main);
    card.addEventListener('click', function () { openList(); });
    return card;
  }

  /* ---------- 2) LIST ---------- */
  function renderList() {
    listScreen.innerHTML = '';
    var scroll = el('div', 'scroll');

    var head = el('div');
    head.style.cssText = 'display:flex;align-items:center;gap:10px;padding:12px 16px 6px';
    var back = UI.miniBtn(UI.icons.back, 'Back');
    back.style.cssText += ';width:34px;height:34px;border-radius:50%;border:1px solid var(--s2);background:var(--chip-bg)';
    back.addEventListener('click', function () {
      if (window.GoodList) window.GoodList.open();
    });
    head.appendChild(back);
    var tt = el('b', null, 'Challenges');
    tt.style.cssText = 'flex:1;font-family:var(--f-disp);font-size:17px;font-weight:700;color:var(--ink)';
    head.appendChild(tt);
    var add = UI.pillBtn('+ Add Challenge');
    add.style.cssText += ';padding:7px 13px;font-size:11.5px';
    add.addEventListener('click', function () { openAddModal(); });
    head.appendChild(add);
    scroll.appendChild(head);

    if (!data.challenges.length) {
      var hint = el('div', null, 'Koi challenge nahi.<br>+ Add Challenge se pehla challenge banao.');
      hint.style.cssText = 'margin:26px 20px;padding:22px;border:1px dashed var(--s2);border-radius:18px;' +
        'color:var(--slate);font-size:12.5px;line-height:1.7;text-align:center';
      scroll.appendChild(hint);
    } else {
      data.challenges.forEach(function (c) { scroll.appendChild(challengeCard(c)); });
    }
    listScreen.appendChild(scroll);
  }

  function openList() {
    renderList();
    bridge().show(listScreen, true);
  }
  function open() { openList(); }

  function challengeCard(c) {
    var card = el('div', 'sub-card no-chevron');
    card.style.cssText += ';padding:13px 14px;align-items:flex-start';
    var tile = el('div', 'sub-tile t2', esc((c.name || '?').charAt(0).toUpperCase()));
    card.appendChild(tile);

    var main = el('div', 'sub-main');
    main.style.cssText = 'flex:1;min-width:0';
    var name = el('h3', null, esc(c.name));
    name.style.margin = '0';
    main.appendChild(name);
    if (c.purpose) {
      var pu = el('div', 'sub-meta', esc(c.purpose));
      pu.style.margin = '2px 0 0';
      main.appendChild(pu);
    }
    var chips = el('div');
    chips.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin-top:7px';
    chips.appendChild(UI.chip(durationLabel(c)));
    chips.appendChild(UI.chip((c.rules || []).length + ' rule' + ((c.rules || []).length === 1 ? '' : 's')));
    main.appendChild(chips);
    card.appendChild(main);
    return card;
  }

  /* ---------- add challenge modal ---------- */
  /* time presets : hours se lekar din tak (user ke bataye hue) */
  var DUR_PRESETS = [
    { unit: 'hours', value: 2, label: '2h' },
    { unit: 'hours', value: 6, label: '6h' },
    { unit: 'hours', value: 8, label: '8h' },
    { unit: 'hours', value: 10, label: '10h' },
    { unit: 'hours', value: 12, label: '12h' },
    { unit: 'days', value: 1, label: '1d' },
    { unit: 'days', value: 7, label: '7d' },
    { unit: 'days', value: 10, label: '10d' },
    { unit: 'days', value: 100, label: '100d' },
    { unit: 'days', value: 1000, label: '1000d' }
  ];

  function openAddModal() {
    var m = UI.modal({ zScrim: 85, zWrap: 86 });
    var nameF = UI.inputField('Challenge name', 'e.g. No phone after 10pm');
    var purposeF = UI.inputField('Purpose', 'e.g. Raat ki neend bachani hai');
    var rulesE = UI.chipEditor('Rules (kya-kya follow karna hai)', 'e.g. Phone 10pm ke baad band', false);

    /* duration : preset chips + custom number/unit */
    var chosen = { unit: 'days', value: 7 };
    var presetBtns = [];
    var durWrap = el('div');
    durWrap.style.marginBottom = '12px';
    var presetRow = el('div');
    presetRow.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px';
    function paintPresets(sel) {
      presetBtns.forEach(function (b) {
        var on = b._d === sel;
        b.style.cssText = 'padding:7px 12px;border-radius:99px;cursor:pointer;font:inherit;font-size:11px;' +
          'font-weight:700;transition:.15s;' +
          (on
            ? 'background:var(--ink);color:var(--paper);border:1px solid var(--line-strong)'
            : 'background:var(--chip-bg);color:var(--slate);border:1px solid var(--s2)');
      });
    }
    DUR_PRESETS.forEach(function (p) {
      var b = el('button', null, p.label);
      b.type = 'button';
      b._d = p;
      b.addEventListener('click', function () {
        chosen = { unit: p.unit, value: p.value };
        customIn.value = '';
        paintPresets(p);
      });
      presetBtns.push(b);
      presetRow.appendChild(b);
    });
    durWrap.appendChild(UI.label('Time (kitna lamba challenge)'));
    durWrap.appendChild(presetRow);
    var custRow = el('div');
    custRow.style.cssText = 'display:flex;gap:8px;align-items:center;flex-wrap:wrap';
    var customIn = el('input');
    customIn.type = 'number';
    customIn.min = '1';
    customIn.placeholder = 'Custom';
    customIn.style.cssText = 'width:90px;padding:9px 10px;border-radius:12px;border:1px solid var(--s2);' +
      'background:var(--input-bg);font:inherit;font-size:13px;color:var(--ink);outline:none';
    var unitR = UI.chipRow(['Hours', 'Days'], 'Days');
    custRow.appendChild(customIn);
    custRow.appendChild(unitR.row);
    durWrap.appendChild(custRow);
    paintPresets(DUR_PRESETS[6]);   /* default 7d */

    m.open('New challenge', function (body) {
      body.appendChild(nameF.wrap);
      body.appendChild(purposeF.wrap);
      body.appendChild(rulesE.wrap);
      body.appendChild(durWrap);
    }, function () {
      var name = nameF.input.value.trim();
      if (!name) { nameF.input.focus(); return; }
      var cv = parseInt(customIn.value, 10);
      var duration = (cv > 0)
        ? { unit: unitR.get() === 'Hours' ? 'hours' : 'days', value: cv }
        : chosen;
      addChallenge({
        name: name,
        purpose: purposeF.input.value.trim(),
        rules: rulesE.get(),
        duration: duration
      });
      m.close();
      renderList();
    });
  }

  window.ChallengeList = {
    open: open, openList: openList, entryCard: entryCard,
    all: all, get: get, addChallenge: addChallenge, removeChallenge: removeChallenge,
    durationLabel: durationLabel
  };
})();
