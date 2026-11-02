/* ================================================================
   FEATURES / HABIT / BAD-LIST.JS — bad habits (single file)
   ----------------------------------------------------------------
   Good habits (good-list.js) ke bilkul saamne wala pattern, lekin
   ULTA maqsad : yahan habit ko ROKE rakhna hai.

   1) ENTRY : good-list.js ke entry screen par "Good Habit" card ke
              NEECHE ek same-styled "Bad Habit" card dikhta hai
              (entryCard() yahan ka hai). Tap → andar.
   2) LIST  : andar upar [Add Bad Habit] button.
              Tap → modal : bad habit name · since (estimated date —
              kab se hai ye habit) · Save
              Save ke baad neeche bad-habit cards bante hain :
                - habit ka naam + "since <date>"
                - aaj ka status : kitni repeats + defend hua ya nahi
                - do gol buttons :
                    DEFEND (shield) : aaj is bad habit ko NAHI kiya —
                                      din ka defended toggle
                    REPEAT (arrow)  : aaj kiya — click par modal :
                                      trigger COMPULSORY (khud likho
                                      ya preset chuno : Bored tha /
                                      Akela tha / Kisi ke saath tha),
                                      Save par abhi ka EXACT time
                                      (HH:MM) + trigger save hota hai.
                                      Din mein kitni bhi repeats log
                                      kar sakte ho; defend ke baad
                                      bhi repeat kar sakte ho.
   3) DETAIL : abhi NAHI — card ke andar wali screen aage banegi.

   Storage : 'achiva.badHabits.v1' → { habits: [ {id, name, since,
             createdAt, defended:{'YYYY-MM-DD':true},
             reps:[ {iso, at:'HH:MM', ts, trigger} ] } ] }
   Depends on : UI, AchivaCalendar (basics.js), SubjectListBridge,
                GoodList (entry/back ke liye)
   ================================================================ */

