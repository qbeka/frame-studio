# Clean checkout verification

Run `scripts/verify-clean.sh --bench`. It clones the repository into a temp folder, installs from the frozen lockfile, and runs everything from there.

Last run on 2026-11-06 at commit `8f33bba`:

| Step | Result |
|---|---|
| `pnpm install --frozen-lockfile` | Passed |
| `pnpm check` | Passed, with types and the copy rules on 125 files |
| `pnpm test` | 118 of 118 passed |
| `pnpm build` | Passed |
| `pnpm test:e2e` | 64 of 64 passed |
| `pnpm bench:smoke` | Finished. Its numbers are not results. |
| Working tree afterwards | Unchanged, apart from `evidence/` |

Every port was free at the start, so no server from another checkout could be reused. The browser suite ran in Chromium. `consumer.spec` and `fidelity.spec` also passed in WebKit and Firefox before the final fixes, and the measured fidelity run covers all three engines at `fdea218`.

Mutation testing is run separately with `node scripts/mutants.mjs`. The result in `results/mutants/` is 46 of 46 caught, with the unmodified suite passing before and after.

No public URL or npm package exists. Publishing has not been done.
