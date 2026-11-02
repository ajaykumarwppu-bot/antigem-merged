/* ================================================================
   CORE / APP-SHELL.JS — floating nav button (FAB) + coming-soon screens
   ----------------------------------------------------------------
   Ye code pehle index.html ke andar inline <script> tha.
   IndexedDB migration (v3) mein index.html ke saare feature/backend
   scripts ek ordered loader se load hote hain, isliye ise yahan
   file bana diya gaya. LOGIC BILKUL UNCHANGED — sirf jagah badli.
   Loader manifest mein ye backend/settings.js ke BAAD aati hai
   (pehle inline script bhi sab scripts ke baad hi chalta tha).
   Depends on: UI, SubjectListBridge, Dashboard, CanvasList,
   TimerFeature, GoalList, GoodList (sab loader se pehle aa chuke).
   ================================================================ */
    (function () {
      'use strict';
      var app = document.getElementById('app');
      var fab = document.getElementById('fab');
      var col = document.getElementById('fabCol');
      var row = document.getElementById('fabRow');
      var FAB = 58, MARGIN = 14;
      var COL_W = 72, COL_H = 252, ROW_W = 252, ROW_H = 72;
      var corner = 'br';
      var menuOpen = false;

      /* ---------- coming-soon feature screens ---------- */
      var FEATURE_SCREENS = {};
      var FEATURE_TITLES = {
        dash: 'Dashboard',
        tasks: 'Tasks', habits: 'Habits', goals: 'Goals'
      };
      Object.keys(FEATURE_TITLES).forEach(function (key) {
        var s = UI.el('section', 'screen');
        s.style.paddingTop = '58px';
        var head = UI.el('div');
        head.style.cssText = 'display:flex;align-items:center;gap:12px;padding:12px 18px 4px';
        /* back arrow NAHI : ye apne aap mein ek feature screen hai
           (kisi cheez ke andar nahi) — is par aana-jaana FAB
           (menu button) se hi hota hai */
        var tw = UI.el('div', 'sub-title-wrap');
        tw.appendChild(UI.el('h2', null, FEATURE_TITLES[key]));
        tw.appendChild(UI.el('div', 'sub-meta', 'Naya feature'));
        head.appendChild(tw);
        s.appendChild(head);
        var wrap = UI.el('div', 'scroll');
        var empty = UI.el('div', 'empty', 'Coming soon<br>' + FEATURE_TITLES[key] + ' feature yahan jald add hoga.');
        empty.style.margin = '12px 18px';
        wrap.appendChild(empty);
        s.appendChild(wrap);
        app.appendChild(s);
        FEATURE_SCREENS[key] = s;
      });

      /* ---------- corner positioning ---------- */
      function cornerPos(c) {
        var w = app.clientWidth, h = app.clientHeight;
        if (c === 'br') return { x: w - FAB - MARGIN, y: h - FAB - MARGIN };
        if (c === 'bl') return { x: MARGIN, y: h - FAB - MARGIN };
        if (c === 'tr') return { x: w - FAB - MARGIN, y: MARGIN + 44 };
        return { x: MARGIN, y: MARGIN + 44 };
      }

      function place(c, animate) {
        corner = c;
        app.setAttribute('data-corner', c);
        var p = cornerPos(c);
        if (animate) {
          fab.classList.add('snap');
          window.setTimeout(function () { fab.classList.remove('snap'); }, 420);
        }
        fab.style.left = p.x + 'px';
        fab.style.top = p.y + 'px';
        if (menuOpen) positionGroups();
      }

      /* fab ki current position (inline style se — layout-safe) */
      function fabXY() {
        return { x: parseInt(fab.style.left, 10) || 0, y: parseInt(fab.style.top, 10) || 0 };
      }

      /* ---------- menu open/close ----------
         Corner-wise directions : dono groups fab wale corner ki
         dono edges ke along khulte hain (screen mein fit) :
           br → column upar, row left   |  bl → column upar, row right
           tr → column neeche, row left  |  tl → column neeche, row right */
      function clamp(v, min, max) { return Math.min(Math.max(min, v), max); }

      function positionGroups() {
        var p = fabXY();
        var w = app.clientWidth, h = app.clientHeight;
        var rightSide = (corner === 'br' || corner === 'tr');
        var bottomSide = (corner === 'br' || corner === 'bl');
        /* column (4 items vertical) */
        col.style.left = clamp(p.x - 7, 4, w - COL_W - 4) + 'px';
        col.style.top = (bottomSide
          ? clamp(p.y - 8 - COL_H, 4, h - COL_H - 4)
          : clamp(p.y + FAB + 8, 4, h - COL_H - 4)) + 'px';
        col.style.transformOrigin = '50% ' + (bottomSide ? '100%' : '0%');
        /* row (4 items horizontal) */
        row.style.top = clamp(p.y - 7, 4, h - ROW_H - 4) + 'px';
        row.style.left = (rightSide
          ? clamp(p.x - 8 - ROW_W, 4, w - ROW_W - 4)
          : clamp(p.x + FAB + 8, 4, w - ROW_W - 4)) + 'px';
        row.style.transformOrigin = (rightSide ? '100%' : '0%') + ' 50%';
      }

      function openMenu() {
        menuOpen = true;
        app.classList.add('menu-open');
        positionGroups();
        [col, row].forEach(function (g) {
          g.style.visibility = 'visible';
          g.style.pointerEvents = 'auto';
        });
        window.requestAnimationFrame(function () {
          [col, row].forEach(function (g) {
            g.style.opacity = '1';
            g.style.transform = 'none';
          });
        });
      }

      function closeMenu() {
        if (!menuOpen) return;
        menuOpen = false;
        app.classList.remove('menu-open');
        [col, row].forEach(function (g) {
          g.style.opacity = '0';
          g.style.transform = 'scale(.6)';
          g.style.pointerEvents = 'none';
        });
        window.setTimeout(function () {
          if (!menuOpen) {
            [col, row].forEach(function (g) { g.style.visibility = 'hidden'; });
          }
        }, 260);
      }

      /* ---------- FAB visibility ----------
         FAB sirf main screens par dikhta hai (subjects / chapters /
         books / feature screens). Chapter-view (basics / topic /
         sources / revision) ke andar list.js ka showScreen ise
         setVisible(false) se chhupa deta hai. */
      var fabVisible = true;
      var fabVisTimer = null;

      function setVisible(v) {
        v = !!v;
        if (v === fabVisible) return;
        fabVisible = v;
        if (!v) closeMenu();          /* khula menu bhi saath band */
        fab.style.pointerEvents = v ? 'auto' : 'none';
        if (fabVisTimer) { window.clearTimeout(fabVisTimer); fabVisTimer = null; }
        if (v) {
          fab.style.visibility = 'visible';
          fab.style.opacity = '0';
          window.requestAnimationFrame(function () {
            if (!fabVisible) return;
            fab.style.transition = 'opacity .28s ease';
            fab.style.opacity = '1';
            fabVisTimer = window.setTimeout(function () {
              fabVisTimer = null;
              fab.style.transition = '';   /* .snap corner animation safe */
            }, 300);
          });
        } else {
          fab.style.transition = 'opacity .22s ease';
          fab.style.opacity = '0';
          fabVisTimer = window.setTimeout(function () {
            fabVisTimer = null;
            if (!fabVisible) {
              fab.style.visibility = 'hidden';
              fab.style.transition = '';
            }
          }, 240);
        }
      }

      window.AchivaFab = { setVisible: setVisible };

      /* ---------- navigation ----------
         RESPONSIVE: ye ek hi function FAB menu AUR wide-screen sidebar
         DONO use karte hain — do jagah alag logic nahi. */
      function navigate(key) {
        var B = window.SubjectListBridge;
        if (key === 'subs') {
          B.show(B.subjectScreen(), false);
        } else if (key === 'time') {
          /* Time = screen-time tracker (features/timer/) */
          if (window.TimerFeature) window.TimerFeature.open();
        } else if (key === 'draw') {
          /* Draw = Canvas feature (canvas/canvas.js) */
          if (window.CanvasList) window.CanvasList.openList();
        } else if (key === 'goals') {
          /* Goals = Goal feature (features/goals/) */
          if (window.GoalList) window.GoalList.open();
        } else if (key === 'habits') {
          /* Habits = Good habits (features/habit/good-list.js) */
          if (window.GoodList) window.GoodList.open();
        } else if (key === 'dash') {
          /* DASH = asli Dashboard (features/dashboard/) */
          if (window.Dashboard) window.Dashboard.open();
        } else if (key === 'thought') {
          /* THOUGHT = thoughts feature (features/thought/) */
          if (window.ThoughtFeature) window.ThoughtFeature.open();
        } else if (key === 'tasks') {
          /* TASKS = extra tasks feature (features/task/task.js) */
          if (window.TaskFeature) window.TaskFeature.open();
          else B.show(FEATURE_SCREENS[key], true);
        } else {
          B.show(FEATURE_SCREENS[key], true);
        }
      }
      function onMenuClick(e) {
        var item = e.target.closest('.mitem');
        if (!item) return;
        var key = item.getAttribute('data-key');
        closeMenu();
        navigate(key);
      }
      col.addEventListener('click', onMenuClick);
      row.addEventListener('click', onMenuClick);

      /* ---------- RESPONSIVE : vertical nav rail (sirf wide screens) ----------
         CSS ise <821px par display:none rakhta hai — phone ki UI/CSS bilkul
         untouched. Reference-image wala sliding highlight VERTICAL : ek hi
         .sn-blob element active item par slide karta hai. Blob ka rang CSS
         mein var(--ink) se aata hai (light=black, dark=grey-silver). */
      var NAV_ICONS = {
        dash: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/></svg>',
        subs: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>',
        habits: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m8.5 12.2 2.4 2.4 4.6-5"/></svg>',
        goals: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.4"/></svg>',
        tasks: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6h13M8 12h13M8 18h13"/><path d="m3 6 .8.8L5.5 5"/><path d="m3 12 .8.8L5.5 11"/><path d="m3 18 .8.8L5.5 17"/></svg>',
        thought: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-3.2-.6L3 21l1.7-4.1A8.4 8.4 0 1 1 21 11.5z"/></svg>',
        time: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
        draw: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/></svg>'
      };
      var NAV_ITEMS = [
        ['dash', 'Dashboard'], ['subs', 'Subjects'], ['habits', 'Habits'],
        ['goals', 'Goals'], ['tasks', 'Tasks'], ['thought', 'Thoughts'],
        ['time', 'Time'], ['draw', 'Draw']
      ];
      var sideNav = UI.el('nav', 'side-nav');
      sideNav.setAttribute('aria-label', 'Features');
      /* BRAND LOCKUP : header wala poora lockup (teen-line logo + ACHIVA +
         STUDY OS) yahan rail ke top par. Wide screens par header ka brand
         CSS se hide hota hai; PHONE par rail hidden hai isliye header wala
         brand wahi dikhta hai (phone UI 0% change). */
      var snBrand = UI.el('div', 'brand sn-brand');
      var snMark = UI.el('span', 'brand-mark');
      snMark.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" ' +
        'stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>';
      var snTxt = UI.el('div');
      snTxt.appendChild(UI.el('div', 'brand-name', 'ACHIVA'));
      snTxt.appendChild(UI.el('div', 'brand-sub', 'Study OS · v1.0'));
      snBrand.appendChild(snMark);
      snBrand.appendChild(snTxt);
      sideNav.appendChild(snBrand);

      var snList = UI.el('div', 'sn-list');
      var snBlob = UI.el('div', 'sn-blob');
      snList.appendChild(snBlob);
      sideNav.appendChild(snList);

      var navCurrent = null;
      function moveBlob(item) {
        if (!item) return;
        snBlob.style.height = item.offsetHeight + 'px';
        snBlob.style.transform = 'translateY(' + item.offsetTop + 'px)';
        snBlob.style.opacity = '1';
      }
      function markNav(key) {
        navCurrent = key;
        var items = snList.querySelectorAll('.side-item');
        for (var i = 0; i < items.length; i++) {
          var on = items[i].getAttribute('data-key') === key;
          if (on) { items[i].classList.add('on'); moveBlob(items[i]); }
          else items[i].classList.remove('on');
        }
      }
      NAV_ITEMS.forEach(function (it) {
        var b = UI.el('button', 'side-item');
        b.type = 'button';
        b.setAttribute('data-key', it[0]);
        b.innerHTML = (NAV_ICONS[it[0]] || '') + '<span>' + UI.esc(it[1]) + '</span>';
        b.addEventListener('click', function () { navigate(it[0]); markNav(it[0]); });
        snList.appendChild(b);
      });
      /* window resize par blob ko dobara active item par set karo */
      window.addEventListener('resize', function () {
        if (!navCurrent) return;
        var cur = snList.querySelector('.side-item[data-key="' + navCurrent + '"]');
        if (cur) moveBlob(cur);
      });
      /* rail .device ke andar (app ke sibling) taaki .app left-shift ho sake */
      if (app.parentNode) app.parentNode.appendChild(sideNav);
      window.AchivaNav = { navigate: navigate, markNav: markNav, el: sideNav };

      document.addEventListener('pointerdown', function (e) {
        if (menuOpen && !col.contains(e.target) && !row.contains(e.target) && !fab.contains(e.target)) closeMenu();
      });

      /* ---------- drag (long-hold) + corner snap ---------- */
      var drag = null;
      fab.addEventListener('pointerdown', function (e) {
        e.preventDefault();
        if (fab.setPointerCapture) fab.setPointerCapture(e.pointerId);
        var p0 = fabXY();
        drag = { sx: e.clientX, sy: e.clientY, ox: p0.x, oy: p0.y, moved: false };
      });
      fab.addEventListener('pointermove', function (e) {
        if (!drag) return;
        var dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
        if (!drag.moved && Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
        if (!drag.moved) {
          drag.moved = true;
          closeMenu();
          app.classList.add('dragging');
          fab.classList.remove('snap');
        }
        var w = app.clientWidth, h = app.clientHeight;
        var x = Math.min(Math.max(4, drag.ox + dx), w - FAB - 4);
        var y = Math.min(Math.max(4, drag.oy + dy), h - FAB - 4);
        fab.style.left = x + 'px';
        fab.style.top = y + 'px';
      });
      fab.addEventListener('pointerup', function () {
        if (!drag) return;
        var wasMoved = drag.moved;
        drag = null;
        app.classList.remove('dragging');
        if (!wasMoved) {
          /* tap → menu toggle */
          if (menuOpen) closeMenu(); else openMenu();
          return;
        }
        /* nearest corner par snap */
        var p1 = fabXY();
        var fx = p1.x + FAB / 2, fy = p1.y + FAB / 2;
        var w = app.clientWidth, h = app.clientHeight;
        var c = (fx > w / 2 ? 'r' : 'l') + (fy > h / 2 ? 'b' : 't');
        place(c === 'rb' ? 'br' : c === 'lb' ? 'bl' : c === 'rt' ? 'tr' : 'tl', true);
      });
      fab.addEventListener('pointercancel', function () {
        drag = null;
        app.classList.remove('dragging');
      });

      window.addEventListener('resize', function () { place(corner, false); });

      /* initial position */
      place('br', false);
    })();
