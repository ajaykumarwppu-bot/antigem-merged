/* ================================================================
   DASHBOARD / DASHBOARD-MYDAY.JS  —  "Mera Din" dual-view panel
   ----------------------------------------------------------------
   Dashboard par ek chhota panel jo do cheezein saaf dikhata hai :

     1. ABHI ka status : "Aapka aaj" (app-day) vs "Asli ab" (real date+time)
     2. 7-DIN STRIP   : do tareeke se dekh sakte ho
          [Mere din]      → har din app-day se bucket (DayClock.dayOf)
          [Asli tareekhen]→ wahi data real tareekh se bucket (realISO)

   Metrics epoch timestamps se compute hoti hain (study sessions ka startMs,
   habit reps ka times[]), isliye DONO views ek hi asli data se bante hain —
   sirf "kis din maanein" ka tareeka badalta hai. Isi se user ko dikhta hai
   ki raat 12 ke baad ka kaam kis view mein kahan gina ja raha hai.

   Koi data mutate nahi hota — sirf read + display.
   ================================================================ */

(function () {
  'use strict';

  if (window.__achivaMyDayLoaded) return;
  window.__achivaMyDayLoaded = true;

  var el = UI.el, esc = UI.esc;
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];

  function DC() { return window.DayClock || null; }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function realISO(ts) {
    var d = new Date(ts);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  function bucket(ts, mode) {
    var dc = DC();
    if (mode === 'app' && dc && dc.dayOf) return dc.dayOf(ts);
    return realISO(ts);
  }
  function label(iso) {
    return parseInt(iso.slice(8, 10), 10) + ' ' + MONTHS[+iso.slice(5, 7) - 1];
  }
  function fmtMin(m) {
    m = Math.round(m);
    if (m < 60) return m + 'm';
    return Math.floor(m / 60) + 'h' + (m % 60 ? ' ' + (m % 60) + 'm' : '');
  }

  /* ---------- metrics : ek din (iso) ke liye, mode ke hisaab se ---------- */
  function studyMinutes(iso, mode) {
    var tot = 0;
    try {
      var st = (window.ST && window.ST.studyStore) ? (window.ST.studyStore() || []) : [];
      st.forEach(function (e) {
        if (!e || !e.startMs) return;
        if (bucket(e.startMs, mode) === iso) tot += (e.ms || 0) / 60000;
      });
    } catch (e) { /* ignore */ }
    return tot;
  }
  function habitReps(iso, mode) {
    var n = 0;
    try {
      var hs = (window.GoodList && window.GoodList.all) ? (window.GoodList.all() || []) : [];
      hs.forEach(function (h) {
        var logs = h.logs || {};
        Object.keys(logs).forEach(function (k) {
          var t = (logs[k] && logs[k].times) || [];
          t.forEach(function (ts) { if (bucket(ts, mode) === iso) n++; });
        });
      });
    } catch (e) { /* ignore */ }
    return n;
  }

  /* ---------- 7-din strip ---------- */
  function strip(mode, endISO) {
    var row = el('div');
    row.style.cssText = 'display:flex;gap:6px;overflow-x:auto;padding:2px 0 4px';
    for (var i = 6; i >= 0; i--) {
      var iso = UI.addDays(endISO, -i);
      var sm = studyMinutes(iso, mode);
      var rp = habitReps(iso, mode);
      var isToday = (i === 0);
      var c = el('div');
      c.style.cssText = 'flex:none;min-width:52px;padding:8px 6px;border-radius:12px;text-align:center;' +
        'border:1px solid ' + (isToday ? 'var(--ink)' : 'var(--s2)') + ';background:var(--chip-bg)';
      var d = el('div', null, esc(label(iso)));
      d.style.cssText = 'font-size:10px;font-weight:700;color:' + (isToday ? 'var(--ink)' : 'var(--slate)');
      c.appendChild(d);
      var sub = el('div', null, (sm > 0 ? fmtMin(sm) : '') + (sm > 0 && rp > 0 ? ' · ' : '') + (rp > 0 ? rp + '✓' : ''));
      sub.style.cssText = 'font-size:9.5px;color:var(--ash);margin-top:3px;min-height:12px';
      sub.textContent = sub.textContent || '—';
      c.appendChild(sub);
      row.appendChild(c);
    }
    return row;
  }

  /* ---------- panel ---------- */
  function build() {
    var dc = DC();
    var mode = 'app';

    var box = el('div');
    box.style.cssText = 'margin:0 18px 12px;padding:14px;border:1px solid var(--line);border-radius:18px;' +
      'background:var(--tile-bg);box-shadow:inset 0 1px 0 var(--hl-soft)';

    var head = el('div');
    head.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px';
    var t = el('div', null, 'Mera Din');
    t.style.cssText = 'font-size:9.5px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:var(--ash)';
    head.appendChild(t);

    var tog = el('button', null, 'Asli tareekhen');
    tog.type = 'button';
    tog.style.cssText = 'padding:5px 11px;border-radius:99px;border:1px solid var(--s2);background:var(--chip-bg);' +
      'color:var(--slate);font:inherit;font-size:10.5px;font-weight:700;cursor:pointer';
    head.appendChild(tog);
    box.appendChild(head);

    var now = new Date();
    var line1 = el('div');
    line1.style.cssText = 'font-family:var(--f-disp);font-size:17px;font-weight:700;color:var(--ink);margin-top:8px';
    var line2 = el('div');
    line2.style.cssText = 'font-size:11px;color:var(--slate);margin-top:2px';
    var line3 = el('div');
    line3.style.cssText = 'font-size:10.5px;color:var(--ash);margin-top:6px;line-height:1.5';
    box.appendChild(line1); box.appendChild(line2); box.appendChild(line3);

    var stripHost = el('div');
    stripHost.style.marginTop = '10px';
    box.appendChild(stripHost);

    function paint() {
      var appToday = dc ? dc.today() : UI.todayISO();
      var realNow = new Date();
      var endISO = (mode === 'app') ? appToday : realISO(realNow.getTime());
      line1.textContent = 'Aapka aaj : ' + label(appToday);
      line2.textContent = 'Asli ab : ' + label(realISO(realNow.getTime())) + ', ' +
        pad2(realNow.getHours()) + ':' + pad2(realNow.getMinutes());
      if (dc && dc.isCustom && dc.isCustom()) {
        line3.textContent = 'Aapka din ' + dc.settings().dayStart + ' par palatta hai (raat 12 baje nahi). ' +
          'Neeche strip do tareeke se dekh sakte ho.';
        line3.style.display = '';
      } else {
        line3.textContent = 'Abhi default chal raha hai (din raat 12 baje palatta hai). ' +
          'Settings → Mera Din se apna din set karo.';
        line3.style.display = '';
      }
      tog.textContent = (mode === 'app') ? 'Asli tareekhen' : 'Mere din';
      stripHost.innerHTML = '';
      stripHost.appendChild(strip(mode, endISO));
    }

    tog.addEventListener('click', function () {
      mode = (mode === 'app') ? 'real' : 'app';
      paint();
    });

    paint();
    return box;
  }

  window.DashboardMyDay = { build: build, studyMinutes: studyMinutes, habitReps: habitReps };
})();
