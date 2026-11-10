# Report

Frame lets you author what happens when a transition is interrupted, on a real React component, and export a small working version. This report says what was measured, what failed, and what the numbers leave out.

All measured results come from commit `e0d45c6`, on 2026-11-09, on one Apple M5 Pro Mac on AC power. That day the runtime gained an entry point for a hand, described under [A hand](#a-hand), so every experiment in the protocol was run again from one clean checkout, and so was the mutation run. Results from the earlier commit `909eca6` are quoted only where an earlier run is the reason a result is not claimed. The CSS easing check is a unit test. Other work was running on the machine. Chromium 158, WebKit 27.2 and Firefox 159 came from Playwright 1.65 and ran headless. The workload and pass criteria are in [`bench/PROTOCOL.md`](../bench/PROTOCOL.md), which was frozen before the first run and amended once, for the reason given under [Failures](#failures).

## Results

| Question | Target | Result | Status |
|---|---|---|---|
| Do the studio and the export draw the same thing? | 0.5 px, 0.01 opacity | At most 0.000023 px and 0 opacity | Met |
| Does the replay you inspect match the export? | 0.5 px, 0.01 opacity | At most 0.000023 px and 0 opacity | Met |
| Does real geometry match independent physics? | 0.11 px | Worst 0.094 px | Met |
| Would these checks notice a broken export? | Every fault | 9 of 9 faults caught, 0 of 2 clean builds flagged | Met |
| Do the tests notice broken logic? | Reported | 68 of 68 mutants caught | Reported |
| Is editing fast at 30 targets? | Under 16.7 ms to DOM | Median 1.4 ms, p95 1.6 ms | Met |
| What does a consumer pay? | Reported | 7.1 KB of gzipped JavaScript, 0.14 KB of CSS | Reported |
| Does the copied CSS easing follow its spring from rest? | 0.2% of the distance | Within it for 13 springs at 3 distances | Met |

### Fidelity

The studio and a clean production build of the export ran the same four scripts on a manual clock. Geometry and opacity were then read from the real DOM at about 60 samples per second of animation, with seeded jitter. That is 5 runs, 3 engines, 2 device scales and 4 scripts, or 120 script runs and 9,060 sample times.

| Engine | Comparisons | Geometry, worst | Opacity, worst | Clip, worst |
|---|---|---|---|---|
| Chromium 158 | 13,462 | 0.000015 px | 0 | 0 |
| WebKit 27.2 | 13,462 | 0.000023 px | 0 | 0 |
| Firefox 159 | 13,462 | 0 px | 0 | 0 |

The replay comparison pauses the studio after the live run, seeks to each sample time, and compares that drawing to the export. It has 10,932 comparisons per engine, with the same worst values. It leaves out the `resize` script, as explained below.

These numbers are this small for a reason. Both sides run the same evaluator on the same machine with no timing difference, so this check does not test the physics. It tests everything around the physics: the build, the CSS, React development and production paths, the page around the component, and the replay path. It found real bugs there. The first run of it reported a 9 px disagreement.

The clock is synchronized by construction, so synchronization error is zero. Readings come from `getBoundingClientRect`, whose floating point noise is the 0.000023 px shown. Device scale 2 gave the same results as 1.

### Physics

The springs are checked by two methods that share nothing with the runtime.

- **Matrix exponential.** 400 points, 40 settling cases and 3 retarget sequences from a 50 digit calculation in `reference/`. It covers all three damping regimes and values half a percent either side of critical. Position agrees within 0.000001 px.
- **RK4 against the browser.** A numerical integrator at a 0.05 ms step predicted the surface height, and the exported app's real height was read at each sample. The worst error across 5 runs was 0.066 to 0.094 px, with medians from 0.003 to 0.005 px. The 0.1 px settle threshold accounts for this: a channel lands on its target once it is within that distance.

### A hand

The runtime can also be driven by a pointer. `grab` takes hold of the transition a command starts, even one that is running, `drag` moves it, and `release` lets go. While a hand holds on, each channel follows the hand's progress between the two measured layouts. Where one target leaves as another arrives, the first fades out before the second fades in. Letting go starts the ordinary retarget from the hand's position and speed. The speed is the least squares slope of the last 80 ms of samples, and a hand that has sent nothing for 50 ms lets go at rest.

This path has 42 unit tests and 22 of the seeded faults in the mutation run, all caught. The tests check that a throw replays to exactly what happened live, that a hand outranks a rule that queues or ignores, that a channel caught away from the hand joins it with no jump, and that letting go does not wait for a delay. On the project page, browser tests drag the real components with a real pointer. They check that the moving edge stays within 1.5 px of where the pointer put it, that nothing jumps when the hand lands or lets go, and that a link to a hand take redraws the same path to a tenth of a pixel.

The hand is not in the fidelity scripts. Those four scripts are presses, so the comparison of studio and export says nothing about a hand beyond the fact that both builds run the same code. The studio has no hand of its own either: it records and replays a take with one in it when a component calls `grab`, but it has no way to know which edge a pointer should follow.

### Controls

A check that cannot fail proves nothing, so faults were written into clean builds.

| Fault | Geometry | Clip | Opacity | Caught |
|---|---|---|---|---|
| Unmodified export | 0.00002 px | 0 | 0 | Not flagged, correct |
| Velocity dropped on retarget | 31 px | one sided | 0.31 | Yes |
| Damping 2 percent high | 2.3 px | one sided | 0.009 | Yes |
| Commands 8 ms late | 247.6 px | one sided | 1 | Yes |
| Opacity 2 percent low | 0.00002 px | 0 | 0.02 | Yes |
| Resize ignored | 72 px | 0 | 0 | Yes |
| Interruption curve ignored | 0.00002 px | 0 | 0.54 | Yes |
| Clip inset 3 px wrong | 0.00002 px | one sided | 0 | Yes |
| Exit box sizing removed | 15 px | 0 | 0 | Yes |
| Unmodified replay | 0.00002 px | 0 | 0 | Not flagged, correct |
| Replay 8 ms late, in replay only | 250.7 px | one sided | 0.32 | Yes |

"One sided" means one build had a clip at a moment when the other had none. The opacity fault passes the 0.01 limit by exactly the amount seeded, so a 1 percent opacity error would sit at the edge of detection.

### Authoring

Production build, Chromium, 5 runs of 60 samples after 20 warmup samples. Each cell is the median across runs of that run's value.

| Declared targets | Edit, p50 | Edit, p95 | Seek, p50 | Seek, p95 |
|---|---|---|---|---|
| 1 | 1.0 ms | 1.1 ms | 0.7 ms | 0.8 ms |
| 10 | 1.1 ms | 1.3 ms | 0.7 ms | 0.9 ms |
| 30 | 1.4 ms | 1.6 ms | 0.8 ms | 1.0 ms |
| 200 (stress) | 3.4 ms | 3.9 ms | 1.6 ms | 2.1 ms |

Two earlier runs, on earlier versions of the interface, gave a median of 1.5 ms and a p95 of 2.2 ms at 30 targets on 2026-11-06, and 1.1 ms and 1.3 ms earlier on 2026-11-09. The machine had other work running every time, so the differences between the runs are not a result.

The p95 ranged from 1.5 to 1.8 ms for edits at 30 targets across runs. The clock stops only after reading back a changed ribbon path, or a moved slider value for seeks, so it cannot stop before the update lands.

The time to the next frame callback was at most 18.5 ms at p95 for these sizes. Frame callback timing is a proxy, and it does not prove a displayed frame. Export took a median of 39 ms in the browser, from click to download, with all sizes between 36 and 45 ms. The command line took 237 ms in one run, most of it starting Vite.

### CSS easing

The project page copies a spring from rest as a CSS `linear()` easing and a duration. `tests/unit/linear-easing.test.ts` reads the written string back and compares it with the closed form at 2,000 moments, for the four presets and the nine corner and middle settings of the page's two sliders, each over 40, 208 and 900 px. The worst gap has to stay under 0.2% of the distance, and a control with the points thinned further has to fail that limit, which it does.

This is one spring from rest and nothing more. CSS cannot start an easing from a speed, so a transition that uses the string restarts when it is interrupted, where the runtime carries on. The page says so beside the string. No browser run compares a CSS transition using the string against the runtime.

### Consumer cost

Sizes are gzip level 9 of a Vite production build, as the increase over the same UI with no animation.

| App | JavaScript added | CSS added |
|---|---|---|
| Frame export | 7.1 KB | 0.14 KB |
| Motion 14.9.1 | 45.1 KB | 0 |
| Motion with `LazyMotion` and `domMax` | 45.2 KB | 0 |

`LazyMotion` saves nothing here, because layout animation needs the full `domMax` feature set. Loading it asynchronously would move the cost, not remove it, and was not measured. Motion does far more than this runtime. This compares one interaction, and it is not a statement about Motion in general.

The export adds no runtime dependency beyond React. The controller holds five small methods only the studio calls, and the three calls for a hand, which an app pays for whether or not it uses them. Both are in the 7.1 KB. Before the hand was added the same build measured 6.2 KB.

### Main thread

Twenty cycles of open, wait 150 ms, reverse, wait 500 ms, in Chromium. Milliseconds per cycle, as the median of 5 runs with the range.

| App | Task | Script | Layout | Style |
|---|---|---|---|---|
| Frame | 12.8 (12.2 to 14.3) | 2.9 (2.8 to 3.3) | 1.3 (1.2 to 1.4) | 2.4 (2.2 to 2.6) |
| Motion | 17.9 (16.0 to 19.6) | 5.4 (4.9 to 6.0) | 0.4 (0.4 to 0.4) | 3.3 (2.9 to 3.6) |
| Motion with `LazyMotion` | 18.4 (15.5 to 19.9) | 5.6 (5.0 to 6.1) | 0.4 (0.4 to 0.4) | 3.3 (2.8 to 3.6) |

**This is not claimed as a runtime win.** In this run the task ranges do not overlap. In the run of the same workload at `909eca6` three days earlier, on the same machine, they did: Frame 13.9 (10.9 to 18.8) against Motion 16.6 (14.6 to 20.5). That run is still in the repository's history. A gap that comes and goes between two runs, with other work on the machine both times, is not a result. Frame spends more time in layout, because `surface` changes real width and height where Motion uses a transform. Every run confirmed that each app really turned around mid flight.

## Failures

These are the failures that changed something. All are fixed unless stated.

| What failed | How it was found | What changed |
|---|---|---|
| Exiting content was 9 px wrong in the export | The studio and export comparison | The exit is now sized as a border box |
| The studio's CSS reset leaked into the canvas and hid that bug | Reading why the 9 px appeared | Every studio style is now scoped to its own interface |
| Focus was lost on a mid flight reversal | Browser tests with real input | Inert is cleared on re-entry, and focus moves after drawing |
| Focus went nowhere after a click in WebKit | Running the suite in WebKit | The runtime remembers what was pressed |
| A layout change at rest was not recorded, so replay started wrong | Reading the code to check a test | It is now a recorded event |
| 7 of 33 mutants survived 88 passing tests | Mutation testing | Tests added, and a real history bug found on the way |
| A reload could leave the studio blank | Code review | Restoring runs outside React's effects, and failure resets safely |
| A queued command could hang replay, or run twice | Code review | Live and replay now share one rule, tested against each other |
| Fidelity only compared live to live | Code review | The replay comparison above exists because of this |
| The Motion baseline did not match the authored timing | Code review | It now uses the same springs and fades |
| The fidelity workload could not detect exit sizing bugs | A control went undetected | The fixture has padded exits, and everything was rerun |
| A seeded fault stopped applying once the hand was added | The control run refused to start | The new calls moved so the fault's text matches again, and the whole protocol was run again |
| The studio's export dialog sat under the canvas | The authoring run could not press Download | The studio's entrance no longer leaves a stacking context behind, and the protocol was run again |
| The speed strip threw when a frame landed between a redraw and its cleanup | Browser tests on the project page | The frame listener checks that its drawing is still there |
| A hand held a leaving button and an arriving form half shown over each other | Looking at a recording of a held card | Under a hand the first now fades out before the second fades in, with tests, and the protocol was run again |

The first full measurement caught 8 of 9 faults. By the rules in the protocol that invalidated it, so those numbers were discarded rather than reported.

## What the numbers leave out

- **One machine, headless engines.** WebKit here is not Safari on an iPhone, and no physical phone was tested. Touch was emulated.
- **Scrubbing across a layout change.** The `resize` script is not in the replay comparison. While you replay a moment before a viewport change, the page is still at the new width, so flow content cannot match. Springs and recorded bounds replay correctly, but the text inside reflows to today's width.
- **Elements outside the root do not animate.** They take the endpoint layout on the first frame, and a shrinking surface can overlap them for a moment.
- **A second command in one event handler** is applied against the last known layout, then corrected before paint. It is unit tested, but it is not in the fidelity scripts.
- **Queued commands** are covered by unit tests against the real controller with a stub DOM, not by the browser fidelity scripts.
- **No field data.** Lab timings are not field INP. Automated accessibility checks pass, and that does not establish full accessibility. Keyboard, touch width, 200 percent zoom, reduced motion, long labels and dense data were tested. No one using a screen reader has tried it.
- **No usability data.** No person has completed the task. See [`USABILITY.md`](USABILITY.md).
- **A hand.** Every measured result here is for presses. The hand is covered by unit tests, seeded faults and browser tests on the project page, and by no experiment in the protocol.
- **The project page.** Its plate is moments worked out from the take, not measured paints. Its status menu and bottom sheet run on the same runtime and are covered by browser tests, but every measured result here is for the expense inspector. The two example takes that use a hand are written as pointer samples, and no person recorded them. Its CSS figure works a reversed transition out from the CSS rule, and no browser run compares that with the runtime. `pnpm longtasks` drives the built page in headless Chromium at 4 times CPU slowdown: after load, no task ran longer than 50 ms while dragging the card by hand, catching it mid flight, dragging a press, scrubbing, replaying, playing each example, tuning, racing, exporting, saving a plate and moving the interruption in the essay's figures, in three runs, and loading the page took one task of 88 to 90 ms at that slowdown. That is one lab check on one machine, not a frame rate.
- **Manifests.** Every manifest from this run shows a clean tree at `e0d45c6`, because the protocol ran in a fresh clone of that commit. Later commits changed the project page and the documents, and neither the runtime nor the studio.
- **Commit hashes.** A working file that no test or benchmark reads was removed from git history after the first runs, on 2026-11-06. That changed the commit hashes and no measured file. `909eca6` above is the new hash of that earlier run.

## Review

Each milestone had a self-review. An automated review of a clean clone then found 19 issues and several weak tests, and those are fixed. No human has reviewed this code.

## Reproduce

```bash
pnpm bench
```

Raw samples and a manifest for each experiment are in [`results/`](../results). `pnpm bench:smoke` checks the harness. Its numbers are not results.
