#!/usr/bin/env node
/**
 * Replay harness.
 *
 *   node simulate.js                  16 weeks, summary table
 *   node simulate.js --weeks 24
 *   node simulate.js --detail 5       print week 5 in full
 *   node simulate.js --perfect        every rep hit at RPE 7 (upper bound on progress)
 *
 * Drives the engine with a synthetic lifter so you can see what the rules
 * actually do over a block before trusting them with real training. Everything
 * is seeded — the same flags always produce the same run, which is the point.
 *
 * Once you have real logs, feed those in instead of simulateWeek() and the same
 * harness shows you what a changed rule WOULD have done to a block you trained.
 */

'use strict';

var E = require('./engine');

// ─── args ───────────────────────────────────────────────────────────────────

var argv = process.argv.slice(2);
function flag(name, fallback) {
  var i = argv.indexOf('--' + name);
  if (i === -1) return fallback;
  var v = argv[i + 1];
  return (v === undefined || v.indexOf('--') === 0) ? true : v;
}
var WEEKS = parseInt(flag('weeks', 16), 10);
var DETAIL = flag('detail', null);
var PERFECT = flag('perfect', false) === true;

// ─── synthetic lifter ───────────────────────────────────────────────────────

/** Seeded LCG so a run is reproducible. */
var seed = 20191211;
function rand() {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}

/** Epley-ish: what estimated 1RM a set of `reps` at `w` demands. */
function demand(w, reps) { return w * (1 + 0.0333 * reps); }

/**
 * Capacity model: each exercise has a hidden estimated 1RM that drifts up
 * slowly. Bodyweight lifts get a nominal capacity so the arithmetic works.
 */
function initCapacity(week, config) {
  var cap = {};
  week.workouts.forEach(function (w) {
    w.exercises.forEach(function (p) {
      if (cap[p.exercise_id] !== undefined) return;
      var base = p.weight_lb > 0 ? p.weight_lb : GUESS;
      cap[p.exercise_id] = base * 1.35;
    });
  });
  return cap;
}

var WEEKLY_GAIN = 0.004; // ~0.4%/week — an intermediate, not a novice
var GUESS = 50;          // weight the synthetic lifter enters for an unknown-weight exercise
var weekNo = 0;

function rpeFor(ratio) {
  // ratio 0.75 -> 6, 0.875 -> 8, 1.0 -> 10
  var r = Math.round(6 + 4 * (ratio - 0.75) / 0.25);
  return Math.max(6, Math.min(10, r));
}

function simulateWeek(week, capacity) {
  return week.workouts.map(function (w) {
    var missedSession = !PERFECT && rand() < 0.035;
    var badDay = !PERFECT && !missedSession && rand() < 0.05;

    if (missedSession) {
      return { day: w.day, completed: false, bad_day: false, exercises: [] };
    }

    return {
      day: w.day,
      completed: true,
      bad_day: badDay,
      exercises: w.exercises.map(function (p) {
        var cap = capacity[p.exercise_id];
        return {
          exercise_id: p.exercise_id,
          sets: p.target_reps.map(function (target, i) {
            var w = p.weight_lb === null ? GUESS : p.weight_lb;
            var isLast = i === p.target_reps.length - 1;
            if (p.amrap) {
              // bodyweight AMRAP: a little more each week, fading across sets
              var r = Math.max(3, 10 + Math.floor(weekNo * 0.4) - i - (w / 10));
              return { weight_lb: w, reps: r, rpe: isLast ? 8 : undefined };
            }
            if (PERFECT) return { weight_lb: w, reps: target, rpe: isLast ? 7 : undefined };
            var need = demand(w > 0 ? w : 45, target);
            var ratio = need / cap;
            // fatigue within the session: later sets are relatively harder
            ratio *= 1 + 0.015 * i;
            var reps = ratio >= 1.0 ? Math.max(1, target - 1) : target;
            return {
              weight_lb: w,
              reps: reps,
              rpe: i === p.target_reps.length - 1 ? rpeFor(ratio) : undefined
            };
          })
        };
      })
    };
  });
}

// ─── run ────────────────────────────────────────────────────────────────────

var library = E.loadLibrary();
var byId = E.indexById(library);

var CONFIG = Object.assign({}, E.CONFIG, { program: E.loadProgram() });
var week = E.initialWeek(library, CONFIG);
var capacity = initCapacity(week, CONFIG);
var history = [];
var rows = [];

var TRACK = ['1:barbell-bench-press', '2:barbell-bent-over-row', '2:barbell-shrug',
             '3:barbell-back-squat', '6:barbell-deadlift', '2:pull-up'];
