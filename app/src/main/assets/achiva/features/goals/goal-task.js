/* ================================================================
   FEATURES / GOALS / GOAL-TASK.JS — goal canvas + task system
   ----------------------------------------------------------------
   • Detail head mein "Canvas" button (Detail ke just bagal mein) :
     click → isi goal ka apna canvas board khulta hai (CanvasEditor),
     jisme goal-naam wali card pehle se bani hoti hai
   • Board GOAL-SCOPED hota hai : { category:'goal', goalId:<id> }
       - Draw (free canvas) list mein YE boards NAHI dikhte
       - free canvas ke tags goals mein NAHI aate
       - har goal ke tasks sirf usi goal mein dikhte hain
   • Detail screen par heat-panel ke just neeche TASK SYSTEM :
     canvas ke tagged cards yahan task bankar aate hain
       - poora task text (chhota note ya lamba content)
       - tag chip (DAILY / date / range)
       - DONE button with rules :
           date  : us date se PEHLE done nahi kar sakte, us din ya
                   baad mein done (one-time)
           range : sirf range ke dinon ke andar daily done/undo
           daily : roz daily done/undo
   • Done state card.tag mein persist : done (date) / doneDays[]
   ================================================================ */

(function () {
  'use strict';

  /* DAY-CLOCK : 'aaj' app ke apne din se */
  function appToday() { return window.DayClock ? window.DayClock.today() : UI.todayISO(); }

  if (window.__achivaGoalTaskLoaded) return;
  window.__achivaGoalTaskLoaded = true;

  var el = UI.el, esc = UI.esc, uid = UI.uid;

  function data() { return window.CanvasList.getData(); }
  function persist() { window.CanvasList.persistNow(); }

  /* ---------- goal ka apna board (lazy create) ---------- */
  function boardOf(g) {
    var b = null;
    data().canvases.forEach(function (c) {
      if (g.canvasId && c.id === g.canvasId) b = c;
      else if (!b && c.goalId === g.id) b = c;
    });
    return b;
  }

  function ensureBoard(g) {
    var b = boardOf(g);
    if (b) return b;
    /* AUTO-FIT : goal title card text ke hisaab se size le */
    var f = (window.CanvasCards && window.CanvasCards.fitSize)
      ? window.CanvasCards.fitSize(g.title, 250, 110)
      : { w: 250, h: 110 };
    b = {
      id: uid(), name: g.title, category: 'goal', goalId: g.id,
      date: UI.fmtDate(appToday()),
      cards: [{ id: uid(), text: g.title, x: 60, y: 60, w: f.w, h: f.h, color: '#ffffff' }],
      lines: [], groups: []
    };
    data().canvases.push(b);
    persist();
    g.canvasId = b.id;
    window.GoalStore.upsert(g);
    window.GoalStore.persist();
    return b;
  }

  function openCanvas(g) {
    var b = ensureBoard(g);
    window.CanvasEditor.open(b, function () {
      /* editor ke back par goal detail wapas KHULNI chahiye (sirf refresh nahi) */
      if (window.GoalDetail) window.GoalDetail.open(g.id);
    });
  }

  /* ---------- tasks = tagged cards of THIS goal's board ---------- */
  function tasksOf(g) {
    var b = boardOf(g);
    if (!b) return [];
    return (b.cards || []).filter(function (c) { return c.tag; });
  }

  function taskState(g, c) {
    var t = c.tag, today = appToday();
    if (t.type === 'date') {
      return { enabled: today >= t.date, done: t.done === true, once: true };
    }
    if (t.type === 'range') {
      var inR = today >= t.from && today <= t.to;
      return { enabled: inR, done: (t.doneDays || []).indexOf(today) >= 0, once: false };
    }
    return { enabled: true, done: (t.doneDays || []).indexOf(today) >= 0, once: false };
  }

  function toggleDone(g, c) {
    var t = c.tag, st = taskState(g, c), today = appToday();
    if (!st.enabled) return;
    if (st.once) t.done = !t.done;
    else {
      if (!Array.isArray(t.doneDays)) t.doneDays = [];
      var i = t.doneDays.indexOf(today);
      if (i >= 0) t.doneDays.splice(i, 1); else t.doneDays.push(today);
    }
    persist();
    if (window.GoalDetail) window.GoalDetail.refresh();
  }

  /* ---------- task editor popup (create / edit) ---------- */
  function taskEditor(g, card) {
    var m = UI.modal({ zScrim: 90, zWrap: 91 });
    var oldTag = card ? card.tag : null;

    var tw = el('div');
    tw.style.marginBottom = '12px';
    tw.appendChild(UI.label('Task'));
    var tin = el('textarea');
    tin.placeholder = 'Task kya hai... (chhota note ya poora content)';
    tin.style.cssText = 'width:100%;min-height:76px;resize:vertical;border:1px solid var(--s2);border-radius:12px;' +
      'background:var(--input-bg);padding:10px 12px;font:inherit;font-size:13px;color:var(--ink);box-sizing:border-box';
    if (card) tin.value = card.text || '';
    tw.appendChild(tin);

    var typeR = UI.chipRow(['Daily', 'Specific date', 'From–To'],
      oldTag ? (oldTag.type === 'daily' ? 'Daily' : oldTag.type === 'date' ? 'Specific date' : 'From–To') : 'Daily');

    var dateB = null, fromB = null, toB = null;
    function datePill(current, label) {
      var b = UI.pillBtn(current ? label + ': ' + UI.fmtDate(current) : label + ': set');
      b.style.cssText += ';width:100%;justify-content:flex-start;margin-top:8px';
      b.addEventListener('click', function () {
        window.AchivaCalendar.open(label, current, function (iso) {
          current = iso;
          b.innerHTML = label + ': ' + UI.fmtDate(iso);
        });
      });
      b.get = function () { return current; };
      return b;
    }
    dateB = datePill(oldTag && oldTag.date, 'Date');
    fromB = datePill(oldTag && oldTag.from, 'From');
    toB = datePill(oldTag && oldTag.to, 'To');

    m.open(card ? 'Edit task' : 'New task', function (body) {
      body.appendChild(tw);
      body.appendChild(typeR.row);
      typeR.row.style.marginTop = '6px';
      body.appendChild(dateB);
      body.appendChild(fromB);
      body.appendChild(toB);
      function paint() {
        var t2 = typeR.get();
        dateB.style.display = t2 === 'Specific date' ? '' : 'none';
        fromB.style.display = t2 === 'From–To' ? '' : 'none';
        toB.style.display = t2 === 'From–To' ? '' : 'none';
      }
      typeR.row.addEventListener('click', paint);
      paint();
    }, function () {
      var text = tin.value.trim();
      if (!text) { tin.focus(); return; }
      var t2 = typeR.get();
      var tag;
      if (t2 === 'Daily') tag = { type: 'daily' };
      else if (t2 === 'Specific date') {
        if (!dateB.get()) { dateB.focus ? dateB.focus() : null; return; }
        tag = { type: 'date', date: dateB.get() };
      } else {
        if (!fromB.get() || !toB.get()) return;
        tag = { type: 'range', from: fromB.get(), to: toB.get() };
      }
      if (card) {
        card.text = text;
        if (oldTag && oldTag.type === tag.type) {
          tag.done = oldTag.done;
          tag.doneDays = oldTag.doneDays;
        }
        card.tag = tag;
      } else {
        addTask(g, text, tag);
      }
      persist();
      m.close();
      if (window.GoalDetail) window.GoalDetail.refresh();
    });
  }

  function addTask(g, text, tag) {
    var b = ensureBoard(g);
    var n = (b.cards || []).length;
    /* AUTO-FIT : task text box mein poora aaye (tag chip ka space bhi) */
    var f = (window.CanvasCards && window.CanvasCards.fitSize)
      ? window.CanvasCards.fitSize(text, 210, 84, true)
      : { w: 210, h: 84 };
    var c = { id: uid(), text: text, x: 60, y: 900 + n * 100, w: f.w, h: f.h, color: '#ffffff',
      tag: tag, manual: true };
    b.cards.push(c);
    persist();
    return c;
  }

  /* manual task delete (canvas-wale tasks yahan se delete NAHI hote) */
  function deleteTask(g, c) {
    var b = boardOf(g);
    if (!b) return;
    b.cards = (b.cards || []).filter(function (x) { return x !== c; });
    b.lines = (b.lines || []).filter(function (l) {
      return l.from.cid !== c.id && l.to.cid !== c.id;
    });
    persist();
    if (window.GoalDetail) window.GoalDetail.refresh();
  }

  /* ---------- tasks panel : ordered cards + numbering ---------- */
  function orderTasks(g, ts) {
    var A = [], B = [], C = [];
    ts.forEach(function (c) {
      var st = taskState(g, c);
      if (st.done) C.push(c);
      else if (st.enabled) A.push(c);
      else B.push(c);
    });
    return A.concat(B, C);
  }

  function tasksPanel(g) {
    var p = UI.panel();
    p.style.cssText += ';margin:0 18px 12px';
    var head = el('div');
    head.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:10px';
    head.appendChild(UI.panelTitle('Tasks', true));
    var hh = el('div');
    var add = UI.pillBtn('+ Task');
    add.style.cssText += ';padding:6px 12px;font-size:10.5px';
    add.addEventListener('click', function () { taskEditor(g, null); });
    var cv = UI.miniBtn(UI.icons.edit, 'Open canvas');
    hh.appendChild(add); hh.appendChild(cv);
    cv.addEventListener('click', function () { openCanvas(g); });
    head.appendChild(hh);
    p.appendChild(head);

    var ts = tasksOf(g);
    if (!ts.length) {
      var hint = el('div', null, 'No tasks yet. "+ Task" se banayein ya canvas mein card par Tag lagayein.');
      hint.style.cssText = 'font-size:11.5px;color:var(--slate);line-height:1.6';
      p.appendChild(hint);
      return p;
    }

    orderTasks(g, ts).forEach(function (c) {
      var t = c.tag, st = taskState(g, c);
      var cardBox = el('div');
      cardBox.style.cssText = 'padding:10px 12px;margin-bottom:8px;border:1px solid var(--line);' +
        'border-radius:14px;background:var(--tile-bg);' + (st.done ? 'opacity:.65' : '');

      var r1 = el('div');
      r1.style.cssText = 'display:flex;align-items:flex-start;gap:8px';

      /* number ki jagah : GOL TICK button (done/undo toggle) */
      var tick = el('button', null, st.done ? UI.icons.check : '');
      tick.type = 'button';
      tick.setAttribute('aria-label', st.done ? 'Undo' : 'Done');
      tick.style.cssText = 'flex:none;width:22px;height:22px;border-radius:50%;cursor:pointer;' +
        'display:flex;align-items:center;justify-content:center;transition:.18s;' +
        (st.done
          ? 'background:rgba(46,160,67,.16);color:#2ea043;border:1px solid rgba(46,160,67,.5)'
          : st.enabled
            ? 'background:var(--chip-bg);color:var(--slate);border:1.5px solid var(--s2)'
            : 'background:var(--chip-bg);color:var(--ash);border:1.5px solid var(--s2);opacity:.5;cursor:not-allowed');
      tick.addEventListener('click', function () { toggleDone(g, c); });
      r1.appendChild(tick);

      var txt = el('div', null, c.text || '(task)');
      txt.style.cssText = 'flex:1;min-width:0;font-size:12.5px;font-weight:600;color:var(--ink);' +
        'line-height:1.5;white-space:pre-wrap;word-break:break-word;max-height:72px;overflow-y:auto;' +
        (st.done ? 'text-decoration:line-through' : '');
      r1.appendChild(txt);

      /* sirf MANUAL tasks (bina canvas ke banaye) : pencil edit + 3-dot delete */
      if (c.manual) {
        var pen = UI.miniBtn(UI.icons.edit, 'Edit task');
        pen.addEventListener('click', function () { taskEditor(g, c); });
        r1.appendChild(pen);
        var keb = UI.miniBtn(UI.icons.kebab, 'Delete task');
        keb.addEventListener('click', function () {
          if (!keb._armed) {
            keb._armed = true;
            keb.innerHTML = '✕!';
            keb.style.background = 'var(--ink)';
            keb.style.color = 'var(--paper)';
            return;
          }
          deleteTask(g, c);
        });
        r1.appendChild(keb);
      }
      cardBox.appendChild(r1);

      /* chips : hamesha EK line mein (label + done status) */
      var r2 = el('div');
      r2.style.cssText = 'display:flex;gap:6px;align-items:center;flex-wrap:nowrap;' +
        'overflow:hidden;margin-top:7px;padding-left:30px';
      var label = t.type === 'daily' ? 'DAILY'
        : t.type === 'date' ? UI.fmtDate(t.date)
          : UI.fmtDate(t.from) + ' \u2192 ' + UI.fmtDate(t.to);
      var lc = UI.chip(label);
      lc.style.cssText += ';flex:none';
      r2.appendChild(lc);
      if (st.done) {
        var dc = UI.chip(st.once ? 'completed' : 'done today');
        dc.style.cssText += ';background:rgba(46,160,67,.12);color:#2ea043;border-color:rgba(46,160,67,.35);flex:none';
        r2.appendChild(dc);
      }
      cardBox.appendChild(r2);
      p.appendChild(cardBox);
    });
    return p;
  }

  window.GoalTask = {
    boardOf: boardOf, ensureBoard: ensureBoard, openCanvas: openCanvas,
    tasksOf: tasksOf, taskState: taskState, toggleDone: toggleDone,
    tasksPanel: tasksPanel, taskEditor: taskEditor, addTask: addTask, deleteTask: deleteTask
  };
})();
