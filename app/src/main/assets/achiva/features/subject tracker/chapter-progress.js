/* ================================================================
   FEATURES / SUBJECT TRACKER / CHAPTER-PROGRESS.JS — pure logic
   ----------------------------------------------------------------
   Chapter ka progress bar (0–80% abhi; Test ka 20% future mein).
   Koi UI nahi — sirf calculation. Existing bars (chapter card +
   subject card) isi se drive hote hain.

   Chaar blocks, har ek 20% tak, PROPORTIONAL (1%,2%,3%… badhta hai):
     1. TOPICS   : done nodes / total nodes * 20        (chapter.topics tree)
     2. SOURCES  : har source ki completion ka average * 20
                   PYQ    → solved / total          (analysis allowed nahi)
                   Normal → union(solved,analysis) / total
     3. RECALL   : min(chapter-revisions, 5) / 5 * 20  (revision.history)
     4. Q-REV    : (important+attempt items jinka itemCount>=3) / total * 20
                   (revision.itemCounts[sourceId][key])
   Subject card = saare chapters ke % ka average.
   ================================================================ */

(function () {
  'use strict';
  if (window.__achivaChapterProgressLoaded) return;
  window.__achivaChapterProgressLoaded = true;

  function flattenTopics(nodes, out) {
    out = out || [];
    (nodes || []).forEach(function (n) {
      out.push(n);
      flattenTopics(n.children, out);
    });
    return out;
  }

  function topicsPct(ch) {
    var all = flattenTopics(ch.topics);
    if (!all.length) return 0;
    var done = all.filter(function (n) { return n.done; }).length;
    return (done / all.length) * 20;
  }

  function sourceCompletion(s) {
    var total = s.total || 0;
    if (!total) return 0;
    var solved = (s.solved || []).length;
    if (s.category === 'PYQ') return Math.min(1, solved / total);
    var uni = {};
    (s.solved || []).forEach(function (q) { uni[q] = 1; });
    (s.analysis || []).forEach(function (q) { uni[q] = 1; });
    var covered = Object.keys(uni).length;
    return Math.min(1, covered / total);
  }

  function sourcesPct(ch) {
    var srcs = ch.sources || [];
    if (!srcs.length) return 0;
    var sum = 0;
    srcs.forEach(function (s) { sum += sourceCompletion(s); });
    return (sum / srcs.length) * 20;
  }

  function recallPct(ch) {
    var h = (ch.revision && ch.revision.history) || [];
    return (Math.min(h.length, 5) / 5) * 20;
  }

  /* important + attempt items ; har ek ka itemCount >= 3 chahiye */
  function qrevItems(ch) {
    var keys = [];
    (ch.sources || []).forEach(function (s) {
      (s.important || []).forEach(function (q) { keys.push({ sid: s.id, key: 'imp:' + q }); });
      (s.attempts || []).forEach(function (g) {
        (g.qs || []).forEach(function (q) { keys.push({ sid: s.id, key: 'att:' + q }); });
      });
    });
    return keys;
  }

  function qrevPct(ch) {
    var items = qrevItems(ch);
    if (!items.length) return 0;
    var counts = (ch.revision && ch.revision.itemCounts) || {};
    var done = items.filter(function (it) {
      var m = counts[it.sid];
      return (m && m[it.key] || 0) >= 3;
    }).length;
    return (done / items.length) * 20;
  }

  function breakdown(ch) {
    var t = topicsPct(ch), s = sourcesPct(ch), r = recallPct(ch), q = qrevPct(ch);
    return {
      topics: Math.round(t), sources: Math.round(s),
      recall: Math.round(r), qrev: Math.round(q),
      total: Math.round(t + s + r + q)      /* abhi max 80 (Test 20% future) */
    };
  }

  function chapterPct(ch) { return breakdown(ch).total; }

  function subjectPct(sub) {
    var chs = sub.chapters || [];
    if (!chs.length) return 0;
    var sum = 0;
    chs.forEach(function (c) { sum += chapterPct(c); });
    return Math.round(sum / chs.length);
  }

  window.ChapterProgress = {
    breakdown: breakdown,
    chapterPct: chapterPct,
    subjectPct: subjectPct,
    topicsPct: topicsPct, sourcesPct: sourcesPct, recallPct: recallPct, qrevPct: qrevPct
  };
})();
