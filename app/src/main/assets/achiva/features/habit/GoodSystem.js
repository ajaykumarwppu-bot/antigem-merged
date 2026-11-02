/* ================================================================
   FEATURES / HABIT / GOOD-SYSTEM.JS — Habit Formation core logic
   ----------------------------------------------------------------
   Source of truth : "habit-tracker-system-design.md"
   Golden rule     : LOGS store karo, STATE calculate karo.
                     streak / score / stage kabhi store NAHI hote —
                     har baar log history se recompute hote hain.

   Pure function (heart) :
     GoodSystem.compute(logs, settings, todayISO)
        -> { series[], streak, automaticity, stage, totalDays,
             completedDays, graceUsed }

   Daily order (single path, koi shortcut nahi) :
     1. day status padho : done | minimum | missed
        (reps >= repsPerDay → done ; 0<reps<repsPerDay → minimum ; 0 → missed)
     2. done     → streak+1, gap=0, completed+1, score += (100-score)*k(stage)
     3. minimum  → streak+1, gap=0, completed+1, score += gain*0.45
     4. missed   → gap+1
                   gap <= grace → streak safe, score -= GRACE_DROP
                   gap >  grace → streak=0, score *= (1-penalty)
     5. grace/penalty = stage + strict level ke formula se
     6. stage = total COMPLETED days se
   ================================================================ */

