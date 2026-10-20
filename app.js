/**
 * Singularity PWA.
 *
 * No framework, no build step. State lives in localStorage on the device —
 * there is no server, which is why it works in a gym with no signal. Clearing
 * site data destroys your history, so Data → Export exists; use it.
 *
 * The program comes from program.json. The engine decides what each exercise
 * does next week; this file only displays it and records what you lifted.
 */

'use strict';

var KEY = 'singularity.v2';
var WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
var LIB = null, BYID = null, PROGRAM = null, CONFIG = null, state = null;

// ─── persistence ────────────────────────────────────────────────────────────

function load() {
  try { var raw = localStorage.getItem(KEY); return raw ? JSON.parse(raw) : null; }
  catch (e) { return null; }
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); }
  catch (e) { alert('Could not save: ' + e.message); }
}

// ─── helpers ────────────────────────────────────────────────────────────────

function fmt(n) {
  if (n === null || n === undefined || isNaN(n)) return '?';
  return (Math.round(n * 10) / 10).toString();
}
function esc(s) {
  return String(s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  });
}
function total(a) { return a.reduce(function (s, x) { return s + (x || 0); }, 0); }

function targetLabel(p) {
  var t = p.target_reps;
  if (p.amrap) return t.length + ' × AMRAP' + (t[0] === null ? '' : ' · beat ' + total(t));
  var even = t.every(function (r) { return r === t[0]; });
  return t.length + ' × ' + (even ? t[0] : t.join('/'));
}

function currentWorkout() { return state.week.workouts[state.day - 1]; }

function findPresc(exerciseId) {
  var p = null;
  currentWorkout().exercises.forEach(function (x) { if (x.exercise_id === exerciseId) p = x; });
  return p;
}

function dayLog(day) {
  if (!state.logs[day]) state.logs[day] = { day: day, completed: null, bad_day: false, exercises: [] };
  return state.logs[day];
}

function exLog(day, exerciseId, setCount) {
  var l = dayLog(day);
  for (var i = 0; i < l.exercises.length; i++) {
    if (l.exercises[i].exercise_id === exerciseId) return l.exercises[i];
  }
  var sets = [];
  for (var s = 0; s < setCount; s++) sets.push(null);
  var rec = { exercise_id: exerciseId, sets: sets };
  l.exercises.push(rec);
  return rec;
}

/** Weight to pre-fill for a set: the prescription, else what you used earlier this session. */
function defaultWeight(p, rec) {
  if (p.weight_lb !== null) return p.weight_lb;
  for (var i = rec.sets.length - 1; i >= 0; i--) {
    if (rec.sets[i] && typeof rec.sets[i].weight_lb === 'number') return rec.sets[i].weight_lb;
  }
  return null;
}

function dayStatus(day) {
  var l = state.logs[day];
  if (!l) return 'pending';
  if (l.completed === false) return 'skipped';
  if (l.completed === true) return 'done';
  return 'started';
}

function allDaysResolved() {
  for (var d = 1; d <= state.week.workouts.length; d++) {
    var s = dayStatus(d);
    if (s !== 'done' && s !== 'skipped') return false;
  }
  return true;
}

// ─── sheet ──────────────────────────────────────────────────────────────────

var sheetEl = document.getElementById('sheet');
var backdropEl = document.getElementById('sheet-backdrop');

function openSheet(html) { sheetEl.innerHTML = html; sheetEl.hidden = false; backdropEl.hidden = false; }
function closeSheet() { sheetEl.hidden = true; backdropEl.hidden = true; sheetEl.innerHTML = ''; }
backdropEl.addEventListener('click', closeSheet);

// ─── set logging ────────────────────────────────────────────────────────────

var draft = null;

function openSetSheet(exerciseId, setIdx) {
  var p = findPresc(exerciseId);
  if (!p) return;
  var ex = BYID[exerciseId];
  var rec = exLog(state.day, exerciseId, p.target_reps.length);
  var existing = rec.sets[setIdx];
  var target = p.target_reps[setIdx];

  draft = {
    exerciseId: exerciseId,
    setIdx: setIdx,
    weight: existing ? existing.weight_lb : defaultWeight(p, rec),
    reps: existing ? existing.reps : (target === null ? (p.amrap ? 10 : 0) : target),
    rpe: existing && typeof existing.rpe === 'number' ? existing.rpe : null,
    isLast: setIdx === p.target_reps.length - 1,
    amrap: p.amrap,
    step: ex.half_increment_lb || ex.load_increment_lb || 5
  };
  renderSetSheet();
}

