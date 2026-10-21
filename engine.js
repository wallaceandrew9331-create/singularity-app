#!/usr/bin/env node
/**
 * Singularity progression engine.
 *
 *     nextWeek(history, library, config) -> Week
 *
 * history is [{ week, logs }, ...] oldest first. PURE: no dates, no randomness,
 * no mutation of inputs. That is what lets you change a constant and replay real
 * logs to see what a different rule would have done. Keep it pure.
 *
 * The week structure comes from program.json — your actual split. The engine
 * does not choose exercises; it decides what each of your exercises does next.
 *
 * Runs in Node (tests, simulation) and in the browser (the PWA). ES2018.
 */

'use strict';

var fs = null, path = null;
if (typeof window === 'undefined' && typeof require === 'function') {
  fs = require('fs');
  path = require('path');
}

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────────────────────

var CONFIG = {
  /** Progress at full increment at or below this RPE. */
  rpe_gate: 8,
  /** Assumed RPE when none was logged. Conservative: progresses at half rate. */
  rpe_when_missing: 9,

  /**
   * Prescriptions at or below this many reps are FIXED (5×5, 4×3): hit every
   * rep at RPE ≤ gate and the weight goes up next week. Above it, your number is
   * the bottom of a range RANGE_WIDTH wide (4×10 → 10–12), climbed a rep at a
   * time across every set before the weight goes up.
   */
  fixed_reps_max: 5,
  range_width: 2,

  /** AMRAP: once every set reaches this, add load and re-baseline. */
  amrap_add_load_at: 12,

  heavy_rest_sec: 180,

  deload_every_weeks: 6,
  deload_load_factor: 0.85,
  deload_volume_factor: 0.6,
  deload_rpe_cap: 6,
  /** Simultaneous primary-lift deloads that force an early program deload. */
  deload_primary_failures: 2,

  exercise_deload_factor: 0.90,
  stall_sessions: 3,

  bad_day_rpe_cap: 7,

  balance: {
    push_pull_min: 0.8,
    push_pull_max: 1.2,
    min_weighted_sets: 6,
    max_pattern_share: 0.30
  },

  /** Set by the caller: the contents of program.json. */
  program: null
};

// ─────────────────────────────────────────────────────────────────────────────
// Loading (Node only — the browser fetches and passes these in)
// ─────────────────────────────────────────────────────────────────────────────

function loadLibrary(file) {
  var p = file || path.join(__dirname, 'exercise-library.json');
  return JSON.parse(fs.readFileSync(p, 'utf8')).exercises;
}