(function () {
  'use strict';

  if (window.__achivaGoodSystemLoaded) return;
  window.__achivaGoodSystemLoaded = true;

  /* ---------- CONFIG : saare numbers ek jagah (code chhue bina tune ho) ---------- */
  var STAGES = [
    { key: 'Ignition L1',   from: 1,   to: 7,        grace: 0, penalty: 1.00, mean: 'Spark. Hardest days, all willpower.' },
    { key: 'Ignition L2',   from: 8,   to: 21,       grace: 0, penalty: 0.75, mean: 'Conscious effort, resistance easing.' },
    { key: 'Ignition L3',   from: 22,  to: 45,       grace: 0, penalty: 0.50, mean: 'Cues start being recognized.' },
    { key: 'Ignition L4',   from: 46,  to: 70,       grace: 0, penalty: 0.40, mean: 'Approaching average automaticity.' },
    { key: 'Wiring L1',     from: 71,  to: 100,      grace: 1, penalty: 0.30, mean: "Average person's automaticity; wiring begins." },
    { key: 'Wiring L2',     from: 101, to: 170,      grace: 1, penalty: 0.25, mean: 'Well wired into the mind.' },
    { key: 'Wiring L3',     from: 171, to: 200,      grace: 1, penalty: 0.20, mean: 'Deeply integrated.' },
    { key: 'Maintain L1',   from: 201, to: 300,      grace: 2, penalty: 0.15, mean: 'Brain has automated it; keep going.' },
    { key: 'Maintain L2',   from: 301, to: 400,      grace: 2, penalty: 0.12, mean: 'Maintain.' },
    { key: 'Maintain L3',   from: 401, to: 500,      grace: 3, penalty: 0.10, mean: 'Maintain.' },
    { key: 'Discipline L1', from: 501, to: 600,      grace: 3, penalty: 0.07, mean: 'Habit in brain; now discipline/identity.' },
    { key: 'Discipline L2', from: 601, to: 700,      grace: 3, penalty: 0.05, mean: 'Discipline.' },
    { key: 'Discipline L3', from: 701, to: 999999,   grace: 3, penalty: 0.03, mean: 'Discipline.' }
  ];
  /* front-loaded gain : early bigger, later slower (plateau curve) */
  var KGAIN = [0.06, 0.05, 0.04, 0.035, 0.03, 0.025, 0.02, 0.016, 0.013, 0.01, 0.008, 0.006, 0.005];
  var MIN_GAIN_RATIO = 0.45;      /* minimum day = ~45% of done gain */
  var GRACE_DROP = 2;             /* miss within grace = 2% drop (free skip nahi) */
  var FLOOR_FROM_DAY = 22;        /* strict-floor sirf day 22 ke baad लागू */

  var STRICT = {
    1: { cap: 1, floor: 0, mult: 1.5,  use: 'Exercise, study, must-do' },
    2: { cap: 2, floor: 0, mult: 1.25, use: 'Tentative' },
    3: { cap: 99, floor: 0, mult: 1.0, use: 'Default' },
    4: { cap: 99, floor: 2, mult: 0.75, use: 'Tentative' },
    5: { cap: 99, floor: 3, mult: 0.5, use: 'Sleep-like habits' }
  };

  /* level short-forms (Y-axis labels) */
  var LEVEL_SHORT = ['IL1','IL2','IL3','IL4','WL1','WL2','WL3','ML1','ML2','ML3','DL1','DL2','DL3'];
  /* curve anchor points : (completed days → level reached). Consistent completion
     par graph in points ko touch karta hai (IL1 @7d, IL2 @21d, … DL3 ~1000d). */
  var LEVEL_POINTS = [[0,0],[7,1],[21,2],[45,3],[70,4],[100,5],[170,6],[200,7],
                      [300,8],[400,9],[500,10],[600,11],[700,12],[1000,13]];
  function expectedLevel(D) {
    var P = LEVEL_POINTS;
    if (D <= 0) return 0;
    for (var i = 1; i < P.length; i++) {
      if (D <= P[i][0]) {
        var t = (D - P[i-1][0]) / (P[i][0] - P[i-1][0]);
        return P[i-1][1] + t * (P[i][1] - P[i-1][1]);
      }
    }
    return P[P.length-1][1];
  }
  var CLIMB = 0.7;             /* done din par curve ki taraf kitni tezi se badhe */
  var MAX_LEVEL = 13;
  var GRACE_DROP_LEVEL = 0.03; /* grace ke andar miss = halki girawat (level units) */

  function stageForCompleted(cd) {
    for (var i = 0; i < STAGES.length; i++) {
      if (cd >= STAGES[i].from && cd <= STAGES[i].to) return { st: STAGES[i], idx: i };
    }
    return { st: STAGES[STAGES.length - 1], idx: STAGES.length - 1 };
  }
  function gracePenalty(stageIdx, strict, dayIdx) {
    var st = STAGES[stageIdx], sc = STRICT[strict] || STRICT[3];
    var effFloor = dayIdx >= FLOOR_FROM_DAY ? sc.floor : 0;
    var grace = Math.min(Math.max(st.grace, effFloor), sc.cap);
    var penalty = Math.min(1, st.penalty * sc.mult);
    return { grace: grace, penalty: penalty };
  }

  function statusOf(log, repsPerDay) {
    var done = (log && log.done) || 0;
    if (done >= repsPerDay) return 'done';
    if (done > 0) return 'minimum';
    return 'missed';
  }

  /* ---------- PURE compute ---------- */
  function compute(logs, settings, todayISO, addDaysFn) {
    var reps = settings.repsPerDay || 1;
    var strict = settings.strict || 3;
    var addD = addDaysFn || function (iso, n) {           /* default ISO add */
      var d = new Date(iso + 'T00:00:00');
      d.setDate(d.getDate() + n);
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    };
    var score = 0, streak = 0, gap = 0, completed = 0, idx = 0, graceUsed = 0;
    var series = [];
    var d = settings.startDate;
    var guard = 0;
    while (d <= todayISO && guard < 5000) {
      idx++;
      var sg = stageForCompleted(completed);
      var gp = gracePenalty(sg.idx, strict, idx);
      var stt = statusOf((logs || {})[d], reps);
      if (stt === 'done') {
        streak++; gap = 0; completed++;
        var tgt = expectedLevel(completed);
        score += (tgt - score) * CLIMB;
      } else if (stt === 'minimum') {
        streak++; gap = 0; completed++;
        var tgt2 = expectedLevel(completed);
        score += (tgt2 - score) * CLIMB * MIN_GAIN_RATIO;
      } else {
        gap++;
        if (gap <= gp.grace) { score = Math.max(0, score - GRACE_DROP_LEVEL); graceUsed++; }
        else { streak = 0; score *= (1 - gp.penalty); }   /* Ignition penalty=1 → poora 0 */
      }
      score = Math.max(0, Math.min(MAX_LEVEL, score));
      series.push({ day: idx, date: d, A: score, status: stt, streak: streak });
      d = addD(d, 1);
      guard++;
    }
    return {
      series: series,
      streak: streak,
      automaticity: series.length ? series[series.length - 1].A : 0,
      autoPercent: series.length ? Math.round((series[series.length - 1].A / MAX_LEVEL) * 100) : 0,
      stage: stageForCompleted(completed).st,
      stageIdx: stageForCompleted(completed).idx,
      totalDays: idx,
      completedDays: completed,
      graceUsed: graceUsed
    };
  }

  /* retroactive-edit limit (loophole: backfill) — [open] default 2 din */
  function canEditLog(dateISO, todayISO) {
    var diff = Math.round((new Date(todayISO) - new Date(dateISO)) / 86400000);
    return diff >= 0 && diff <= 2;
  }

  window.GoodSystem = {
    STAGES: STAGES, STRICT: STRICT, KGAIN: KGAIN,
    MIN_GAIN_RATIO: MIN_GAIN_RATIO, GRACE_DROP: GRACE_DROP, FLOOR_FROM_DAY: FLOOR_FROM_DAY,
    LEVEL_SHORT: LEVEL_SHORT, LEVEL_POINTS: LEVEL_POINTS, expectedLevel: expectedLevel,
    MAX_LEVEL: MAX_LEVEL, CLIMB: CLIMB, GRACE_DROP_LEVEL: GRACE_DROP_LEVEL,
    stageForCompleted: stageForCompleted, gracePenalty: gracePenalty,
    statusOf: statusOf, compute: compute, canEditLog: canEditLog
  };
})();
