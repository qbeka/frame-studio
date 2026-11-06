# Measurement protocol

Frozen on 2026-11-06, before the first measured run. A change to anything here means rerunning and saying so in the report.

## What is measured

| Experiment | Question | Pass criteria |
|---|---|---|
| Fidelity | Do the studio and the export draw the same thing at the same time? | At most 0.5 CSS px of geometry and 0.01 opacity disagreement, in every script, every run |
| Reference | Does real browser geometry match an independent solution of the physics? | At most 0.11 px on the surface height (0.1 px settle snap plus drawing precision) |
| Controls | Would the fidelity check notice a broken export? | Every seeded fault is detected, and an unmodified export is not flagged |
| Authoring | Is editing fast enough to feel direct? | Reported, with no pass mark. The target is under one 60 Hz frame (16.7 ms) to DOM update at 30 targets. |
| Size | What does a consumer pay? | Reported against the baseline, with no pass mark |
| Runtime | What does it cost per interaction? | Reported against the baseline, with no pass mark |

The numbers in the pass criteria are targets from the project brief. They are not results.

## Workloads

**Fidelity.** The four scripts in `tests/support/scripts.ts`, run on the authored inspector, with seeded sample times at about 60 Hz and half a step of jitter. Run at device scale 1 and 2 in Chromium, WebKit and Firefox. Each engine compares the studio to the export inside itself. The studio is the production build. The export is a production build in a clean temp folder. Both use the manual clock.

**Authoring.** `bench/fixtures` gives the same component with 1, 10 and 30 declared targets, and separately a stress fixture with 200. Each run records one take of open, interrupt, settle, then discards 20 warmup edits and measures 60 property edits and 60 seeks.

**Runtime.** Twenty cycles of: open, wait 150 ms, reverse, wait 500 ms. Real clock.

## Baseline

A hand-written Motion for React version of the same inspector, in `bench/apps/motion`, with the same spring parameters, the same reversal and the same fading content. `bench/apps/motion-lazy` is the same code using `LazyMotion`, Motion's documented way to reduce bundle size, because comparing only against the full import would flatter Frame. Size is compared to `bench/apps/none`, the same UI with no animation. Every runtime row records whether the panel really turned around mid flight. This compares one interaction and supports no general claim.

## Metrics

- **Geometry disagreement:** the largest absolute difference in x, y, width or height, across targets and samples.
- **Opacity disagreement:** the largest absolute difference in computed opacity.
- **Edit to DOM:** from dispatching the input event until the ribbon path has changed, confirmed by reading it.
- **Edit to frame:** from the same moment until the next animation frame has run. This is a proxy. A frame callback does not prove a displayed frame.
- **Size:** gzip of built JavaScript and CSS, level 9.
- **Main thread:** Chrome's `ScriptDuration`, `LayoutDuration`, `RecalcStyleDuration` and `TaskDuration` over the whole workload, per cycle.

## Runs

Five independent runs per condition, each in a new browser process. Samples inside one run are not independent, so tables report the median of run level values and the range across runs. There are no exclusions. A failed run is recorded as a failure.

## What this cannot show

- Lab timings on one machine are not field INP.
- Headless engines from Playwright on one Mac. WebKit here is not Safari on an iPhone. Authoring and runtime timings are Chromium only.
- No human usability data. See `docs/USABILITY.md`.