function loadProgram(file) {
  var p = file || path.join(__dirname, 'program.json');
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function indexById(library) {
  var m = {};
  library.forEach(function (e) { m[e.id] = e; });
  return m;
}

// ─────────────────────────────────────────────────────────────────────────────
// Week 1 — straight from the program
// ─────────────────────────────────────────────────────────────────────────────

function rangeFor(reps, config) {
  if (reps <= config.fixed_reps_max) return [reps, reps];
  return [reps, reps + config.range_width];
}

function initialWeek(library, config) {
  config = config || CONFIG;
  if (!config.program) throw new Error('config.program is required — load program.json');
  var byId = indexById(library);
  var warnings = [];

  var workouts = config.program.days.map(function (d, di) {
    var day = di + 1;
    var exercises = [];

    d.exercises.forEach(function (x, i) {
      var ex = byId[x.exercise_id];
      if (!ex) {
        warnings.push(d.weekday + ': "' + x.exercise_id + '" is not in the library — skipped.');
        return;
      }
      var amrap = x.reps === 'amrap';
      var range = amrap ? null : rangeFor(x.reps, config);
      var targets = [];
      for (var s = 0; s < x.sets; s++) targets.push(amrap ? null : range[0]);
      var known = x.weight_lb !== null && x.weight_lb !== undefined;

      exercises.push({
        exercise_id: ex.id,
        slot: day + ':' + ex.id,   // the same lift can appear on two days
        order: i + 1,
        weight_lb: known ? x.weight_lb : null,
        target_reps: targets,
        rep_range: range,
        amrap: amrap,
        rest_sec: (!amrap && range[0] <= config.fixed_reps_max) ? config.heavy_rest_sec : ex.default_rest_sec,
        target_rpe: config.rpe_gate,
        note: !known ? 'first session — enter your weight' : (amrap ? 'first session sets the baseline' : '')
      });
    });

    return { day: day, weekday: d.weekday, name: d.name, exercises: exercises };
  });

  var week = { index: 1, deload: false, workouts: workouts, warnings: warnings, transition: {} };
  week.warnings = week.warnings.concat(balanceCheck(week, byId, config));
  return week;
}

// ─────────────────────────────────────────────────────────────────────────────
// The core rule
// ─────────────────────────────────────────────────────────────────────────────

function clonePrescription(p) {
  var n = {};
  Object.keys(p).forEach(function (k) { n[k] = p[k]; });
  n.target_reps = p.target_reps.slice();
  n.rep_range = p.rep_range ? p.rep_range.slice() : null;
  n.note = '';
  delete n.temp_swap_of;
  return n;
}

function lastLoggedSet(log) {
  for (var i = log.sets.length - 1; i >= 0; i--) if (log.sets[i]) return log.sets[i];
  return null;
}

function firstWeight(log) {
  for (var i = 0; i < log.sets.length; i++) {
    var s = log.sets[i];
    if (s && typeof s.weight_lb === 'number') return s.weight_lb;
  }
  return null;
}

/**
 * Decide what one prescription does next week.
 *
 * Actions:
 *   load_up / load_up_half   weight goes up, reps reset to the bottom
 *   add_rep                  same weight, one more rep on every set
 *   repeat                   unchanged (RPE 10, or RPE 9 with no half step)
 *   miss                     reps missed for the first time — unchanged
 *   deload                   reps missed twice running — weight × 0.90
 *   calibrated               first session for an unknown weight / AMRAP baseline
 *   not_evaluated            missed session, bad day, deload, or nothing logged
 */
function progressExercise(presc, log, ex, ctx, config) {
  config = config || CONFIG;
  var next = clonePrescription(presc);
  var hasSets = log && log.sets && log.sets.some(Boolean);
  if (!hasSets) return { action: 'not_evaluated', next: next };

  var achieved = presc.target_reps.map(function (t, i) {
    return log.sets[i] ? log.sets[i].reps : 0;
  });

  // Calibration happens even on a bad day — knowing the weight is never wrong.
  if (presc.weight_lb === null) {
    var w = firstWeight(log);
    if (w === null) return { action: 'not_evaluated', next: next };
    next.weight_lb = w;
    if (presc.amrap) next.target_reps = achieved;
    next.note = 'weight set from your first session';
    return { action: 'calibrated', next: next };
  }
  if (presc.amrap && presc.target_reps.some(function (t) { return t === null; })) {
    next.target_reps = achieved;
    next.note = 'baseline: ' + sum(achieved) + ' total reps';
    return { action: 'calibrated', next: next };
  }

  if (!ctx.evaluate) return { action: 'not_evaluated', next: next };

  var last = lastLoggedSet(log);
  var rpe = (last && typeof last.rpe === 'number') ? last.rpe : config.rpe_when_missing;

  if (presc.amrap) return progressAmrap(presc, next, achieved, rpe, ex, config);

  var top = presc.rep_range[1];
  var bottom = presc.rep_range[0];
  var capped = achieved.map(function (a) { return Math.min(a, top); });
  var hit = capped.every(function (a, i) { return a >= presc.target_reps[i]; });
  var topped = capped.every(function (a) { return a >= top; });

  if (!hit) {
    if (ctx.priorMisses >= 1) {
      next.weight_lb = roundLoad(presc.weight_lb * config.exercise_deload_factor, ex);
      next.target_reps = presc.target_reps.map(function () { return bottom; });
      next.note = 'deload — missed reps two weeks running';
      return { action: 'deload', next: next };
    }
    next.note = 'repeat — missed reps last time';
    return { action: 'miss', next: next };
  }

  if (topped) {
    if (rpe <= config.rpe_gate) {
      next.weight_lb = presc.weight_lb + ex.load_increment_lb;
      next.target_reps = presc.target_reps.map(function () { return bottom; });
      next.note = '+' + ex.load_increment_lb + ' lb';
      return { action: 'load_up', next: next };
    }
    if (rpe === 9 && ex.half_increment_lb) {
      next.weight_lb = presc.weight_lb + ex.half_increment_lb;
      next.target_reps = presc.target_reps.map(function () { return bottom; });
      next.note = '+' + ex.half_increment_lb + ' lb (RPE 9)';
      return { action: 'load_up_half', next: next };
    }
    next.note = rpe === 9 ? 'held — RPE 9, no smaller jump available' : 'held — RPE 10';
    return { action: 'repeat', next: next };
  }

  if (rpe <= 9) {
    next.target_reps = capped.map(function (r) { return Math.min(r + 1, top); });
    next.note = '+1 rep';
    return { action: 'add_rep', next: next };
  }
  next.note = 'held — RPE 10';
  return { action: 'repeat', next: next };
}

function progressAmrap(presc, next, achieved, rpe, ex, config) {
  var total = sum(achieved);
  var prev = sum(presc.target_reps);

  if (achieved.every(function (r) { return r >= config.amrap_add_load_at; }) && rpe <= config.rpe_gate) {
    next.weight_lb = presc.weight_lb + ex.load_increment_lb;
    next.target_reps = presc.target_reps.map(function () { return null; });
    next.note = '+' + ex.load_increment_lb + ' lb — next session sets a new baseline';
    return { action: 'load_up', next: next };
  }
  if (total > prev) {
    next.target_reps = achieved;
    next.note = '+' + (total - prev) + ' reps — beat ' + total;
    return { action: 'add_rep', next: next };
  }
  next.note = 'beat ' + prev + ' total reps';
  return { action: 'repeat', next: next };
}

function sum(a) { return a.reduce(function (s, x) { return s + (x || 0); }, 0); }

/** Round to something loadable: nearest half-increment, else nearest 5. */
function roundLoad(lb, ex) {
  var step = ex.half_increment_lb || 5;
  return Math.round(lb / step) * step;
}

// ─────────────────────────────────────────────────────────────────────────────
// History queries
//
// Each week carries `transition`: slot -> the action that produced it from the
// week before. So history[k].week.transition is the outcome of logging week k-1.
// ─────────────────────────────────────────────────────────────────────────────

function weeksSinceDeload(history) {
  var n = 0;
  for (var i = history.length - 1; i >= 0; i--) {
    if (history[i].week.deload) return n;
    n++;
  }
  return n;
}

/** Consecutive 'miss'/'deload' outcomes immediately before the week being evaluated. */
function priorMissCount(history, slot) {
  var n = 0;
  for (var k = history.length - 1; k >= 0; k--) {
    var a = (history[k].week.transition || {})[slot];
    if (a === 'miss' || a === 'deload') n++;
    else if (a && a !== 'not_evaluated') break;
  }
  return n;
}

function stalled(history, slot, config) {
  config = config || CONFIG;
  var n = 0;
  for (var k = history.length - 1; k >= 0; k--) {
    var a = (history[k].week.transition || {})[slot];
    if (a === 'repeat' || a === 'miss') n++;
    else if (a && a !== 'not_evaluated') break;
  }
  return n >= config.stall_sessions;
}

// ─────────────────────────────────────────────────────────────────────────────
// Next week
// ─────────────────────────────────────────────────────────────────────────────

function cloneWorkouts(workouts, note) {
  return workouts.map(function (w) {
    return {
      day: w.day, weekday: w.weekday, name: w.name,
      exercises: w.exercises.map(function (p) {
        var n = clonePrescription(p.temp_swap_of || p);
        n.note = note !== undefined ? note : p.note;
        return n;
      })
    };
  });
}

function nextWeek(history, library, config) {
  config = config || CONFIG;
  if (!history || !history.length) return initialWeek(library, config);

  var byId = indexById(library);
  var prev = history[history.length - 1];
  var prevWeek = prev.week;

  var logByDay = {};
  (prev.logs || []).forEach(function (l) { logByDay[l.day] = l; });

  // Out of a deload: resume exactly where progression had got to. `resume` is
  // stored on the deload week at the moment it was created, so the progression
  // earned in the week before the deload is kept, not thrown away.
  if (prevWeek.deload) {
    var resumed = {
      index: prevWeek.index + 1,
      deload: false,
      workouts: cloneWorkouts(prevWeek.resume || prevWeek.workouts, 'resumed after deload'),
      warnings: [],
      transition: {},
      parked: copyParked(prevWeek.parked)
    };
    // calibrations made during the deload week still count
    resumed.workouts.forEach(function (w) {
      var log = logByDay[w.day];
      if (!log || !log.exercises) return;
      w.exercises.forEach(function (p) {
        if (p.weight_lb !== null) return;
        var l = log.exercises.filter(function (e) { return e.exercise_id === p.exercise_id; })[0];
        var wt = l && l.sets ? firstWeight(l) : null;
        if (wt !== null) { p.weight_lb = wt; p.note = 'weight set during deload'; }
      });
    });
    resumed.warnings = balanceCheck(resumed, byId, config);
    return resumed;
  }

  var missed = prevWeek.workouts.filter(function (w) {
    var l = logByDay[w.day];
    return !l || l.completed === false;
  }).length;
  var suppressWeek = missed >= 2;

  var transition = {};
  var primaryFailures = 0;
  var parked = copyParked(prevWeek.parked);

  var workouts = prevWeek.workouts.map(function (w) {
    var log = logByDay[w.day];
    var evaluate = !!(log && log.completed !== false && !log.bad_day && !suppressWeek);

    var logByExercise = {};
    if (log && log.exercises) log.exercises.forEach(function (e) { logByExercise[e.exercise_id] = e; });

    return {
      day: w.day, weekday: w.weekday, name: w.name,
      exercises: w.exercises.map(function (p) {
        // A today-only swap: the replacement progresses on its own and is parked;
        // the original comes back next week exactly as it was.
        if (p.temp_swap_of) {
          var repl = stripSwap(p);
          var rr = progressExercise(repl, logByExercise[repl.exercise_id], byId[repl.exercise_id], {
            priorMisses: priorMissCount(history, repl.slot),
            evaluate: evaluate
          }, config);
          transition[repl.slot] = rr.action;
          parked[repl.slot] = rr.next;
          var orig = clonePrescription(p.temp_swap_of);
          orig.note = 'back after a one-off swap';
          transition[orig.slot] = 'not_evaluated';
          return orig;
        }

        var ex = byId[p.exercise_id];
        var r = progressExercise(p, logByExercise[p.exercise_id], ex, {
          priorMisses: priorMissCount(history, p.slot),
          evaluate: evaluate
        }, config);
        transition[p.slot] = r.action;
        if (r.action === 'deload' && ex.role === 'primary') primaryFailures++;
        return r.next;
      })
    };
  });

  var week = { index: prevWeek.index + 1, deload: false, workouts: workouts, warnings: [],
    transition: transition, parked: parked };

  var due = weeksSinceDeload(history) >= config.deload_every_weeks;
  if (due || primaryFailures >= config.deload_primary_failures) {
    var resume = week.workouts;
    week = applyDeload(week, byId, config);
    week.resume = resume;
    week.warnings.push(due
      ? 'Deload week — ' + config.deload_every_weeks + ' weeks since the last one.'
      : 'Deload week — ' + primaryFailures + ' primary lifts failed in the same week.');
  }

  if (suppressWeek) week.warnings.push(missed + ' sessions missed last week — no progression evaluated.');

  week.warnings = week.warnings.concat(balanceCheck(week, byId, config));
  return week;
}

function applyDeload(week, byId, config) {
  return {
    index: week.index,
    deload: true,
    transition: week.transition,
    parked: week.parked,
    warnings: week.warnings.slice(),
    workouts: week.workouts.map(function (w) {
      return {
        day: w.day, weekday: w.weekday, name: w.name,
        exercises: w.exercises.map(function (p) {
          var ex = byId[p.exercise_id];
          var n = clonePrescription(p);
          var sets = Math.max(2, Math.round(p.target_reps.length * config.deload_volume_factor));
          n.target_reps = p.target_reps.slice(0, sets).map(function (t) {
            return p.amrap ? t : p.rep_range[0];
          });
          if (p.weight_lb !== null) n.weight_lb = roundLoad(p.weight_lb * config.deload_load_factor, ex);
          n.target_rpe = config.deload_rpe_cap;
          n.note = p.amrap ? 'deload — stop 2–3 reps short' : 'deload';
          return n;
        })
      };
    })
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Swaps
//
// Every swap gives the replacement its own slot (day:exercise_id), so it
// progresses independently. Whatever is swapped out is parked on the week with
// its progression intact; swapping back resumes it. Parked prescriptions ride
// along from week to week untouched until they're used again.
// ─────────────────────────────────────────────────────────────────────────────

function copyParked(parked) {
  var out = {};
  Object.keys(parked || {}).forEach(function (k) { out[k] = clonePrescription(parked[k]); });
  return out;
}

function stripSwap(p) {
  var n = clonePrescription(p);
  n.note = p.note;
  return n;
}

var SWAP_REASON = { lateral: 'Similar', regress: 'Easier', progress: 'Harder' };

/**
 * Ranked replacements for an exercise. Your hand-authored substitutions come
 * first; then anything training the same primary pattern, preferring the same
 * role and overlapping muscles. Lifts already in the day are excluded.
 */
function swapCandidates(exerciseId, library, excludeIds) {
  var byId = indexById(library);
  var orig = byId[exerciseId];
  var skip = {};
  (excludeIds || []).concat([exerciseId]).forEach(function (id) { skip[id] = true; });
  var out = [];

  var subs = orig.substitutions || {};
  ['lateral', 'regress', 'progress'].forEach(function (k) {
    (subs[k] || []).forEach(function (id) {
      if (skip[id] || !byId[id]) return;
      skip[id] = true;
      out.push({ exercise: byId[id], reason: SWAP_REASON[k] });
    });
  });

  var pattern = orig.components[0].pattern;
  var computed = library.filter(function (e) {
    return !skip[e.id] && e.prescription_unit === 'reps' && e.components[0].pattern === pattern;
  }).map(function (e) {
    var overlap = e.primary_muscles.filter(function (m) { return orig.primary_muscles.indexOf(m) !== -1; }).length;
    var score = (e.role === orig.role ? 3 : 0) + overlap * 2;
    return { exercise: e, score: score, reason: overlap ? 'Same muscles' : 'Same movement' };
  });
  computed.sort(function (a, b) { return b.score - a.score || a.exercise.name.localeCompare(b.exercise.name); });
  computed.slice(0, 8).forEach(function (c) { out.push({ exercise: c.exercise, reason: c.reason }); });
  return out;
}

/** Every prescription in a week, including parked ones and ones hidden behind a swap. */
function allPrescriptions(week) {
  var out = [];
  week.workouts.forEach(function (w) {
    w.exercises.forEach(function (p) { out.push(p); if (p.temp_swap_of) out.push(p.temp_swap_of); });
  });
  Object.keys(week.parked || {}).forEach(function (k) { out.push(week.parked[k]); });
  return out;
}

function buildReplacement(orig, newEx, day, week, config) {
  var slot = day + ':' + newEx.id;
  var p;
  // same lift done on another day? start from that weight instead of asking
  var known = allPrescriptions(week).filter(function (x) {
    return x.exercise_id === newEx.id && x.weight_lb !== null;
  })[0];
  if (week.parked && week.parked[slot]) {
    p = clonePrescription(week.parked[slot]);
    p.note = 'swapped in — picks up where it left off';
    if (p.weight_lb === null && known) p.weight_lb = known.weight_lb;
  } else {
    var vr = newEx.viable_reps;
    var base = orig.amrap ? 8 : orig.rep_range[0];
    base = Math.max(vr[0], Math.min(base, vr[1]));
    var range = rangeFor(base, config);
    range[1] = Math.max(range[0], Math.min(range[1], vr[1]));
    p = {
      exercise_id: newEx.id, slot: slot, order: orig.order,
      weight_lb: known ? known.weight_lb : null,
      target_reps: orig.target_reps.map(function () { return range[0]; }),
      rep_range: range, amrap: false,
      rest_sec: range[0] <= config.fixed_reps_max ? config.heavy_rest_sec : newEx.default_rest_sec,
      target_rpe: orig.target_rpe,
      note: known ? 'swapped in — starting from the weight you use elsewhere'
        : 'swapped in — enter your weight'
    };
  }
  p.order = orig.order;
  if (week.deload) {
    p.target_reps = p.target_reps.slice(0, orig.target_reps.length);
    while (p.target_reps.length < orig.target_reps.length) p.target_reps.push(p.target_reps[0]);
    if (p.weight_lb !== null) p.weight_lb = roundLoad(p.weight_lb * config.deload_load_factor, newEx);
    p.target_rpe = orig.target_rpe;
  }
  return p;
}

function cloneWeek(week) {
  var w = JSON.parse(JSON.stringify(week));
  w.parked = w.parked || {};
  return w;
}

/**
 * Swap one exercise in a day. Returns a new week; never mutates the input.
 * `permanent` false = today only; true = from now on.
 */
function swapExercise(week, day, exerciseId, newId, library, config, permanent) {
  config = config || CONFIG;
  var byId = indexById(library);
  var out = cloneWeek(week);
  var workout = out.workouts[day - 1];
  var idx = -1;
  workout.exercises.forEach(function (p, i) { if (p.exercise_id === exerciseId) idx = i; });
  if (idx === -1) throw new Error(exerciseId + ' is not in day ' + day);

  var current = workout.exercises[idx];
  var orig = current.temp_swap_of || current;     // swapping a swap replaces the swap
  if (current.temp_swap_of) out.parked[current.slot] = stripSwap(current);

  var repl = buildReplacement(orig, byId[newId], day, out, config);
  delete out.parked[repl.slot];

  if (permanent) {
    out.parked[orig.slot] = clonePrescription(orig);
    workout.exercises[idx] = repl;
    // a deload week resumes from `resume`; make the change stick there too
    if (out.resume) {
      var rw = out.resume[day - 1];
      rw.exercises.forEach(function (p, i) {
        if (p.slot !== orig.slot) return;
        out.parked[orig.slot] = clonePrescription(p);
        var un = buildReplacement(p, byId[newId], day, { parked: week.parked, workouts: out.resume }, config);
        rw.exercises[i] = un;
      });
    }
  } else {
    repl.temp_swap_of = clonePrescription(orig);
    workout.exercises[idx] = repl;
  }
  return out;
}

/** Undo a today-only swap: the original returns, the replacement is parked. */
function undoSwap(week, day, exerciseId) {
  var out = cloneWeek(week);
  var ex = out.workouts[day - 1].exercises;
  ex.forEach(function (p, i) {
    if (p.exercise_id !== exerciseId || !p.temp_swap_of) return;
    out.parked[p.slot] = stripSwap(p);
    ex[i] = clonePrescription(p.temp_swap_of);
  });
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Bad day — §7
// ─────────────────────────────────────────────────────────────────────────────

/**
 * What a bad day actually trains: everything but the last isolation exercise,
 * with target RPE capped. Display only — progression is already switched off
 * for the session by nextWeek().
 */
function badDaySession(workout, byId, config) {
  config = config || CONFIG;
  var dropIdx = -1;
  workout.exercises.forEach(function (p, i) {
    if (byId[p.exercise_id] && byId[p.exercise_id].role === 'isolation') dropIdx = i;
  });
  return {
    dropped: dropIdx === -1 ? null : workout.exercises[dropIdx],
    exercises: workout.exercises.filter(function (p, i) { return i !== dropIdx; }).map(function (p) {
      var n = Object.assign({}, p);
      n.target_rpe = Math.min(p.target_rpe, config.bad_day_rpe_cap);
      return n;
    })
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Balance check — warnings only, never changes the week
// ─────────────────────────────────────────────────────────────────────────────

function weeklyVolume(week, byId) {
  var vol = {};
  week.workouts.forEach(function (w) {
    w.exercises.forEach(function (p) {
      var ex = byId[p.exercise_id];
      if (!ex) return;
      ex.components.forEach(function (c) {
        vol[c.pattern] = (vol[c.pattern] || 0) + p.target_reps.length * c.emphasis;
      });
    });
  });
  return vol;
}

function balanceCheck(week, byId, config) {
  var cfg = (config || CONFIG).balance;
  var vol = weeklyVolume(week, byId);
  var warnings = [];

  var push = (vol.horizontal_push || 0) + (vol.vertical_push || 0);
  var pull = (vol.horizontal_pull || 0) + (vol.vertical_pull || 0);
  if (pull > 0) {
    var ratio = push / pull;
    if (ratio < cfg.push_pull_min || ratio > cfg.push_pull_max) {
      warnings.push('push:pull is ' + ratio.toFixed(2) + ' (' + push.toFixed(0) + ' vs ' +
        pull.toFixed(0) + ' weighted sets) — outside ' + cfg.push_pull_min + '–' + cfg.push_pull_max + '.');
    }
  }

  if (!week.deload) {
    ['squat', 'hinge', 'horizontal_push', 'horizontal_pull'].forEach(function (p) {
      var v = vol[p] || 0;
      if (v < cfg.min_weighted_sets) {
        warnings.push(p + ' is ' + v.toFixed(1) + ' weighted sets — below ' + cfg.min_weighted_sets + '.');
      }
    });
  }

  var total = Object.keys(vol).reduce(function (s, k) { return s + vol[k]; }, 0);
  Object.keys(vol).forEach(function (p) {
    if (total > 0 && vol[p] / total > cfg.max_pattern_share) {
      warnings.push(p + ' is ' + Math.round(100 * vol[p] / total) + '% of weekly volume — above ' +
        Math.round(100 * cfg.max_pattern_share) + '%.');
    }
  });

  return warnings;
}

var API = {
  CONFIG: CONFIG,
  loadLibrary: loadLibrary,
  loadProgram: loadProgram,
  indexById: indexById,
  rangeFor: rangeFor,
  initialWeek: initialWeek,
  progressExercise: progressExercise,
  nextWeek: nextWeek,
  weeklyVolume: weeklyVolume,
  balanceCheck: balanceCheck,
  stalled: stalled,
  roundLoad: roundLoad,
  swapCandidates: swapCandidates,
  swapExercise: swapExercise,
  undoSwap: undoSwap,
  badDaySession: badDaySession
};

if (typeof module === 'object' && module.exports) module.exports = API;
if (typeof window !== 'undefined') window.Engine = API;
