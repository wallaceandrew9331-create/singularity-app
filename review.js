#!/usr/bin/env node
/**
 * Validates exercise-library.json against the schema in exercise.ts, then prints
 * the fields that need your judgment.
 *
 *   node review.js          validate + review table
 *   node review.js --subs   also show what the hand-authored substitutions resolve to
 *
 * Plain CommonJS, no dependencies — runs on the Node 10 already on this machine.
 */

var fs = require('fs');
var path = require('path');

var PATTERNS = [
  'squat', 'hinge', 'lunge', 'horizontal_push', 'vertical_push',
  'horizontal_pull', 'vertical_pull', 'carry', 'rotation',
  'anti_rotation', 'anti_extension', 'flexion', 'gait'
];
var JOINTS = ['knee', 'back', 'shoulder', 'hip', 'elbow', 'wrist', 'ankle'];
var ROLES = ['primary', 'accessory', 'isolation'];
var UNITS = ['reps', 'time', 'distance'];

var REQUIRED = [
  'id', 'name', 'aliases', 'components', 'role', 'unilateral', 'velocity',
  'equipment', 'skill_demand', 'joint_stress', 'primary_muscles',
  'secondary_muscles', 'prescription_unit', 'viable_reps', 'default_rest_sec',
  'setup', 'cue', 'tags'
];

var lib = JSON.parse(fs.readFileSync(path.join(__dirname, 'exercise-library.json'), 'utf8'));
var exercises = lib.exercises;
var byId = {};
exercises.forEach(function (e) { byId[e.id] = e; });

var errors = [];
var warnings = [];

// ── Validation ──────────────────────────────────────────────────────────────

var seenNames = {};

exercises.forEach(function (e) {
  var where = e.id || '(missing id)';

  REQUIRED.forEach(function (f) {
    if (!(f in e)) errors.push(where + ': missing required field `' + f + '`');
  });

  if (e.id && !/^[a-z0-9-]+$/.test(e.id)) {
    errors.push(where + ': id must be a lowercase slug');
  }

  if (ROLES.indexOf(e.role) === -1) errors.push(where + ': bad role `' + e.role + '`');
  if (UNITS.indexOf(e.prescription_unit) === -1) {
    errors.push(where + ': bad prescription_unit `' + e.prescription_unit + '`');
  }
  if (['grind', 'ballistic'].indexOf(e.velocity) === -1) {
    errors.push(where + ': bad velocity `' + e.velocity + '`');
  }
  if (!(e.skill_demand >= 1 && e.skill_demand <= 5)) {
    errors.push(where + ': skill_demand must be 1-5');
  }

  // components
  var sum = 0;
  (e.components || []).forEach(function (c) {
    if (PATTERNS.indexOf(c.pattern) === -1) {
      errors.push(where + ': unknown pattern `' + c.pattern + '`');
    }
    sum += c.emphasis;
  });
  if (!e.components || e.components.length === 0) {
    errors.push(where + ': needs at least one component');
  } else if (Math.abs(sum - 1) > 0.001) {
    errors.push(where + ': component emphasis sums to ' + sum.toFixed(2) + ', must be 1.0');
  }

  // joint stress
  Object.keys(e.joint_stress || {}).forEach(function (j) {
    if (JOINTS.indexOf(j) === -1) errors.push(where + ': unknown joint `' + j + '`');
    var v = e.joint_stress[j];
    if (!(v >= 0 && v <= 3)) errors.push(where + ': joint_stress.' + j + ' must be 0-3');
  });

  // prescription coherence
  if (e.prescription_unit === 'reps') {
    if (!Array.isArray(e.viable_reps)) {
      errors.push(where + ': unit is `reps` but viable_reps is not a range');
    } else if (e.viable_reps[0] > e.viable_reps[1]) {
      errors.push(where + ': viable_reps range is inverted');
    }
  } else if (e.viable_reps !== null) {
    warnings.push(where + ': unit is `' + e.prescription_unit + '` — viable_reps should be null');
  }
  if (e.prescription_unit === 'time' && !e.viable_duration_sec) {
    errors.push(where + ': unit is `time` but viable_duration_sec is missing');
  }

  // substitution targets must resolve
  var subs = e.substitutions || {};
  ['lateral', 'regress', 'progress'].forEach(function (k) {
    (subs[k] || []).forEach(function (id) {
      if (!byId[id]) errors.push(where + ': substitutions.' + k + ' -> unknown id `' + id + '`');
    });
  });
  (subs.decompose || []).forEach(function (set) {
    set.forEach(function (id) {
      if (!byId[id]) errors.push(where + ': substitutions.decompose -> unknown id `' + id + '`');
    });
  });

  // role sanity: a primary should not be the regression target of an isolation, etc.
  ['lateral', 'regress', 'progress'].forEach(function (k) {
    (subs[k] || []).forEach(function (id) {
      var t = byId[id];
      if (t && t.role !== e.role && k === 'lateral') {
        warnings.push(where + ': lateral swap to `' + id + '` crosses role (' +
          e.role + ' -> ' + t.role + ')');
      }
    });
  });

  // duplicate display names across ids
  [e.name].concat(e.aliases || []).forEach(function (n) {
    var key = n.trim().toLowerCase();
    if (seenNames[key] && seenNames[key] !== e.id) {
      errors.push('name collision: "' + n + '" claimed by both `' +
        seenNames[key] + '` and `' + e.id + '`');
    }
    seenNames[key] = e.id;
  });
});

