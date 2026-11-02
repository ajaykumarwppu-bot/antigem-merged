/* ================================================================
   FEATURES / SUBJECT TRACKER / EXAM-WIDGET.JS — syllabus ring + exam countdown
   ----------------------------------------------------------------
   Subject screen ke SABSE UPAR ek widget card :
     [ ring : overall syllabus % ]  [ total study hours (ab tak) ]  [ ⌚ icon ]
     + nearest exam : name + days + hh:mm:ss (live)
     (card par SIRF sabse pass wali exam; baaki exams screen mein)
   ⌚ icon → EXAMS screen : kitni bhi exams add/edit/delete (name + date + time)
   Storage : 'achiva.exams.v1' = { exams:[{id,name,dt}] }
   Overall % = saare subjects ke saare chapters ke % ka weighted average
               (ChapterProgress.chapterPct se)
   Total study hours = study-store ke saare sessions ka jod (hours, 1 decimal)
   Koi subject-screens change nahi : widget khud subjectScreen ke top par mount hota hai.
   ================================================================ */

(function () {
  'use strict';
  if (window.__achivaExamWidgetLoaded) return;
  window.__achivaExamWidgetLoaded = true;

  var el = UI.el, esc = UI.esc;
  var KEY = 'achiva.exams.v1';
  var EXAM_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="7"/><path d="M12 10v3l2 2M9 2h6M12 2v2"/></svg>';

  function store() { var d = window.AppStorage.loadAt(KEY); return (d && Array.isArray(d.exams)) ? d : { exams: [] }; }
  function save(d) { window.AppStorage.saveAt(KEY, d); }

  /* ---------- overall syllabus % ---------- */
  function overallPct() {
    var sum = 0, n = 0;
    (window.ST.state.subjects || []).forEach(function (s) {
      (s.chapters || []).forEach(function (ch) { sum += window.ChapterProgress.chapterPct(ch); n++; });
    });
    return n ? Math.round(sum / n) : 0;
  }

  /* ---------- total study hours ---------- */
  function totalHours() {
    var ms = 0;
    (window.ST.studyStore() || []).forEach(function (e) { ms += (e.ms || 0); });
    return Math.round((ms / 3600000) * 10) / 10;
  }

  /* ---------- nearest exam ---------- */
  function sortedExams() {
    return store().exams.slice().sort(function (a, b) { return a.dt - b.dt; });
  }
  function nearest() {
    var now = Date.now();
    var list = sortedExams();
    for (var i = 0; i < list.length; i++) if (list[i].dt >= now) return list[i];
    return null;
  }
  function fmtCountdown(ms) {
    var t = Math.max(0, Math.floor(ms / 1000));
    var d = Math.floor(t / 86400);
    var h = Math.floor((t % 86400) / 3600);
    var m = Math.floor((t % 3600) / 60);
    var s = t % 60;
    return d + 'd ' + String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }
  function daysOnly(ms) { return Math.max(0, Math.floor(ms / 86400000)) + 'd'; }

  /* ---------- ring SVG ---------- */
  function ringSVG(pct) {
    var r = 26, c = 2 * Math.PI * r;
    var filled = c * (Math.max(0, Math.min(100, pct)) / 100);
    return '<svg width="70" height="70" viewBox="0 0 70 70">' +
      '<circle cx="35" cy="35" r="' + r + '" fill="none" stroke="var(--s2)" stroke-width="7"/>' +
      '<circle cx="35" cy="35" r="' + r + '" fill="none" stroke="#2ea043" stroke-width="7" ' +
      'stroke-linecap="round" stroke-dasharray="' + filled.toFixed(1) + ' ' + c.toFixed(1) + '" ' +
      'transform="rotate(-90 35 35)"/>' +
      '<text x="35" y="39" text-anchor="middle" font-size="15" font-weight="700" fill="var(--ink)">' + pct + '%</text>' +
      '</svg>';
  }

  /* ---------- widget card (prototype jaisa) ---------- */
  var card = null, ringBox = null, hrsEl = null, subEl = null, examsBox = null;

  function fmtHM(ms) {
    var t = Math.floor(ms / 60000);
    var h = Math.floor(t / 60), m = t % 60;
    return h + ' hr ' + m + ' min';
  }

  function buildCard() {
    card = el('div');
    card.style.cssText = 'margin:10px 18px 12px;padding:14px;border:1px solid var(--line);border-radius:18px;' +
      'background:var(--tile-bg);box-shadow:inset 0 1px 0 var(--hl-soft);display:flex;align-items:center;gap:12px;cursor:pointer';
    ringBox = el('div'); ringBox.style.cssText = 'flex:none';
    card.appendChild(ringBox);
    var mid = el('div'); mid.style.cssText = 'flex:1;min-width:0';
    hrsEl = el('div', null, '0 hr 0 min');
    hrsEl.style.cssText = 'font-family:var(--f-disp);font-size:20px;font-weight:700;color:var(--ink)';
    var lab = el('div', null, 'total study');
    lab.style.cssText = 'font-size:9.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--slate)';
    subEl = el('div', null, '');
    subEl.style.cssText = 'font-size:10.5px;color:var(--ash);margin-top:6px';
    mid.appendChild(hrsEl); mid.appendChild(lab); mid.appendChild(subEl);
    card.appendChild(mid);
    examsBox = el('div');
    examsBox.style.cssText = 'flex:none;display:flex;flex-direction:column;gap:4px;align-items:flex-end;max-width:44%';
    card.appendChild(examsBox);
    card.addEventListener('click', function () { openExams(); });
    return card;
  }

  function refreshStats() {
    if (!card) return;
    ringBox.innerHTML = ringSVG(overallPct());
    var ms = 0; (window.ST.studyStore() || []).forEach(function (e) { ms += (e.ms || 0); });
    hrsEl.textContent = fmtHM(ms);
    var subs = (window.ST.state.subjects || []);
    var chs = 0; subs.forEach(function (s) { chs += (s.chapters || []).length; });
    subEl.textContent = subs.length + ' subjects · ' + chs + ' chapters';
    var now = Date.now();
    var list = sortedExams().slice(0, 4);
    examsBox.innerHTML = '';
    if (!list.length) {
      var e0 = el('div', null, 'Koi exam nahi');
      e0.style.cssText = 'font-size:10px;color:var(--slate)';
      examsBox.appendChild(e0);
    } else {
      list.forEach(function (ex) {
        var row = el('div');
        row.style.cssText = 'display:flex;align-items:baseline;gap:6px;justify-content:flex-end';
        var nm = el('span', null, esc(ex.name));
        nm.style.cssText = 'font-size:10.5px;font-weight:600;color:var(--ink2);max-width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
        var dy = el('span', null, daysOnly(ex.dt - now));
        dy.style.cssText = 'font-family:var(--f-mono);font-size:10.5px;font-weight:700;color:var(--slate)';
        row.appendChild(nm); row.appendChild(dy);
        examsBox.appendChild(row);
      });
    }
  }

  function mountSubjectTop() {
    if (card) return;
    var sc = window.ST.subjectScreen();
    if (!sc) return;
    buildCard();
    /* card ko Library/AddSubject/+ header (subTop) ke UPAR rakho */
    sc.insertBefore(card, sc.firstChild);
    refreshStats();
  }

  /* ---------- EXAMS screen ---------- */
  var examScreen = null;
  function ensureScreen() {
    if (examScreen) return examScreen;
    examScreen = el('section', 'screen');
    examScreen.style.paddingTop = '58px';
    document.getElementById('app').appendChild(examScreen);
    return examScreen;
  }

  function renderExams() {
    var sc = ensureScreen();
    sc.innerHTML = '';
    var scroll = el('div', 'scroll');
    var head = el('div');
    head.style.cssText = 'display:flex;align-items:center;gap:10px;padding:12px 16px 6px';
    var back = UI.miniBtn(UI.icons.back, 'Back');
    back.style.cssText += ';width:34px;height:34px;border-radius:50%;border:1px solid var(--s2);background:var(--chip-bg)';
    back.addEventListener('click', function () { window.SubjectListBridge.show(window.ST.subjectScreen(), false); });
    head.appendChild(back);
    var t = el('b', null, 'Exams');
    t.style.cssText = 'flex:1;font-family:var(--f-disp);font-size:18px;font-weight:700;color:var(--ink)';
    head.appendChild(t);
    var add = UI.miniBtn(UI.icons.plus, 'Add exam');
    add.style.cssText += ';width:34px;height:34px;border:1px solid var(--s2);background:var(--chip-bg);border-radius:50%';
    add.addEventListener('click', function () { openExamModal(null); });
    head.appendChild(add);
    scroll.appendChild(head);

    var d = store();
    if (!d.exams.length) {
      var e0 = el('div', 'empty', 'Koi exam nahi.<br>+ se exam add karo (name + date + time).');
      e0.style.margin = '0 18px 12px';
      scroll.appendChild(e0);
    } else {
      var now = Date.now();
      sortedExams().forEach(function (ex) {
        var c = el('div', 'sub-card');
        c.style.cssText += ';padding:12px 14px;align-items:center';
        var main = el('div', 'sub-main');
        var nm = el('h3', null, esc(ex.name));
        var dt = new Date(ex.dt);
        var meta = el('div', 'sub-meta', dt.toLocaleDateString() + ' ' + dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) +
          ' · ' + (ex.dt >= now ? daysOnly(ex.dt - now) + ' left' : 'ho gayi'));
        main.appendChild(nm); main.appendChild(meta);
        c.appendChild(main);
        var pop = UI.makeKebabPop(
          function () { openExamModal(ex); },
          function () {
            var dd = store(); dd.exams = dd.exams.filter(function (x) { return x.id !== ex.id; });
            save(dd); renderExams(); refreshStats();
          }
        );
        var kb = UI.miniBtn(UI.icons.kebab, 'Edit or delete');
        kb.addEventListener('click', function (e) { e.stopPropagation(); UI.togglePop(pop); });
        c.appendChild(kb); c.appendChild(pop);
        scroll.appendChild(c);
      });
    }
    sc.appendChild(scroll);
  }

  function openExams() { renderExams(); window.SubjectListBridge.show(examScreen, true); }

  function openExamModal(ex) {
    var m = UI.modal({ zScrim: 91, zWrap: 92 });
    var nameF = UI.inputField('Exam name', 'e.g. JEE Mains Attempt 1');
    var dateF = UI.inputField('Date', '', 'date');
    if (ex) {
      nameF.input.value = ex.name;
      var dt0 = new Date(ex.dt);
      dateF.input.value = ex.dt ? (dt0.getFullYear() + '-' + String(dt0.getMonth() + 1).padStart(2, '0') + '-' + String(dt0.getDate()).padStart(2, '0')) : '';
    }
    m.open(ex ? 'Edit exam' : 'New exam', function (body) {
      body.appendChild(nameF.wrap); body.appendChild(dateF.wrap);
    }, function () {
      var name = nameF.input.value.trim();
      var dv = dateF.input.value;
      if (!name || !dv) { return; }
      var dt = new Date(dv + 'T00:00:00');
      var d = store();
      if (ex) { ex.name = name; ex.dt = dt.getTime(); }
      else d.exams.push({ id: UI.uid(), name: name, dt: dt.getTime() });
      save(d);
      m.close();
      renderExams();
      refreshStats();
    });
  }

  /* ticks */
  /* sirf stats refresh (5s) — koi full re-render nahi, isliye koi blink nahi */
  window.setInterval(function () { if (card && card.isConnected) refreshStats(); }, 5000);

  /* mount on load */
  mountSubjectTop();

  window.ExamWidget = { mountSubjectTop: mountSubjectTop, refresh: refreshStats, overallPct: overallPct, totalHours: totalHours, openExams: openExams };
})();
