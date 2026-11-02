/* ================================================================
   FEATURES / HABIT / GOOD-LIST.JS — good habits (single file)
   ----------------------------------------------------------------
   Poora good-habit logic isi EK file mein :

   1) ENTRY screen  : FAB → HABITS par jaate hi ek simple BADA card
                      dikhta hai jisme "Good Habit" likha hota hai
                      (+ kitni habits hain). Card tap → andar.
   2) LIST screen   : andar jaate hi upar [Add Habit] button.
                      Tap → modal : habit name · description ·
                      repetition per day · start date (calendar) · Save
                      Save ke baad neeche habit cards bante hain :
                        - habit ka naam
                        - "today X/Y reps" (kitne reps ho chuke)
                        - [+] se rep log hota hai
                        - chhota 🔥 streak chip
                      Kisi bhi card par tap → DETAIL screen
   3) DETAIL screen : abhi "Coming soon" (detail aane wala hai)

   Storage : 'achiva.goodHabits.v1' → { habits: [ {id,name,desc,
             repsPerDay,startDate,logs:{'YYYY-MM-DD':{done,times}} } ] }
   ================================================================ */

(function () {
  'use strict';

  if (window.__achivaGoodListLoaded) return;
  window.__achivaGoodListLoaded = true;

  var el = UI.el, esc = UI.esc;
  var KEY = 'achiva.goodHabits.v1';
  var data = window.AppStorage.loadAt(KEY) || { habits: [] };
  if (!Array.isArray(data.habits)) data.habits = [];

  /* HABIT-TYPES: purane habits (jinme `type` field hi nahi) ko normalize karo.
     Koi migration nahi — sirf safe defaults, isliye unka behaviour 100% wahi
     rahega jo pehle tha (type 'one' = tap karo, rep +1). */
  function HT() { return window.HabitTypes || null; }
  if (HT()) data.habits.forEach(function (h) { HT().normalize(h); });

  function persist() { window.AppStorage.saveAt(KEY, data); }
  function bridge() { return window.SubjectListBridge; }
  function today() { return window.DayClock ? window.DayClock.today() : UI.todayISO(); }   /* DAY-CLOCK */

  /* ---------- chhota transient message (app ki existing .toast CSS) ----------
     App mein toast ki CSS thi lekin koi JS nahi — isliye yahan minimal helper.
     Strict-block / timer-start / validation messages ke liye use hota hai. */
  var toastEl = null, toastTimer = null;
  function toast(msg) {
    var app = document.getElementById('app');
    if (!app) return;
    if (!toastEl || !toastEl.parentNode) {
      toastEl = el('div', 'toast');
      /* .toast mein white-space:nowrap hai — lambe message ke liye override */
      toastEl.style.whiteSpace = 'normal';
      toastEl.style.maxWidth = '80%';
      toastEl.style.textAlign = 'center';
      toastEl.style.lineHeight = '1.35';
      app.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.style.opacity = '1';
    toastEl.style.transform = 'translate(-50%, 0)';
    if (toastTimer) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () {
      toastTimer = null;
      if (toastEl) {
        toastEl.style.opacity = '0';
        toastEl.style.transform = 'translate(-50%, -18px)';
      }
    }, 2100);
  }

  /* ---------- store ---------- */
  function all() { return data.habits; }
  function get(id) { return data.habits.filter(function (h) { return h.id === id; })[0] || null; }
  function addHabit(o) {
    o.id = o.id || UI.uid();
    o.repsPerDay = Math.max(1, o.repsPerDay || 1);
    o.startDate = o.startDate || today();
    o.logs = o.logs || {};
    if (HT()) HT().normalize(o);      /* type defaults + shape safe karo */
    data.habits.push(o);
    persist();
    return o;
  }
  function removeHabit(id) {
    /* STUDY-HABIT: default "Study" card compulsory hai — delete block.
       (good-detail.js ka kebab bhi noDelete ke saath banta hai, ye doosri
       safety layer hai taaki kisi bhi raaste se delete na ho.) */
    if (window.StudyHabit && window.StudyHabit.isStudyCard(id)) {
      toast('Study card default hai — delete nahi ho sakta.');
      return;
    }
    data.habits = data.habits.filter(function (h) { return h.id !== id; });
    persist();
  }
  function repsOn(h, date) {
    var l = (h.logs || {})[date];
    return l ? (l.done || 0) : 0;
  }
  function addRep(h, delta) {
    var d = today();
    if (!h.logs) h.logs = {};
    if (!h.logs[d]) h.logs[d] = { done: 0, times: [] };
    h.logs[d].done = Math.min(h.repsPerDay || 1, Math.max(0, (h.logs[d].done || 0) + delta));
    if (delta > 0) h.logs[d].times.push(Date.now());
    persist();
    return h.logs[d].done;
  }

  /* HABIT-TYPES: timer-type habits ka credit. Fractional ho sakta hai
     (proportional — 30 min mein se 20 min = 0.67). Session record bhi save
     hota hai taaki dobara credit na ho (dedupe) aur history rahe.
     habit-types.js ka ST.recordStudy wrapper isi ko call karta hai — wo
     SINGLE funnel hai jisse saare save paths (native finish, manual stop,
     reconcile, reload-recovery) guzarte hain. */
  function addCredit(habitId, credit, meta) {
    var h = get(habitId);
    if (!h) return null;
    meta = meta || {};
    var cr = Math.max(0, Math.min(1, Number(credit) || 0));
    if (!(cr > 0)) return null;
    var d = meta.date || today();
    if (!h.logs) h.logs = {};
    if (!h.logs[d]) h.logs[d] = { done: 0, times: [] };
    var L = h.logs[d];
    if (!Array.isArray(L.times)) L.times = [];
    if (!Array.isArray(L.sessions)) L.sessions = [];
    L.sessions.push({
      ms: Math.max(0, Math.floor(Number(meta.ms) || 0)),
      startMs: Math.floor(Number(meta.startMs) || 0) || null,
      sid: meta.sid || null,
      credit: cr,
      at: Date.now()
    });
    /* done = saare sessions ka total, repsPerDay par cap */
    L.done = HT() ? HT().recomputeTimerDone(h, d)
                  : Math.min(h.repsPerDay || 1, (L.done || 0) + cr);
    L.times.push(Date.now());
    persist();
    try { renderList(); } catch (e) { /* list screen mount nahi hai to ignore */ }
    return L.done;
  }
  function dayDone(h, date) { return repsOn(h, date) >= (h.repsPerDay || 1); }
  function bestStreak(h) {
    var keys = Object.keys(h.logs || {}).sort();
    var best = 0, cur = 0, prev = null;
    keys.forEach(function (k) {
      if (!dayDone(h, k)) return;
      cur = (prev && UI.addDays(prev, 1) === k) ? cur + 1 : 1;
      if (cur > best) best = cur;
      prev = k;
    });
    return best;
  }
  function goodStreak(h) {
    var d = today();
    if (!dayDone(h, d)) d = UI.addDays(d, -1);
    var n = 0;
    while (dayDone(h, d) && n < 5000) { n++; d = UI.addDays(d, -1); }
    return n;
  }

  /* ---------- screens ---------- */
  var entryScreen = el('section', 'screen');
  entryScreen.style.paddingTop = '58px';
  document.getElementById('app').appendChild(entryScreen);

  var listScreen = el('section', 'screen');
  listScreen.style.paddingTop = '58px';
  document.getElementById('app').appendChild(listScreen);

  var detailScreen = el('section', 'screen');
  detailScreen.style.paddingTop = '58px';
  document.getElementById('app').appendChild(detailScreen);

  /* ---------- 1) ENTRY : ek bada "Good Habit" card ---------- */
  function renderEntry() {
    entryScreen.innerHTML = '';
    var scroll = el('div', 'scroll');
    var card = el('div', 'sub-card');
    card.style.cssText += ';margin:26px 20px;padding:26px 20px;align-items:center;cursor:pointer';
    var tile = el('div', 'sub-tile t1', 'G');
    tile.style.cssText += ';width:56px;height:56px;font-size:24px;border-radius:18px';
    card.appendChild(tile);
    var main = el('div', 'sub-main');
    main.style.cssText = 'width:100%;text-align:center';
    var t = el('div', null, 'Good Habit');
    t.style.cssText = 'font-family:var(--f-disp);font-size:20px;font-weight:700;color:var(--ink);margin-top:10px';
    var sub = el('div', 'sub-meta', data.habits.length + ' habit' + (data.habits.length === 1 ? '' : 's'));
    sub.style.marginTop = '4px';
    main.appendChild(t);
    main.appendChild(sub);
    card.appendChild(main);
    card.addEventListener('click', function () { openList(); });
    scroll.appendChild(card);
    /* BAD HABITS entry card (Good Habit ke NEECHE, same style) —
       card bad-list.js banata hai; file na load ho to chup-chaap skip */
    if (window.BadList && window.BadList.entryCard) scroll.appendChild(window.BadList.entryCard());
    /* CHALLENGES entry card (Bad Habit ke NEECHE, same style) —
       card challenge-list.js banata hai */
    if (window.ChallengeList && window.ChallengeList.entryCard) scroll.appendChild(window.ChallengeList.entryCard());
    entryScreen.appendChild(scroll);
  }

  function open() {
    renderEntry();
    bridge().show(entryScreen, true);
  }

  /* ---------- 2) LIST : Add Habit + habit cards ---------- */
  function renderList() {
    /* STUDY-HABIT: render se pehle default card ensure + logs sync.
       Study ka time studyStore se DERIVE hota hai (incremental nahi),
       isliye har render par fresh rakhna zaroori hai. */
    if (window.StudyHabit) { try { window.StudyHabit.sync(); } catch (e) { /* ignore */ } }

    listScreen.innerHTML = '';
    resetLive();          /* HABIT-TYPES: purane buttons ke repaint refs hatao */
    var scroll = el('div', 'scroll');

    var head = el('div');
    head.style.cssText = 'display:flex;align-items:center;gap:10px;padding:12px 16px 6px';
    var back = UI.miniBtn(UI.icons.back, 'Back');
    back.style.cssText += ';width:34px;height:34px;border-radius:50%;border:1px solid var(--s2);background:var(--chip-bg)';
    back.addEventListener('click', function () { open(); });
    head.appendChild(back);
    var tt = el('b', null, 'Good Habits');
    tt.style.cssText = 'flex:1;font-family:var(--f-disp);font-size:17px;font-weight:700;color:var(--ink)';
    head.appendChild(tt);
    var add = UI.pillBtn('+ Add Habit');
    add.style.cssText += ';padding:7px 13px;font-size:11.5px';
    add.addEventListener('click', function () { openAddModal(); });
    head.appendChild(add);
    scroll.appendChild(head);

    /* STUDY-HABIT: default Study card SABSE UPAR pinned, baaki habits
       apne normal order mein neeche. */
    function isStudy(h) { return !!(window.StudyHabit && window.StudyHabit.isStudyCard(h)); }
    var pinned = data.habits.filter(isStudy);
    var rest = data.habits.filter(function (h) { return !isStudy(h); });
    var ordered = pinned.concat(rest);

    if (!ordered.length) {
      var hint = el('div', null, 'Koi good habit nahi.<br>+ Add Habit se pehli habit banao.');
      hint.style.cssText = 'margin:26px 20px;padding:22px;border:1px dashed var(--s2);border-radius:18px;' +
        'color:var(--slate);font-size:12.5px;line-height:1.7;text-align:center';
      scroll.appendChild(hint);
    } else {
      ordered.forEach(function (h) { scroll.appendChild(habitCard(h)); });
      /* Study card to hamesha rahega — isliye "koi habit nahi" wala hint
         tabhi dikhao jab user ki apni koi habit na ho */
      if (!rest.length) {
        var hint2 = el('div', null, 'Ye <b>Study</b> card default hai — Subject Tracker ka poora ' +
          'padhai-time apne aap yahan judta hai.<br>+ Add Habit se apni habits banao.');
        hint2.style.cssText = 'margin:14px 20px 26px;padding:16px;border:1px dashed var(--s2);' +
          'border-radius:16px;color:var(--slate);font-size:11.5px;line-height:1.65;text-align:center';
        scroll.appendChild(hint2);
      }
    }
    listScreen.appendChild(scroll);
  }

  /* STUDY-HABIT: study-habit.js recordStudy-wrap ke baad isi ko call karta hai
     taaki list live update ho. renderList idempotent hai — loop ka koi khatra
     nahi (sync recordStudy trigger nahi karta). */
  function refreshList() {
    try { renderList(); } catch (e) { /* ignore */ }
  }

  var ICON_CHEV = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>';
  /* HABIT-TYPES: timer-type ke button par play glyph */
  var ICON_PLAY = '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M8 5.2v13.6L19 12z"/></svg>';

  /* ---------- live repaint ----------
     'time' type ki window khud khulti/band hoti rehti hai aur 'timer' type ka
     countdown chalta rehta hai — dono ke liye button state time ke saath badalti
     hai. Isliye ek halka interval sirf unhi buttons ko repaint karta hai
     ('one' type kabhi khud nahi badalta, isliye skip).

     LEAK-FIX: interval tabhi chalta hai jab tak koi button DOM se juda hua hai.
     List re-render ya screen change par buttons detach hote hain → entry hat
     jati hai → list khaali hote hi interval BAND. Warna user ke habit list se
     bahar jaane ke baad bhi har second bekaar kaam hota rehta (aur detached
     nodes memory mein atke rehte). */
  var liveBtns = [];
  var liveTimer = null;

  function attached(n) {
    try {
      if (typeof n.isConnected === 'boolean') return n.isConnected;
      return !!(window.document.documentElement && window.document.documentElement.contains(n));
    } catch (e) { return false; }
  }
  function stopLive() {
    if (liveTimer) { window.clearInterval(liveTimer); liveTimer = null; }
  }
  function ensureLive() {
    if (liveTimer) return;
    liveTimer = window.setInterval(function () {
      for (var i = liveBtns.length - 1; i >= 0; i--) {
        var rec = liveBtns[i];
        if (!rec || !rec.btn || !attached(rec.btn)) { liveBtns.splice(i, 1); continue; }
        try { rec.paint(); } catch (e) { /* ignore */ }
      }
      if (!liveBtns.length) stopLive();
    }, 1000);
  }
  function resetLive() { liveBtns = []; }

  /* round progress button : fraction-fill green, complete par tick.
     HABIT-TYPES: ab "smart" hai — behaviour habit ke type par depend karta hai.
       one   → tap = instant +1 rep
       time  → tap = active slot tick; window ke bahar DISABLED (strict)
       timer → tap = seedha timer start (koi popup nahi); credit session
               complete hone par recordStudy-wrapper se aata hai */
  function progressBtn(h, done, total, repsLine) {
    var b = el('button');
    b.type = 'button';
    b.setAttribute('aria-label', 'Add rep');
    b.style.cssText = 'width:34px;height:34px;border-radius:50%;cursor:pointer;flex:none;' +
      'display:flex;align-items:center;justify-content:center;border:1px solid var(--s2);' +
      'transition:transform .16s ease, background .2s ease, opacity .2s ease;';

    function paint() {
      var d = repsOn(h, today());
      var t = HT() ? HT().typeOf(h) : 'one';
      var pct = total > 0 ? Math.max(0, Math.min(100, Math.round((d / total) * 100))) : 0;
      var comp = d >= total;
      var st = HT() ? HT().buttonState(h) : { enabled: !comp, complete: comp, type: 'one', hint: '' };

      b.style.background = comp ? '#2ea043'
        : 'conic-gradient(#2ea043 ' + pct + '%, var(--chip-bg) ' + pct + '% 100%)';
      b.style.borderColor = comp ? '#2ea043' : 'var(--s2)';
      b.style.color = comp ? '#fff' : 'var(--slate)';
      var usable = comp || st.enabled;
      b.style.opacity = usable ? '1' : '.4';
      b.style.cursor = usable ? 'pointer' : 'not-allowed';
      b.title = st.hint || '';
      b.setAttribute('aria-label', st.hint || 'Add rep');

      /* icon : complete → tick, timer → play (remaining ke saath), warna khaali */
      if (comp) b.innerHTML = UI.icons.check;
      else if (t === 'timer') {
        b.innerHTML = ICON_PLAY;
        if (st.running && typeof st.remainingMs === 'number' && st.remainingMs > 0) {
          var mins = Math.ceil(st.remainingMs / 60000);
          b.title = (st.hint || '') + ' · ' + mins + ' min bache';
        }
      } else b.innerHTML = '';

      /* reps line : study card par MINUTES, baaki types par reps
         (fraction ho to decimal — aapki choice) */
      if (repsLine) {
        if (t === 'study' && window.StudyHabit) repsLine.textContent = window.StudyHabit.lineText(h);
        else repsLine.textContent = HT() ? HT().repsText(h) : ('today ' + d + '/' + total + ' reps');
      }
      return st;
    }

    paint();

    b.addEventListener('click', function (e) {
      e.stopPropagation();

      /* fallback : HabitTypes na load ho to purana behaviour */
      if (!HT()) {
        var cur0 = repsOn(h, today());
        if (cur0 >= total) return;
        var nd0 = addRep(h, 1);
        b.style.transform = 'scale(1.18)';
        window.setTimeout(function () { b.style.transform = 'scale(1)'; }, 160);
        if (repsLine) repsLine.textContent = 'today ' + nd0 + '/' + total + ' reps';
        return;
      }

      var st = HT().buttonState(h);
      /* STUDY-HABIT: display-only — tap par sirf explanation, tick kabhi nahi */
      if (st.type === 'study') {
        toast(st.hint || 'Study time Subject Tracker se apne aap aata hai.');
        return;
      }
      if (st.complete) return;                      /* aaj poora ho chuka */
      if (!st.enabled) {                            /* strict block */
        toast(st.hint || 'Abhi ye habit tick nahi ho sakti.');
        return;
      }

      var r = HT().applyTick(h);
      if (!r || !r.ok) {
        toast((r && r.msg) || 'Abhi ye habit tick nahi ho sakti.');
        paint();
        return;
      }

      if (r.type === 'timer') {
        /* timer START hua — credit session complete hone par aayega */
        toast('Timer start · ' + HT().durLabel(HT().durationMin(h)) +
              ' · poora hone par rep milega');
        paint();
        return;
      }

      persist();
      b.style.transform = 'scale(1.18)';
      window.setTimeout(function () { b.style.transform = 'scale(1)'; }, 160);
      paint();
    });

    /* sirf 'time' aur 'timer' ko live repaint chahiye :
         'time'  → window khulti/band hoti rehti hai
         'timer' → countdown chal raha hota hai
       'one' aur 'study' khud nahi badalte (study ka time har render par
       studyStore se sync ho jata hai), isliye interval mein register nahi. */
    if (HT()) {
      var liveT = HT().typeOf(h);
      if (liveT === 'time' || liveT === 'timer') {
        liveBtns.push({ btn: b, paint: paint });
        ensureLive();
      }
    }
    return b;
  }

  function habitCard(h) {
    var c = el('div', 'sub-card no-chevron');
    c.style.cssText += ';padding:13px 14px;align-items:flex-start;cursor:pointer';
    /* STUDY-HABIT: default card ki pehchaan */
    var isStudy = !!(window.StudyHabit && window.StudyHabit.isStudyCard(h));
    var tile = el('div', 'sub-tile t1', esc((h.name || '?').charAt(0).toUpperCase()));
    c.appendChild(tile);

    var main = el('div', 'sub-main');
    main.style.cssText = 'flex:1;min-width:0';
    /* naam + (Study card ho to) AUTO badge ek row mein */
    var nameRow = el('div');
    nameRow.style.cssText = 'display:flex;align-items:center;gap:6px;min-width:0';
    var name = el('h3', null, esc(h.name));
    name.style.cssText = 'margin:0;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
    nameRow.appendChild(name);
    if (isStudy) {
      var badge = el('span', null, 'AUTO');
      badge.style.cssText = 'flex:none;font-size:8px;font-weight:800;letter-spacing:.09em;' +
        'padding:2px 6px;border-radius:99px;background:rgba(46,160,67,.16);color:#2ea043;' +
        'border:1px solid rgba(46,160,67,.35)';
      badge.title = 'Default card — Subject Tracker ka padhai-time apne aap judta hai. Delete nahi ho sakta.';
      nameRow.appendChild(badge);
    }
    main.appendChild(nameRow);

    var done = repsOn(h, today());
    var total = h.repsPerDay || 1;
    /* STUDY-HABIT: reps ki jagah minutes — "today 42/60 min" */
    var repsLine = el('div', 'sub-meta',
      isStudy ? window.StudyHabit.lineText(h) : ('today ' + done + '/' + total + ' reps'));
    repsLine.style.margin = '2px 0 0';          /* naam ke just neeche, kam gap */
    main.appendChild(repsLine);
    /* Habit Formation % bar (automaticity) */
    var cs = window.GoodSystem.compute(h.logs || {}, {
      startDate: h.startDate, strict: h.strict || 3, repsPerDay: h.repsPerDay || 1
    }, today());
    var fpct = cs.autoPercent;
    var fbar = el('div');
    fbar.style.cssText = 'height:5px;border-radius:99px;background:var(--s2);overflow:hidden;margin-top:9px';
    var ffill = el('div');
    ffill.style.cssText = 'height:100%;border-radius:99px;background:var(--ink);width:' + fpct + '%;transition:width .3s';
    fbar.appendChild(ffill);
    main.appendChild(fbar);
    var flab = el('div', 'sub-meta', 'Habit Formation ' + fpct + '%');
    flab.style.margin = '3px 0 0';
    main.appendChild(flab);
    c.appendChild(main);

    /* right column : progress button (upar) + arrow (neeche) — ek line/sequence mein */
    var col = el('div');
    col.style.cssText = 'flex:none;display:flex;flex-direction:column;align-items:center;' +
      'justify-content:center;gap:10px;align-self:stretch';
    col.appendChild(progressBtn(h, done, total, repsLine));
    var ab = el('button', null, ICON_CHEV);
    ab.type = 'button';
    ab.setAttribute('aria-label', 'Open detail');
    ab.style.cssText = 'width:26px;height:26px;border-radius:8px;border:0;background:transparent;' +
      'color:var(--slate);cursor:pointer;display:flex;align-items:center;justify-content:center';
    ab.addEventListener('click', function (e) { e.stopPropagation(); openDetail(h.id); });
    col.appendChild(ab);
    c.appendChild(col);

    c.addEventListener('click', function () { openDetail(h.id); });
    return c;
  }

  function openList() {
    renderList();
    bridge().show(listScreen, true);
  }

  /* HABIT-TYPES: collected type-values ko habit object par lagao.
     NOTE: type badalne par purana type-data (slots / durationMin) DELETE nahi
     hota — sirf ignore hota hai. Isliye user wapas usi type par jaaye to uska
     purana setup mila rahega. */
  function applyType(h, v) {
    if (!v) return;
    h.type = v.type || 'one';
    h.repsPerDay = Math.max(1, parseInt(v.repsPerDay, 10) || 1);
    if (h.type === 'time' && Array.isArray(v.slots)) h.slots = v.slots;
    if (h.type === 'timer') {
      h.durationMin = Math.max(1, parseInt(v.durationMin, 10) ||
        (HT() ? HT().DEFAULT_DUR : 30));
    }
    if (HT()) HT().normalize(h);
  }

  /* ---------- add habit modal ---------- */
  function openAddModal(h) {
    /* STUDY-HABIT: default Study card ka APNA editor hai — type-chooser nahi,
       naam/type locked, delete/disable nahi. Sirf target + start date + strict.
       (good-detail.js ka kebab bhi yahin aata hai, isliye yahi intercept.) */
    if (h && window.StudyHabit && window.StudyHabit.isStudyCard(h)) {
      window.StudyHabit.openEditor(h);
      return;
    }
    var m = UI.modal({ zScrim: 85, zWrap: 86 });
    /* HABIT-TYPES: 'time' type mein N slots ke saath form kaafi lamba ho jata
       hai. .sheet par max-height/overflow hai hi nahi, isliye yahan explicitly
       scrollable banate hain — warna content screen se bahar chala jata. */
    m.sheet.style.maxHeight = 'calc(100% - 26px)';
    m.sheet.style.boxSizing = 'border-box';
    m.sheet.style.display = 'flex';
    m.sheet.style.flexDirection = 'column';
    m.body.style.overflowY = 'auto';
    m.body.style.flex = '1 1 auto';
    m.body.style.minHeight = '0';
    m.body.style.overscrollBehavior = 'contain';

    var nameF = UI.inputField('Habit name', 'e.g. Drink water');
    var descWrap = el('div');
    descWrap.style.marginBottom = '12px';
    descWrap.appendChild(UI.label('Description'));
    var descIn = el('textarea');
    descIn.placeholder = 'What exactly is this habit...';
    descIn.style.cssText = 'width:100%;min-height:64px;resize:vertical;border:1px solid var(--s2);border-radius:12px;' +
      'background:var(--input-bg);padding:10px 12px;font:inherit;font-size:13px;color:var(--ink);box-sizing:border-box';
    descWrap.appendChild(descIn);
    /* HABIT-TYPES: 'Repetition per day' field ki jagah 'Habit type' chooser.
       Repetition ab type-specific section ke andar hai (teeno types mein hota
       hai). HabitTypes load na ho to purana field fallback mein chalta hai. */
    var typeEd = HT() ? HT().buildTypeEditor(h) : null;
    var repsF = typeEd ? null : UI.inputField('Repetition per day', 'e.g. 1, 2, 10', 'number');
    var startISO = today();
    if (h) {
      nameF.input.value = h.name || '';
      descIn.value = h.desc || '';
      if (repsF) repsF.input.value = h.repsPerDay || 1;
      startISO = h.startDate || today();
    } else if (repsF) repsF.input.value = 1;
    var startB = UI.pillBtn('Start: ' + UI.fmtDate(startISO));
    startB.style.cssText += ';width:100%;justify-content:flex-start;margin-bottom:10px';
    startB.addEventListener('click', function () {
      window.AchivaCalendar.open('Start date', startISO, function (iso) {
        startISO = iso;
        startB.innerHTML = 'Start: ' + UI.fmtDate(iso);
      });
    });
    var strictR = UI.chipRow(['1', '2', '3', '4', '5'], String(h ? (h.strict || 3) : 3));

    m.open(h ? 'Edit habit' : 'New good habit', function (body) {
      body.appendChild(nameF.wrap);
      body.appendChild(descWrap);
      body.appendChild(typeEd ? typeEd.wrap : repsF.wrap);
      body.appendChild(startB);
      body.appendChild(UI.label('Strict level (1 = strictest, 5 = lenient)'));
      body.appendChild(strictR.row);
      strictR.row.style.margin = '6px 0 12px';
    }, function () {
      var name = nameF.input.value.trim();
      if (!name) { nameF.input.focus(); return; }

      /* HABIT-TYPES: type-specific validation — e.g. 'time' type mein exactly
         N slots zaroori hain (aapki choice). Fail hone par editor apna inline
         error dikha chuka hota hai; modal khula rehta hai taaki user theek
         kar sake, chup-chaap galat data save na ho. */
      var tv = null;
      if (typeEd) {
        tv = typeEd.collect();
        if (!tv || !tv.ok) return;
      }
      var fallbackReps = repsF ? Math.max(1, parseInt(repsF.input.value, 10) || 1) : 1;

      if (h) {
        h.name = name;
        h.desc = descIn.value.trim();
        h.startDate = startISO;
        h.strict = parseInt(strictR.get(), 10) || 3;
        if (typeEd) applyType(h, tv.value);
        else h.repsPerDay = fallbackReps;
        persist();
      } else {
        var o = {
          name: name,
          desc: descIn.value.trim(),
          startDate: startISO,
          strict: parseInt(strictR.get(), 10) || 3
        };
        if (typeEd) applyType(o, tv.value);
        else o.repsPerDay = fallbackReps;
        addHabit(o);
      }
      m.close();
      if (h && window.GoodDetail) window.GoodDetail.open(h.id);
      else renderList();
    });
  }

  /* ---------- 3) DETAIL : good-detail.js ---------- */
  function openDetail(id) {
    if (window.GoodDetail) { window.GoodDetail.open(id); return; }
    var h = get(id);
    detailScreen.innerHTML = '';
    var scroll = el('div', 'scroll');
    var head = el('div');
    head.style.cssText = 'display:flex;align-items:center;gap:10px;padding:12px 16px 6px';
    var back = UI.miniBtn(UI.icons.back, 'Back');
    back.style.cssText += ';width:34px;height:34px;border-radius:50%;border:1px solid var(--s2);background:var(--chip-bg)';
    back.addEventListener('click', function () { openList(); });
    head.appendChild(back);
    var tt = el('b', null, h ? h.name : 'Habit');
    tt.style.cssText = 'flex:1;min-width:0;font-family:var(--f-disp);font-size:16px;font-weight:700;' +
      'color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
    head.appendChild(tt);
    scroll.appendChild(head);

    var box = el('div');
    box.style.cssText = 'margin:40px 24px;padding:34px 20px;border:1px dashed var(--s2);border-radius:22px;text-align:center';
    var t1 = el('div', null, 'Coming soon');
    t1.style.cssText = 'font-family:var(--f-disp);font-size:18px;font-weight:700;color:var(--ink2);margin-bottom:8px';
    var t2 = el('div', null, 'Is habit ki poori detail (history, streak graph, edits) is update ke baad aayegi.');
    t2.style.cssText = 'font-size:12px;line-height:1.7;color:var(--slate)';
    box.appendChild(t1); box.appendChild(t2);
    scroll.appendChild(box);

    detailScreen.appendChild(scroll);
    bridge().show(detailScreen, true);
  }

  window.GoodList = {
    open: open, openList: openList, openDetail: openDetail,
    all: all, get: get, addHabit: addHabit, removeHabit: removeHabit, addRep: addRep,
    repsOn: repsOn, dayDone: dayDone, goodStreak: goodStreak, bestStreak: bestStreak,
    openAddModal: openAddModal,
    /* HABIT-TYPES: timer sessions ka (fractional) credit — habit-types.js ka
       ST.recordStudy wrapper isi ko call karta hai. */
    addCredit: addCredit, persist: persist, toast: toast,
    /* STUDY-HABIT: study-habit.js recordStudy-wrap ke baad isi ko call karta hai */
    refreshList: refreshList
  };

  /* HABIT-TYPES: ab GoodList ready hai — jo timer-session app band/reload hone
     ki wajah se atka tha uska hisaab lagao. Ye zaroori hai kyunki study-timer.js
     apna reconcile() index.html mein HAMARE wrapper se pehle chala chuka hota
     hai (load order), to us waqt habit ko credit nahi mil pata. */
  if (HT() && HT().reconcilePending) {
    try { HT().reconcilePending(); } catch (e) { /* ignore */ }
  }
})();
