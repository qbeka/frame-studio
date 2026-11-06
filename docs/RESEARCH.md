# Research

Read on 2026-11-06. Comparisons below are about product scope. No benchmark here supports a claim that Frame is broadly better than any of these tools.

## Adopted and rejected

| Source | Idea used | Difference |
|---|---|---|
| [Theatre.js sequences](https://theatrejs.com/docs/latest/manual/sequences) and [core API 0.5](https://www.theatrejs.com/docs/0.5/api/core) | Keep the editor out of the production bundle. Production loads exported JSON state through `@theatre/core`. | Theatre.js sequences keyframes against a timeline. Frame stores event rules and has no keyframes. The Studio link in the brief returned 404, so I read these pages instead. |
| [Rive features](https://rive.app/features) and [web runtime](https://rive.app/docs/runtimes/web/web-js) | Inputs as a stated contract between design and engineering. That became the registration API. | Rive draws its own graphics into a canvas you supply. Frame moves the real DOM of your component, so inputs, focus and native text keep working. |
| [Motion layout animations](https://motion.dev/docs/react-layout-animations) | Take endpoints from native layout. Separate position-only motion from size motion, as `layout="position"` does. | Motion uses `transform` scale with correction. Frame avoids scale on anything with text or a border. Motion is the runtime cost baseline. |
| [Web Animations API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Animations_API) | Milliseconds as the time unit. | It has no spring timing function and no velocity carry into a new animation, so a CSS or Web Animations export cannot preserve a retarget. See the export report. |
| [Great animations](https://emilkowal.ski/ui/great-animations) | Interruption as a first-class requirement, transform and opacity as the default, reduced motion as a real path, short durations. | `surface` and `clip` deliberately pay paint cost because size has to change without distorting content. |
| [APG slider](https://www.w3.org/WAI/ARIA/apg/patterns/slider/) | Transport uses role `slider`, the arrows, Page Up and Down, Home and End, and `aria-valuetext`. | Values are milliseconds, announced as time plus current state. |

## Limits of the comparison

- I read documentation. I did not author the same task in Theatre.js or Rive.
- The Rive features page does not state the rendering target. The web runtime page does.
- The runtime baseline compares one interaction only.

## Name check

Run on 2026-11-06. `frame-studio` was free on npm and `qbeka/frame-studio` was free on GitHub. A web search found no product called Frame Studio. It did find [FrameScript](https://frame-script.github.io/FrameScript), a code-first motion graphics toolkit with a Studio app, which is a close neighbor. Framer is a large neighbor with a similar name. Check again before any public release.

## Pinned versions

See `package.json` and `pnpm-lock.yaml`.