function renderSetSheet() {
  var ex = BYID[draft.exerciseId];
  var rpeHtml = draft.isLast
    ? '<div class="sheet-sub" style="margin:16px 0 0">RPE on the last set — the rule needs it</div>' +
      '<div class="rpe">' + [6, 7, 8, 9, 10].map(function (r) {
        return '<button data-rpe="' + r + '" aria-pressed="' + (draft.rpe === r) + '">' + r + '</button>';
      }).join('') + '</div>'
    : '';
  var weightOk = typeof draft.weight === 'number' && !isNaN(draft.weight);

  openSheet(
    '<div class="sheet-title">' + esc(ex.name) + '</div>' +
    '<div class="sheet-sub">Set ' + (draft.setIdx + 1) + (draft.amrap ? ' · as many reps as possible' : '') + '</div>' +
    '<div class="stepper">' +
      '<div class="stepper-label">Weight' + (ex.equipment.indexOf('bodyweight') !== -1 ? ' (added)' : '') + '</div>' +
      '<button data-adj="w" data-by="-1">−</button>' +
      '<input class="val" id="draft-weight" type="number" inputmode="decimal" step="any" ' +
        'placeholder="lb" value="' + (weightOk ? draft.weight : '') + '">' +
      '<button data-adj="w" data-by="1">+</button>' +
    '</div>' +
    '<div class="stepper">' +
      '<div class="stepper-label">Reps</div>' +
      '<button data-adj="r" data-by="-1">−</button>' +
      '<div class="val">' + draft.reps + '</div>' +
      '<button data-adj="r" data-by="1">+</button>' +
    '</div>' +
    rpeHtml +
    '<button class="btn primary" data-act="save-set"' +
      ((!weightOk || (draft.isLast && draft.rpe === null)) ? ' disabled' : '') + '>Save set</button>' +
    '<button class="btn ghost" data-act="close-sheet">Cancel</button>'
  );

  var input = document.getElementById('draft-weight');
  input.addEventListener('input', function () {
    draft.weight = input.value === '' ? null : parseFloat(input.value);
    var ok = typeof draft.weight === 'number' && !isNaN(draft.weight);
    sheetEl.querySelector('[data-act="save-set"]').disabled = !ok || (draft.isLast && draft.rpe === null);
  });
  if (!weightOk) input.focus();
}

function commitSet() {
  var p = findPresc(draft.exerciseId);
  var rec = exLog(state.day, draft.exerciseId, p.target_reps.length);
  var entry = { weight_lb: draft.weight, reps: draft.reps };
  if (draft.rpe !== null) entry.rpe = draft.rpe;
  var wasLogged = !!rec.sets[draft.setIdx];
  rec.sets[draft.setIdx] = entry;
  save();
  closeSheet();
  render();
  if (!wasLogged) afterSetLogged(p);   // editing an already-logged set doesn't restart rest
}

/**
 * One tap logs the set as prescribed. The sheet opens instead when a tap can't
 * know the answer: the last set (needs RPE), an AMRAP set (needs reps), or a
 * weight nobody has entered yet.
 */
function quickLog(exerciseId, setIdx) {
  var p = findPresc(exerciseId);
  if (!p) return;
  var rec = exLog(state.day, exerciseId, p.target_reps.length);

  if (rec.sets[setIdx]) { rec.sets[setIdx] = null; save(); return render(); }

  var w = defaultWeight(p, rec);
  if (setIdx === p.target_reps.length - 1 || p.amrap || w === null) return openSetSheet(exerciseId, setIdx);

  rec.sets[setIdx] = { weight_lb: w, reps: p.target_reps[setIdx] };
  save();
  render();
  afterSetLogged(p);
}

// ─── rest timer ─────────────────────────────────────────────────────────────
//
// Stores an end timestamp, not a countdown, so it stays correct while the phone
// is locked or you're in another app — browsers freeze timers in the background,
// but Date.now() keeps going. Persisted in state, so a reload doesn't lose it.

var timerEl = document.getElementById('timer');
var timerInt = null, audioCtx = null, wakeLock = null;

function clock(sec) {
  var a = Math.abs(sec);
  return (sec < 0 ? '+' : '') + Math.floor(a / 60) + ':' + ('0' + (a % 60)).slice(-2);
}

function startTimer(sec, label) {
  state.timer = { endsAt: Date.now() + sec * 1000, total: sec, label: label, alerted: false };
  save();
  ensureTicking();
  keepAwake();
}

