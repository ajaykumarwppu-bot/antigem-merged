/* ================================================================
   FEATURES / SUBJECT TRACKER / DOUBT.JS  (PDF tree wala naam)
   ----------------------------------------------------------------
   DOUBT BOOK — sabhi subjects/chapters/sources ke doubt questions
   ek jagah (ye data Sources ke "+ Doubt" button se aata hai):
     • Subject screen ke neeche "Doubt Book" book-card se khulti hai
     • Screen par subject-wise groups → unke chapters → har chapter
       ke sources ke doubt question numbers
     • Har doubt ke saamne tick : tick karte hi doubt SOLVED mark
       hota hai (source.doubtSolved mein save); solved doubts group
       mein neeche dikhte hain (history ke taur par)
     • Tick toggle kar sakte ho (galat tick ho to wapas)
     • Sources ke andar wala doubt picker waisa hi rehta hai —
       ye screen sirf solve-status dikhati/update karti hai
   Data : source.doubt (list) + source.doubtSolved (solved list),
   list.js bridge ke through, core/storage.js se persist.
   ================================================================ */

(function () {
  'use strict';

  if (window.__achivaDoubtLoaded) return;
  window.__achivaDoubtLoaded = true;

  var el = UI.el, esc = UI.esc;
  var sorted = UI.sorted;
  var ICON_BACK = UI.icons.back;
  var ICON_CHECK = UI.icons.check;

  function bridge() { return window.SubjectListBridge; }
  function state() { return bridge().getState(); }

  var screen = el('section', 'screen');
  screen.style.paddingTop = '58px';
  document.getElementById('app').appendChild(screen);

  function openBook() {
    render();
    bridge().show(screen, true);
  }

  function render() {
    screen.innerHTML = '';

    var head = el('div');
    head.style.cssText = 'display:flex;align-items:center;gap:12px;padding:12px 18px 4px';
    var back = el('button', 'icon-btn', ICON_BACK);
    back.type = 'button';
    back.setAttribute('aria-label', 'Back');
    back.addEventListener('click', function () {
      bridge().show(bridge().subjectScreen(), false);
    });
    var tw = el('div', 'sub-title-wrap');
    tw.appendChild(el('h2', null, 'Doubt Book'));
    tw.appendChild(el('div', 'sub-meta', 'Sabhi doubts ek jagah — tick karke solve karo'));
    head.appendChild(back);
    head.appendChild(tw);
    screen.appendChild(head);

    var wrap = el('div', 'scroll');
    var anyDoubt = false;

    state().subjects.forEach(function (subj) {
      var p = UI.panel();
      p.appendChild(UI.panelTitle(esc(subj.name)));
      var hasAny = false;

      /* chapter-wise group : same chapter ke saare sources ek saath */
      (subj.chapters || []).forEach(function (ch) {
        (ch.sources || []).forEach(function (src) {
          if (!Array.isArray(src.doubt)) src.doubt = [];
          if (!Array.isArray(src.doubtSolved)) src.doubtSolved = [];
        });
        var srcs = (ch.sources || []).filter(function (src) { return src.doubt.length; });
        if (!srcs.length) return;
        hasAny = true;

        p.appendChild(UI.label(ch.name));

        srcs.forEach(function (src) {
          var sl = el('div', 'sub-meta', esc(src.name));
          sl.style.margin = '0 0 6px';
          p.appendChild(sl);

          var unsolved = sorted(src.doubt.filter(function (n) {
            return src.doubtSolved.indexOf(n) === -1;
          }));
          var solved = sorted(src.doubt.filter(function (n) {
            return src.doubtSolved.indexOf(n) > -1;
          }));

          var row = el('div');
          row.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px';

          function doubtChip(n, isSolved) {
            var b = el('button');
            b.type = 'button';
            b.setAttribute('aria-label', (isSolved ? 'Unsolved karo Q' : 'Solved karo Q') + n);
            b.style.cssText = 'position:relative;min-width:38px;height:38px;padding:0 10px;border-radius:10px;' +
              'cursor:pointer;font:inherit;font-size:12px;font-weight:700;transition:.15s;' +
              'display:flex;align-items:center;justify-content:center;' +
              (isSolved
                ? 'background:var(--hl);color:var(--ink);border:1.5px solid var(--ink)'
                : 'background:var(--chip-bg);color:var(--slate);border:1px solid var(--s2)');
            b.textContent = 'Q' + n;
            if (isSolved) {
              b.insertAdjacentHTML('beforeend',
                '<span style="position:absolute;top:-7px;right:-7px;width:16px;height:16px;border-radius:50%;' +
                'background:var(--ink);color:var(--paper);display:flex;align-items:center;justify-content:center;' +
                'border:1.5px solid var(--paper)">' + ICON_CHECK + '</span>');
            }
            b.addEventListener('click', function () {
              var i = src.doubtSolved.indexOf(n);
              if (i > -1) src.doubtSolved.splice(i, 1);
              else src.doubtSolved.push(n);
              bridge().persist();
              render();
            });
            return b;
          }

          unsolved.forEach(function (n) { row.appendChild(doubtChip(n, false)); });
          solved.forEach(function (n) { row.appendChild(doubtChip(n, true)); });
          p.appendChild(row);
        });
      });

      if (hasAny) {
        anyDoubt = true;
        wrap.appendChild(p);
      }
    });

    if (!anyDoubt) {
      var empty = el('div', 'empty',
        'Koi doubt question nahi.<br>Sources ke andar "+ Doubt" button se doubts add karo.');
      empty.style.margin = '12px 18px';
      wrap.appendChild(empty);
    }

    screen.appendChild(wrap);
  }

  window.DoubtBook = { open: openBook };
})();
