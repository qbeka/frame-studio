# Design

## Who this is for

A frontend engineer refining one bounded interaction, such as an inspector, a command surface or an expandable receipt. They already have a working React component. They want it to move well when a person changes their mind halfway.

## The problem

Most motion is authored as if it always finishes. Real people reverse a panel halfway, type while it opens, and cancel a save that has not landed. Existing tools show the uninterrupted path. The interrupted path is usually found by accident in production.

## The primary task

Build a three-state inspector: compact, editing and confirmation. Use it for real. Interrupt it. Change what happens at the interruption. Export a small working version.

## Two approaches to the central workflow

### A. Timeline first

```
 [ tracks ]  0ms      200ms      400ms
 panel.y     o---------o----------o
 panel.w     o--------------------o
 body.alpha       o---------------o
```

You place keyframes against a clock and press play. It is familiar and fast to read. Theatre.js works this way and does it well.

It fails this task. A keyframe says "at 200ms the value is 40". An interruption has no fixed time. It lands whenever the person acts, from whatever position and speed the component has reached. To author it on a timeline you would need one track for every possible interruption moment.

### B. Take first (chosen)

```
 [ live component ]   you use it, it is recorded as commands
 ------------------------------------------------------------
 take:   open ----- cancel ---- open
 path:      ___/\_____
           /      \___     the dotted line is the path without the interruption
 drag the cancel marker: the path and the component both update
```

You use the real component. Frame records commands against logical target IDs, with the measured layout at each one. That recording is a take. The take is replayed through a pure evaluator, so you can scrub it, edit a spring and see the same sequence recomputed, or drag the interruption to a new moment.

What you edit is a rule: when command C lands during transition T, retarget from the current position and speed with this spring. That rule is what gets exported.

### Decision

Approach B. The rejected design is the keyframe timeline, because a keyframe cannot state an interruption rule. The timeline stays as a readout of one take, and it never owns the motion data. The trade is that B is less familiar and offers no arbitrary choreography.

## The signature interaction

The take ribbon. It draws one channel's real path with a dotted ghost of the path without the interruption. Drag the interruption marker along it and the live component scrubs with you.

Everything else stays quiet.

## A hand is one more interruption

A press that lands mid flight and a hand that lets go mid flight ask for the same thing: start a new leg from wherever the component is, at whatever speed it has. So the hand needed no physics of its own. `grab` starts the same transition a command would, with one difference, that its channels follow the hand's progress between the two measured layouts instead of their curves. The leg a hand drives reports a position and a speed like any other leg, so when the hand lets go the ordinary retarget reads them and carries on. A take records the hand as events, and the pure evaluator replays them.

Two choices are not obvious. The speed is the least squares slope of the last 80 ms of samples, because one late pointer event swings a two point estimate. And where one target leaves as another arrives, the first fades out before the second fades in, because a hand can wait halfway for as long as it likes, and both half shown over each other is not a state anyone designed.

On the project page the record of a take is a plate: a long exposure of the followed target, in place behind the component, where ink builds up with time spent. The studio has neither the hand nor the plate. It has no way to know which edge a pointer should follow, and it opens held at the interruption, where the component covers its own exposure.

## Layout model

Three things must hold at once: text must not distort, endpoints must come from native flow, and focus and input state must survive.

| Mode | Applies to | How it renders |
|---|---|---|
| `translate` | Anything, including text | `transform: translate()` from the measured box. Size snaps. |
| `surface` | A text-free background layer | Absolute layer sized with `width` and `height` under `contain: strict`. It can never push siblings. |
| `clip` | A content wrapper | `clip-path: inset()` in pixels, so children are revealed without being stretched. Children do not move. |
| `scale` | Text-free elements only | `transform: translate() scale()`. Rejected on a target that holds text. |

I did not copy scale correction. Motion's documentation lists the costs: stretched borders, and rules about which styles can be corrected. A hairline border is central to this visual language, so the surface layer keeps a true 1px border and a true radius at every size.

Elements outside the registered root are not animated. They take the endpoint layout on the first frame.

## Screens

Desktop: state list and a compact graph on the left, the live component in the middle, the inspector for the selection on the right, the transport and ribbon along the bottom.

Below 768 CSS pixels: preview, transport and the selected property's controls. The graph is replaced by the state list, which is also the accessible alternative at every size.

## Type

Geist Serif for editorial text. Geist Sans for dense controls, as the project brief asks. Geist Mono for numbers. This is a deliberate exception to the Geist Serif rule used on my public sites, because this is a dense tool.
