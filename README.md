# agentlens

A front-end-only library that estimates whether a browsing session is driven by an agent (computer use, Playwright, in-browser assistants) or a human. It listens passively to pointer, keyboard and scroll events, folds them on the device into fixed-bin histograms, and hands a verdict to your callback. The core never makes a network request; reporting is yours to wire up.

**Status: M1, all signals and rules.** Every listener and probe in [docs/plan/03-architecture.md](docs/plan/03-architecture.md) section 4 is in, with the Tier 1 and Tier 2 scorer, gates, labels and confidence. Thresholds marked placeholder in `src/scorer/rules.ts` wait on the M2 human cohorts, and nothing here is a release yet (section 9 lists the milestones).

**A verdict computed in the visitor's browser is readable and forgeable.** It is for understanding your own traffic in aggregate, never for enforcement. `human-like` means "no agent rule reached threshold", never "verified human".

```ts
import { createDetector } from "./vendor/agentlens/agentlens.mjs";

const d = createDetector(); // same instance on every call until d.destroy()
d.on("signal", (s) => console.log("hard tell", s.rule, s.agentClass));
d.on("verdict", (v) => console.log(v.label, v.agentClass, v.confidence, v.evidence));
```

Distribution is GitHub only: built files (`agentlens.mjs`, `agentlens.iife.js` with a `window.agentlens` global, `scorer.mjs`, `.d.ts`) attach to tagged GitHub Releases. There is no npm package.

## Verdicts and signals

- **`'verdict'`** fires once per page when the tab first goes hidden or on `pagehide` (`reason: "flush"`), and whenever the label or class changes (`reason: "label-change"`). `insufficient-data` and `abstain` never trigger a label change, so nothing fires in the first seconds. `snapshot()` scores on demand without emitting.
- **`'signal'`** fires once per Tier 1 rule per session, as soon as the tell lands: `C-marker` (Claude in Chrome), `BU-marker` (Browser Use or legacy Playwright highlights), `webdriver`, `headless-ua`, `fw-globals` (automation framework globals), `BU-trio` (Browser Use's synthetic input/change/blur), and `custom-marker` for your own `extraMarkers`.
- **Labels.** Any Tier 1 rule gives `agent-likely` with confidence `certain`. Otherwise fewer than `minActions` (default 3) actions give `insufficient-data`; two or more behavioural (Tier 2) rules give `agent-likely` with class A or B when a class profile matches, else `agent-unattributed`, at `high` with three or more rules and `medium` with two. One or zero rules give `human-like` (`low` or `medium`); when every behavioural gate abstains (for example a keyboard-only session) the label is `abstain`. R8 (think-time cadence) only corroborates and never counts toward the two. Class C is only ever attributed through its DOM marker.
- **Accessibility gates.** Pointer rules run only on trusted mouse input; keyboard and switch activations (`detail === 0`), dictation (`insertText` with no keys), IME composition, trackpad taps and touch sessions abstain rather than flag.

## Options and privacy

| Option            | Default     | Effect                                                                                                                                                     |
| ----------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `minActions`      | `3`         | Actions needed before any Tier 2 label.                                                                                                                    |
| `storage`         | `"session"` | `sessionStorage["al:v1"]` per tab across pages; `"memory"` makes each page its own session. Any storage error falls back to memory.                        |
| `respectGPC`      | `true`      | Global Privacy Control forces minimal mode and memory storage.                                                                                             |
| `minimal`         | `false`     | Minimal mode without GPC.                                                                                                                                  |
| `ignore`          | `[]`        | Extra selectors whose subtrees are never observed, on top of `[data-al-ignore]`, password, `cc-*` and one-time-code fields. Invalid selectors are dropped. |
| `extraMarkers`    | `[]`        | Your own marker selectors, reported as `custom-marker` with no class.                                                                                      |
| `scoreDebounceMs` | `1000`      | Quiet time after input before re-scoring.                                                                                                                  |

**Minimal mode** (GPC or `minimal: true`) attaches no input listeners, only the flush triggers. It runs the one-shot probes and the marker check, so a Tier 1 tell still gives `agent-likely`; otherwise the label is `abstain` with evidence rule `gpc` (or `minimal`), never `human-like`. Its `features` hold probe bits and marker hits only. It leaves the tab's stored behavioural features from earlier pages untouched and only advances `seq` and `pageCount`.

**What leaves the device** is decided by your callback. `features` (in every verdict) is bounded integers, fixed-bin histograms, booleans, `null` and closed enums, checked by a schema test: never coordinates, key values, field contents, clipboard data, URLs, the raw user agent or the raw WebGL renderer.

## Re-scoring offline

`scorer.mjs` is the pure scorer with no DOM, for Node or your own server:

```ts
import { score, validateFeatures, RULESET } from "./vendor/agentlens/scorer.mjs";

const check = validateFeatures(v.features, v.featuresVersion);
if (check.ok) score(check.features, RULESET, { mode: v.mode });
```

A re-score that disagrees with the reported label catches a lazily forged verdict, not forged features.

## Size

`pnpm size` (size-limit, gzip) on the M1 build: `agentlens.mjs` 9.91 kB, `agentlens.iife.js` 9.95 kB, `scorer.mjs` 4.07 kB, against a 10 kB cap (10.5 kB for the IIFE).

## Develop

Tasks run through Turborepo with a local cache; see [docs/decisions/0001-toolchain.md](docs/decisions/0001-toolchain.md) for why each tool was chosen.

```sh
pnpm install
pnpm check        # everything CI runs: lint, typecheck, build, test, size, check-exports
pnpm build        # packages/core/dist: agentlens.mjs, agentlens.iife.js, scorer.mjs and .d.ts
pnpm test         # builds first where a test needs the bundle
pnpm lint         # oxlint (type-aware) and oxfmt --check; `pnpm format` rewrites
pnpm size         # size-limit on the built files, gzipped
pnpm changeset    # describe a consumer-visible change to @agentlens/core
pnpm --filter @agentlens/recorder start            # fixture page + JSONL recorder on :8787
pnpm --filter @agentlens/runners-ts exec playwright install chromium
pnpm --filter @agentlens/runners-ts playwright     # Playwright against the fixture
```

`harness/runners-py` is the computer-use-demo driver (a uv project). It prints the run plan and refuses to start without `ANTHROPIC_API_KEY`; secrets come from 1Password via `op run --env-file .env.op`.

## Layout

`packages/core` (library: `src/extractors` one module per signal family, `src/probes`, `src/scorer` rules as data, `src/detector.ts` wiring through an injected `Env`), `apps/fixture` (static task page), `harness/recorder` (JSONL sink), `harness/runners-ts` and `harness/runners-py` (agent runners), `docs/plan` (research and architecture), `docs/decisions` (decision records).

## Licence

MIT.