(function () {
  'use strict';

  if (window.__achivaBadListLoaded) return;
  window.__achivaBadListLoaded = true;

  var el = UI.el, esc = UI.esc;
  var KEY = 'achiva.badHabits.v1';
  var data = window.AppStorage.loadAt(KEY) || { habits: [] };
  if (!Array.isArray(data.habits)) data.habits = [];

  function persist() { window.AppStorage.saveAt(KEY, data); }
  function bridge() { return window.SubjectListBridge; }
  function today() { return window.DayClock ? window.DayClock.today() : UI.todayISO(); }   /* DAY-CLOCK */

  /* ---------- store ---------- */
  function all() { return data.habits; }
  function get(id) { return data.habits.filter(function (h) { return h.id === id; })[0] || null; }
  function addHabit(o) {
    o.id = o.id || UI.uid();
    o.since = o.since || today();
    o.createdAt = o.createdAt || Date.now();
    o.defended = o.defended || {};
    o.reps = o.reps || [];
    data.habits.push(o);
    persist();
    return o;
  }
  function removeHabit(id) {
    data.habits = data.habits.filter(function (h) { return h.id !== id; });
    persist();
  }
  /* is date par kitni repeats hui */
  function repsOn(h, date) {
    return (h.reps || []).filter(function (r) { return r.iso === date; });
  }
  /* repeat log : exact time + trigger */
  function addRep(h, trigger) {
    var rep = { iso: today(), at: UI.nowTime(), ts: Date.now(), trigger: trigger || '' };
    if (!h.reps) h.reps = [];
    h.reps.push(rep);
    /* PROTECTION TOOT GAYI : jis din repeat ho chuki, us din ka
       defend hata do — wo din ab defend ke liye BAN hai */
    if (h.defended) delete h.defended[rep.iso];
    persist();
    return rep;
  }
  /* aaj defend kiya (yaani aaj ye bad habit NAHI ki) */
  function defendedOn(h, date) { return !!(h.defended && h.defended[date]); }
  function toggleDefend(h) {
    if (repsOn(h, today()).length) return false;   /* repeat wale din defend BAN */
    if (!h.defended) h.defended = {};
    var d = today();
    if (h.defended[d]) delete h.defended[d];
    else h.defended[d] = true;
    persist();
    return !!h.defended[d];
  }

  /* ---------- icons ---------- */
  var ICON_SHIELD = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 2l8 3.5v5.7c0 4.9-3.4 8.4-8 10.3-4.6-1.9-8-5.4-8-10.3V5.5z"/></svg>';
  var ICON_REPEAT = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 2l4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/></svg>';
  var ICON_CHEV = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>';

  /* ---------- screens ---------- */
  var listScreen = el('section', 'screen');
  listScreen.style.paddingTop = '58px';
  document.getElementById('app').appendChild(listScreen);

  /* ---------- 1) ENTRY card : good-list ke entry screen par ----------
     Good Habit card jaisa hi, sirf tile dark (t3) aur naam "Bad Habit". */
  function entryCard() {
    var card = el('div', 'sub-card');
    card.style.cssText += ';margin:0 20px 26px;padding:26px 20px;align-items:center;cursor:pointer';
    var tile = el('div', 'sub-tile t3', 'B');
    tile.style.cssText += ';width:56px;height:56px;font-size:24px;border-radius:18px';
    card.appendChild(tile);
    var main = el('div', 'sub-main');
    main.style.cssText = 'width:100%;text-align:center';
    var t = el('div', null, 'Bad Habit');
    t.style.cssText = 'font-family:var(--f-disp);font-size:20px;font-weight:700;color:var(--ink);margin-top:10px';
    var sub = el('div', 'sub-meta', data.habits.length + ' habit' + (data.habits.length === 1 ? '' : 's'));
    sub.style.marginTop = '4px';
    main.appendChild(t);
    main.appendChild(sub);
    card.appendChild(main);
    card.addEventListener('click', function () { openList(); });
    return card;
  }

  /* ---------- 2) LIST : Add Bad Habit + cards ---------- */
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
    var tt = el('b', null, 'Bad Habits');
    tt.style.cssText = 'flex:1;font-family:var(--f-disp);font-size:17px;font-weight:700;color:var(--ink)';
    head.appendChild(tt);
    var add = UI.pillBtn('+ Add Bad Habit');
    add.style.cssText += ';padding:7px 13px;font-size:11.5px';
    add.addEventListener('click', function () { openAddModal(); });
    head.appendChild(add);
    scroll.appendChild(head);

    if (!data.habits.length) {
      var hint = el('div', null, 'Koi bad habit nahi.<br>+ Add Bad Habit se pehli habit banao.');
      hint.style.cssText = 'margin:26px 20px;padding:22px;border:1px dashed var(--s2);border-radius:18px;' +
        'color:var(--slate);font-size:12.5px;line-height:1.7;text-align:center';
      scroll.appendChild(hint);
    } else {
      data.habits.forEach(function (h) { scroll.appendChild(habitCard(h)); });
    }
    listScreen.appendChild(scroll);
  }

  function openList() {
    renderList();
    bridge().show(listScreen, true);
  }
  function open() { openList(); }

  /* ---------- gol DEFEND button : aaj nahin kiya ---------- */
  function defendBtn(h) {
    var b = el('button');
    b.type = 'button';
    b.setAttribute('aria-label', 'Defend today (aaj nahin kiya)');
    b.style.cssText = 'width:34px;height:34px;border-radius:50%;cursor:pointer;flex:none;' +
      'display:flex;align-items:center;justify-content:center;border:1px solid var(--s2);' +
      'transition:transform .16s ease, background .2s ease;';
    function paint() {
      /* jis din repeat ho chuki us din protection toot chuki hai →
         defend button us din ke liye COMPLETELY BAN (hidden) */
      var banned = repsOn(h, today()).length > 0;
      b.style.display = banned ? 'none' : '';
      b.disabled = banned;
      var on = !banned && defendedOn(h, today());
      b.style.background = on ? '#2ea043' : 'var(--chip-bg)';
      b.style.borderColor = on ? '#2ea043' : 'var(--s2)';
      b.style.color = on ? '#fff' : 'var(--slate)';
      b.innerHTML = ICON_SHIELD;
    }
    paint();
    b.addEventListener('click', function (e) {
      e.stopPropagation();
      toggleDefend(h);
      b.style.transform = 'scale(1.18)';
      window.setTimeout(function () { b.style.transform = 'scale(1)'; }, 160);
      paint();
      var line = b._statusLine;
      if (line) line.textContent = statusLine(h);
    });
    return b;
  }

  /* ---------- gol REPEAT button : aaj kiya (time + optional trigger) ---------- */
  function repeatBtn(h) {
    var b = el('button');
    b.type = 'button';
    b.setAttribute('aria-label', 'Repeat log karo (aaj kiya)');
    b.style.cssText = 'width:34px;height:34px;border-radius:50%;cursor:pointer;flex:none;' +
      'display:flex;align-items:center;justify-content:center;border:1px solid var(--s2);' +
      'background:var(--chip-bg);color:var(--slate);' +
      'transition:transform .16s ease, background .2s ease;';
    b.innerHTML = ICON_REPEAT;
    b.addEventListener('click', function (e) {
      e.stopPropagation();
      openRepeatModal(h);
    });
    return b;
  }

  /* aaj ka status : defended? kitni repeats, kin times par */
  function statusLine(h) {
    var parts = [];
    var reps = repsOn(h, today());
    if (defendedOn(h, today())) parts.push('defended today (nahi kiya)');
    if (reps.length) {
      var times = reps.map(function (r) { return r.at; }).join(', ');
      parts.push('today ' + reps.length + ' repeat' + (reps.length === 1 ? '' : 's') + ' (' + times + ')');
    } else if (!parts.length) {
      parts.push('aaj koi repeat nahi');
    }
    return parts.join(' · ');
  }

  function habitCard(h) {
    var c = el('div', 'sub-card no-chevron');
    /* card COMPACT : column layout — upar naam wala row, neeche
       actions ki PARALLEL (side-by-side) row. Logos ab ek-doosre ke
       upar stack NAHI hote, isliye card lamba nahi dikhta. */
    c.style.cssText += ';padding:13px 14px;align-items:flex-start;flex-direction:column;gap:10px';
    var top = el('div');
    top.style.cssText = 'display:flex;align-items:flex-start;gap:13px;width:100%';
    var tile = el('div', 'sub-tile t3', esc((h.name || '?').charAt(0).toUpperCase()));
    top.appendChild(tile);

    var main = el('div', 'sub-main');
    main.style.cssText = 'flex:1;min-width:0';
    var name = el('h3', null, esc(h.name));
    name.style.margin = '0';
    main.appendChild(name);
    var sinceLine = el('div', 'sub-meta', 'since ' + UI.fmtDate(h.since || today()));
    sinceLine.style.margin = '2px 0 0';
    main.appendChild(sinceLine);
    var status = el('div', 'sub-meta', statusLine(h));
    status.style.margin = '2px 0 0';
    main.appendChild(status);
    top.appendChild(main);
    c.appendChild(top);

    /* actions row : defend + repeat + chevron PARALLEL (side-by-side) */
    var row = el('div');
    row.style.cssText = 'display:flex;align-items:center;justify-content:flex-end;gap:10px;width:100%';
    var db = defendBtn(h);
    var rb = repeatBtn(h);
    db._statusLine = status;
    row.appendChild(db);
    row.appendChild(rb);
    var ab = el('button', null, ICON_CHEV);
    ab.type = 'button';
    ab.setAttribute('aria-label', 'Open detailed board');
    ab.style.cssText = 'width:26px;height:26px;border-radius:8px;border:0;background:transparent;' +
      'color:var(--slate);cursor:pointer;display:flex;align-items:center;justify-content:center';
    ab.addEventListener('click', function (e) { e.stopPropagation(); openDetail(h.id); });
    row.appendChild(ab);
    c.appendChild(row);

    /* card tap → DETAILED BOARD (bad-detail.js) */
    c.addEventListener('click', function () { openDetail(h.id); });
    return c;
  }

  /* ---------- detail board (bad-detail.js) ---------- */
  function openDetail(id) {
    if (window.BadDetail) window.BadDetail.open(id);
  }

  /* ---------- repeat modal : exact time + trigger (COMPULSORY) ----------
     Trigger ke bina repeat save NAHI hota : user ya to upar khud
     likhe, ya neeche diye preset options mein se chune —
     'Bored tha' / 'Akela tha' / 'Kisi ke saath tha'. */
  var TRIGGER_PRESETS = ['Bored tha', 'Akela tha', 'Kisi ke saath tha'];
  var repModal = UI.modal({ zScrim: 87, zWrap: 88, saveLabel: 'Save repeat' });
  function openRepeatModal(h) {
    var triggerIn = null;
    var preset = null;
    var presetBtns = [];
    repModal.open('Repeat — ' + (h.name || 'Bad habit'), function (body) {
      var info = el('div', null,
        'Save karte hi abhi ka exact time (' + UI.nowTime() + ') save ho jayega. ' +
        'Trigger zaroori hai — upar likho ya neeche se chuno.');
      info.style.cssText = 'font-size:11px;color:var(--ash);line-height:1.6;margin-bottom:10px';
      body.appendChild(info);
      body.appendChild(UI.label('Trigger (zaroori)'));
      triggerIn = el('textarea');
      triggerIn.placeholder = 'Kya trigger tha — thought, place, feeling...';
      triggerIn.rows = 2;
      triggerIn.style.cssText = 'width:100%;min-height:56px;resize:vertical;border:1px solid var(--s2);border-radius:12px;' +
        'background:var(--input-bg);padding:10px 12px;font:inherit;font-size:13px;color:var(--ink);box-sizing:border-box';
      body.appendChild(triggerIn);
      /* preset triggers : click = select, dobara click = deselect */
      var row = el('div');
      row.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin-top:8px';
      function paint() {
        presetBtns.forEach(function (b) {
          var on = b._t === preset;
          b.style.cssText = 'padding:8px 14px;border-radius:99px;cursor:pointer;font:inherit;font-size:11.5px;' +
            'font-weight:600;transition:.15s;' +
            (on
              ? 'background:var(--ink);color:var(--paper);border:1px solid var(--line-strong)'
              : 'background:var(--chip-bg);color:var(--slate);border:1px solid var(--s2)');
        });
      }
      TRIGGER_PRESETS.forEach(function (t) {
        var b = el('button', null, t);
        b.type = 'button';
        b._t = t;
        b.addEventListener('click', function () {
          preset = (preset === t) ? null : t;
          paint();
        });
        presetBtns.push(b);
        row.appendChild(b);
      });
      paint();
      body.appendChild(row);
    }, function () {
      var custom = (triggerIn ? triggerIn.value : '').trim();
      var trig = custom || preset || '';
      if (!trig) {                       /* compulsory : khali save nahi */
        if (triggerIn) triggerIn.focus();
        return;
      }
      addRep(h, trig);
      repModal.close();
      renderList();
    });
  }

  /* ---------- add bad habit modal ---------- */
  function openAddModal() {
    var m = UI.modal({ zScrim: 85, zWrap: 86 });
    var nameF = UI.inputField('Bad habit name', 'e.g. Late night phone scrolling');
    var sinceISO = today();
    var sinceB = UI.pillBtn('Since (estimated): ' + UI.fmtDate(sinceISO));
    sinceB.style.cssText += ';width:100%;justify-content:flex-start;margin-bottom:10px';
    sinceB.addEventListener('click', function () {
      window.AchivaCalendar.open('Kab se hai ye habit', sinceISO, function (iso) {
        sinceISO = iso;
        sinceB.innerHTML = 'Since (estimated): ' + UI.fmtDate(iso);
      });
    });
    m.open('New bad habit', function (body) {
      body.appendChild(nameF.wrap);
      body.appendChild(UI.label('Since (estimated) — kab se hai ye bad habit'));
      body.appendChild(sinceB);
    }, function () {
      var name = nameF.input.value.trim();
      if (!name) { nameF.input.focus(); return; }
      addHabit({ name: name, since: sinceISO });
      m.close();
      renderList();
    });
  }

  window.BadList = {
    open: open, openList: openList, entryCard: entryCard,
    all: all, get: get, addHabit: addHabit, removeHabit: removeHabit,
    repsOn: repsOn, addRep: addRep, defendedOn: defendedOn, toggleDefend: toggleDefend,
    openDetail: openDetail
  };
})();
