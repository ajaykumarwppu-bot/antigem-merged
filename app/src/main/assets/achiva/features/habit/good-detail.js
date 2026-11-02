/* ================================================================
   FEATURES / HABIT / GOOD-DETAIL.JS — good habit detail screen
   ----------------------------------------------------------------
   • head : circular back + habit name
   • Top par DO side-by-side boxes :
       LEFT  : ek box do parts mein —
                 upar  : bada dark number = CURRENT streak
                         just neeche label "current streak"
                         phir ek chhoti divider line
                 neeche : chhota number = BEST streak + label
       RIGHT : parallel box —
                 Start date (kab shuru hui)
                 divider
                 bada number = kitne days beet chuke (since start)
   • Aage ke sections (history, edits, graph) baad mein aayenge
   ================================================================ */

(function () {
  'use strict';

  if (window.__achivaGoodDetailLoaded) return;
  window.__achivaGoodDetailLoaded = true;

  var el = UI.el, esc = UI.esc;
  var G = function () { return window.GoodList; };
  /* DAY-CLOCK : 'aaj' app ke apne din se (setting 'Mera Din') */
  function appToday() { return window.DayClock ? window.DayClock.today() : UI.todayISO(); }


  var screen = el('section', 'screen');
  screen.style.paddingTop = '58px';
  document.getElementById('app').appendChild(screen);

  /* STUDY-HABIT: abhi kaunsi habit khuli hai — refresh() ke liye */
  var curId = null;

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

  /* ================================================================
     STUDY-HABIT: total padhai-time panel
     ----------------------------------------------------------------
     exam-widget.js (Subject screen ka top card) jo "total study" number
     dikhata hai — BILKUL WAHI yahan aata hai, kyunki dono
     ST.studyStore() ke saare entries ka ms jodte hain, bina kisi filter ke.
     Saath mein aaj ka progress (minutes / daily target).
     ================================================================ */
  function studyTimePanel(h) {
    var SH = window.StudyHabit;
    if (!SH) return el('div');

    var p = el('div');
    p.style.cssText = 'display:flex;gap:10px;margin:0 18px 12px';

    /* LEFT : ab tak ka total study time */
    var left = boxBase();
    var tv = el('div', null, esc(SH.totalText()));
    tv.style.cssText = 'font-family:var(--f-disp);font-size:19px;font-weight:700;' +
      'line-height:1.15;color:var(--ink)';
    left.appendChild(tv);
    var tl = el('div', null, 'total study');
    tl.style.cssText = 'font-size:9.5px;font-weight:700;letter-spacing:.08em;text-transform:' +
      'uppercase;color:var(--slate);margin-top:3px';
    left.appendChild(tl);
    left.appendChild(divider());
    var sl = el('div', null, 'saare subjects + chapters ka jod');
    sl.style.cssText = 'font-size:9px;line-height:1.4;color:var(--ash)';
    left.appendChild(sl);
    p.appendChild(left);

    /* RIGHT : aaj ka progress vs daily target */
    var right = boxBase();
    var target = h.studyTargetMin || SH.DEFAULT_TARGET;
    var mins = SH.minutesOn(h);
    var av = el('div', null, esc(SH.fmtMin(mins)) + ' / ' + target + ' min');
    av.style.cssText = 'font-family:var(--f-disp);font-size:19px;font-weight:700;' +
      'line-height:1.15;color:var(--ink2)';
    right.appendChild(av);
    var al = el('div', null, 'aaj');
    al.style.cssText = 'font-size:9.5px;font-weight:700;letter-spacing:.08em;text-transform:' +
      'uppercase;color:var(--slate);margin-top:3px';
    right.appendChild(al);
    right.appendChild(divider());
    /* chhota progress bar */
    var pct = SH.todayPct(h);
    var bar = el('div');
    bar.style.cssText = 'height:5px;border-radius:99px;background:var(--s2);overflow:hidden';
    var fill = el('div');
    fill.style.cssText = 'height:100%;border-radius:99px;background:' +
      (pct >= 100 ? '#2ea043' : 'var(--ink)') + ';width:' + pct + '%;transition:width .3s';
    bar.appendChild(fill);
    right.appendChild(bar);
    var pl = el('div', null, pct + '% of daily target');
    pl.style.cssText = 'font-size:9px;font-weight:700;letter-spacing:.06em;color:var(--ash);margin-top:4px';
    right.appendChild(pl);
    p.appendChild(right);

    return p;
  }


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
  /* repetition ke hisaab se color : halka green → dark green */
  function repColor(h, date) {
    var done = G().repsOn(h, date);
    var total = h.repsPerDay || 1;
    if (done <= 0) return null;
    var dark = document.documentElement.getAttribute('data-theme') === 'dark';
    var from = dark ? [36, 52, 42] : [207, 230, 207];
    var to = dark ? [86, 211, 100] : [46, 160, 67];
    var t = Math.min(1, done / total);
    return { bg: lerp(from, to, t), done: done >= total };
  }
  var TICK = '<svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>';

  /* ---------- month-wise streak panel (3 month rolling) ---------- */
  function streakPanel(h) {
    var p = UI.panel();
    p.style.cssText += ';margin:0 18px 12px';
    p.appendChild(UI.panelTitle('Streak box'));
    var today = appToday();
    var startMK = monthKey(h.startDate);
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
        if (iso < h.startDate) continue;          /* start se pehle ke din nahi */
        var b = el('div');
        b.className = 'gh-box';
        var col = repColor(h, iso);
        if (iso > today) b.className += ' gh-fut';
        else if (col) {
          b.style.background = col.bg;
          b.style.borderColor = col.bg;
          if (col.done) {
            b.innerHTML = TICK;                    /* rep poori = tick */
            b.style.display = 'flex';
            b.style.alignItems = 'center';
            b.style.justifyContent = 'center';
          }
        }
        b.title = iso;
        wrap.appendChild(b);
      }
      p.appendChild(wrap);
    }
    return p;
  }


  /* ---------- formation graph : BOX mein, 7-din sliding window, solid base ----------
     REUSE : bad-detail.js bhi yahi panel use karta hai opts ke saath —
       opts.labels   : Y-axis ke level naam (default GoodSystem.LEVEL_SHORT)
       opts.stageOf  : cs se stage object (default cs.stage)
       opts.hideRules: true → Rules button nahi (bad board par rules screen nahi hai)
     Bina opts ke behaviour bilkul purana hi rehta hai. */
  function formationPanel(h, opts) {
    opts = opts || {};
    var GS = window.GoodSystem;
    var cs = GS.compute(h.logs || {}, {
      startDate: h.startDate, strict: h.strict || 3, repsPerDay: h.repsPerDay || 1
    }, appToday());

    /* ek BOX (streak-box jaisa) */
    var p = el('div');
    p.style.cssText = 'margin:0 18px 12px;padding:14px;border:1px solid var(--line);border-radius:18px;' +
      'background:var(--tile-bg);box-shadow:inset 0 1px 0 var(--hl-soft)';

    /* box ke andar upar title + stage + Rules */
    var head = el('div');
    head.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:10px';
    head.appendChild(UI.panelTitle('Habit Formation', true));
    head.lastChild.style.flex = '1';
    var sc = UI.chip(opts.stageOf ? opts.stageOf(cs).key : cs.stage.key);
    sc.style.cssText += ';background:var(--chip-bg);color:var(--ink2);border-color:var(--s2);flex:none';
    head.appendChild(sc);
    if (!opts.hideRules) {
      var rb = UI.pillBtn('Rules');
      rb.style.cssText += ';padding:5px 11px;font-size:10.5px;flex:none';
      rb.addEventListener('click', function () { openRules(h, cs); });
      head.appendChild(rb);
    }
    p.appendChild(head);

    var totalDays = Math.max(1, cs.totalDays);
    var WIN = 7;                       /* ek waqt mein 7 din dikhte hain */
    var H = 210, padL = 40, padR = 10, padT = 8, padB = 22;

    var scroller = el('div');
    scroller.style.cssText = 'overflow-x:auto;overflow-y:hidden;-webkit-overflow-scrolling:touch';
    var inner = el('div');
    inner.style.cssText = 'position:relative';
    var svgHolder = el('div');
    svgHolder.style.cssText = 'position:sticky;left:0';
    inner.appendChild(svgHolder);
    scroller.appendChild(inner);
    p.appendChild(scroller);

    var W = 320;                      /* baad mein clientWidth se update */
    var yMin = 0, yMax = 2, winStart = 1;

    function yFor(L) { return padT + (1 - (L - yMin) / (yMax - yMin)) * (H - padT - padB); }
    function xFor(day) { return padL + ((day - winStart) / (WIN - 1)) * (W - padL - padR); }

    function render() {
      var g = '<svg width="' + W + '" height="' + H + '" style="display:block">';
      /* level dotted lines + chhote boxes (left) */
      for (var L = Math.max(1, Math.ceil(yMin)); L <= Math.floor(yMax); L++) {
        var y = yFor(L);
        g += '<line x1="' + padL + '" y1="' + y.toFixed(1) + '" x2="' + W + '" y2="' + y.toFixed(1) +
          '" stroke="var(--s2)" stroke-width="1" stroke-dasharray="4,4"/>' +
          '<rect x="2" y="' + (y - 8).toFixed(1) + '" width="30" height="16" rx="5" fill="var(--chip-bg)" stroke="var(--s2)"/>' +
          '<text x="17" y="' + (y + 3.5).toFixed(1) + '" font-size="9" fill="var(--ink2)" font-weight="700" text-anchor="middle">' +
          (opts.labels || GS.LEVEL_SHORT)[L - 1] + '</text>';
      }
      /* bottom SOLID line (corner to corner) */
      g += '<line x1="0" y1="' + (H - padB) + '" x2="' + W + '" y2="' + (H - padB) + '" stroke="var(--ink2)" stroke-width="1.6"/>';
      /* curve for visible window */
      var pts = [];
      cs.series.forEach(function (q) {
        if (q.day >= winStart && q.day <= winStart + WIN - 1) pts.push(q);
      });
      if (pts.length) {
        var poly = pts.map(function (q) { return xFor(q.day).toFixed(1) + ',' + yFor(q.A).toFixed(1); });
        var area = 'M' + xFor(pts[0].day).toFixed(1) + ',' + (H - padB) + ' L' + poly.join(' L') +
          ' L' + xFor(pts[pts.length - 1].day).toFixed(1) + ',' + (H - padB) + ' Z';
        g += '<defs><linearGradient id="gl3" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0%" stop-color="rgba(46,160,67,.55)"/><stop offset="100%" stop-color="rgba(46,160,67,.06)"/></linearGradient></defs>' +
          '<path d="' + area + '" fill="url(#gl3)"/>' +
          '<polyline points="' + poly.join(' ') + '" fill="none" stroke="#2ea043" stroke-width="2.6" stroke-linejoin="round"/>';
        var lq = pts[pts.length - 1];
        g += '<circle cx="' + xFor(lq.day).toFixed(1) + '" cy="' + yFor(lq.A).toFixed(1) + '" r="4.2" fill="#2ea043" stroke="#fff" stroke-width="1.2"/>';
      }
      /* day labels (7) */
      for (var d = winStart; d <= winStart + WIN - 1 && d <= totalDays; d++) {
        g += '<text x="' + xFor(d).toFixed(1) + '" y="' + (H - 6) + '" font-size="8" fill="var(--ash)" text-anchor="middle">' + d + '</text>';
      }
      g += '</svg>';
      svgHolder.innerHTML = g;
    }

    function layout() {
      W = scroller.clientWidth || 320;
      var maxWin = Math.max(1, totalDays - WIN + 1);
      var contentW = Math.max(W, maxWin * 40);
      inner.style.width = contentW + 'px';
      svgHolder.style.width = W + 'px';
      return contentW;
    }
    function windowFromScroll() {
      var contentW = parseFloat(inner.style.width) || W;
      var range = Math.max(1, contentW - W);
      var t = Math.max(0, Math.min(1, scroller.scrollLeft / range));
      var maxWin = Math.max(1, totalDays - WIN + 1);
      winStart = 1 + Math.round(t * (maxWin - 1));
      /* Y-window : visible days ke score ke levels */
      var lo = 99, hi = 0;
      cs.series.forEach(function (q) {
        if (q.day >= winStart && q.day <= winStart + WIN - 1) {
          if (q.A < lo) lo = q.A;
          if (q.A > hi) hi = q.A;
        }
      });
      if (lo > hi) { lo = 0; hi = 0.5; }
      yMin = Math.max(0, Math.floor(lo));
      yMax = Math.min(GS.MAX_LEVEL, Math.max(yMin + 2, Math.ceil(hi) + 1));
      render();
    }

    var contentW = layout();
    windowFromScroll();
    scroller.scrollLeft = contentW - W;      /* default : latest 7 din */
    windowFromScroll();

    var raf = false;
    scroller.addEventListener('scroll', function () {
      if (raf) return;
      raf = true;
      window.requestAnimationFrame(function () { raf = false; windowFromScroll(); });
    });
    return p;
  }

  /* ---------- RULES screen (alag scrollable screen, back ke saath) ---------- */
  var rulesScreen = null;
  function openRules(h, cs) {
    var GS = window.GoodSystem;
    if (!cs) cs = GS.compute(h.logs || {}, { startDate: h.startDate, strict: h.strict || 3, repsPerDay: h.repsPerDay || 1 }, appToday());
    if (!rulesScreen) {
      rulesScreen = el('section', 'screen');
      rulesScreen.style.paddingTop = '58px';
      document.getElementById('app').appendChild(rulesScreen);
    }
    rulesScreen.innerHTML = '';
    var scroll = el('div', 'scroll');

    var head = el('div');
    head.style.cssText = 'display:flex;align-items:center;gap:10px;padding:12px 16px 6px';
    var back = UI.miniBtn(UI.icons.back, 'Back');
    back.style.cssText += ';width:34px;height:34px;border-radius:50%;border:1px solid var(--s2);background:var(--chip-bg)';
    back.addEventListener('click', function () { open(h.id); });
    head.appendChild(back);
    var tt = el('b', null, 'Rules');
    tt.style.cssText = 'flex:1;font-family:var(--f-disp);font-size:16px;font-weight:700;color:var(--ink)';
    head.appendChild(tt);
    scroll.appendChild(head);

    function sec(title) {
      var t = el('div', null, title);
      t.style.cssText = 'font-family:var(--f-disp);font-size:13px;font-weight:700;color:var(--ink);margin:14px 18px 6px';
      return t;
    }
    function para(txt) {
      var d = el('div', null, txt);
      d.style.cssText = 'font-size:12px;line-height:1.7;color:var(--ink2);margin:0 18px 8px';
      return d;
    }
    function bullet(txt) {
      var d = el('div', null, '• ' + txt);
      d.style.cssText = 'font-size:11.5px;line-height:1.65;color:var(--ink2);margin:0 18px 5px';
      return d;
    }
    function tbl(heads, rows) {
      var wrap = el('div');
      wrap.style.cssText = 'margin:0 18px 10px;overflow-x:auto';
      var t = el('table');
      t.style.cssText = 'width:100%;border-collapse:collapse;font-size:10.5px';
      var hr = el('tr');
      heads.forEach(function (x) {
        var th = el('th', null, x);
        th.style.cssText = 'text-align:left;padding:5px 7px;border-bottom:1px solid var(--line);color:var(--slate);font-weight:700';
        hr.appendChild(th);
      });
      t.appendChild(hr);
      rows.forEach(function (r) {
        var tr = el('tr');
        r.forEach(function (c) {
          var td = el('td', null, c);
          td.style.cssText = 'padding:5px 7px;border-bottom:1px solid var(--line);color:var(--ink2)';
          tr.appendChild(td);
        });
        t.appendChild(tr);
      });
      wrap.appendChild(t);
      return wrap;
    }

    scroll.appendChild(sec('Asaan bhasha mein'));
    scroll.appendChild(para('Ye app sirf "tick" nahi lagata. Ye dekhta hai ki aapki habit dheere-dheere ' +
      'kitni **apne aap** hone lagi hai. Neeche ke graph mein yahi levels (IL1→DL3) tak dikhta hai — graph kabhi rukta nahi, har level ko uske din par touch karta hai.'));
    scroll.appendChild(bullet('Jis din habit poori ki → graph upar badhta hai.'));
    scroll.appendChild(bullet('Jis din chhota version (minimum) kiya → graph thoda upar badhta hai, streak bachi rehti hai.'));
    scroll.appendChild(bullet('Jis din bilkul nahi kiya → ek "gap" gina jaata hai.'));
    scroll.appendChild(bullet('Gap maafi ke andar ho → streak nahi toot-ti, bas graph thoda sa girta hai.'));
    scroll.appendChild(bullet('Gap maafi se bahar ho → streak 0 ho jaati hai aur graph thoda neeche gir jaata hai.'));

    scroll.appendChild(sec('Din ke 3 nateeje'));
    scroll.appendChild(tbl(['Status', 'Kab', 'Asar'], [
      ['Done', 'reps poori ki', 'streak +1, graph upar'],
      ['Minimum', 'chhota version kiya', 'streak +1, graph thoda upar'],
      ['Missed', 'kuch nahi kiya', 'gap +1 (neeche dekhiye)']
    ]));

    scroll.appendChild(sec('Streak aur maafi (grace)'));
    scroll.appendChild(para('Har stage ki ek **maafi** hoti hai — kitne lagaataar din chhoot sakte hain bina streak toote. ' +
      'Shuru ke 7 din mein koi maafi nahi (sabse naazuk time). Jaise-jaise habit purani hoti hai, maafi badhti jaati hai. ' +
      'Maafi ke andar bhi graph thoda girta hai taaki "free skip" na ho.'));
    scroll.appendChild(bullet('Never-miss-twice: kabhi-kabhi ek din chhoot jaana theek hai; lagaatar chhootna mehnga padta hai.'));

    scroll.appendChild(sec('Automaticity graph'));
    scroll.appendChild(para('Graph = aapka dimaag is habit ko kitna apna chuka hai. Y-axis par levels hain (IL1, IL2, … DL3) dotted lines ke saath; ' +
      'lagatar karne par curve har level ko uske din par chhuta hai (IL1 @7 din, IL2 @21, IL3 @45…). Lamba gap graph ko neeche gira deta hai; ' +
      'Ignition mein ek miss par graph poora 0. X-axis par days hain (streak nahi) — graph ko left-right scroll karke purane din dekhe ja sakte hain.'));

    scroll.appendChild(sec('Stages (habit ki umar)'));
    scroll.appendChild(tbl(['Stage', 'Din', 'Maafi', 'Graph girega'],
      GS.STAGES.map(function (x) {
        return [x.key, x.from + '–' + (x.to > 9000 ? '∞' : x.to), x.grace + ' din', Math.round(x.penalty * 100) + '%'];
      })));

    scroll.appendChild(sec('Strict level (aapki habit ka type)'));
    scroll.appendChild(para('Kuch habits poori tarah aapke control mein hoti hain (exercise) — unpar strict rule lagta hai. ' +
      'Kuch habits halat par nirbhar hoti hain (neend, travel) — unpar naram rule. Ye aap habit banate waqt chunte hain (1–5).'));
    scroll.appendChild(tbl(['Strict', 'Maafi cap', 'Maafi floor', 'Penalty ×'],
      Object.keys(GS.STRICT).map(function (k) { var v = GS.STRICT[k]; return [k, v.cap > 90 ? '∞' : v.cap, v.floor, v.mult]; })));
    var gp = GS.gracePenalty(cs.stageIdx, h.strict || 3, cs.totalDays);
    scroll.appendChild(para('Is habit par abhi: Strict ' + (h.strict || 3) + ' · Stage ' + cs.stage.key +
      ' · maafi ' + gp.grace + ' din · graph girawat ' + Math.round(gp.penalty * 100) + '%.'));

    scroll.appendChild(sec('Examples'));
    scroll.appendChild(bullet('Nayi habit (din 5), ek din miss → streak 0, graph 0 (Ignition L1 mein koi maafi nahi).'));
    scroll.appendChild(bullet('Purani habit (din 300, Strict 5), 3 din miss → streak bachi, graph bas ~2% gira.'));
    scroll.appendChild(bullet('Din 300, Strict 1, 2 din miss → streak toot gayi (Strict 1 ki cap sirf 1 din hai).'));
    scroll.appendChild(bullet('Din 700+, 3 din miss → kuch nahi hua; 4 din miss → streak 0, graph ~3% gira.'));

    if (window.GoodSystemScenarios) {
      var tb = el('button', 'btn-ghost', 'View test scenarios');
      tb.style.cssText += ';margin:12px 18px;width:calc(100% - 36px);justify-content:center';
      tb.addEventListener('click', function () { window.GoodSystemScenarios.open(); });
      scroll.appendChild(tb);
    }

    rulesScreen.appendChild(scroll);
    window.SubjectListBridge.show(rulesScreen, true);
  }

  function open(id) {
    curId = id;                       /* STUDY-HABIT: refresh() ke liye */
    var h = G().get(id);
    if (!h) { G().openList(); return; }
    /* STUDY-HABIT: study card ke logs har open par fresh derive karo */
    if (window.StudyHabit && window.StudyHabit.isStudyCard(h)) {
      try { window.StudyHabit.sync(); h = G().get(id) || h; } catch (e) { /* ignore */ }
    }
    var isStudy = !!(window.StudyHabit && window.StudyHabit.isStudyCard(h));
    screen.innerHTML = '';
    var scroll = el('div', 'scroll');

    /* head */
    var head = el('div');
    head.style.cssText = 'display:flex;align-items:center;gap:10px;padding:12px 16px 6px';
    var back = UI.miniBtn(UI.icons.back, 'Back');
    back.style.cssText += ';width:34px;height:34px;border-radius:50%;border:1px solid var(--s2);background:var(--chip-bg)';
    back.addEventListener('click', function () { G().openList(); });
    head.appendChild(back);
    var tt = el('b', null, esc(h.name));
    tt.style.cssText = 'flex:1;min-width:0;font-family:var(--f-disp);font-size:16px;font-weight:700;' +
      'color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
    head.appendChild(tt);
    /* kebab : Edit + Delete (do-click confirm) popover — direct edit NAHI
       STUDY-HABIT: default Study card par Delete item BANTA HI NAHI
       (opts.noDelete) — wo compulsory hai. Edit label bhi alag, kyunki
       wahan sirf target/date/strict badalta hai. */
    var keb = UI.miniBtn(UI.icons.kebab, isStudy ? 'Edit study card' : 'Edit or delete');
    keb.style.flex = 'none';
    head.style.position = 'relative';
    var pop = UI.makeKebabPop(
      function () { window.GoodList.openAddModal(h); },        /* Edit → edit modal */
      function () {                                           /* Delete (confirm ke baad) */
        window.GoodList.removeHabit(h.id);
        G().openList();
      },
      isStudy ? { noDelete: true, editLabel: 'Edit target / dates' } : null
    );
    keb.addEventListener('click', function (e) { e.stopPropagation(); UI.togglePop(pop); });
    head.appendChild(keb);
    head.appendChild(pop);
    scroll.appendChild(head);

    /* two boxes */
    var row = el('div');
    row.style.cssText = 'display:flex;gap:10px;margin:10px 18px 12px';

    /* LEFT : current streak / divider / best streak */
    var left = boxBase();
    var cur = G().goodStreak(h);
    var curN = el('div', null, String(cur));
    curN.style.cssText = 'font-family:var(--f-disp);font-size:30px;font-weight:700;line-height:1.1;color:var(--ink2)';
    left.appendChild(curN);
    var curL = el('div', null, 'current streak');
    curL.style.cssText = 'font-size:9.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--slate);margin-top:2px';
    left.appendChild(curL);
    left.appendChild(divider());
    var best = G().bestStreak(h);
    var bestN = el('div', null, String(best));
    bestN.style.cssText = 'font-family:var(--f-disp);font-size:19px;font-weight:700;color:var(--ink)';
    left.appendChild(bestN);
    var bestL = el('div', null, 'best streak');
    bestL.style.cssText = 'font-size:9px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:var(--ash);margin-top:1px';
    left.appendChild(bestL);
    row.appendChild(left);

    /* RIGHT : start date / divider / days since start */
    var right = boxBase();
    var stL = el('div', null, 'Start');
    stL.style.cssText = 'font-size:9.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--slate)';
    right.appendChild(stL);
    var stV = el('div', null, UI.fmtDate(h.startDate));
    stV.style.cssText = 'font-size:13px;font-weight:700;color:var(--ink);margin-top:3px';
    right.appendChild(stV);
    right.appendChild(divider());
    var days = Math.max(0, Math.round((new Date(appToday()) - new Date(h.startDate)) / 86400000));
    var dN = el('div', null, String(days));
    dN.style.cssText = 'font-family:var(--f-disp);font-size:22px;font-weight:700;color:var(--ink2)';
    right.appendChild(dN);
    var dL = el('div', null, 'days ho chuke');
    dL.style.cssText = 'font-size:9px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:var(--ash);margin-top:1px';
    right.appendChild(dL);
    row.appendChild(right);

    scroll.appendChild(row);
    /* STUDY-HABIT: total study time + aaj ka progress (sirf Study card par) */
    if (isStudy) scroll.appendChild(studyTimePanel(h));
    /* DAY-CLOCK PHASE 3 : aaj ke reps ke ASLI waqt (dual-view ka hissa).
       Din app-day se gina jaata hai, lekin har rep ka asli timestamp bhi
       dikhaaya jaata hai taaki user ko dono pata hon. */
    var todayLog = (h.logs || {})[appToday()];
    var timesArr = (todayLog && todayLog.times) || [];
    if (timesArr.length) {
      var rt = el('div');
      rt.style.cssText = 'margin:0 18px 12px;font-size:10.5px;color:var(--slate);line-height:1.6';
      var fmts = timesArr.map(function (ts) {
        var d = new Date(ts);
        return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
      });
      rt.innerHTML = 'Aaj ke reps (asli waqt) : <b style="color:var(--ink)">' + esc(fmts.join(', ')) + '</b>';
      scroll.appendChild(rt);
    }
    scroll.appendChild(streakPanel(h));
    scroll.appendChild(formationPanel(h));
    screen.appendChild(scroll);
    window.SubjectListBridge.show(screen, true);
  }

  window.GoodDetail = {
    open: open,
    formationPanel: formationPanel,
    /* STUDY-HABIT: study-habit.js sync ke baad detail screen live refresh ho */
    refresh: function () { if (curId && G() && G().get(curId)) open(curId); }
  };
})();