function stopTimer() {
  state.timer = null;
  save();
  tick();
}

function ensureTicking() {
  if (!timerInt) timerInt = setInterval(tick, 250);
  tick();
}

function tick() {
  var t = state && state.timer;
  if (!t) {
    timerEl.hidden = true;
    if (timerInt) { clearInterval(timerInt); timerInt = null; }
    releaseWake();
    return;
  }
  var msLeft = t.endsAt - Date.now();
  var left = Math.ceil(msLeft / 1000);
  var over = left <= 0;

  if (over && !t.alerted) {
    t.alerted = true;
    save();
    restOver();
  }
  // nobody needs an overtime counter running for twenty minutes
  if (-left > 600) return stopTimer();

  timerEl.hidden = false;
  timerEl.classList.toggle('go', over);
  document.getElementById('timer-clock').textContent = over ? 'Go  ' + clock(left) : clock(left);
  document.getElementById('timer-label').textContent = over ? 'Rest over · ' + t.label : 'Rest · ' + t.label;
  document.getElementById('timer-bar').style.width = Math.max(0, msLeft / (t.total * 1000)) * 100 + '%';
  document.getElementById('timer-stop').textContent = over ? 'Done' : 'Skip';
}

function adjustTimer(by) {
  if (!state.timer) return;
  state.timer.endsAt += by * 1000;
  state.timer.total = Math.max(1, state.timer.total + by);
  if (state.timer.endsAt > Date.now()) state.timer.alerted = false;
  save();
  tick();
}

/** iOS only allows audio that was unlocked by a tap, so every tap tries to unlock it. */
function unlockAudio() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch (e) { /* no audio — the bar still turns amber */ }
}

function restOver() {
  if (navigator.vibrate) navigator.vibrate([250, 120, 250, 120, 400]);
  if (!audioCtx || document.hidden) return;
  [0, 0.22, 0.44].forEach(function (at, i) {
    var o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.frequency.value = i === 2 ? 1320 : 880;
    o.connect(g); g.connect(audioCtx.destination);
    var t0 = audioCtx.currentTime + at;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.4, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.18);
    o.start(t0); o.stop(t0 + 0.2);
  });
}

/** Keep the screen on while resting, so the countdown is visible at the rack. */
function keepAwake() {
  if (wakeLock || !('wakeLock' in navigator)) return;
  navigator.wakeLock.request('screen').then(function (w) {
    wakeLock = w;
    w.addEventListener('release', function () { wakeLock = null; });
  }).catch(function () {});
}
function releaseWake() {
  if (wakeLock) { wakeLock.release().catch(function () {}); wakeLock = null; }
}

document.addEventListener('visibilitychange', function () {
  if (document.hidden || !state || !state.timer) return;
  ensureTicking();   // catch up immediately on return
  keepAwake();       // the OS drops the wake lock when the page is hidden
});

/** Start the rest timer after a set — unless that set finished the whole session. */
function afterSetLogged(p) {
  var l = state.logs[state.day];
  var w = currentWorkout();
  var everythingLogged = w.exercises.every(function (x) {
    var rec = l && l.exercises.filter(function (e) { return e.exercise_id === x.exercise_id; })[0];
    return rec && rec.sets.every(Boolean);
  });
  if (everythingLogged) return stopTimer();
  startTimer(p.rest_sec, BYID[p.exercise_id].name);
}

// ─── views ──────────────────────────────────────────────────────────────────

var viewEl = document.getElementById('view');

function render() {
  document.querySelectorAll('#tabs button').forEach(function (b) {
    b.setAttribute('aria-current', String(b.dataset.view === state.view));
  });
  document.getElementById('tabs').hidden = !state.week;
  if (!state.week) return renderSetup();
  if (state.view === 'week') return renderWeek();
  if (state.view === 'data') return renderData();
  return renderToday();
}

function setHeader(title, sub, badge) {
  document.getElementById('hdr-title').textContent = title;
  document.getElementById('hdr-sub').textContent = sub || '';
  document.getElementById('hdr-badge').textContent = badge || '';
}

// — setup —

