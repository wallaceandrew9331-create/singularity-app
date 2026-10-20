#!/usr/bin/env node
/**
 * Engine tests. No framework — `node engine.test.js`.
 */

'use strict';

var E = require('./engine');

var passed = 0, failed = 0;
function t(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (err) { failed++; console.log('  ✗ ' + name + '\n      ' + err.message); }
}
function eq(actual, expected, what) {
  var a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a !== b) throw new Error((what || 'value') + ': expected ' + b + ', got ' + a);
}

var library = E.loadLibrary();
var byId = E.indexById(library);
var CONFIG = Object.assign({}, E.CONFIG, { program: E.loadProgram() });

var BENCH = byId['barbell-bench-press'];        // +5 / half 2.5
var DB = byId['flat-dumbbell-bench-press'];     // +5 / no half
var PULLUP = byId['pull-up'];

function presc(over) {
  return Object.assign({
    exercise_id: BENCH.id, slot: '1:' + BENCH.id, order: 1,
    weight_lb: 155, target_reps: [10, 10, 10, 10], rep_range: [10, 12],
    amrap: false, rest_sec: 90, target_rpe: 8, note: ''
  }, over || {});
}
function sets(reps, rpe, w) {
  return { exercise_id: BENCH.id, sets: reps.map(function (r, i) {
    var s = { weight_lb: w === undefined ? 155 : w, reps: r };
    if (i === reps.length - 1 && rpe !== undefined) s.rpe = rpe;
    return s;
  }) };
}
var CTX = { priorMisses: 0, evaluate: true };
function run(p, log, ex, ctx) { return E.progressExercise(p, log, ex || BENCH, ctx || CTX, CONFIG); }

// ─── ranges ─────────────────────────────────────────────────────────────────

console.log('\nRep ranges from your program\n');

t('5 reps or fewer is fixed', function () { eq(E.rangeFor(5, CONFIG), [5, 5]); eq(E.rangeFor(3, CONFIG), [3, 3]); });
t('above 5 becomes your number +2', function () { eq(E.rangeFor(8, CONFIG), [8, 10]); eq(E.rangeFor(12, CONFIG), [12, 14]); });

// ─── the core rule ──────────────────────────────────────────────────────────

console.log('\nThe core rule\n');

t('missed reps, first time → miss (unchanged)', function () {
  var r = run(presc(), sets([10, 10, 9, 8], 9));
  eq(r.action, 'miss'); eq(r.next.weight_lb, 155); eq(r.next.target_reps, [10, 10, 10, 10]);
});
t('missed reps twice running → deload 10%', function () {
  var r = run(presc(), sets([10, 10, 9, 8], 9), BENCH, { priorMisses: 1, evaluate: true });
  eq(r.action, 'deload'); eq(r.next.weight_lb, 140);
});
t('inside the range at RPE 8 → +1 rep on every set', function () {
  var r = run(presc(), sets([10, 10, 10, 10], 8));
  eq(r.action, 'add_rep'); eq(r.next.target_reps, [11, 11, 11, 11]); eq(r.next.weight_lb, 155);
});
t('inside the range at RPE 10 → held', function () {
  eq(run(presc(), sets([10, 10, 10, 10], 10)).action, 'repeat');
});
t('topped at RPE 8 → full increment, reps reset', function () {
  var r = run(presc({ target_reps: [12, 12, 12, 12] }), sets([12, 12, 12, 12], 8));
  eq(r.action, 'load_up'); eq(r.next.weight_lb, 160); eq(r.next.target_reps, [10, 10, 10, 10]);
});
t('topped at RPE 9 on a barbell → half increment', function () {
  var r = run(presc({ target_reps: [12, 12, 12, 12] }), sets([12, 12, 12, 12], 9));
  eq(r.action, 'load_up_half'); eq(r.next.weight_lb, 157.5);
});
t('topped at RPE 9 on dumbbells → held (no half step exists)', function () {
  var r = run(presc({ exercise_id: DB.id, target_reps: [12, 12, 12, 12] }), sets([12, 12, 12, 12], 9), DB);
  eq(r.action, 'repeat'); eq(r.next.weight_lb, 155);
});
t('topped at RPE 10 → held', function () {
  eq(run(presc({ target_reps: [12, 12, 12, 12] }), sets([12, 12, 12, 12], 10)).action, 'repeat');
});

console.log('\nFixed 5×5 — your bench and squat\n');