var HEAD = ['bench', 'row', 'shrug', 'squat', 'deadlift', 'pull-up'];

function findPrescription(w, slot) {
  for (var i = 0; i < w.workouts.length; i++) {
    for (var j = 0; j < w.workouts[i].exercises.length; j++) {
      if (w.workouts[i].exercises[j].slot === slot) return w.workouts[i].exercises[j];
    }
  }
  return null;
}

for (var n = 0; n < WEEKS; n++) {
  if (DETAIL && String(week.index) === String(DETAIL)) printWeek(week);

  rows.push({
    index: week.index,
    deload: week.deload,
    warnings: week.warnings,
    lifts: TRACK.map(function (id) {
      var p = findPrescription(week, id);
      if (!p) return '—';
      var reps = p.target_reps;
      if (p.amrap) return p.weight_lb + '  ' + (reps[0] === null ? 'new base' : 'beat ' + reps.reduce(function (a, b) { return a + b; }, 0));
      var even = reps.every(function (r) { return r === reps[0]; });
      return p.weight_lb + '  ' + reps.length + '×' + (even ? reps[0] : reps.join('/'));
    })
  });

  var logs = simulateWeek(week, capacity);
  history.push({ week: week, logs: logs });
  week = E.nextWeek(history, library, CONFIG);
  weekNo++;

  Object.keys(capacity).forEach(function (k) { capacity[k] *= (1 + WEEKLY_GAIN); });
}

// ─── output ─────────────────────────────────────────────────────────────────

function pad(s, n) {
  s = String(s);
  return s.length >= n ? s : s + Array(n - s.length + 1).join(' ');
}

function printWeek(w) {
  console.log('\n─── Week ' + w.index + (w.deload ? '  (DELOAD)' : '') + ' ' + Array(50).join('─'));
  w.workouts.forEach(function (d) {
    console.log('\n  ' + d.weekday + '  ' + d.name);
    d.exercises.forEach(function (p) {
      var ex = byId[p.exercise_id];
      var reps = p.target_reps;
      var even = reps.every(function (r) { return r === reps[0]; });
      console.log('    ' + pad(ex.name, 30) +
        pad((p.weight_lb === null ? '?' : p.weight_lb) + ' lb', 10) +
        pad(reps.length + '×' + (p.amrap ? 'AMRAP' : (even ? reps[0] : reps.join('/'))), 12) +
        pad('RPE ' + p.target_rpe, 8) +
        pad(p.rest_sec + 's', 7) +
        (p.note || ''));
    });
  });
  console.log('');
}

console.log('\n' + WEEKS + ' weeks' + (PERFECT ? ', perfect execution' : ', synthetic lifter (seeded)') + '\n');

var header = '  wk  ' + HEAD
  .map(function (h) { return pad(h, 13); }).join('');
console.log(header);
console.log('  ' + Array(header.length).join('-'));

rows.forEach(function (r) {
  console.log('  ' + pad(r.index + (r.deload ? 'D' : ''), 4) +
    r.lifts.map(function (l) { return pad(l, 13); }).join(''));
});

console.log('\n  D = deload week\n');

// each distinct warning once, with the weeks it fired
var seen = {}, order = [];
rows.forEach(function (r) {
  (r.warnings || []).forEach(function (w) {
    var key = w.replace(/[\d.]+/g, '#');
    if (!seen[key]) { seen[key] = { text: w, weeks: [] }; order.push(key); }
    seen[key].weeks.push(r.index);
  });
});
if (order.length) {
  console.log('Warnings\n');
  order.forEach(function (k) {
    console.log('  ' + seen[k].text + '\n      weeks ' + seen[k].weeks.join(', '));
  });
  console.log('');
}

// compare against the last real week — a deload's reduced load isn't progress lost
var real = rows.filter(function (r) { return !r.deload; });
var first = rows[0].lifts, last = real[real.length - 1].lifts;
console.log('Net change to week ' + real[real.length - 1].index + ' (last non-deload week)\n');
TRACK.forEach(function (slot, i) {
  var a = parseFloat(first[i]), b = parseFloat(last[i]);
  if (isNaN(a) || isNaN(b)) return;
  var delta = b - a;
  console.log('  ' + pad(byId[slot.split(':')[1]].name, 26) + pad(a + ' → ' + b + ' lb', 20) +
    (delta >= 0 ? '+' : '') + delta.toFixed(1) + ' lb');
});
console.log('');