function renderSetup() {
  setHeader('Singularity', 'Your program');
  var unknown = 0;
  var html = '<div class="note">This is your split from <strong>program.json</strong>. ' +
    'Weights marked <strong>?</strong> get filled in the first time you log them.</div>';

  PROGRAM.days.forEach(function (d) {
    html += '<h2>' + esc(d.weekday) + ' · ' + esc(d.name) + '</h2>';
    d.exercises.forEach(function (x) {
      var ex = BYID[x.exercise_id];
      if (x.weight_lb === null) unknown++;
      html += '<div class="kv"><span>' + esc(ex ? ex.name : x.exercise_id + ' (missing!)') + '</span><span>' +
        x.sets + ' × ' + (x.reps === 'amrap' ? 'AMRAP' : x.reps) + ' · ' + fmt(x.weight_lb) + ' lb</span></div>';
    });
  });

  html += '<button class="btn primary" data-act="start">Start week 1</button>';
  viewEl.innerHTML = html;
}

function startProgram() {
  state.week = Engine.initialWeek(LIB, CONFIG);
  state.logs = {};
  state.history = [];
  state.day = 1;
  state.view = 'today';
  save();
  render();
}

// — today —

function renderToday() {
  var w = currentWorkout();
  var l = state.logs[state.day];
  setHeader(w.weekday + ' · ' + w.name, 'Week ' + state.week.index, state.week.deload ? 'DELOAD' : '');

  if (l && l.completed === true) {
    viewEl.innerHTML = '<div class="empty">' + w.weekday + ' is logged.</div>' +
      '<button class="btn" data-act="reopen">Reopen this session</button>' + nextDayButton();
    return;
  }
  if (l && l.completed === false) {
    viewEl.innerHTML = '<div class="empty">' + w.weekday + ' was skipped.<br>It repeats next week.</div>' +
      '<button class="btn" data-act="reopen">Undo skip</button>' + nextDayButton();
    return;
  }

  var badDay = l && l.bad_day;
  var html = '';
  if (state.week.deload) {
    html += '<div class="note"><strong>Deload week.</strong> Loads and volume cut, RPE capped at ' +
      CONFIG.deload_rpe_cap + '. Nothing progresses — that is the point.</div>';
  }
  if (badDay) {
    html += '<div class="note"><strong>Bad day.</strong> Keep it at RPE ' + CONFIG.bad_day_rpe_cap +
      ' or below. Nothing progresses from today, but new weights still get recorded.</div>';
  }

  html += w.exercises.map(function (p) {
    var ex = BYID[p.exercise_id];
    var rec = (l && l.exercises.filter(function (e) { return e.exercise_id === p.exercise_id; })[0]) || null;
    var allDone = rec && rec.sets.every(Boolean);

    var setsHtml = p.target_reps.map(function (target, si) {
      var s = rec ? rec.sets[si] : null;
      var label, cls = '';
      if (s) {
        label = fmt(s.weight_lb) + ' lb × ' + s.reps;
        cls = (!p.amrap && s.reps < target) ? 'set-missed' : 'set-logged';
      } else {
        var w0 = rec ? defaultWeight(p, rec) : p.weight_lb;
        label = fmt(w0) + ' lb × ' + (p.amrap ? (target === null ? 'max' : target + '+') : target);
      }
      return '<div class="set">' +
        '<button class="set-hit" data-quick="' + p.exercise_id + '" data-set="' + si + '">' +
          '<span class="set-n">' + (si + 1) + '</span>' +
          '<span class="set-target ' + cls + '">' + label + '</span>' +
          (s && typeof s.rpe === 'number' ? '<span class="set-rpe">RPE ' + s.rpe + '</span>' : '') +
        '</button>' +
        '<button class="set-edit" data-edit="' + p.exercise_id + '" data-set="' + si + '">✎</button>' +
      '</div>';
    }).join('');

    return '<div class="card' + (allDone ? ' done' : '') + '">' +
      '<div class="card-head">' +
        '<div class="ex-name">' + esc(ex.name) + '</div>' +
        '<div class="ex-meta">' + fmt(p.weight_lb) + ' lb · ' + targetLabel(p) +
          ' · RPE ' + p.target_rpe + ' · ' + p.rest_sec + 's rest</div>' +
        (p.note ? '<div class="ex-note">' + esc(p.note) + '</div>' : '') +
      '</div>' +
      '<div class="sets">' + setsHtml + '</div>' +
    '</div>';
  }).join('');

  html += '<button class="btn primary" data-act="finish-session">Finish session</button>' +
    '<div class="row">' +
      '<button class="btn" data-act="bad-day">' + (badDay ? 'Clear bad day' : 'Bad day') + '</button>' +
      '<button class="btn danger" data-act="skip">Skip day</button>' +
    '</div>' + nextDayButton();

  viewEl.innerHTML = html;
}

