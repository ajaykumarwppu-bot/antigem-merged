/* ================================================================
   FEATURES / HABIT / BAD-SYSTEM.JS — Bad Habit Formation core logic
   ----------------------------------------------------------------
   GoodSystem.js ka ULTA-maqsad wala bhai : wahan habit BANANI hoti
   hai, yahan habit se DOOR rehna (resist karna) hota hai. Lekin
   MATH BILKUL WAHI HAI — koi duplicate logic nahi :

   • Din ka nateeja (BadSystem.logsFrom habit object se banata hai) :
       defended clean (defend ✓, repeat 0)  → logs[day] = { done: 1 }
                                             (= GoodSystem ka "done")
       repeat hui (defend ke saath ya bina) → log nahi (= "missed")
       kuch nahi kiya (na defend, na repeat)→ log nahi (= "missed")
     Yaani resist kiya din = done, baaki sab = missed. (Minimum ka
     concept bad habits mein nahi hai — slip ho to slip hai.)

   • compute() seedha GoodSystem.compute() ko call karta hai :
       settings = { startDate: since, repsPerDay: 1, strict: 3 }
     strict 3 = cap 99 / floor 0 / mult 1.0 → iska matlab stage ki
     APNI grace + APNI penalty lagti hai, koi strict modification
     NAHI ("strict level mat lagana" wala rule).

   • Sirf NAAM badle hain (din / grace / penalty sab same) :
       Ignition  L1-L4  →  FRAYING   FR1-FR4   (1-7, 8-21, 22-45, 46-70)
       Wiring    L1-L3  →  WEAKENING WK1-WK3   (71-100, 101-170, 171-200)
       Maintain  L1-L3  →  FADING    FD1-FD3   (201-300, 301-400, 401-500)
       Discipline L1-L3 →  DORMANT   DM1-DM3   (501-600, 601-700, 701+)
     Graph wahi rehta hai (wahi curve, wahi green fill, wahi levels
     0..13) — sirf Y-axis ke labels FR1…DM3 dikhte hain.

   • Koi test-scenarios / examples is file mein NAHI hain (good wale
     alag file mein the; bad side par wo jaan-boojh kar nahi banaye).

   Golden rule wahi : LOGS store karo (bad-list.js mein defended +
   reps), STATE (streak / score / stage) har baar yahan recompute.
   ================================================================ */

(function () {
  'use strict';

  if (window.__achivaBadSystemLoaded) return;
  window.__achivaBadSystemLoaded = true;

  var GS = function () { return window.GoodSystem; };

  /* ---------- STAGES : naam badal, din/grace/penalty same ---------- */
  var STAGES = [
    { key: 'FR1', name: 'Fraying',   from: 1,   to: 7,      grace: 0, penalty: 1.00, mean: 'Resistance ki spark. Sabse hard din, poori willpower.' },
    { key: 'FR2', name: 'Fraying',   from: 8,   to: 21,     grace: 0, penalty: 0.75, mean: 'Hosh mein ladai, urge abhi bhi tez.' },
    { key: 'FR3', name: 'Fraying',   from: 22,  to: 45,     grace: 0, penalty: 0.50, mean: 'Triggers pehchaane jaane lagte hain.' },
    { key: 'FR4', name: 'Fraying',   from: 46,  to: 70,     grace: 0, penalty: 0.40, mean: 'Staabil resistance ke kareeb.' },
    { key: 'WK1', name: 'Weakening', from: 71,  to: 100,    grace: 1, penalty: 0.30, mean: 'Habit ki pakad kamzor; purani wiring khulne lagi.' },
    { key: 'WK2', name: 'Weakening', from: 101, to: 170,    grace: 1, penalty: 0.25, mean: 'Pakad kaafi kamzor pad chuki.' },
    { key: 'WK3', name: 'Weakening', from: 171, to: 200,    grace: 1, penalty: 0.20, mean: 'Purana loop gehraai se khul gaya.' },
    { key: 'FD1', name: 'Fading',    from: 201, to: 300,    grace: 2, penalty: 0.15, mean: 'Urge dhundhli; bas nigahbaani jaari rakho.' },
    { key: 'FD2', name: 'Fading',    from: 301, to: 400,    grace: 2, penalty: 0.12, mean: 'Dhundhli hoti urge.' },
    { key: 'FD3', name: 'Fading',    from: 401, to: 500,    grace: 3, penalty: 0.10, mean: 'Dhundhli hoti urge.' },
    { key: 'DM1', name: 'Dormant',   from: 501, to: 600,    grace: 3, penalty: 0.07, mean: 'Habit soyi hui; ab vigilance/identity.' },
    { key: 'DM2', name: 'Dormant',   from: 601, to: 700,    grace: 3, penalty: 0.05, mean: 'Dormant.' },
    { key: 'DM3', name: 'Dormant',   from: 701, to: 999999, grace: 3, penalty: 0.03, mean: 'Dormant.' }
  ];
  /* Y-axis labels (graph mein IL1… ki jagah) */
  var LEVEL_SHORT = ['FR1', 'FR2', 'FR3', 'FR4', 'WK1', 'WK2', 'WK3',
    'FD1', 'FD2', 'FD3', 'DM1', 'DM2', 'DM3'];

  function stageForCompleted(cd) {
    return STAGES[GS().stageForCompleted(cd).idx];   /* din same → index same */
  }

  /* ---------- habit object → GoodSystem-format logs ----------
     defended clean din = { done: 1 }; baaki sab din absent (missed) */
  function defendedClean(h, iso) {
    var reps = (h.reps || []).filter(function (r) { return r.iso === iso; }).length;
    return !!(h.defended && h.defended[iso]) && reps === 0;
  }
  function logsFrom(h, todayISO, addDaysFn) {
    var addD = addDaysFn || function (iso, n) {
      var d = new Date(iso + 'T00:00:00');
      d.setDate(d.getDate() + n);
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    };
    var logs = {};
    var d = h.since || todayISO;
    var guard = 0;
    while (d <= todayISO && guard < 5000) {
      if (defendedClean(h, d)) logs[d] = { done: 1, times: [] };
      d = addD(d, 1);
      guard++;
    }
    return logs;
  }

  /* ---------- PURE compute : GoodSystem.compute ka reuse ----------
     strict 3 → stage ki apni grace/penalty (koi strict mod nahi).
     Result wahi shape : { series, streak, automaticity, autoPercent,
     totalDays, completedDays, graceUsed } + stage = renamed stage. */
  function compute(h, todayISO, addDaysFn) {
    var logs = logsFrom(h, todayISO, addDaysFn);
    var cs = GS().compute(logs, {
      startDate: h.since || todayISO,
      repsPerDay: 1,
      strict: 3                      /* mult 1.0 → stage ki apni penalty */
    }, todayISO, addDaysFn);
    cs.stage = STAGES[cs.stageIdx];  /* same din → same index, naya naam */
    return cs;
  }

  window.BadSystem = {
    STAGES: STAGES,
    LEVEL_SHORT: LEVEL_SHORT,
    stageForCompleted: stageForCompleted,
    defendedClean: defendedClean,
    logsFrom: logsFrom,
    compute: compute,
    MAX_LEVEL: GS().MAX_LEVEL        /* 13 — wahi scale */
  };
})();
