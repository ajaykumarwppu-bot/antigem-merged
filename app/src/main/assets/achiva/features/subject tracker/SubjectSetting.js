/* ================================================================
   FEATURES / SUBJECT TRACKER / SUBJECTSETTING.JS
   ----------------------------------------------------------------
   "ADD STEP SECTION" — poore Subject Tracker ki DEFAULT roadmap
   steps ek jagah se manage karne ke liye.

   1) BUTTON (subject screen ke header mein)
      'Add Subject' heading aur '+' icon ke THEEK LEFT ek
      TRIANGLE + EYE button mount hota hai. Screen ki koi bhi
      existing cheez remove/edit/move NAHI hoti — button sirf
      `insertBefore(btn, addBtn)` se judta hai (wahi self-mount
      pattern jo exam-widget.js use karta hai, isliye
      subject-screens.js ko chhoone ki zaroorat nahi padti).

   2) SCREEN ("Add Step Section")
      Button dabate hi POORI nayi screen khulti hai
      (section.screen + SubjectListBridge.show — Settings/Exams
      jaisa hi). Andar do panel :
        • Complete Roadmap  — default steps
        • Mastery  Roadmap  — default steps
      Har panel mein : step rows (text + ↑ ↓ reorder + 3-dot
      Edit/Delete do-click confirm) aur '+ Add Step' pill.

   3) CHAPTERS TAK KAISE PAHUNCHTI HAIN  (basics.js UNTOUCHED)
      Template steps chapter ke `steps` / `masterySteps` arrays
      mein MATERIALIZE hoti hain — har copy par `tid` (template
      id) hota hai. Isse basics.js ka purana render / tick /
      edit / delete / sequential-display BILKUL waise hi chalta
      rehta hai, ek line badle bina.

      Sync kab hota hai :
        • app load par (sab chapters)
        • template mein add/edit/delete/reorder hote hi
        • chapter-view khulte hi — `window.Basics.renderChapterView`
          wrap karke (naye bane chapters bhi turant cover)

      Rules (user ke decisions ke mutabik) :
        • default steps chapter ki list ke SABSE NEECHE aati hain
          (chapter ki apni steps ki jagah nahi badalti), template
          ke order mein
        • chapter ke andar se default step delete → `gHidden`
          tombstone → US chapter mein kabhi wapas nahi aati
        • template se step delete → SAB chapters se hat jaati hai
        • template ka text edit → sab chapters mein propagate,
          SIWAYE jahan user ne us step ko locally edit kar diya
          ho (gText snapshot se detect hota hai — local copy
          bacha li jaati hai)
        • ↑ ↓ se template ka order badlo → chapters mein bhi wahi
          order (chapter ki apni steps apni jagah rehti hain)

   4) STORAGE
      `ST.state.stepTemplates = { complete:[{id,text}], mastery:[…] }`
      → 'achiva.subjectTracker.v1' ke saath apne aap persist +
      cloud backup + per-account namespace (backup.js mein koi
      change nahi chahiye). Chapter-side bookkeeping :
      `gSynced` (kaun se tid daale), `gText` (sync ne kya text
      likha tha), `gHidden` (is chapter se hataye gaye tid).

      Template KHALI hai to sync kuch bhi nahi likhta — matlab
      feature use na karne wale ka data byte-for-byte waisa hi.

   Styling : style/ ki CSS files FROZEN hain — sab inline styles
   + core/ui.js ke shared builders (panel, pillBtn, miniBtn,
   rowBox, modal, makeKebabPop). ES5-only.
   ================================================================ */