function nextDayButton() {
  if (state.day >= state.week.workouts.length) {
    return '<button class="btn ghost" data-act="go-week">Go to week overview</button>';
  }
  return '<button class="btn ghost" data-act="next-day">Next: ' +
    esc(state.week.workouts[state.day].weekday) + ' →</button>';
}

// — week —

function renderWeek() {
  setHeader('Week ' + state.week.index, state.week.deload ? 'Deload' : 'Training',
    state.week.deload ? 'DELOAD' : '');

  var html = (state.week.warnings || []).map(function (w) {
    return '<div class="note">' + esc(w) + '</div>';
  }).join('');

  WEEKDAYS.forEach(function (wd) {
    var w = state.week.workouts.filter(function (x) { return x.weekday === wd; })[0];
    if (!w) {
      html += '<div class="day rest"><span class="day-n">–</span>' +
        '<span><span class="day-name">' + wd + '</span><span class="day-sub">Rest</span></span></div>';
      return;
    }
    var st = dayStatus(w.day);
    var mark = st === 'done' ? '✓' : st === 'skipped' ? '—' : wd.slice(0, 1);
    var sub = w.exercises.map(function (p) { return BYID[p.exercise_id].name; }).join(' · ');
    html += '<button class="day" data-day="' + w.day + '"' + (w.day === state.day ? ' aria-current="true"' : '') + '>' +
      '<span class="day-n ' + (st === 'done' ? 'done' : st === 'skipped' ? 'skipped' : '') + '">' + mark + '</span>' +
      '<span><span class="day-name">' + wd + ' · ' + esc(w.name) + '</span>' +
      '<span class="day-sub">' + esc(sub) + '</span></span></button>';
  });

  html += allDaysResolved()
    ? '<button class="btn primary" data-act="finish-week">Finish week ' + state.week.index + ' →</button>'
    : '<div class="note">Finish or skip every training day to close the week.</div>';

  viewEl.innerHTML = html;
}

function finishWeek() {
  var logs = [];
  for (var d = 1; d <= state.week.workouts.length; d++) {
    var l = state.logs[d] || { day: d, completed: false, bad_day: false, exercises: [] };
    if (l.completed === null) l.completed = true;
    logs.push(l);
  }
  state.history.push({ week: state.week, logs: logs });
  state.week = Engine.nextWeek(state.history, LIB, CONFIG);
  state.logs = {};
  state.day = 1;
  state.view = 'today';
  save();
  render();
}

// — data —

function renderData() {
  var n = state.history.length;
  setHeader('Data', n + (n === 1 ? ' week logged' : ' weeks logged'));

  var html = '<h2>Program</h2>' +
    '<div class="kv"><span>Current week</span><span>' + state.week.index + '</span></div>' +
    '<div class="kv"><span>RPE gate</span><span>' + CONFIG.rpe_gate + '</span></div>' +
    '<div class="kv"><span>Deload every</span><span>' + CONFIG.deload_every_weeks + ' weeks</span></div>';

  // progress against week 1 for every lift that started with a known weight
  var first = n ? state.history[0].week : state.week;
  var rows = '';
  first.workouts.forEach(function (w) {
    w.exercises.forEach(function (p0) {
      if (p0.weight_lb === null || p0.amrap) return;
      var now = null;
      state.week.workouts.forEach(function (x) { x.exercises.forEach(function (q) { if (q.slot === p0.slot) now = q; }); });
      if (!now) return;
      var cur = now.weight_lb, delta = cur - p0.weight_lb;
      rows += '<div class="kv"><span>' + esc(BYID[p0.exercise_id].name) + '</span><span>' +
        fmt(cur) + ' lb  (' + (delta >= 0 ? '+' : '') + fmt(delta) + ')</span></div>';
    });
  });
  if (rows) html += '<h2>Since week 1</h2>' + rows +
    (state.week.deload ? '<div class="note">Deload week — these are deliberately low.</div>' : '');

  html += '<h2>Backup</h2>' +
    '<div class="note">Everything lives in this browser. Clearing site data erases your history — export regularly.</div>' +
    '<button class="btn" data-act="export">Export JSON</button>' +
    '<button class="btn" data-act="import">Import JSON</button>' +
    '<h2>Danger</h2>' +
    '<button class="btn danger" data-act="reset">Erase everything and start over</button>';

  viewEl.innerHTML = html;
}

