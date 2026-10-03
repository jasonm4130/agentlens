# agentlens

A front-end-only library that estimates whether a browsing session is driven by an agent (computer use, Playwright, in-browser assistants) or a human. It listens passively to pointer, keyboard and scroll events, folds them on the device into fixed-bin histograms, and hands a verdict to your callback. The core never makes a network request; reporting is yours to wire up.

**Status: M0 scaffold.** The `createDetector` skeleton, the #1 (pointer path), #2 (click dwell), #6 (keystroke timing) and #10 (scroll) extractors, session state, and a stub scorer that emits `features` are in. The scorer has no rules yet, so labels are `insufficient-data` or `abstain`. See [docs/plan/03-architecture.md](docs/plan/03-architecture.md) section 9 for the milestones.

**Minimal mode.** When the browser sends Global Privacy Control (unless `respectGPC: false`) or you pass `minimal: true`, the detector attaches no input listeners, only the flush triggers (`visibilitychange` to hidden and `pagehide`). Each page still emits one `flush` verdict with label `abstain`, evidence rule `gpc` (or `minimal` when forced), and empty `features`. GPC also forces memory-only storage.

**A verdict computed in the visitor's browser is readable and forgeable.** It is for understanding your own traffic in aggregate, never for enforcement.

```ts
import { createDetector } from "./vendor/agentlens/agentlens.mjs";

const d = createDetector();
d.on("verdict", (v) => console.log(v.label, v.features));
```

Distribution is GitHub only: built files (`agentlens.mjs`, `agentlens.iife.js`, `.d.ts`) attach to tagged GitHub Releases. There is no npm package.

## Develop

```sh
pnpm install
pnpm build        # packages/core/dist: agentlens.mjs, agentlens.iife.js, agentlens.d.ts
pnpm test         # needs a build first (the SSR test imports the built bundle)
pnpm lint
pnpm --filter @agentlens/recorder start            # fixture page + JSONL recorder on :8787
pnpm --filter @agentlens/runners-ts exec playwright install chromium
pnpm --filter @agentlens/runners-ts playwright     # Playwright against the fixture
```

`harness/runners-py` is the computer-use-demo driver (a uv project). It prints the run plan and refuses to start without `ANTHROPIC_API_KEY`; secrets come from 1Password via `op run --env-file .env.op`.

## Layout

`packages/core` (library), `apps/fixture` (static task page), `harness/recorder` (JSONL sink), `harness/runners-ts` and `harness/runners-py` (agent runners), `docs/plan` (research and architecture).

## Licence

MIT.