(function () {
  'use strict';
  if (window.__achivaSubjectSettingLoaded) return;
  window.__achivaSubjectSettingLoaded = true;

  var el = UI.el, esc = UI.esc, uid = UI.uid;

  /* ================================================================
     TEMPLATE STORE (ST.state.stepTemplates)
  ================================================================ */
  function templates() {
    var st = window.ST ? window.ST.state : null;
    if (!st) return { complete: [], mastery: [] };
    if (!st.stepTemplates || typeof st.stepTemplates !== 'object') {
      st.stepTemplates = { complete: [], mastery: [] };
    }
    var t = st.stepTemplates;
    if (!Array.isArray(t.complete)) t.complete = [];
    if (!Array.isArray(t.mastery)) t.mastery = [];
    return t;
  }

  function listOf(key) {
    var t = templates();
    return (key === 'mastery') ? t.mastery : t.complete;
  }

  /* saare template ids (dono lists) ka map — bookkeeping safai ke liye */
  function aliveIds() {
    var t = templates(), m = {};
    t.complete.forEach(function (x) { if (x && x.id) m[x.id] = x; });
    t.mastery.forEach(function (x) { if (x && x.id) m[x.id] = x; });
    return m;
  }

  function persist() {
    if (window.ST && window.ST.persist) { try { window.ST.persist(); } catch (e) { } }
  }

  /* ================================================================
     SYNC : template steps → har chapter ke roadmap
     ----------------------------------------------------------------
     Materialize model : chapter ki list mein asli step objects
     { id, text, done, tid } — tid template step ka id hai.
  ================================================================ */
  function hasTrace(ch) {
    if (!ch) return false;
    if (ch.gSynced && ch.gSynced.length) return true;
    if (ch.gHidden && ch.gHidden.length) return true;
    if (ch.gText && Object.keys(ch.gText).length) return true;
    var found = false;
    function scan(a) { (a || []).forEach(function (s) { if (s && s.tid) found = true; }); }
    scan(ch.steps);
    scan(ch.masterySteps);
    return found;
  }

  function ensureFields(ch) {
    if (!Array.isArray(ch.steps)) ch.steps = [];
    if (!Array.isArray(ch.masterySteps)) ch.masterySteps = [];
    if (!Array.isArray(ch.gSynced)) ch.gSynced = [];
    if (!Array.isArray(ch.gHidden)) ch.gHidden = [];
    if (!ch.gText || typeof ch.gText !== 'object') ch.gText = {};
  }

  /* template order chapter ki list mein bhi follow ho.
     Sirf default (tid wali) steps aapas mein reorder hoti hain —
     chapter ki apni steps jis index par hain wahi rehti hain. */
  function reorderGlobals(arr, tpl) {
    var order = {};
    tpl.forEach(function (t, i) { if (t && t.id) order[t.id] = i; });
    var idx = [];
    arr.forEach(function (s, i) {
      if (s && s.tid && order[s.tid] != null) idx.push(i);
    });
    if (idx.length < 2) return false;
    var items = idx.map(function (i) { return arr[i]; });
    var before = items.map(function (s) { return s.tid; }).join(',');
    items.sort(function (a, b) { return order[a.tid] - order[b.tid]; });
    var after = items.map(function (s) { return s.tid; }).join(',');
    if (before === after) return false;
    idx.forEach(function (i, k) { arr[i] = items[k]; });
    return true;
  }

  /* ek roadmap list sync karo → true agar kuch badla */
  function syncList(ch, field, tpl) {
    var arr = ch[field];
    var byTid = {};
    tpl.forEach(function (t) { if (t && t.id) byTid[t.id] = t; });
    var changed = false;

    var present = {};
    arr.forEach(function (s) { if (s && s.tid) present[s.tid] = s; });

    /* ---- 1) is chapter se user ne default step hata di → tombstone ---- */
    ch.gSynced.forEach(function (tid) {
      if (!present[tid] && byTid[tid] && ch.gHidden.indexOf(tid) === -1) {
        ch.gHidden.push(tid);
        changed = true;
      }
    });

    /* ---- 2) template se delete hui step → chapter se bhi hatao ---- */
    var kept = [];
    arr.forEach(function (s) {
      if (s && s.tid && !byTid[s.tid]) { changed = true; return; }
      kept.push(s);
    });
    if (kept.length !== arr.length) {
      arr.length = 0;
      kept.forEach(function (s) { arr.push(s); });
    }

    /* ---- 3) template ka text propagate (local edit ko bacha kar) ---- */
    arr.forEach(function (s) {
      if (!s || !s.tid || !byTid[s.tid]) return;
      var t = byTid[s.tid];
      var last = ch.gText[s.tid];
      if (last == null || last === s.text) {
        if (s.text !== t.text) changed = true;
        s.text = t.text;
        ch.gText[s.tid] = t.text;
      }
    });

    /* ---- 4) nayi default steps → list ke NEECHE, template order mein ---- */
    var insertAt = arr.length;
    for (var i = arr.length - 1; i >= 0; i--) {
      if (arr[i] && arr[i].tid) { insertAt = i + 1; break; }
    }
    tpl.forEach(function (t) {
      if (!t || !t.id) return;
      if (present[t.id]) return;                          /* pehle se hai */
      if (ch.gHidden.indexOf(t.id) !== -1) return;         /* user ne hataya tha */
      arr.splice(insertAt, 0, { id: uid(), text: t.text, done: false, tid: t.id });
      insertAt++;
      ch.gSynced.push(t.id);
      ch.gText[t.id] = t.text;
      changed = true;
    });

    /* ---- 5) order match karo ---- */
    if (reorderGlobals(arr, tpl)) changed = true;

    return changed;
  }

  function syncChapter(ch) {
    if (!ch || typeof ch !== 'object') return false;
    var t = templates();
    var empty = !t.complete.length && !t.mastery.length;
    /* template khali aur chapter par koi nishan nahi → kuch mat likho */
    if (empty && !hasTrace(ch)) return false;

    ensureFields(ch);
    var changed = false;
    if (syncList(ch, 'steps', t.complete)) changed = true;
    if (syncList(ch, 'masterySteps', t.mastery)) changed = true;

    /* jo template se hi ud gaye, unka bookkeeping saaf karo */
    var alive = aliveIds();
    var n1 = ch.gSynced.length;
    ch.gSynced = ch.gSynced.filter(function (tid) { return !!alive[tid]; });
    if (ch.gSynced.length !== n1) changed = true;
    var n2 = ch.gHidden.length;
    ch.gHidden = ch.gHidden.filter(function (tid) { return !!alive[tid]; });
    if (ch.gHidden.length !== n2) changed = true;
    Object.keys(ch.gText).forEach(function (tid) {
      if (!alive[tid]) { delete ch.gText[tid]; changed = true; }
    });
    return changed;
  }

  function syncAll() {
    var subs = (window.ST && window.ST.state && window.ST.state.subjects) || [];
    var changed = false;
    subs.forEach(function (s) {
      (s && s.chapters ? s.chapters : []).forEach(function (ch) {
        if (syncChapter(ch)) changed = true;
      });
    });
    return changed;
  }

  /* chapter se hatayi gayi default steps wapas laao (escape hatch —
     abhi UI nahi, API/tests ke liye).
     NOTE : sirf gHidden khaali karna kaafi nahi — sync ka tombstone
     detector us step ko turant dobara gHidden mein daal deta (kyunki
     wo list mein abhi bhi nahi hai). Isliye gSynced se bhi wahi tid
     hataana zaroori hai, taaki sync use "nayi step" samajh kar
     dobara insert kare. */
  function unhideAll() {
    var changed = false;
    var subs = (window.ST && window.ST.state && window.ST.state.subjects) || [];
    subs.forEach(function (s) {
      (s && s.chapters ? s.chapters : []).forEach(function (ch) {
        if (!ch || !ch.gHidden || !ch.gHidden.length) return;
        var hidden = ch.gHidden.slice();
        ch.gHidden = [];
        if (Array.isArray(ch.gSynced)) {
          ch.gSynced = ch.gSynced.filter(function (tid) {
            return hidden.indexOf(tid) === -1;
          });
        }
        changed = true;
      });
    });
    if (changed) { if (syncAll()) changed = true; persist(); }
    return changed;
  }

  /* ================================================================
     TEMPLATE MUTATORS (UI + tests dono isi se jaate hain)
  ================================================================ */
  function afterTemplateChange() {
    persist();
    if (syncAll()) persist();
    if (screen && screen.classList.contains('active')) render();
    if (window.ST && window.ST.refreshLists) { try { window.ST.refreshLists(); } catch (e) { } }
  }

  function addStep(key, text) {
    text = String(text == null ? '' : text).trim();
    if (!text) return null;
    var step = { id: uid(), text: text };
    listOf(key).push(step);
    afterTemplateChange();
    return step;
  }

  function setText(key, id, text) {
    text = String(text == null ? '' : text).trim();
    if (!text) return false;
    var done = false;
    listOf(key).forEach(function (s) { if (s.id === id) { s.text = text; done = true; } });
    if (done) afterTemplateChange();
    return done;
  }

  function removeStep(key, id) {
    var list = listOf(key);
    var next = list.filter(function (s) { return s.id !== id; });
    if (next.length === list.length) return false;
    if (key === 'mastery') templates().mastery = next;
    else templates().complete = next;
    afterTemplateChange();
    return true;
  }

  function moveStep(key, id, dir) {
    var list = listOf(key);
    var i = -1;
    list.forEach(function (s, k) { if (s.id === id) i = k; });
    var j = i + (dir < 0 ? -1 : 1);
    if (i < 0 || j < 0 || j >= list.length) return false;
    var tmp = list[i]; list[i] = list[j]; list[j] = tmp;
    afterTemplateChange();
    return true;
  }

  /* ================================================================
     TRIANGLE + EYE BUTTON
     ----------------------------------------------------------------
     42×42 ka transparent hit-area (row ki height wahi rehti hai jo
     '+' ki wajah se hai), andar 26px ka SVG : triangle outline +
     beech mein eye. Rang theme variables se → dark mode apne aap.
  ================================================================ */
  var ICON_TRIANGLE_EYE =
    '<svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true">' +
    '<path d="M12 3.8L20.6 19.2H3.4Z" style="fill:var(--tile-bg);stroke:var(--s2);' +
    'stroke-width:1.6;stroke-linejoin:round;stroke-linecap:round"/>' +
    '<path d="M8.1 14.3C9.4 12.2 14.6 12.2 15.9 14.3C14.6 16.4 9.4 16.4 8.1 14.3Z" ' +
    'style="fill:none;stroke:var(--ink2);stroke-width:1.35;stroke-linejoin:round"/>' +
    '<circle cx="12" cy="14.3" r="1.35" style="fill:var(--ink2);stroke:none"/>' +
    '</svg>';

  var BTN_CSS = 'width:42px;height:42px;flex:none;padding:0;border:0;background:transparent;' +
    'box-shadow:none;cursor:pointer;display:flex;align-items:center;justify-content:center;' +
    'color:var(--ink2);transition:transform .15s;-webkit-tap-highlight-color:transparent';

  var eyeBtn = null;

  function buildBtn() {
    var b = el('button');
    b.type = 'button';
    b.id = 'ss-eye-btn';
    b.setAttribute('aria-label', 'Add Step Section');
    b.setAttribute('title', 'Add Step Section');
    b.style.cssText = BTN_CSS;
    b.innerHTML = ICON_TRIANGLE_EYE;

    /* CSS frozen hai isliye ':active' wala press feedback JS se */
    function down() { b.style.transform = 'scale(.9)'; }
    function up() { b.style.transform = ''; }
    if (window.PointerEvent) {
      b.addEventListener('pointerdown', down);
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      b.addEventListener('pointerleave', up);
    } else {
      b.addEventListener('touchstart', down);
      b.addEventListener('touchend', up);
      b.addEventListener('touchcancel', up);
      b.addEventListener('mousedown', down);
      b.addEventListener('mouseup', up);
      b.addEventListener('mouseleave', up);
    }
    b.addEventListener('click', function (e) {
      e.stopPropagation();
      up();
      open();
    });
    return b;
  }

  function mount() {
    if (eyeBtn && eyeBtn.isConnected) return eyeBtn;
    var sc = (window.ST && window.ST.subjectScreen) ? window.ST.subjectScreen() : null;
    if (!sc) return null;
    var top = sc.querySelector('.sub-top');
    if (!top) return null;
    var addBtn = top.querySelector('.add-btn');
    if (!addBtn) return null;
    if (!eyeBtn) eyeBtn = buildBtn();
    /* '+' ke THEEK LEFT — baaki header (eyebrow, heading, +) apni jagah */
    top.insertBefore(eyeBtn, addBtn);
    return eyeBtn;
  }

  /* renderSubjects() ka error-path poore screen ka innerHTML saaf kar
     deta hai (usme exam-widget card bhi jaata hai) — isliye har render
     ke baad button dobara mount. Idempotent hai. */
  function wrapRenderSubjects() {
    var ST = window.ST;
    if (!ST || typeof ST.renderSubjects !== 'function' || ST.__ssWrapped) return;
    var orig = ST.renderSubjects;
    ST.renderSubjects = function () {
      var r = orig.apply(this, arguments);
      try { mount(); } catch (e) { }
      return r;
    };
    ST.__ssWrapped = true;
  }

  /* ================================================================
     SCREEN — "Add Step Section"
  ================================================================ */
  var ICON_CLIP = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M9 12h6M9 16h6"/></svg>';
  var ICON_STAR = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8-6.2-3.2-6.2 3.2L7 14.2 2 9.3l6.9-1z"/></svg>';
  var ICON_UP = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 15l6-6 6 6"/></svg>';
  var ICON_DOWN = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>';

  var screen = null, prevScreen = null;

  function ensureScreen() {
    if (screen) return screen;
    var app = document.getElementById('app');
    if (!app) return null;
    screen = el('section', 'screen');
    screen.id = 'screen-step-section';
    screen.style.paddingTop = '58px';
    app.appendChild(screen);
    return screen;
  }

  /* ---------- step add/edit modal (core/ui.js factory) ---------- */
  var stepModal = UI.modal({ zScrim: 79, zWrap: 80 });

  function openStepModal(key, step) {
    function save() {
      var text = stepModal.body._get ? stepModal.body._get() : '';
      if (!text) { return; }
      if (step) setText(key, step.id, text);
      else addStep(key, text);
      stepModal.close();
    }
    stepModal.open(step ? 'Edit Step' : 'Add Step', function (body) {
      body.appendChild(UI.label('Step'));
      var inp = el('input');
      inp.type = 'text';
      inp.autocomplete = 'off';
      inp.placeholder = 'e.g. Overview of the chapter.';
      inp.style.cssText = UI.fieldCss;
      if (step) inp.value = step.text;
      body.appendChild(inp);
      var hint = el('div', null, key === 'mastery'
        ? 'Ye step HAR subject ke HAR chapter ke Mastery Roadmap mein default dikhegi.'
        : 'Ye step HAR subject ke HAR chapter ke Complete Roadmap mein default dikhegi.');
      hint.style.cssText = 'margin-top:8px;font-size:11.5px;line-height:1.5;color:var(--ash)';
      body.appendChild(hint);
      body._get = function () { return inp.value.trim(); };
      inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') save(); });
      window.setTimeout(function () {
        if (stepModal.isOpen()) { inp.focus(); inp.select(); }
      }, 260);
    }, save);
  }

  /* ---------- ek default step ki row ---------- */
  function stepLine(key, step, i, total) {
    var row = UI.rowBox();

    var num = el('div', null, String(i + 1));
    num.style.cssText = 'width:18px;flex:none;font-family:var(--f-mono);font-size:11px;' +
      'font-weight:700;color:var(--ash);text-align:right;margin-top:2px';
    row.appendChild(num);

    var t = el('div', null, esc(step.text));
    t.style.cssText = 'flex:1;min-width:0;font-size:13px;line-height:1.55;color:var(--ink2);' +
      'white-space:pre-wrap;word-break:break-word';
    row.appendChild(t);

    /* reorder : ↑ ↓ */
    var up = UI.miniBtn(ICON_UP, 'Move up');
    up.setAttribute('data-move', 'up');
    if (i === 0) { up.style.opacity = '.28'; up.disabled = true; }
    up.addEventListener('click', function (e) { e.stopPropagation(); moveStep(key, step.id, -1); });
    row.appendChild(up);

    var dn = UI.miniBtn(ICON_DOWN, 'Move down');
    dn.setAttribute('data-move', 'down');
    if (i === total - 1) { dn.style.opacity = '.28'; dn.disabled = true; }
    dn.addEventListener('click', function (e) { e.stopPropagation(); moveStep(key, step.id, 1); });
    row.appendChild(dn);

    /* edit / delete (do-click confirm) */
    var pop = UI.makeKebabPop(
      function () { openStepModal(key, step); },
      function () { removeStep(key, step.id); }
    );
    var k = UI.miniBtn(UI.icons.kebab, 'Edit or delete');
    k.addEventListener('click', function (e) {
      e.stopPropagation();
      UI.togglePop(pop);
    });
    row.appendChild(k);
    row.appendChild(pop);
    return row;
  }

  /* ---------- ek roadmap ka panel ---------- */
  function panelFor(key, icon, title) {
    var list = listOf(key);
    var p = UI.panel();

    var head = el('div');
    head.style.cssText = 'display:flex;align-items:center;justify-content:space-between;' +
      'gap:10px;margin-bottom:10px';
    var tt = el('div');
    tt.style.cssText = 'display:flex;align-items:center;gap:8px;font-family:var(--f-disp);' +
      'font-size:14px;font-weight:700;color:var(--ink)';
    tt.innerHTML = '<span style="color:var(--slate);display:flex">' + icon + '</span>' + esc(title);
    head.appendChild(tt);
    var cnt = el('div', 'sub-meta', list.length + (list.length === 1 ? ' step' : ' steps'));
    head.appendChild(cnt);
    p.appendChild(head);

    if (!list.length) {
      var hint = el('div', null, 'No steps yet — + Add Step se pehli default step add karo.');
      hint.style.cssText = 'font-size:12px;color:var(--ash);padding:4px 2px 8px';
      p.appendChild(hint);
    }

    list.forEach(function (step, i) {
      p.appendChild(stepLine(key, step, i, list.length));
    });

    var add = UI.pillBtn('+ Add Step');
    add.setAttribute('data-add', key);
    add.addEventListener('click', function () { openStepModal(key, null); });
    p.appendChild(add);
    return p;
  }

  function render() {
    var s = ensureScreen();
    if (!s) return;
    var scrollTop = s.querySelector('.scroll') ? s.querySelector('.scroll').scrollTop : 0;
    s.innerHTML = '';

    var scroll = el('div', 'scroll');

    /* head : back + title */
    var head = el('div');
    head.style.cssText = 'display:flex;align-items:center;gap:10px;padding:12px 16px 6px';
    var back = UI.miniBtn(UI.icons.back, 'Back');
    back.style.cssText += ';width:34px;height:34px;border-radius:50%;border:1px solid ' +
      'var(--s2);background:var(--chip-bg)';
    back.addEventListener('click', function () { close(); });
    head.appendChild(back);
    var h = el('b', null, 'Add Step Section');
    h.style.cssText = 'flex:1;min-width:0;font-family:var(--f-disp);font-size:18px;font-weight:700;' +
      'color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
    head.appendChild(h);
    scroll.appendChild(head);

    /* note */
    var note = el('div', null,
      'Yahan add ki gayi steps HAR subject ke HAR chapter ke roadmap mein DEFAULT dikhti hain ' +
      '(list ke neeche). Chapter ke andar se bhi steps add kar sakte ho, aur kisi default step ' +
      'ko wahan se hata bhi sakte ho — hatai gayi step us chapter mein dobara nahi aayegi.');
    note.style.cssText = 'margin:2px 18px 12px;padding:9px 11px;font-size:11.5px;line-height:1.6;' +
      'color:var(--slate);background:var(--chip-bg);border:1px solid var(--line);border-radius:12px';
    scroll.appendChild(note);

    scroll.appendChild(panelFor('complete', ICON_CLIP, 'Complete Roadmap'));
    scroll.appendChild(panelFor('mastery', ICON_STAR, 'Mastery Roadmap'));

    var t = templates();
    var applied = 0;
    ((window.ST && window.ST.state && window.ST.state.subjects) || []).forEach(function (sb) {
      applied += (sb && sb.chapters ? sb.chapters.length : 0);
    });
    var foot = el('div', 'sub-meta',
      (t.complete.length + t.mastery.length) + ' default steps · ' + applied +
      (applied === 1 ? ' chapter' : ' chapters') + ' par lagu');
    foot.style.cssText = 'margin:2px 18px 20px;text-align:center';
    scroll.appendChild(foot);

    s.appendChild(scroll);
    scroll.scrollTop = scrollTop;
  }

  function open() {
    var s = ensureScreen();
    if (!s) return;
    /* jahan se khola, wahi yaad rakho — back par wahi wapas */
    var act = document.querySelector('section.screen.active');
    if (act && act !== s) prevScreen = act;
    render();
    if (window.SubjectListBridge && window.SubjectListBridge.show) {
      window.SubjectListBridge.show(s, true);
    } else {
      Array.prototype.forEach.call(document.querySelectorAll('section.screen'), function (x) {
        x.classList.remove('active');
      });
      s.classList.add('active');
    }
  }

  function close() {
    if (!screen) return;
    var back = prevScreen;
    prevScreen = null;
    if (window.SubjectListBridge && window.SubjectListBridge.show) {
      if (back && document.body.contains(back)) { window.SubjectListBridge.show(back, false); return; }
      if (window.ST && window.ST.subjectScreen) { window.SubjectListBridge.show(window.ST.subjectScreen(), false); return; }
    }
    screen.classList.remove('active');
  }

  function isOpen() {
    return !!(screen && screen.classList.contains('active'));
  }

  /* ================================================================
     BASICS WRAP : chapter view khulte hi sync (basics.js untouched)
  ================================================================ */
  function wrapBasics() {
    var B = window.Basics;
    if (!B || typeof B.renderChapterView !== 'function' || B.__ssWrapped) return;
    var orig = B.renderChapterView;
    B.renderChapterView = function (cont, ch, hk) {
      try {
        if (syncChapter(ch)) { persist(); }
      } catch (e) { }
      return orig(cont, ch, hk);
    };
    B.__ssWrapped = true;
  }

  /* ================================================================
     BOOT
  ================================================================ */
  function boot() {
    try { wrapBasics(); } catch (e) { }
    try { wrapRenderSubjects(); } catch (e) { }
    try { mount(); } catch (e) { }
    try { if (syncAll()) persist(); } catch (e) { }
  }

  boot();
  /* load par ek baar aur (idempotent) — kisi wajah se Basics ya subject
     screen us waqt ready na ho to wrap/mount tab pakka ho jaye */
  window.addEventListener('load', boot);

  /* SAFETY NET : subject-screens.js ke ANDAR wale renderSubjects() calls
     closure se hote hain (ST.renderSubjects wrap se nahi guzarte), aur uske
     error-path mein poore screen ka innerHTML saaf ho jaata hai — usme ye
     button bhi ud jaata. Isliye halka-fulka guard (exam-widget.js ki 5s
     refresh wali precedent jaisa) : button gayab hua to wapas mount.
     mount() idempotent hai, isliye cost ~ek querySelector har 5s. */
  window.setInterval(function () {
    try { if (!eyeBtn || !eyeBtn.isConnected) mount(); } catch (e) { }
  }, 5000);

  window.SubjectSetting = {
    /* UI */
    open: open, close: close, isOpen: isOpen, render: render,
    mount: mount, button: function () { return eyeBtn; },
    /* data */
    templates: templates,
    addStep: addStep, setText: setText, removeStep: removeStep, moveStep: moveStep,
    /* sync */
    syncAll: syncAll, syncChapter: syncChapter, unhideAll: unhideAll,
    KEYS: { complete: 'steps', mastery: 'masterySteps' }
  };
})();