// ── Report ──────────────────────────────────────────────────────────────────

function pad(s, n) {
  s = String(s);
  return s.length >= n ? s.slice(0, n) : s + Array(n - s.length + 1).join(' ');
}

console.log('\n' + exercises.length + ' exercises\n');

if (errors.length) {
  console.log('ERRORS (' + errors.length + ')');
  errors.forEach(function (e) { console.log('  ✗ ' + e); });
  console.log('');
}
if (warnings.length) {
  console.log('WARNINGS (' + warnings.length + ')');
  warnings.forEach(function (w) { console.log('  ! ' + w); });
  console.log('');
}
if (!errors.length && !warnings.length) console.log('Schema: clean.\n');

// Coverage
var byPattern = {};
var byRole = {};
exercises.forEach(function (e) {
  byRole[e.role] = (byRole[e.role] || 0) + 1;
  e.components.forEach(function (c) {
    byPattern[c.pattern] = (byPattern[c.pattern] || 0) + 1;
  });
});

console.log('COVERAGE BY PATTERN  (thin patterns give the swap engine nothing to work with)');
PATTERNS.forEach(function (p) {
  var n = byPattern[p] || 0;
  var flag = n === 0 ? '  <- empty' : (n < 3 ? '  <- thin' : '');
  console.log('  ' + pad(p, 18) + pad(n, 4) + flag);
});
console.log('\nBY ROLE');
ROLES.forEach(function (r) { console.log('  ' + pad(r, 18) + (byRole[r] || 0)); });

// The review table
console.log('\n\nREVIEW — these are my drafts. Correct them.\n');
console.log('  ' + pad('exercise', 34) + pad('skill', 7) + pad('reps', 10) + 'joint stress');
console.log('  ' + Array(86).join('-'));

exercises.slice().sort(function (a, b) {
  return a.components[0].pattern.localeCompare(b.components[0].pattern) ||
    a.name.localeCompare(b.name);
}).forEach(function (e) {
  var js = JOINTS.filter(function (j) { return e.joint_stress[j]; })
    .map(function (j) { return j + ':' + e.joint_stress[j]; })
    .join(' ');
  var reps = e.viable_reps ? e.viable_reps[0] + '-' + e.viable_reps[1] :
    (e.viable_duration_sec ? e.viable_duration_sec[0] + '-' + e.viable_duration_sec[1] + 's' : '—');
  console.log('  ' + pad(e.name, 34) + pad(e.skill_demand, 7) + pad(reps, 10) + js);
});

var noCue = exercises.filter(function (e) { return !e.cue; }).length;
console.log('\n' + noCue + ' of ' + exercises.length + ' entries have an empty `cue` — that field is yours.\n');

// ── Optional: resolve the hand-authored substitutions ───────────────────────

if (process.argv.indexOf('--subs') !== -1) {
  console.log('\nHAND-AUTHORED SUBSTITUTIONS\n');
  exercises.forEach(function (e) {
    var subs = e.substitutions || {};
    var keys = Object.keys(subs).filter(function (k) {
      return subs[k] && subs[k].length;
    });
    if (!keys.length) return;
    console.log('  ' + e.name);
    keys.forEach(function (k) {
      if (k === 'decompose') {
        subs[k].forEach(function (set) {
          console.log('    decompose  ' + set.map(function (id) {
            return byId[id].name;
          }).join('  +  '));
        });
      } else {
        console.log('    ' + pad(k, 11) + subs[k].map(function (id) {
          return byId[id].name;
        }).join(', '));
      }
    });
  });
  console.log('');
}

process.exit(errors.length ? 1 : 0);
