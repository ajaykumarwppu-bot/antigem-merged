/* ================================================================
   FEATURES / THOUGHT / DETAIL.JS — ek thought ki poori detail
   ----------------------------------------------------------------
   Main screen ke date-card ke ARROW se khulti hai :
     • head : BACK (→ main screen) + thought ka NAAM (pencil se
       rename — default naam recording/summary se aaya hota hai)
       + [Connect] button
     • upar : saved AUDIO player (IndexedDB se blob → replay;
       audio device par saved rehti hai)
     • [Transcript] button → bada scrollable POPUP (verbatim,
       usi bhasha mein jo boli gayi thi)
     • neeche : SUMMARY poori + POINTS / MISTAKES / ACTIONS
       (simple Hinglish mein)
     • [Connect] → categories ki checklist (knowledge graph wali)
       — jo chuno us category se thought link ho jaata hai aur
       graph mein node+edge ban jaata hai
   • ES5-only.
   ================================================================ */

(function () {
  'use strict';

  if (window.__achivaThoughtDetailLoaded) return;
  window.__achivaThoughtDetailLoaded = true;

  var el = UI.el, esc = UI.esc;
  var S = function () { return window.ThoughtStore; };

  var screen = el('section', 'screen');
  screen.style.paddingTop = '58px';
  document.getElementById('app').appendChild(screen);

  var currentId = null;

  function fmtT(s) {
    return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  }

  /* ---------- transcript popup ---------- */
  function openTranscript(t) {
    var m = UI.modal({ zScrim: 96, zWrap: 97, width: 'min(520px, calc(100% - 32px))' });
    m.open('Transcript — ' + (t.name || 'Thought'), function (body) {
      if (t.language) {
        var lg = el('div', null, 'boli gayi bhasha: ' + esc(t.language));
        lg.style.cssText = 'font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--slate);margin-bottom:8px';
        body.appendChild(lg);
      }
      var box = el('div');
      box.style.cssText = 'max-height:52vh;overflow-y:auto;white-space:pre-wrap;word-break:break-word;' +
        'font-size:13px;line-height:1.7;color:var(--ink2);padding:12px;border:1px solid var(--line);' +
        'border-radius:12px;background:var(--chap-bg)';
      box.textContent = t.transcript || '(transcript khali hai)';
      body.appendChild(box);
    }, null);
  }

  /* ---------- connect sheet : categories se link ---------- */
  function openConnect(t) {
    var G = window.ThoughtGraph;
    if (!G) return;
    var m = UI.modal({ zScrim: 94, zWrap: 95, saveLabel: 'Save' });
    var wanted = {};
    m.open('Connect — categories', function (body) {
      var info = el('div', null, 'Jis category se ye thought judna chahiye use tick karo — ' +
        'knowledge graph mein connection ban jayegi.');
      info.style.cssText = 'font-size:11px;color:var(--ash);line-height:1.6;margin-bottom:10px';
      body.appendChild(info);
      (t.catIds || []).forEach(function (cid) { wanted[cid] = true; });
      function rowFor(cat, depth) {
        var on = !!wanted[cat.id];
        var r = el('div');
        r.style.cssText = 'display:flex;align-items:center;gap:9px;padding:7px 2px;margin-left:' + (depth * 14) + 'px';
        var tick = UI.roundCheck(on);
        r.appendChild(tick);
        var nm = el('div', null, (depth ? '↳ ' : '') + esc(cat.name));
        nm.style.cssText = 'flex:1;font-size:13px;font-weight:' + (depth ? '500' : '700') + ';color:var(--ink)';
        r.appendChild(nm);
        function bind(node) {
          node.addEventListener('click', function () {
            wanted[cat.id] = !wanted[cat.id];
            var nx = UI.roundCheck(wanted[cat.id]);
            r.replaceChild(nx, node);
            bind(nx);
          });
        }
        bind(tick);
        body.appendChild(r);
        G.subCatsOf(cat.id).forEach(function (s2) { rowFor(s2, depth + 1); });
      }
      var tops = G.topCats();
      if (!tops.length) {
        var hint = el('div', null, 'Koi category nahi hai — Knowledge Graph ke gear se pehle categories banao.');
        hint.style.cssText = 'font-size:11.5px;color:var(--slate);line-height:1.6';
        body.appendChild(hint);
      }
      tops.forEach(function (c) { rowFor(c, 0); });
    }, function () {
      G.allCats().forEach(function (c) {
        var has = (t.catIds || []).indexOf(c.id) >= 0;
        if (wanted[c.id] && !has) S().linkCat(t.id, c.id);
        else if (!wanted[c.id] && has) S().unlinkCat(t.id, c.id);
      });
      m.close();
      open(currentId);   /* chips refresh */
    });
  }

  /* ---------- rename ---------- */
  function openRename(t) {
    var m = UI.modal({ zScrim: 94, zWrap: 95, saveLabel: 'Rename' });
    var f = null;
    m.open('Thought ka naam', function (body) {
      f = UI.inputField('Naam', 'thought ka naam');
      f.input.value = t.name || '';
      body.appendChild(f.wrap);
    }, function () {
      var v = (f.input.value || '').trim();
      if (!v) { f.input.focus(); return; }
      S().update(t.id, { name: v });
      m.close();
      open(t.id);
    });
  }

  /* ---------- screen ---------- */
  function open(id) {
    var t = S().get(id);
    if (!t) { if (window.ThoughtMain) window.ThoughtMain.open(); return; }
    currentId = id;
    screen.innerHTML = '';
    var scroll = el('div', 'scroll');

    /* head */
    var head = el('div');
    head.style.cssText = 'display:flex;align-items:center;gap:8px;padding:12px 16px 6px';
    var back = UI.miniBtn(UI.icons.back, 'Back');
    back.style.cssText += ';width:34px;height:34px;border-radius:50%;border:1px solid var(--s2);background:var(--chip-bg)';
    back.addEventListener('click', function () {
      if (window.ThoughtMain) window.ThoughtMain.open();
    });
    head.appendChild(back);
    var tt = el('b', null, esc(t.name || 'Thought'));
    tt.style.cssText = 'flex:1;min-width:0;font-family:var(--f-disp);font-size:15px;font-weight:700;' +
      'color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
    head.appendChild(tt);
    var pen = UI.miniBtn(UI.icons.edit, 'Rename');
    pen.addEventListener('click', function () { openRename(t); });
    head.appendChild(pen);
    var delB = UI.miniBtn(UI.icons.trash, 'Delete thought');
    delB.addEventListener('click', function () {
      var m = UI.modal({ zScrim: 96, zWrap: 97, saveLabel: 'Delete' });
      m.open('Thought delete karein?', function (body) {
        var d = el('div', null, 'Ye thought, iski recording aur transcript permanent hat jayengi.');
        d.style.cssText = 'font-size:12px;color:var(--ink2);line-height:1.6';
        body.appendChild(d);
      }, function () {
        m.close();
        S().remove(t.id);
        if (window.ThoughtMain) window.ThoughtMain.open();
      });
    });
    head.appendChild(delB);
    var conB = UI.pillBtn('Connect');
    conB.style.cssText += ';padding:7px 12px;font-size:11px;font-weight:700';
    conB.addEventListener('click', function () { openConnect(t); });
    head.appendChild(conB);
    scroll.appendChild(head);

    var when = el('div', null, esc(UI.fmtDate(t.date) + ' · ' +
      new Date(t.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) +
      (t.duration ? ' · ' + fmtT(t.duration) : '')));
    when.style.cssText = 'font-size:10.5px;color:var(--ash);margin:0 18px 10px';
    scroll.appendChild(when);

    /* category chips */
    var cats = S().catsOf(t.id);
    if (cats.length) {
      var crow = el('div');
      crow.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin:0 18px 10px';
      cats.forEach(function (c) {
        var ch = UI.chip(esc(c.name));
        ch.style.cssText += ';font-size:9px';
        crow.appendChild(ch);
      });
      scroll.appendChild(crow);
    }

    /* audio player (saved blob se replay) */
    var audioBox = el('div');
    audioBox.style.cssText = 'margin:0 18px 12px;padding:12px;border:1px solid var(--line);border-radius:16px;' +
      'background:var(--tile-bg);box-shadow:inset 0 1px 0 var(--hl-soft)';
    var alab = el('div', null, 'Recording');
    alab.style.cssText = 'font-size:9.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--slate);margin-bottom:8px';
    audioBox.appendChild(alab);
    var ph = el('div', null, 'Audio load ho rahi hai…');
    ph.style.cssText = 'font-size:11px;color:var(--slate)';
    audioBox.appendChild(ph);
    S().audioGet(t.audioId, function (blob) {
      ph.remove ? ph.remove() : null;
      if (!blob) {
        ph.textContent = 'Audio device par saved nahi mili (shayad purani session ki hai).';
        audioBox.appendChild(ph);
        return;
      }
      try {
        var a = el('audio');
        a.controls = true;
        a.style.cssText = 'width:100%;height:38px';
        a.src = URL.createObjectURL(blob);
        audioBox.appendChild(a);
      } catch (e) {
        ph.textContent = 'Is device par audio player chal nahi saka.';
        audioBox.appendChild(ph);
      }
    });
    scroll.appendChild(audioBox);

    /* transcript button */
    var trRow = el('div');
    trRow.style.cssText = 'display:flex;gap:8px;margin:0 18px 12px;flex-wrap:wrap';
    var trB = UI.pillBtn('Transcript');
    trB.style.cssText += ';padding:8px 14px;font-size:11.5px';
    trB.addEventListener('click', function () { openTranscript(t); });
    trRow.appendChild(trB);
    if (t.language) {
      var lc = UI.chip(esc(t.language));
      lc.style.cssText += ';font-size:9px';
      trRow.appendChild(lc);
    }
    scroll.appendChild(trRow);

    /* structured output : summary poori + points */
    var st = t.structured;
    if (t.status === 'error') {
      var er = el('div', null, esc(t.error || 'Process fail hua tha — main screen par Retry karo.'));
      er.style.cssText = 'font-size:11.5px;color:#c0392b;margin:0 18px 12px;line-height:1.6';
      scroll.appendChild(er);
    }
    if (st) {
      var box = el('div');
      box.style.cssText = 'margin:0 18px 18px;padding:14px;border:1px solid var(--line);border-radius:16px;' +
        'background:var(--tile-bg);box-shadow:inset 0 1px 0 var(--hl-soft)';
      function label(txt, color) {
        var l = el('div', null, txt);
        l.style.cssText = 'font-size:9px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;' +
          'color:' + (color || 'var(--slate)') + ';margin:10px 0 4px';
        return l;
      }
      function para(txt) {
        var p = el('div', null, esc(txt));
        p.style.cssText = 'font-size:12.5px;line-height:1.7;color:var(--ink2);white-space:pre-wrap';
        return p;
      }
      function bullets(list, color) {
        list.forEach(function (x) {
          var d = el('div', null, '• ' + esc(x));
          d.style.cssText = 'font-size:12px;line-height:1.65;color:' + color + ';margin:0 0 4px 2px';
          box.appendChild(d);
        });
      }
      box.appendChild(label('Summary'));
      box.appendChild(para(st.summary || '(summary khali)'));
      if (st.points && st.points.length) { box.appendChild(label('Points')); bullets(st.points, 'var(--ink2)'); }
      if (st.mistakes && st.mistakes.length) { box.appendChild(label('Mistakes', '#c0392b')); bullets(st.mistakes, '#c0392b'); }
      if (st.actions && st.actions.length) { box.appendChild(label('Actions', '#2ea043')); bullets(st.actions, '#2ea043'); }
      scroll.appendChild(box);
    }

    screen.appendChild(scroll);
    if (window.SubjectListBridge) window.SubjectListBridge.show(screen, true);
  }

  window.ThoughtDetail = { open: open, openTranscript: openTranscript, openConnect: openConnect };
})();