t('5×5 hit at RPE 8 → weight goes up next week', function () {
  var p = presc({ weight_lb: 275, target_reps: [5, 5, 5, 5, 5], rep_range: [5, 5] });
  var r = run(p, sets([5, 5, 5, 5, 5], 8, 275));
  eq(r.action, 'load_up'); eq(r.next.weight_lb, 280); eq(r.next.target_reps, [5, 5, 5, 5, 5]);
});
t('5×5 hit at RPE 9 → +2.5', function () {
  var p = presc({ weight_lb: 275, target_reps: [5, 5, 5, 5, 5], rep_range: [5, 5] });
  eq(run(p, sets([5, 5, 5, 5, 5], 9, 275)).next.weight_lb, 277.5);
});
t('5×5 with a 4 on the last set → miss, same weight', function () {
  var p = presc({ weight_lb: 275, target_reps: [5, 5, 5, 5, 5], rep_range: [5, 5] });
  var r = run(p, sets([5, 5, 5, 5, 4], 10, 275));
  eq(r.action, 'miss'); eq(r.next.weight_lb, 275);
});

console.log('\nAMRAP — your pull-ups\n');

function amrap(over) {
  return presc(Object.assign({ exercise_id: PULLUP.id, slot: '2:pull-up', weight_lb: 0,
    target_reps: [null, null, null, null], rep_range: null, amrap: true }, over || {}));
}
t('first session sets the baseline', function () {
  var r = run(amrap(), sets([12, 10, 9, 8], 8, 0), PULLUP);
  eq(r.action, 'calibrated'); eq(r.next.target_reps, [12, 10, 9, 8]);
});
t('beating the total → new target', function () {
  var r = run(amrap({ target_reps: [12, 10, 9, 8] }), sets([12, 11, 9, 9], 8, 0), PULLUP);
  eq(r.action, 'add_rep'); eq(r.next.target_reps, [12, 11, 9, 9]);
});
t('not beating it → same target', function () {
  var r = run(amrap({ target_reps: [12, 10, 9, 8] }), sets([11, 10, 9, 8], 9, 0), PULLUP);
  eq(r.action, 'repeat'); eq(r.next.target_reps, [12, 10, 9, 8]);
});
t('every set at 12+ → add 5 lb and re-baseline', function () {
  var r = run(amrap({ target_reps: [13, 12, 12, 12] }), sets([14, 13, 12, 12], 8, 0), PULLUP);
  eq(r.action, 'load_up'); eq(r.next.weight_lb, 5); eq(r.next.target_reps, [null, null, null, null]);
});

console.log('\nUnknown weights\n');

t('first logged weight becomes the prescription', function () {
  var r = run(presc({ weight_lb: null }), sets([10, 10, 10, 10], 7, 90));
  eq(r.action, 'calibrated'); eq(r.next.weight_lb, 90); eq(r.next.target_reps, [10, 10, 10, 10]);
});
t('calibration happens even on a bad day', function () {
  var r = run(presc({ weight_lb: null }), sets([10, 10, 10, 10], 7, 90), BENCH, { priorMisses: 0, evaluate: false });
  eq(r.action, 'calibrated');
});

console.log('\nEdges\n');

t('missing RPE is treated as 9', function () {
  eq(run(presc({ target_reps: [12, 12, 12, 12] }), sets([12, 12, 12, 12])).action, 'load_up_half');
});
t('not evaluated on a bad day', function () {
  eq(run(presc(), sets([10, 10, 10, 10], 7), BENCH, { priorMisses: 0, evaluate: false }).action, 'not_evaluated');
});
t('the input prescription is never mutated', function () {
  var p = presc({ target_reps: [12, 12, 12, 12] }); var before = JSON.stringify(p);
  run(p, sets([12, 12, 12, 12], 7)); eq(JSON.stringify(p), before);
});

// ─── week level ─────────────────────────────────────────────────────────────

console.log('\nYour program\n');

