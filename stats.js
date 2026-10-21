/**
 * Read-only views over training history: last-time numbers, PRs, estimated
 * maxes, warm-up sets. Nothing here changes a prescription — that's engine.js.
 *
 * Pure functions, no DOM. Runs in Node (stats.test.js) and the browser.
 */

'use strict';

/** Epley estimated one-rep max. 0 for bodyweight-only sets. */
function e1rm(weight, reps) {
  if (!weight || !reps) return 0;
  return reps === 1 ? weight : weight * (1 + reps / 30);
}

/**
 * Every logged exercise, oldest first, across finished weeks and the week in
 * progress. One entry per exercise per session.
 *
 * @returns [{ week, day, weekday, date, deload, bad_day, exercise_id, sets }]
 */
function sessions(history, currentWeek, currentLogs) {
  var out = [];

  function add(week, logs) {
    var weekdayOf = {};
    week.workouts.forEach(function (w) { weekdayOf[w.day] = w.weekday; });
    logs.slice().sort(function (a, b) { return a.day - b.day; }).forEach(function (l) {
      if (l.completed === false || !l.exercises) return;
      l.exercises.forEach(function (e) {
        var sets = (e.sets || []).filter(Boolean);
        if (!sets.length) return;
        out.push({
          week: week.index, day: l.day, weekday: weekdayOf[l.day] || '',
          date: l.date || null, deload: !!week.deload, bad_day: !!l.bad_day,
          exercise_id: e.exercise_id, sets: sets
        });
      });
    });
  }

  (history || []).forEach(function (h) { add(h.week, h.logs || []); });
  if (currentWeek) {
    var logs = Object.keys(currentLogs || {}).map(function (k) { return currentLogs[k]; });
    add(currentWeek, logs);
  }
  return out;
}

/**
 * The most recent earlier session of this exercise. "Earlier" means a previous
 * week, or an earlier day of this week — so a lift done Monday and Friday
 * shows Monday's numbers on Friday.
 */
function lastSession(all, exerciseId, week, day) {
  for (var i = all.length - 1; i >= 0; i--) {
    var s = all[i];
    if (s.exercise_id !== exerciseId) continue;
    if (s.week < week || (s.week === week && s.day < day)) return s;
  }
  return null;
}

/**
 * PR kinds a set sets, judged against every set of the same exercise logged
 * before it. Nothing on a first-ever session — there's nothing to beat yet.
 *
 *   weight  heaviest weight ever
 *   reps    more reps than ever at this weight or heavier
 *   e1rm    best estimated max
 */
function prKinds(set, prior) {
  if (!prior.length || !set || !set.reps) return [];
  var kinds = [];
  var w = set.weight_lb || 0;

  var maxW = 0, maxE = 0, maxRepsHere = 0;
  prior.forEach(function (p) {
    var pw = p.weight_lb || 0;
    if (pw > maxW) maxW = pw;
    var e = e1rm(pw, p.reps);
    if (e > maxE) maxE = e;
    if (pw >= w && p.reps > maxRepsHere) maxRepsHere = p.reps;
  });

  if (w > 0 && w > maxW) kinds.push('weight');
  if (set.reps > maxRepsHere) kinds.push('reps');
  if (w > 0 && e1rm(w, set.reps) > maxE + 0.01) kinds.push('e1rm');
  return kinds;
}

/** Copy of sessions with `pr` arrays on each set, chronologically fair. */
function withPRs(all) {
  var seen = {};
  return all.map(function (s) {
    var prior = seen[s.exercise_id] || (seen[s.exercise_id] = []);
    var sets = s.sets.map(function (set) {
      var copy = { weight_lb: set.weight_lb, reps: set.reps, rpe: set.rpe };
      copy.pr = prKinds(copy, prior);
      prior.push(copy);
      return copy;
    });
    return Object.assign({}, s, { sets: sets });
  });
}

/** Per-session summary for a chart: best e1RM, or total reps for bodyweight. */
function trend(all, exerciseId) {
  var points = all.filter(function (s) { return s.exercise_id === exerciseId; });
  var bodyweight = points.every(function (s) {
    return s.sets.every(function (x) { return !x.weight_lb; });
  });
  return {
    metric: bodyweight ? 'reps' : 'e1rm',
    points: points.map(function (s) {
      var v = bodyweight
        ? s.sets.reduce(function (t, x) { return t + x.reps; }, 0)
        : Math.max.apply(null, s.sets.map(function (x) { return e1rm(x.weight_lb, x.reps); }));
      return { week: s.week, weekday: s.weekday, date: s.date, deload: s.deload, value: Math.round(v) };
    })
  };
}

/**
 * Warm-up ramp for a heavy barbell lift. Not logged, not progressed — a
 * checklist. Rounded to 5 lb so it's always loadable.
 */
function needsWarmup(p, ex) {
  return !!(ex && p && p.weight_lb >= 135 && !p.amrap &&
    ex.equipment.indexOf('barbell') !== -1 &&
    (ex.role === 'primary' || (p.rep_range && p.rep_range[0] <= 5)));
}

function warmupSets(weight) {
  var BAR = 45;
  var steps = [[0, 10], [0.4, 5], [0.6, 3], [0.8, 2]];
  if (weight >= 300) steps.push([0.9, 1]);
  var out = [], last = 0;
  steps.forEach(function (s) {
    var w = s[0] === 0 ? BAR : Math.round(weight * s[0] / 5) * 5;
    if (w < BAR) w = BAR;
    if (w <= last || w >= weight) return;
    out.push({ weight_lb: w, reps: s[1] });
    last = w;
  });
  return out;
}

var Stats = {
  e1rm: e1rm, sessions: sessions, lastSession: lastSession,
  prKinds: prKinds, withPRs: withPRs, trend: trend,
  needsWarmup: needsWarmup, warmupSets: warmupSets
};

if (typeof module === 'object' && module.exports) module.exports = Stats;
if (typeof window !== 'undefined') window.Stats = Stats;