function textareaSheet(title, sub, id, value, actions) {
  openSheet('<div class="sheet-title">' + title + '</div><div class="sheet-sub">' + sub + '</div>' +
    '<div class="field"><textarea id="' + id + '" ' + (value !== null ? 'readonly ' : '') +
    'style="width:100%;height:220px;background:var(--surface-2);border:1px solid var(--line);' +
    'border-radius:11px;color:var(--text);font:12px/1.4 ui-monospace,Menlo,monospace;padding:10px">' +
    (value !== null ? esc(value) : '') + '</textarea></div>' + actions);
}

// ─── events ─────────────────────────────────────────────────────────────────

document.getElementById('tabs').addEventListener('click', function (e) {
  var b = e.target.closest('button[data-view]');
  if (!b) return;
  state.view = b.dataset.view;
  save();
  render();
});

document.body.addEventListener('click', function (e) {
  unlockAudio();
  var t = e.target.closest('[data-act],[data-quick],[data-edit],[data-day],[data-adj],[data-rpe],[data-timer]');
  if (!t) return;

  if (t.dataset.timer) return t.dataset.timer === 'stop' ? stopTimer() : adjustTimer(+t.dataset.timer);

  if (t.dataset.quick !== undefined) return quickLog(t.dataset.quick, +t.dataset.set);
  if (t.dataset.edit !== undefined) return openSetSheet(t.dataset.edit, +t.dataset.set);
  if (t.dataset.day !== undefined) { state.day = +t.dataset.day; state.view = 'today'; save(); return render(); }

  if (t.dataset.adj) {
    var by = +t.dataset.by;
    if (t.dataset.adj === 'w') {
      var cur = typeof draft.weight === 'number' && !isNaN(draft.weight) ? draft.weight : 0;
      draft.weight = Math.max(0, cur + by * draft.step);
    } else draft.reps = Math.max(0, draft.reps + by);
    return renderSetSheet();
  }
  if (t.dataset.rpe) { draft.rpe = +t.dataset.rpe; return renderSetSheet(); }

  switch (t.dataset.act) {
    case 'start': return startProgram();
    case 'close-sheet': return closeSheet();
    case 'save-set': return commitSet();
    case 'finish-session': dayLog(state.day).completed = true; state.timer = null; save(); tick(); return render();
    case 'skip':
      var sl = dayLog(state.day); sl.completed = false; sl.exercises = []; save(); return render();
    case 'reopen': dayLog(state.day).completed = null; save(); return render();
    case 'bad-day': var bl = dayLog(state.day); bl.bad_day = !bl.bad_day; save(); return render();
    case 'next-day': state.day = Math.min(state.week.workouts.length, state.day + 1); save(); return render();
    case 'go-week': state.view = 'week'; save(); return render();
    case 'finish-week': return finishWeek();
    case 'export':
      textareaSheet('Export', 'Copy this somewhere safe.', 'exp', JSON.stringify(state, null, 2),
        '<button class="btn ghost" data-act="close-sheet">Done</button>');
      var ta = document.getElementById('exp'); ta.focus(); ta.select();
      return;
    case 'import':
      return textareaSheet('Import', 'Paste a previous export. This replaces everything.', 'imp', null,
        '<button class="btn primary" data-act="do-import">Replace my data</button>' +
        '<button class="btn ghost" data-act="close-sheet">Cancel</button>');
    case 'do-import':
      try {
        var next = JSON.parse(document.getElementById('imp').value);
        if (!next || !next.week || !next.week.workouts[0].weekday) {
          throw new Error('that is not an export from this version of the app');
        }
        state = next; save(); closeSheet(); return render();
      } catch (err) { return alert('Import failed: ' + err.message); }
    case 'reset':
      if (!confirm('Erase all training history and start over?')) return;
      localStorage.removeItem(KEY);
      location.reload();
      return;
  }
});

// ─── boot ───────────────────────────────────────────────────────────────────

Promise.all([
  fetch('./exercise-library.json').then(function (r) { return r.json(); }),
  fetch('./program.json').then(function (r) { return r.json(); })
]).then(function (res) {
  LIB = res[0].exercises;
  BYID = Engine.indexById(LIB);
  PROGRAM = res[1];
  CONFIG = Object.assign({}, Engine.CONFIG, { program: PROGRAM });
  state = load() || { v: 2, view: 'today', day: 1, week: null, logs: {}, history: [] };
  render();
  if (state.timer) ensureTicking();
}).catch(function (err) {
  viewEl.innerHTML = '<div class="empty">Could not load the app data.<br>' + esc(err.message) + '</div>';
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('./sw.js').catch(function () {});
  });
}
