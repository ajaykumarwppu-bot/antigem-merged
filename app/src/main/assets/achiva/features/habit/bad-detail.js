/* ================================================================
   FEATURES / HABIT / BAD-DETAIL.JS — BAD habit detailed board
   ----------------------------------------------------------------
   Bad habit card (bad-list.js) par tap karne par ye board khulta
   hai. Layout good-detail.js jaisa hi, lekin meanings ULTE :

   • head : circular back + bad habit ka naam
   • Top par DO side-by-side boxes :
       LEFT  : upar bada number = CURRENT streak
               (lagaatar kitne din is bad habit ko DEFEND kiya —
               yaani nahi kiya. Aaj defend na ho to streak count
               yesterday tak gina jata hai, good-detail jaisa hi)
               divider ke neeche = BEST streak (ab tak ki sabse
               lambi defend ki hui run)
       RIGHT : "fighting since" = kab se is habit se lad rahe ho
               (since date) + divider + kitne DAYS ho chuke
   • Neeche STREAK MAP (3 month rolling heat map, good-detail wale
     streak box jaisa) lekin colors ke matlab ye :
       GREEN          : us din habit DEFEND ki (nahi kiya)
       RED (5 levels) : us din habit REPEAT ki —
                         1 repeat = halka red … 5+ repeat = gehra red
       defended ke BAAD usi din repeat ho gayi → cell GREEN se
       RED ho jata hai (reps > 0 hone par red hi jeetta hai)
       khaali cell      : na defend, na repeat (abhi kuch nahi)
       future din       : fade (gh-fut)
   • Map ke neeche chhoti LEGEND : green = defended, red 1..5 =
     repeats ke levels.

   Data kahin se duplicate NAHI hota : sab kuch BadList (bad-list.js)
   ke API se padha jata hai — repsOn / defendedOn / get — taaki
   storage 'achiva.badHabits.v1' hi single source of truth rahe.
   Depends on : UI, BadList, SubjectListBridge
   ================================================================ */