t('week 1 is your six days, in order, Thursday off', function () {
  var w = E.initialWeek(library, CONFIG);
  eq(w.workouts.map(function (d) { return d.weekday; }),
     ['Monday', 'Tuesday', 'Wednesday', 'Friday', 'Saturday', 'Sunday']);
});
t('every exercise in program.json is in the library', function () {
  var w = E.initialWeek(library, CONFIG);
  var missing = w.warnings.filter(function (x) { return /not in the library/.test(x); });
  if (missing.length) throw new Error(missing.join('; '));
});
t('bench is 275 × 5×5 fixed; deadlift 455 × 4×3', function () {
  var w = E.initialWeek(library, CONFIG);
  var b = w.workouts[0].exercises[0], d = w.workouts[5].exercises[0];
  eq([b.weight_lb, b.target_reps, b.rep_range], [275, [5, 5, 5, 5, 5], [5, 5]]);
  eq([d.weight_lb, d.target_reps, d.rep_range], [455, [3, 3, 3, 3], [3, 3]]);
});
t('lateral raises on Monday and Friday are separate slots', function () {
  var w = E.initialWeek(library, CONFIG);
  var slots = [];
  w.workouts.forEach(function (d) { d.exercises.forEach(function (p) {
    if (p.exercise_id === 'lateral-raise') slots.push(p.slot + ' ' + p.target_reps.length + 'x' + p.target_reps[0]);
  }); });
  eq(slots, ['1:lateral-raise 3x10', '4:lateral-raise 4x12']);
});

/** n weeks where every set is hit at RPE 7, unknown weights logged as 50. */
function perfectHistory(n) {
  var history = [];
  var week = E.initialWeek(library, CONFIG);
  for (var i = 0; i < n; i++) {
    var logs = week.workouts.map(function (w) {
      return { day: w.day, completed: true, bad_day: false, exercises: w.exercises.map(function (p) {
        return { exercise_id: p.exercise_id, sets: p.target_reps.map(function (r, idx) {
          return { weight_lb: p.weight_lb === null ? 50 : p.weight_lb, reps: r === null ? 10 : r,
            rpe: idx === p.target_reps.length - 1 ? 7 : undefined };
        }) };
      }) };
    });
    history.push({ week: week, logs: logs });
    week = E.nextWeek(history, library, CONFIG);
  }
  return { history: history, next: week };
}
function slotIn(week, slot) {
  var hit = null;
  week.workouts.forEach(function (d) { d.exercises.forEach(function (p) { if (p.slot === slot) hit = p; }); });
  return hit;
}

console.log('\nWeek to week\n');

t('a perfect week puts 5 lb on the bench', function () {
  eq(slotIn(perfectHistory(1).next, '1:barbell-bench-press').weight_lb, 280);
});
t('unknown weights are filled in after week 1', function () {
  eq(slotIn(perfectHistory(1).next, '1:dip').weight_lb, 50);
});
t('a deload lands after six weeks', function () {
  var r = perfectHistory(6);
  if (!r.next.deload) throw new Error('week ' + r.next.index + ' is not a deload');
});
t('a deload does not cost the week of progress before it', function () {
  // Regression: resume used to restore the pre-deload week as logged, discarding
  // the progression that week had just earned.
  var r = perfectHistory(8);
  var before = slotIn(r.history[5].week, '1:barbell-bench-press');   // week 6, logged perfect
  var deload = r.history[6].week;
  var after = slotIn(r.history[7].week, '1:barbell-bench-press');    // week 8
  if (!deload.deload) throw new Error('expected week 7 to be the deload');
  eq(after.weight_lb, before.weight_lb + 5, 'week 8 should carry week 6\'s earned +5');
});
t('two missed sessions suppress the week', function () {
  var week = E.initialWeek(library, CONFIG);
  var logs = week.workouts.map(function (w, i) {
    return { day: w.day, completed: i >= 2, bad_day: false, exercises: w.exercises.map(function (p) {
      return { exercise_id: p.exercise_id, sets: p.target_reps.map(function (rr) {
        return { weight_lb: p.weight_lb || 50, reps: rr || 10, rpe: 7 }; }) };
    }) };
  });
  var next = E.nextWeek([{ week: week, logs: logs }], library, CONFIG);
  eq(slotIn(next, '3:barbell-back-squat').weight_lb, 315, 'squat frozen');
});
t('nextWeek is pure', function () {
  var r = perfectHistory(3);
  eq(JSON.stringify(E.nextWeek(r.history, library, CONFIG)),
     JSON.stringify(E.nextWeek(r.history, library, CONFIG)));
});
t('config is actually honoured (rpe_gate passed in, not read from module scope)', function () {
  var strict = Object.assign({}, CONFIG, { rpe_gate: 7 });
  var p = presc({ target_reps: [12, 12, 12, 12] });
  eq(E.progressExercise(p, sets([12, 12, 12, 12], 8), BENCH, CTX, strict).action, 'repeat');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
process.exit(failed ? 1 : 0);
