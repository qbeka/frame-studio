# Attribution

Frame's source is MIT licensed. See `LICENSE`. That covers only code in this repository written for this project.

| Third party | Used for | License | Notice |
|---|---|---|---|
| Geist, Geist Mono, Geist Serif by Vercel and basement.studio | Fonts in the editor interface | SIL Open Font License 1.1 | `packages/studio/editor/fonts/OFL-Geist.txt` |
| React | Peer dependency | MIT | Installed, not vendored |
| Vite and `@vitejs/plugin-react` | Editor dev server and build | MIT | Installed, not vendored |
| Motion 14.9.1 | Benchmark baseline only, never shipped | MIT | Installed in `bench/apps` |
| mpmath 1.3.0 | Generates the reference values | BSD 3-Clause | Run through `uv`, not vendored |

An export contains your spec and a copy of Frame's runtime source. It has no third party code. The fonts are not part of an export.

Frame is not affiliated with Vercel, Motion, Theatre.js, Rive or any of their designers. Geist is used under its open license.