(function () {
  'use strict';

  if (window.__achivaBadDetailLoaded) return;
  window.__achivaBadDetailLoaded = true;

  var el = UI.el, esc = UI.esc;
  /* DAY-CLOCK : 'aaj' app ke apne din se (setting 'Mera Din') */
  function appToday() { return window.DayClock ? window.DayClock.today() : UI.todayISO(); }

  var B = function () { return window.BadList; };

  var screen = el('section', 'screen');
  screen.style.paddingTop = '58px';
  document.getElementById('app').appendChild(screen);

  function boxBase() {
    var b = el('div');
    b.style.cssText = 'flex:1;padding:14px;border:1px solid var(--line);border-radius:18px;' +
      'background:var(--tile-bg);box-shadow:inset 0 1px 0 var(--hl-soft);text-align:center';
    return b;
  }
  function divider() {
    var d = el('div');
    d.style.cssText = 'width:34px;height:1px;background:var(--s2);margin:8px auto';
    return d;
  }

  /* ---------- month helpers (good-detail jaise hi) ---------- */
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];
  function monthKey(iso) { return iso.slice(0, 7); }
  function addMonths(mk, n) {
    var y = +mk.slice(0, 4), m = +mk.slice(5, 7) - 1 + n;
    y += Math.floor(m / 12); m = ((m % 12) + 12) % 12;
    return y + '-' + String(m + 1).padStart(2, '0');
  }
  function monthLabel(mk) { return MONTHS[+mk.slice(5, 7) - 1] + ' ' + mk.slice(2, 4); }
  function daysInMonth(mk) {
    return new Date(+mk.slice(0, 4), +mk.slice(5, 7), 0).getDate();
  }
  function lerp(a, b, t) {
    return 'rgb(' + Math.round(a[0] + (b[0] - a[0]) * t) + ',' +
      Math.round(a[1] + (b[1] - a[1]) * t) + ',' +
      Math.round(a[2] + (b[2] - a[2]) * t) + ')';
  }

  /* ---------- colors ----------
     RED : 5 levels — 1 repeat halka, 5+ repeat sabse gehra */
  function redColor(level) {
    var dark = document.documentElement.getAttribute('data-theme') === 'dark';
    var from = dark ? [62, 40, 38] : [245, 213, 213];
    var to = dark ? [229, 115, 105] : [192, 57, 43];
    var t = (Math.min(5, Math.max(1, level)) - 1) / 4;
    return lerp(from, to, t);
  }
  function greenColor() {
    var dark = document.documentElement.getAttribute('data-theme') === 'dark';
    return dark ? 'rgb(86,211,100)' : 'rgb(46,160,67)';
  }
  var TICK = '<svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>';

  /* ---------- din ka status : red (repeats) jeetta hai green par ---------- */
  function dayState(h, iso) {
    var reps = B().repsOn(h, iso).length;
    if (reps > 0) return { kind: 'red', level: Math.min(5, reps), reps: reps };
    if (B().defendedOn(h, iso)) return { kind: 'green' };
    return null;
  }

  /* ---------- streaks : lagaatar DEFEND kiye din ----------
     defend ke baad usi din repeat ho gayi → wo din streak mein
     NAHI ginta (sirf wo din achha tha jis din habit hui hi nahi) */
  function defendedClean(h, iso) {
    return B().defendedOn(h, iso) && B().repsOn(h, iso).length === 0;
  }
  function curStreak(h) {
    var d = appToday();
    if (!defendedClean(h, d)) d = UI.addDays(d, -1);
    var n = 0;
    while (defendedClean(h, d) && n < 5000) { n++; d = UI.addDays(d, -1); }
    return n;
  }
  function bestStreak(h) {
    var d = h.since || appToday();
    var t = appToday();
    var best = 0, cur = 0, guard = 0;
    while (d <= t && guard < 5000) {
      if (defendedClean(h, d)) { cur++; if (cur > best) best = cur; }
      else cur = 0;
      d = UI.addDays(d, 1);
      guard++;
    }
    return best;
  }

  /* ---------- STREAK MAP : 3 month rolling, red/green cells ---------- */
  function streakMap(h) {
    var p = UI.panel();
    p.style.cssText += ';margin:0 18px 12px';
    p.appendChild(UI.panelTitle('Streak map'));
    var today = appToday();
    var since = h.since || today;
    var startMK = monthKey(since);
    var todayMK = monthKey(today);
    var fromMK = startMK > addMonths(todayMK, -2) ? startMK : addMonths(todayMK, -2);
    for (var mi = 0; mi < 3; mi++) {
      var mk = addMonths(fromMK, mi);
      var ml = el('div', null, monthLabel(mk));
      ml.style.cssText = 'font-size:9.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;' +
        'color:var(--slate);margin:' + (mi ? '10px' : '2px') + ' 0 5px';
      p.appendChild(ml);
      var wrap = el('div');
      wrap.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px';
      var dim = daysInMonth(mk);
      for (var d = 1; d <= dim; d++) {
        var iso = mk + '-' + String(d).padStart(2, '0');
        if (iso < since) continue;                 /* since se pehle ke din nahi */
        var b = el('div');
        b.className = 'gh-box';
        if (iso > today) b.className += ' gh-fut';
        else {
          var st = dayState(h, iso);
          if (st && st.kind === 'red') {
            var col = redColor(st.level);
            b.style.background = col;
            b.style.borderColor = col;
            b.title = iso + ' · ' + st.reps + ' repeat' + (st.reps === 1 ? '' : 's');
          } else if (st && st.kind === 'green') {
            b.style.background = greenColor();
            b.style.borderColor = greenColor();
            b.style.display = 'flex';
            b.style.alignItems = 'center';
            b.style.justifyContent = 'center';
            b.innerHTML = TICK;
            b.title = iso + ' · defended (nahi kiya)';
          } else {
            b.title = iso;
          }
        }
        wrap.appendChild(b);
      }
      p.appendChild(wrap);
    }
    /* legend : green = defended, red levels 1..5 = repeats */
    var leg = el('div');
    leg.style.cssText = 'display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:12px';
    function swatch(bg) {
      var s = el('div');
      s.style.cssText = 'width:12px;height:12px;border-radius:4px;flex:none;background:' + bg;
      return s;
    }
    function legTxt(t) {
      var x = el('div', null, t);
      x.style.cssText = 'font-size:9px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--slate)';
      return x;
    }
    leg.appendChild(swatch(greenColor()));
    leg.appendChild(legTxt('defended'));
    for (var lv = 1; lv <= 5; lv++) {
      leg.appendChild(swatch(redColor(lv)));
      leg.appendChild(legTxt(lv === 5 ? '5+ repeats' : String(lv)));
    }
    p.appendChild(leg);
    return p;
  }

  /* ---------- REPEAT HISTORY : din-wise repeats + triggers ----------
     "Dekho" button click karte hi poori history khulti hai : kis din
     repeat hui, kis-kis time par, aur trigger kya tha — poora data.
     (Triggers bad-list.js mein har rep ke saath save hote hain.) */
  function historyPanel(h) {
    var p = UI.panel();
    p.style.cssText += ';margin:0 18px 12px';
    var head = el('div');
    head.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:10px';
    head.appendChild(UI.panelTitle('Repeat history', true));
    head.lastChild.style.flex = '1';
    var reps = h.reps || [];
    var cnt = UI.chip(reps.length + ' repeat' + (reps.length === 1 ? '' : 's'));
    cnt.style.cssText += ';background:var(--chip-bg);color:var(--ink2);border-color:var(--s2);flex:none';
    head.appendChild(cnt);
    var toggle = UI.pillBtn('Dekho');
    toggle.style.cssText += ';padding:5px 11px;font-size:10.5px;flex:none';
    head.appendChild(toggle);
    p.appendChild(head);

    var box = el('div');
    box.style.display = 'none';
    var days = {};
    reps.forEach(function (r) { (days[r.iso] = days[r.iso] || []).push(r); });
    var isos = Object.keys(days).sort().reverse();      /* naya din pehle */
    if (!isos.length) {
      var e = el('div', null, 'Koi repeat nahi — history khali hai.');
      e.style.cssText = 'font-size:11px;color:var(--slate);line-height:1.6';
      box.appendChild(e);
    } else {
      isos.forEach(function (iso, i) {
        if (i) {
          var d = el('div');
          d.style.cssText = 'height:1px;background:var(--line);margin:8px 0';
          box.appendChild(d);
        }
        var dt = el('div', null, esc(UI.fmtDate(iso)));
        dt.style.cssText = 'font-size:11px;font-weight:700;color:var(--ink);margin-bottom:4px';
        box.appendChild(dt);
        days[iso].forEach(function (r) {
          var line = el('div', null, esc(r.at + ' — ' + (r.trigger || '(trigger nahi likha)')));
          line.style.cssText = 'font-size:11px;color:var(--ink2);line-height:1.6;margin:0 0 2px 2px';
          box.appendChild(line);
        });
      });
    }
    toggle.addEventListener('click', function () {
      var show = box.style.display === 'none';
      box.style.display = show ? '' : 'none';
      toggle.innerHTML = show ? 'Chhupao' : 'Dekho';
    });
    p.appendChild(box);
    return p;
  }

  /* ---------- board ---------- */
  function open(id) {
    var h = B().get(id);
    if (!h) { B().openList(); return; }
    screen.innerHTML = '';
    var scroll = el('div', 'scroll');

    /* head */
    var head = el('div');
    head.style.cssText = 'display:flex;align-items:center;gap:10px;padding:12px 16px 6px';
    var back = UI.miniBtn(UI.icons.back, 'Back');
    back.style.cssText += ';width:34px;height:34px;border-radius:50%;border:1px solid var(--s2);background:var(--chip-bg)';
    back.addEventListener('click', function () { B().openList(); });
    head.appendChild(back);
    var tt = el('b', null, esc(h.name));
    tt.style.cssText = 'flex:1;min-width:0;font-family:var(--f-disp);font-size:16px;font-weight:700;' +
      'color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
    head.appendChild(tt);
    scroll.appendChild(head);

    /* two boxes */
    var row = el('div');
    row.style.cssText = 'display:flex;gap:10px;margin:10px 18px 12px';

    /* LEFT : current streak / divider / best streak */
    var left = boxBase();
    var cur = curStreak(h);
    var curN = el('div', null, String(cur));
    curN.style.cssText = 'font-family:var(--f-disp);font-size:30px;font-weight:700;line-height:1.1;color:var(--ink2)';
    left.appendChild(curN);
    var curL = el('div', null, 'current streak');
    curL.style.cssText = 'font-size:9.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--slate);margin-top:2px';
    left.appendChild(curL);
    left.appendChild(divider());
    var best = bestStreak(h);
    var bestN = el('div', null, String(best));
    bestN.style.cssText = 'font-family:var(--f-disp);font-size:19px;font-weight:700;color:var(--ink)';
    left.appendChild(bestN);
    var bestL = el('div', null, 'best streak');
    bestL.style.cssText = 'font-size:9px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:var(--ash);margin-top:1px';
    left.appendChild(bestL);
    row.appendChild(left);

    /* RIGHT : fighting since / divider / days ho chuke */
    var right = boxBase();
    var stL = el('div', null, 'Fighting since');
    stL.style.cssText = 'font-size:9.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--slate)';
    right.appendChild(stL);
    var stV = el('div', null, UI.fmtDate(h.since || appToday()));
    stV.style.cssText = 'font-size:13px;font-weight:700;color:var(--ink);margin-top:3px';
    right.appendChild(stV);
    right.appendChild(divider());
    var days = Math.max(0, Math.round((new Date(appToday()) - new Date(h.since || appToday())) / 86400000));
    var dN = el('div', null, String(days));
    dN.style.cssText = 'font-family:var(--f-disp);font-size:22px;font-weight:700;color:var(--ink2)';
    right.appendChild(dN);
    var dL = el('div', null, 'days ho chuke');
    dL.style.cssText = 'font-size:9px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:var(--ash);margin-top:1px';
    right.appendChild(dL);
    row.appendChild(right);

    scroll.appendChild(row);
    scroll.appendChild(streakMap(h));
    /* FORMATION GRAPH : good-detail.js ka wahi panel REUSE hota hai —
       sirf labels FR1…DM3 aur stage naam BadSystem ke, Rules button
       band (bad side par rules screen nahi hai). Graph wahi rehta hai
       (wahi curve, wahi green fill). */
    if (window.GoodDetail && window.GoodDetail.formationPanel && window.BadSystem) {
      var asGood = {
        id: h.id,
        name: h.name,
        logs: window.BadSystem.logsFrom(h, appToday()),
        startDate: h.since || appToday(),
        strict: 3,
        repsPerDay: 1
      };
      scroll.appendChild(window.GoodDetail.formationPanel(asGood, {
        labels: window.BadSystem.LEVEL_SHORT,
        stageOf: function (cs) { return window.BadSystem.STAGES[cs.stageIdx]; },
        hideRules: true
      }));
    }
    scroll.appendChild(historyPanel(h));
    screen.appendChild(scroll);
    window.SubjectListBridge.show(screen, true);
  }

  window.BadDetail = {
    open: open,
    curStreak: curStreak,
    bestStreak: bestStreak,
    dayState: dayState,
    defendedClean: defendedClean,
    redColor: redColor,
    greenColor: greenColor
  };
})();
