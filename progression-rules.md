# Progression rules — v0.3

> **v0.3:** the week is no longer generated. §2 (split) and §3 (prescription by
> role) are superseded by `program.json` — your actual split. Fixed reps (≤5),
> ranges (your number +2) and AMRAP are described in the README. Everything from
> §4 onward still applies, per exercise slot.


The thing the 2019 project never had. Everything here is deterministic: given a
logged week, exactly one next week comes out. No model in the loop.

The four open decisions from v0.1 are resolved and implemented in `engine.js`.
Each is marked **[settled]** with the reasoning, so changing one later is a
deliberate act rather than a rediscovery. All four are single constants in
`CONFIG` — none requires touching the logic.

---

## 0. Configuration (n=1)

```
goal           strength
frequency      6 days/week
constraints    none           # the back condition is retired; the mechanism stays
progression    double progression, RPE-gated
```

The contraindication system from `exercise.ts` stays in place with an empty pain
profile. It costs nothing to leave in, and if anything flares you populate one
field instead of rebuilding the filter.

---

## 1. The tension, and how the rules absorb it

Six days and a strength goal pull against each other. You cannot drive a heavy
top set six days a week — not because of the muscle, but because the recovery
debt compounds faster than the strength adapts.

So the week is **not** six heavy days. It is three heavy days carrying the
strength goal, and three supporting days carrying volume and weak points. The
progression gate below is also deliberately conservative: it would be too slow
for a 3-day week and is about right when you are accumulating this much work.

If you disagree with that reading, the knob to turn is §5's RPE gate, not the
split.

---

## 2. Week structure

| Day | Session | Primary pattern | Primary reps |
|-----|---------|-----------------|--------------|
| 1 | Lower — heavy | squat | 3–6 |
| 2 | Upper — heavy | horizontal_push | 3–6 |
| 3 | Lower — volume | hinge | 6–8 |
| 4 | Upper — volume | vertical_push + horizontal_pull | 6–8 |
| 5 | Lower — accessory | lunge, posterior chain | 8–12 |
| 6 | Upper — accessory | vertical_pull, arms, delts | 8–12 |

Weekly pattern frequency: squat 2×, hinge 2×, push 3×, pull 3×.

**[settled]** — alternating upper/lower, because it spreads spinal and shoulder
load most evenly across six consecutive days. A 4-lower/2-upper or a PPL×2 would
both also serve a strength goal; this is the least-confident call in the document
and the first thing to change if the week feels wrong in practice. The day
templates live in `DAYS` in `engine.js`.

Each `Workout` gains an `intensity: 'heavy' | 'volume' | 'accessory'` field,
which is what shifts the rep range for the primary lift in that session.

---

## 3. Prescription by role

Set counts are working sets; warmups aren't tracked or progressed.

| Role | Heavy day | Volume day | Accessory day |
|------|-----------|------------|---------------|
| `primary` | 4 × 3–6 | 4 × 6–8 | 3 × 8–12 |
| `accessory` | 3 × 6–10 | 3 × 8–12 | 3 × 10–15 |
| `isolation` | 3 × 10–15 | 3 × 10–15 | 3 × 12–20 |

Rest comes from `default_rest_sec` on the exercise, extended to 180s for any
`primary` on a heavy day.

---

## 4. The core rule

Evaluated per exercise, immediately after the session is logged.

```
hit     = every working set reached its prescribed reps
topped  = every working set is at the TOP of the rep range
rpe     = RPE of the final working set

if not hit:
    if this is the 2nd consecutive miss on this exercise:
        DELOAD        load × 0.90, reps reset to bottom of range
    else:
        REPEAT        unchanged

elif topped:
    if rpe <= 8:      LOAD UP   +full increment, reps reset to bottom
    if rpe == 9:      LOAD UP   +half increment, reps reset to bottom
    if rpe == 10:     REPEAT    unchanged

else:
    if rpe <= 9:      ADD A REP to the lowest-rep working set
    if rpe == 10:     REPEAT    unchanged
```

A full cycle on a 4 × 3–6 lift therefore runs:

```
3/3/3/3 → 4/3/3/3 → 4/4/3/3 → 4/4/4/3 → 4/4/4/4 → … → 6/6/6/6 → +load, back to 3/3/3/3
```

Slow by design. The rep ladder is doing the work, and the load only moves when
you've earned every rep at the top of the range.

**[settled]** — the gate sits at 8, with RPE 9 progressing at half increment.
Moving it to 9 makes everything roughly 30% faster and raises the stall rate,
which is the wrong trade at six days a week. `CONFIG.rpe_gate`.

### Load increments

Needs a new field on `Exercise`: `load_increment_lb`.

| Equipment | Full | Half |
|-----------|------|------|
| Barbell, lower body | 10 | 5 |
| Barbell, upper body | 5 | 2.5 |
| Dumbbell | 5/hand | — |
| Machine / cable | 1 pin | — |
| Bodyweight | reps only, or +5 external | — |

