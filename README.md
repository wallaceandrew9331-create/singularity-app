# Singularity

A training app for one user, built around the split he actually runs. Rebuilt
from the 2019 senior project, scoped down to the thing that was never finished:
the progression engine.

No auth, no app store, no wearables. One lifter, deterministic rules, a replay
harness to tune them.

## Files

| | |
|---|---|
| `exercise.ts` | Schema. `Exercise` (the movement) vs `PrescribedExercise` (a slot in a workout). |
| `program.json` | **Your split.** Days, exercises, sets, reps, starting weights. Edit this to change the program. |
| `exercise-library.json` | 55 exercises — what each lift is, its increments, its joint stress. |
| `progression-rules.md` | The spec. Read this first — the code implements it section by section. |
| `engine.js` | The engine. `nextWeek(history, library, config) -> Week`. |
| `engine.test.js` | 33 tests. |
| `simulate.js` | Replay harness. |
| `review.js` | Library validator + the review table for your judgment calls. |
| `index.html` `app.js` `app.css` | The PWA. No framework, no build step. |
| `sw.js` `manifest.webmanifest` | Service worker and install manifest. |
| `serve.js` | Static server — service workers refuse to register over `file://`. |
| `build.js` | Copies the app into `docs/`, which GitHub Pages serves. |
| `make-icons.js` | Generates the PNG icons from scratch using Node's zlib. |

## Run

```bash
node serve.js                  # the app, at http://localhost:8080
```

```bash
node engine.test.js            # 25 tests
node simulate.js --weeks 16    # see what the rules do over a block
node simulate.js --detail 5    # print one week in full
node review.js --subs          # validate the library, show substitutions
```

Node 10 compatible, zero dependencies.

### Putting it on your phone

```bash
node build.js && git add -A && git commit -m "update" && git push
```

`build.js` copies only the app into `docs/`; GitHub Pages serves that folder.
The phone picks up the new version the next time the app is opened. On the
phone, open the Pages URL in Safari → Share → **Add to Home Screen**, and from
then on open it only from the icon.

### Trying it over wifi

`serve.js` prints a LAN address. That works for trying it, but iOS will not
install a PWA or register a service worker over plain HTTP from a non-localhost
origin — for a real home-screen install with offline support you need HTTPS.
Easiest route is a tunnel (Cloudflare Tunnel, ngrok) or any static host; the
whole app is static files, so anything that serves a directory will do.

## How your program is read

- **≤5 reps is fixed** (5×5 bench, 4×3 deadlift): hit every rep at RPE ≤8 and the
  weight goes up next week (+5 upper barbell, +10 lower; +2.5/+5 at RPE 9).
- **Above 5 is a range** of your number +2 (4×10 → 10–12): one rep added to every
  set each good week, then weight goes up and reps reset.
- **AMRAP** (pull-ups): beat last week's total; once every set hits 12, +5 lb.
- **No weight given**: the first session asks, and that becomes the prescription.

All of these are constants in `CONFIG` at the top of `engine.js`.

## The one invariant

`nextWeek` is pure. Same history in, same week out — no dates, no randomness, no
mutation. That is what lets you change a constant in `CONFIG` and replay real
logs to see what a different rule *would have* done to a block you actually
trained. It is the only honest way to tune these numbers, and it is worth
preserving even when it is inconvenient.

## State

Working end to end: first-run setup, week generation, the full progression rule,
set logging, stall and deload handling, missed sessions, bad-day autoregulation,
emphasis-weighted balance checking, week rollover, export/import.

Known gaps:

- **The substitution engine.** `exercise.ts` defines the interface and the
  library carries hand-authored substitutions, but nothing resolves them yet.
  §5 of the spec calls into it on a second stall and finds nothing there.
- **No history view.** Past weeks are stored but only Data → Export shows them.
- **Editing program.json mid-block.** Each week evolves from the last, so edits
  only take effect after Data → Erase and start over. Export first.
- **localStorage only.** Clearing site data erases everything. Export regularly.

## Next

1. Run a real week and see what is annoying. That list beats anything here.
2. The substitution resolver.
3. A history view, so progress is visible without exporting JSON.