Dumbbells and machines have no half increment. **[settled]** — at RPE 9 they
**hold** rather than taking the full jump, and the rep ladder absorbs it instead.
A 5 lb jump per hand on a dumbbell press is a far larger relative step than 5 lb
on a barbell, and taking it from an RPE 9 is how you manufacture a stall. This is
why `half_increment_lb` is an explicit nullable field rather than
`load_increment_lb / 2` — the data says whether the step exists.

---

## 5. Stalls and deloads

**Exercise stall** — no progression (neither load nor reps) for 3 consecutive
sessions of that exercise. On a stall:

1. First stall → deload that exercise: load × 0.90, reps to bottom, run it up again.
2. Second stall on the same exercise within 8 weeks → swap it. Call the
   substitution engine for a `lateral` at the same role, and keep the stalled
   lift out of rotation for 4 weeks.

That second branch is the first place the substitution engine earns its keep
without you asking it to.

**Program deload** — triggered by whichever comes first:

- 6 weeks since the last deload, or
- 2+ `primary` lifts hit the deload branch in the same week.

Deload week: all loads × 0.85, working sets cut to 60%, target RPE capped at 6,
**no progression evaluated**. The following week resumes at pre-deload loads with
reps reset to the bottom of the range.

**[settled]** — 6 weeks. The conservative end, and at six days a week I would not
stretch past it regardless of how good things feel. `CONFIG.deload_every_weeks`.

---

## 6. Missed sessions

At six days a week you will miss sessions. The rule is: **do not make them up.**

A missed session's exercises are not evaluated and do not progress. They repeat
unchanged the next time that day comes around. No shuffling, no doubling up, no
cramming day 3 into day 4.

Two or more missed sessions in a single week suppresses that week's progression
entirely — every exercise repeats. A week that fragmented is not data.

---

## 7. Bad-day autoregulation

One flag, set before the session starts: poor sleep, illness, high stress,
something tweaked.

When set:

- Target RPE capped at 7 for the session
- Drop the last `isolation` exercise from the session
- Progression is **not** evaluated — everything repeats next cycle

Deliberately not a skip. The habit is worth more than the session, and a logged
light day keeps the data honest in a way a gap doesn't.

---

## 8. Weekly balance check

Runs after a week is generated and warns before you train it. Uses
`components[].emphasis` from the schema:

```
weekly_volume[pattern] = Σ (working_sets × emphasis) across the week
```

Flags:

- `push : pull` outside **0.8 – 1.2** — at six days this drifts push-heavy fast
- any of squat / hinge / horizontal_push / horizontal_pull below **6 weighted sets**
- any single pattern above **30%** of total weekly volume

These are warnings, not hard blocks. The three thresholds are the numbers I'd
most want a second opinion on from someone who has written a lot of six-day
programs — but they only print, so a wrong threshold costs you a spurious warning
rather than a bad week. `CONFIG.balance`.

---

## 9. Schema changes this requires

1. `Exercise.load_increment_lb: number` — §4
2. `Workout.intensity: 'heavy' | 'volume' | 'accessory'` — §2
3. A `SessionLog` entity that doesn't exist yet:

```ts
interface SetLog {
  set_index: number;
  weight_lb: number;
  reps: number;
  rpe?: number;          // final working set at minimum
}

interface ExerciseLog {
  exercise_id: string;
  sets: SetLog[];
  swapped_from?: string;
}

interface SessionLog {
  id: string;
  workout_id: string;
  date: string;          // ISO
  bad_day: boolean;
  completed: boolean;    // false = missed, §6
  exercises: ExerciseLog[];
}
```

The progression engine is a pure function:

```
nextWeek(lastWeek: SessionLog[], library: Exercise[], config) => Workout[]
```

Pure matters here — it means you can replay six months of logs against a changed
rule and see what would have happened, which is the only way you'll ever tune
these numbers honestly.

---

## 10. Tuning

Every settled decision is a constant in `CONFIG` at the top of `engine.js`. The
engine is a pure function over history, so the honest way to tune any of them is
to change the constant and replay:

```
node simulate.js --weeks 16
```

That prints what the next sixteen weeks would look like under the current rules.
Once you have real logs, the same replay runs against those instead of synthetic
ones, and you can see what a changed rule *would have* done to a block you
actually trained. That is the whole reason the engine takes history and returns a
week rather than mutating state in place.

Order I'd revisit them in, once you've run the thing for a month:

1. **§2 split** — structural, and the least-confident call here.
2. **§4 RPE gate** — the single number that sets the pace of everything.
3. **§5 deload interval** — the one most likely to need shortening, not lengthening.
4. **§8 balance thresholds** — cosmetic until they start firing every week.
