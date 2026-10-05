# agentlens

A front-end-only TypeScript library that estimates whether a browsing session is driven by an agent (computer use, Playwright and friends, in-browser assistants) or a human. It listens passively to pointer, keyboard, form and scroll events, folds them on the device into fixed-bin histograms, scores the session with a compiled-in rules engine, and hands the verdict to your callback. **The core never makes a network request.** What you do with the verdict is yours.

**Status: M2 (release gate, eval and docs), not yet released.** The release gate in [docs/plan/03-architecture.md](docs/plan/03-architecture.md) section 7.6 has **not passed**: no human or assistive-technology sessions have been recorded yet, the Claude in Chrome runs need an operator, and the computer-use runs need a direct Anthropic key, Docker and an operator. The [gate report](eval/reports/gate-2026-10-05.md) lists every check and what each still needs. Until the gate passes, treat behavioural (Tier 2) labels as evidence only.

## The trade-off, first

**A verdict computed in the visitor's browser is readable and forgeable.** The rules and thresholds are public, the bundle is on the page, and any script running in the page (an agent's injected code, an in-browser extension agent) can read the verdict, stub the listeners, dispatch events that satisfy the gates, or call your callback with a fabricated `human-like`.

That is acceptable for what this library is for: **understanding your own traffic in aggregate**, where an adversary who bothers to forge the verdict is a small, documented bias. It is **not** acceptable for enforcement. agentlens ships no blocking, gating, challenge or step-up features, and a behavioural verdict must never gate access to anything. If a verdict is going to change what your server does, re-validate it on the server with signals the page cannot fake ([recipe 3](#3-server-side-re-validation)) and assume a determined agent passes.

`human-like` means "no agent rule reached threshold", never "verified human".

## What it can honestly detect, by class

- **Class A, browsers driven over CDP (Playwright, Puppeteer, Browser Use).** Stock automation is caught with near-certainty by runtime and page markers: `navigator.webdriver`, the HeadlessChrome user agent, framework globals, Browser Use's highlight markers and its synthetic input/change/blur sequence. Patched stacks (Patchright, Camoufox) remove those, and are then caught only by behaviour; a humanised pointer (ghost-cursor) defeats most of that.
- **Class B, OS-level computer use (screenshot, model, xdotool in a VM).** Detected only when it behaves like Anthropic's reference harness: warped cursor, zero dwell, a fixed 12 ms typing gap, regular wheel ticks, software WebGL. Each tell is one line of harness code to remove, so **B is always a lower bound.**
- **Class C, agents inside the visitor's own browser (Claude in Chrome, Atlas, Comet, Gemini in Chrome).** Attributed to C only when a C-specific page marker is present (Claude in Chrome's). Behaviour alone on a real desktop browser looks like a human false positive, so it is reported as `agent-unattributed`, never as C. Gemini in Chrome is entirely unmeasured. Class C is also the class best placed to forge the verdict; treat any C result as best effort.

### What has been measured so far

From the harness runs of 2026-10-05 on the fixture page (Linux, Chromium 153, ruleset 2026.10.1), each run a fresh browser doing the same 3-page task; full tables with baselines in the [gate report](eval/reports/gate-2026-10-05.md):

| Generator (class A)                                           | Runs | Flagged (agent-likely or agent-unattributed) | How                         | BotD 2.0.0 | agent-detector 0.3.0 |
| ------------------------------------------------------------- | ---- | -------------------------------------------- | --------------------------- | ---------- | -------------------- |
| Playwright, headless                                          | 15   | 15/15 (95% CI 79.6-100%)                     | Tier 1: webdriver, headless | 15/15      | 15/15                |
| Playwright, headful                                           | 15   | 15/15 (95% CI 79.6-100%)                     | Tier 1: webdriver           | 15/15      | 15/15                |
| Patchright, headful                                           | 15   | 15/15 (95% CI 79.6-100%), all unattributed   | Tier 2: R1/R2 path, R7      | 0/15       | 0/15                 |
| Playwright + ghost-cursor, headful                            | 10   | 10/10 (95% CI 72.2-100%)                     | Tier 1: webdriver           | 10/10      | 10/10                |
| Patchright + ghost-cursor, headful                            | 10   | 0/10 (95% CI 0-27.8%)                        | missed: labelled human-like | 0/10       | 0/10                 |
| Browser Use 0.13.10, Claude Sonnet 5 (1 headless, 15 headful) | 16   | 16/16 (95% CI 80.6-100%)                     | Tier 1: BU-marker, BU-trio  | 1/16       | 16/16                |

**These are recall numbers on class A agents only, and say nothing about false positives.** Zero flags in n human sessions bounds the false-positive rate only below about 3/n: 40 sessions give ~7.5%, 5-8 sessions in one cohort ~40-60%, 120 assistive-technology sessions ~2.5%, ~1,000 ~0.3%. No human sessions have been recorded yet, so there is no false-positive bound at all, and the Patchright result rests on behavioural rules whose human false-positive rate is unmeasured. The harness proves the gates work; it does not prove the false-positive rate is low.

## Install

There is no npm package. Each tagged [GitHub Release](https://github.com/jasonm4130/agentlens/releases) attaches the files to vendor into your site, with a `SHA256SUMS`:

| File                            | What                                                                        |
| ------------------------------- | --------------------------------------------------------------------------- |
| `agentlens.mjs`                 | ES module: `createDetector`                                                 |
| `agentlens.iife.js`             | Classic script; sets `window.agentlens.createDetector`                      |
| `scorer.mjs`                    | Pure scorer for Node or your server: `score`, `RULESET`, `validateFeatures` |
| `agentlens.d.ts`, `scorer.d.ts` | Types                                                                       |

Each file is self-contained with no dependencies; ES2020 evergreen browsers. Sizes (gzip): `agentlens.mjs` 9.95 kB, `agentlens.iife.js` 9.98 kB, `scorer.mjs` 3.94 kB.

## Use

```ts
import { createDetector } from "./vendor/agentlens/agentlens.mjs";

const d = createDetector(); // the same instance on every call until d.destroy()
d.on("signal", (s) => console.log("hard tell", s.rule, s.agentClass));
d.on("verdict", (v) => console.log(v.label, v.agentClass, v.confidence, v.evidence));
```

```html
<script src="/vendor/agentlens/agentlens.iife.js"></script>
<script>
  const d = window.agentlens.createDetector();
  d.on("verdict", (v) => console.log(v.label, v.confidence));
</script>
```

## API

```ts
createDetector(options?: DetectorOptions): Detector
```

On the server (`typeof window === "undefined"`) it returns an inert detector whose `snapshot()` is `abstain` with evidence rule `ssr`; importing the module has no side effects. In the browser it reads or starts the session, runs the one-shot probes and the marker check, and attaches passive capture-phase listeners on `window`. It adds no DOM and nothing to `window` (the IIFE build adds only `window.agentlens`).

| `Detector` member     | Does                                                                                         |
| --------------------- | -------------------------------------------------------------------------------------------- |
| `on("verdict", cb)`   | Subscribe to verdicts; returns the unsubscribe function.                                     |
| `on("signal", cb)`    | Subscribe to Tier 1 hard tells; returns the unsubscribe function.                            |
| `snapshot()`          | Score now and return a `Verdict` (`reason: "snapshot"`) without emitting.                    |
| `destroy({ clear? })` | Detach listeners and timers. Saves the session state first, or erases it with `clear: true`. |

| Option            | Default     | Effect                                                                                                                                                        |
| ----------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `minActions`      | `3`         | Actions needed before any Tier 2 label; below it the label is `insufficient-data`.                                                                            |
| `storage`         | `"session"` | `sessionStorage["al:v1"]` per tab across pages; `"memory"` makes each page its own session (see [privacy](#privacy)). Any storage error falls back to memory. |
| `respectGPC`      | `true`      | Global Privacy Control forces minimal mode and memory storage.                                                                                                |
| `minimal`         | `false`     | Minimal mode without GPC.                                                                                                                                     |
| `ignore`          | `[]`        | Extra selectors whose subtrees are never observed, on top of `[data-al-ignore]`, password, `cc-*` and one-time-code fields. Invalid selectors are dropped.    |
| `extraMarkers`    | `[]`        | Your own marker selectors, reported as `custom-marker` with no class.                                                                                         |
| `scoreDebounceMs` | `1000`      | Quiet time after input before re-scoring; continuous input still re-scores every 10 s.                                                                        |

**Events.**

- **`'verdict'`** fires once per page when the tab first goes hidden or on `pagehide` (`reason: "flush"`), and whenever the label or class changes (`reason: "label-change"`). `insufficient-data` and `abstain` never trigger a label change, so nothing fires in the first seconds.
- **`'signal'`** fires once per Tier 1 rule per session, as soon as the tell lands: `C-marker` (Claude in Chrome), `BU-marker` (Browser Use or legacy Playwright highlights), `webdriver`, `headless-ua`, `fw-globals` (automation framework globals), `BU-trio` (Browser Use's synthetic input/change/blur), and `custom-marker` for your `extraMarkers`.

**`Verdict`** fields: `label`; `agentClass` (`"A" | "B" | "C"`, only with `agent-likely`); `confidence`; `evidence` (`{rule, detail}[]`, the rules that fired plus abstain reasons, with details from fixed templates filled with numbers only); `cohort` (`mouse`, `touch`, `keyboard`, `mixed` or `none`, from raw modality counts); `mode` (`full`, or `minimal` under GPC or `minimal: true`); `features` (always included, see [data collected](#data-collected)); `featuresVersion`; `rulesetVersion`; `sessionId` (random 128-bit hex, per tab, or per page with memory storage); `seq` (rises with every emitted verdict in the session); `reason`.

**Labels**, evaluated in order:

| Condition                                                            | `label`              | `agentClass` | `confidence`                        |
| -------------------------------------------------------------------- | -------------------- | ------------ | ----------------------------------- |
| any Tier 1 rule                                                      | `agent-likely`       | per rule     | `certain`                           |
| minimal mode, no Tier 1                                              | `abstain`            | —            | `low`                               |
| fewer than `minActions` actions                                      | `insufficient-data`  | —            | `low`                               |
| 2+ Tier 2 rules and a class profile (A or B)                         | `agent-likely`       | A or B       | `high` with 3+ rules, else `medium` |
| 2+ Tier 2 rules, no class profile                                    | `agent-unattributed` | —            | `high` with 3+ rules, else `medium` |
| enough actions, but every Tier 2 gate abstained (e.g. keyboard-only) | `abstain`            | —            | `low`                               |
| 0-1 Tier 2 rules                                                     | `human-like`         | —            | `medium` with 0, `low` with 1       |

`confidence` is an ordinal tier, not a probability. R8 (think-time cadence) only corroborates and never counts toward the two. Class C is only ever attributed through its page marker. **Accessibility gates are structural:** pointer rules run only on trusted mouse input; keyboard and switch activations (`detail === 0`), dictation (`insertText` with no keys), IME composition, trackpad taps and touch sessions abstain rather than flag, and abstain beats flag. An agent that uses only keyboard activations therefore abstains too; count `abstain` as its own bar, never as a flag.

## Reporting recipes

Reporting is a few lines of your own code; agentlens never sends anything. In any aggregate, the share is the share of sessions that _ran the library_ (blockers, `noscript`, consent gating and lost beacons shrink the denominator). Report `insufficient-data` and `abstain` as their own bars, with Wilson intervals.

### 1. sendBeacon to your own endpoint

```ts
const d = createDetector();
d.on("verdict", (v) => {
  const body = new Blob([JSON.stringify(v)], { type: "text/plain;charset=UTF-8" });
  navigator.sendBeacon("/analytics/agentlens", body);
});
```

`text/plain` is meant to keep a cross-origin request CORS-safelisted (remembered, not verified here). `sendBeacon` on `pagehide` is best effort, so some verdicts are lost: count them as missing, never as evidence. De-duplicate on your side by `(sessionId, seq)`.

### 2. PostHog and GA4

```ts
d.on("verdict", (v) => {
  // PostHog: low-cardinality fields; add `features` only if your privacy notice covers it.
  posthog.capture("agentlens_verdict", {
    label: v.label,
    agent_class: v.agentClass ?? null,
    confidence: v.confidence,
    rules: v.evidence.map((e) => e.rule).join(","),
    ruleset: v.rulesetVersion,
  });
  // GA4: label, class and confidence only. Its parameter limits rule out `features`.
  gtag("event", "agentlens_verdict", {
    label: v.label,
    agent_class: v.agentClass ?? "none",
    confidence: v.confidence,
  });
});
```

Both vendor APIs and GA4's limits (remembered as ~25 parameters and 100-character values) are unverified here and are re-checked when tested adapters ship (M3).

### 3. Server-side re-validation

If a verdict is going to change what a server does, the server must not trust it. At minimum, re-score the reported `features` with `scorer.mjs` in Node and reject a verdict whose label disagrees with its own features:

```ts
import { RULESET, score, validateFeatures } from "./vendor/agentlens/scorer.mjs";

function recheck(v) {
  const check = validateFeatures(v.features, v.featuresVersion);
  if (!check.ok) return { ok: false, reason: check.reason };
  const s = score(check.features, RULESET, { mode: v.mode });
  return { ok: s.label === v.label, label: s.label };
}
```

This catches a lazily forged label, not forged features. Combine it with signals the page cannot fake (Web Bot Auth signature verification, Sec-Fetch consistency, ASN, Turnstile), and even then treat the behavioural verdict as a soft signal (label, rate-limit), never as a block on its own. A newer release's `scorer.mjs` can also re-score `features` you stored earlier.

## Framework snippets

Create the detector in an effect and destroy it in cleanup. `createDetector` returns the same instance until `destroy`, so a re-render cannot double-count.

**React**

```tsx
import { useEffect } from "react";
import { createDetector } from "./vendor/agentlens/agentlens.mjs";

export function AgentLens({ onVerdict }) {
  useEffect(() => {
    const d = createDetector();
    const off = d.on("verdict", onVerdict);
    return () => {
      off();
      d.destroy();
    };
  }, [onVerdict]);
  return null;
}
```

**Vue**

```vue
<script setup>
import { onMounted, onBeforeUnmount } from "vue";
import { createDetector } from "./vendor/agentlens/agentlens.mjs";

let d;
onMounted(() => {
  d = createDetector();
  d.on("verdict", (v) => console.log(v.label));
});
onBeforeUnmount(() => d?.destroy());
</script>
```

**Svelte**

```svelte
<script>
  import { onMount } from "svelte";
  import { createDetector } from "./vendor/agentlens/agentlens.mjs";

  onMount(() => {
    const d = createDetector();
    d.on("verdict", (v) => console.log(v.label));
    return () => d.destroy();
  });
</script>
```

Put the component once near the root of a single-page app: the session continues across client-side navigations, and a flush verdict fires when the tab is hidden or closed.

## Privacy

- **On-device only.** Events are folded into counts and fixed-bin histograms as they arrive and dropped. Never collected: pointer coordinates, key values or codes, field values or lengths (beyond a "grew by more than 3 characters" boolean), clipboard contents, element text, URLs, the raw user agent, the raw WebGL renderer, fonts, canvas. No cookies; no fingerprinting library; no disability inference.
- **Skipped entirely:** `type=password`, `autocomplete=cc-*` and `one-time-code` fields, `[data-al-ignore]` subtrees, and your `ignore` selectors.
- **What leaves the device** is decided by your callback. A CI test fails the build if any `features` field is a free string, a coordinate or an unbounded number; the [table below](#data-collected) is generated from the same schema.
- **Storage.** By default the session (features, a random id, counters) is kept in `sessionStorage` for the tab, so a visit is judged across its pages. **`storage: "memory"` is the EU-cautious option:** nothing is stored on the device at all, and each page is judged alone. The trade-off, plainly: no cross-page visit continuity, so short pages end `insufficient-data` or `abstain` more often; the signals, the scoring and the bundle size are unchanged. You can start with memory and switch to session once consent is given (`d.destroy(); d = createDetector({ storage: "session" })`; that page starts a new session). GPC already forces memory storage and minimal mode.
- **Global Privacy Control** (`navigator.globalPrivacyControl === true`, honoured by default) forces minimal mode: probe bits, marker hits and counts only, no timing histograms, no input listeners, memory storage. The label is `abstain` (evidence `gpc`) unless a Tier 1 rule fires, never `human-like`.

agentlens transmits nothing, so the legal questions sit with the site that deploys it. [docs/privacy.md](docs/privacy.md) is a checklist for your counsel (not legal advice), with the questions to answer (including whether reading `sessionStorage` here needs consent under ePrivacy Art 5(3); agentlens makes no claim either way) and an Australian Privacy Act (APP 1 / APP 5) notice template.

### Data collected

Every field `features` can contain. All counts saturate at their maximum; a histogram or moment is `null` until it has a sample, never zero-filled.

<details>
<summary>All <code>features</code> fields (generated from the schema)</summary>

<!-- data-collected:start (generated by `pnpm --filter @agentlens/runners-ts data-table --write`) -->

| Field                               | Type and bounds                                                                               | What it is                                                                     |
| ----------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `counts.mouseEvents`                | integer 0-65535                                                                               | Trusted pointer events from a mouse                                            |
| `counts.touchEvents`                | integer 0-65535                                                                               | Trusted pointer events from touch                                              |
| `counts.penEvents`                  | integer 0-65535                                                                               | Trusted pointer events from a pen                                              |
| `counts.clicks`                     | integer 0-65535                                                                               | Trusted primary-button mouse clicks (pointerdown then pointerup)               |
| `counts.anchoredClicks`             | integer 0-65535                                                                               | Clicks whose start point is known (not the first on a page)                    |
| `counts.singleMoveClicks`           | integer 0-65535                                                                               | Clicks with at most one move in the 300 ms before                              |
| `counts.displacedSingleMoveClicks`  | integer 0-65535                                                                               | Single-move clicks that also jumped from the previous point                    |
| `counts.shortDwellClicks`           | integer 0-65535                                                                               | Clicks held under 20 ms                                                        |
| `counts.singleMoveShortDwellClicks` | integer 0-65535                                                                               | Clicks both single-move and under 20 ms                                        |
| `counts.mouseMoves`                 | integer 0-65535                                                                               | Trusted mouse moves                                                            |
| `counts.mouseActiveSecs`            | integer 0-65535                                                                               | Seconds with any mouse activity                                                |
| `counts.activations`                | integer 0-65535                                                                               | Trusted clicks with no pointer chain (keyboard, switch, screen reader)         |
| `counts.untrustedClicks`            | integer 0-65535                                                                               | Script-dispatched clicks                                                       |
| `counts.orphanClicks`               | integer 0-65535                                                                               | Script-dispatched clicks with no pointerdown                                   |
| `counts.centreSampled`              | integer 0-65535                                                                               | Of the first 12 mouse clicks, how many were measured against their target      |
| `counts.centreHits`                 | integer 0-65535                                                                               | Of those, how many landed within 5% of the target's centre                     |
| `counts.centreSizes`                | integer 0-65535                                                                               | Distinct target sizes among those clicks                                       |
| `counts.hovered`                    | integer 0-65535                                                                               | Elements hovered (the elements themselves are not kept)                        |
| `counts.hoveredClicked`             | integer 0-65535                                                                               | Hovered elements that were then clicked                                        |
| `counts.idleGaps`                   | integer 0-65535                                                                               | Gaps over 1 s between actions                                                  |
| `counts.idleMoves`                  | integer 0-65535                                                                               | Mouse moves during those gaps                                                  |
| `counts.idleSecs`                   | integer 0-65535                                                                               | Total seconds of those gaps                                                    |
| `counts.keys`                       | integer 0-65535                                                                               | Trusted keydowns                                                               |
| `counts.chars`                      | integer 0-65535                                                                               | Keydowns of the character class (the key itself is not kept)                   |
| `counts.imeKeys`                    | integer 0-65535                                                                               | IME composition keydowns (keyCode 229)                                         |
| `counts.repeatKeys`                 | integer 0-65535                                                                               | Auto-repeat keydowns                                                           |
| `counts.navKeys`                    | integer 0-65535                                                                               | Navigation keydowns (Tab, arrows, Page Up/Down, Home, End)                     |
| `counts.pasteKeys`                  | integer 0-65535                                                                               | Paste shortcuts                                                                |
| `counts.findKeys`                   | integer 0-65535                                                                               | Find shortcuts                                                                 |
| `counts.inputs`                     | integer 0-65535                                                                               | Input events in observed fields                                                |
| `counts.untrustedInputs`            | integer 0-65535                                                                               | Script-dispatched input events                                                 |
| `counts.compositions`               | integer 0-65535                                                                               | IME compositions started                                                       |
| `counts.valueJumps`                 | integer 0-65535                                                                               | Fields whose value grew by more than 3 characters with no keydown              |
| `counts.fillFields`                 | integer 0-65535                                                                               | Fields filled that way outside the human paths (dictation, autofill, paste)    |
| `counts.keylessInsertText`          | integer 0-65535                                                                               | Trusted keyless insertText (dictation, Voice Control)                          |
| `counts.autofillJumps`              | integer 0-65535                                                                               | Value jumps in fields with an autocomplete hint                                |
| `counts.pastes`                     | integer 0-65535                                                                               | Paste events (the clipboard is never read)                                     |
| `counts.copies`                     | integer 0-65535                                                                               | Copy events                                                                    |
| `counts.contextmenus`               | integer 0-65535                                                                               | Context menus opened                                                           |
| `counts.pasteNoCopy`                | integer 0-65535                                                                               | Pastes with no copy or context menu first on the page                          |
| `counts.buTrio`                     | integer 0-65535                                                                               | Browser Use's synthetic input, change and blur sequence                        |
| `counts.wheelTicks`                 | integer 0-65535                                                                               | Wheel events                                                                   |
| `counts.wheelGestures`              | integer 0-65535                                                                               | Wheel gestures (ticks separated by more than 300 ms)                           |
| `counts.wheelSameDelta`             | integer 0-65535                                                                               | Wheel ticks with the same delta as the previous tick                           |
| `counts.wheelFractional`            | integer 0-65535                                                                               | Wheel ticks with a fractional delta (a trackpad hint)                          |
| `counts.wheelSmall`                 | integer 0-65535                                                                               | Wheel ticks under 4 px (a trackpad hint)                                       |
| `counts.noInputScrolls`             | integer 0-65535                                                                               | Document scrolls with no wheel, touch or key input in the 500 ms before        |
| `counts.scrollThenAct`              | integer 0-65535                                                                               | Such scrolls followed within 1 s by a click                                    |
| `counts.hiddenTransitions`          | integer 0-65535                                                                               | Times the tab went hidden                                                      |
| `counts.hiddenInputs`               | integer 0-65535                                                                               | Trusted keydowns or pointerdowns at least 500 ms into a hidden period          |
| `counts.actionGaps`                 | integer 0-65535                                                                               | Gaps between consecutive actions                                               |
| `counts.cadenceGaps`                | integer 0-65535                                                                               | Of those, gaps of 1.5 to 8 s                                                   |
| `counts.stillGaps`                  | integer 0-65535                                                                               | Of those, gaps with at most one mouse move                                     |
| `hist.clickDwell`                   | 10 integer bins (edges 5, 10, 20, 40, 80, 160, 320, 640, 1280) or `null`                      | Click hold time, ms                                                            |
| `hist.interKey`                     | 11 integer bins (edges 5, 10, 15, 20, 40, 80, 160, 320, 640, 1280) or `null`                  | Time between keydowns, ms (one bin is 10-15 ms)                                |
| `hist.keyHold`                      | 10 integer bins (edges 5, 10, 20, 40, 80, 160, 320, 640, 1280) or `null`                      | Key hold time, ms                                                              |
| `hist.wheelDt`                      | 9 integer bins (edges 10, 20, 40, 80, 160, 320, 640, 1280) or `null`                          | Time between wheel ticks, ms                                                   |
| `hist.wheelDelta`                   | 9 integer bins (edges 1, 4, 16, 32, 64, 100, 200, 400) or `null`                              | Wheel distance per tick, px                                                    |
| `hist.actionGap`                    | 11 integer bins (edges 500, 1000, 1500, 2000, 3000, 4000, 6000, 8000, 16000, 32000) or `null` | Time between actions, ms                                                       |
| `hist.centreDev`                    | 10 integer bins (edges 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45) or `null`            | Click distance from the target's centre, as a fraction of its size             |
| `hist.clickSlip`                    | 7 integer bins (edges 1, 2, 4, 8, 16, 32) or `null`                                           | Pointer movement between pointerdown and pointerup, px                         |
| `moments.interKey`                  | `{n, sum, sumSq}` or `null`, integer ms, each sample clamped to 10000                         | Count, sum and sum of squares of time between keydowns, for a variance         |
| `moments.wheelDt`                   | `{n, sum, sumSq}` or `null`, integer ms, each sample clamped to 10000                         | Count, sum and sum of squares of time between wheel ticks, for a variance      |
| `moments.actionGap`                 | `{n, sum, sumSq}` or `null`, integer ms, each sample clamped to 60000                         | Count, sum and sum of squares of time between actions, for a variance          |
| `probes.webdriver`                  | boolean or `null`                                                                             | `navigator.webdriver` is true                                                  |
| `probes.webdriverOwn`               | boolean or `null`                                                                             | `webdriver` is defined on the navigator object itself (a stealth patch)        |
| `probes.headlessUA`                 | boolean or `null`                                                                             | The user agent says HeadlessChrome                                             |
| `probes.platformMismatch`           | boolean or `null`                                                                             | Client Hints platform disagrees with the user agent's OS (Chromium)            |
| `probes.pointerMediaTell`           | boolean or `null`                                                                             | A desktop user agent without `(hover:hover)` and `(pointer:fine)`              |
| `probes.renderer`                   | one of hardware, swiftshader, llvmpipe, other-software, or `null`                             | WebGL renderer, bucketed on the device; the raw string is never kept           |
| `probes.outerEqInner`               | boolean or `null`                                                                             | Window outer size equals inner size                                            |
| `probes.availEqScreen`              | boolean or `null`                                                                             | Available screen equals the full screen                                        |
| `probes.xgaDpr1`                    | boolean or `null`                                                                             | An XGA or WXGA screen at device pixel ratio 1                                  |
| `probes.fwGlobals`                  | boolean or `null`                                                                             | An automation framework global is present (Playwright, Selenium, ChromeDriver) |
| `probes.tzQuarterHours`             | integer -64 to 64 or `null`                                                                   | UTC offset in 15-minute steps                                                  |
| `probes.maxTouchPoints`             | integer 0 to 64 or `null`                                                                     | `navigator.maxTouchPoints`                                                     |
| `probes.anyCoarse`                  | boolean or `null`                                                                             | `(any-pointer:coarse)` matches                                                 |
| `probes.pointerFine`                | boolean or `null`                                                                             | `(pointer:fine)` matches                                                       |
| `probes.desktopUA`                  | boolean or `null`                                                                             | The user agent is a desktop one                                                |
| `markers.claude`                    | boolean                                                                                       | A Claude in Chrome page marker was seen                                        |
| `markers.browserUse`                | boolean                                                                                       | A Browser Use or legacy Playwright highlight marker was seen                   |
| `markers.custom`                    | boolean                                                                                       | One of your `extraMarkers` was seen                                            |

<!-- data-collected:end -->

</details>

## Evaluation and the release gate

The harness drives the fixture page (`apps/fixture`) with each generator in the red-team matrix, records every verdict to JSONL (`harness/recorder`), and labels each run with its ground truth. `eval/` (a uv project) computes recall per class and generator, attribution, abstain and insufficient-data shares, and human flags per cohort, each with a Wilson 95% interval and the rule-of-three bound, against three baselines on the same runs: BotD, agent-detector, and the arXiv 2607.26935 minimal tree. It also writes the golden fixtures and the release gate report. The runbooks for every run, including the ones that need keys or participants, are in [harness/README.md](harness/README.md); human sessions need the [consent form](harness/human/consent.md).

```sh
pnpm --filter @agentlens/runners-ts matrix --generator=patchright --runs=15 --baselines
cd eval && uv run eval.py metrics            # tables over harness/recorder/out
cd eval && uv run eval.py gate --out reports/gate-<date>.md   # runs the check commands too
cd eval && uv run eval.py golden             # new runs become fixtures/golden/<run>.json
```

`fixtures/golden/` holds every labelled run's final `features` with the label it got; a vitest suite re-scores them on every commit, so a ruleset change that flips any label must update that fixture in the same commit, with the reason in its `changes` list.

## Develop

Tasks run through Turborepo with a local cache; see [docs/decisions/0001-toolchain.md](docs/decisions/0001-toolchain.md) for why each tool was chosen.

```sh
pnpm install
pnpm check        # everything CI runs: lint, typecheck, build, test, size, check-exports
pnpm build        # packages/core/dist: agentlens.mjs, agentlens.iife.js, scorer.mjs and .d.ts
pnpm test         # builds first; the browser tests need the playwright install below
pnpm lint         # oxlint (type-aware) and oxfmt --check; `pnpm format` rewrites
pnpm size         # size-limit on the built files, gzipped
pnpm changeset    # describe a consumer-visible change to @agentlens/core
pnpm --filter @agentlens/recorder start            # fixture page + JSONL recorder on :8787
pnpm --filter @agentlens/runners-ts exec playwright install chromium
pnpm --filter @agentlens/runners-ts playwright     # one Playwright run against the fixture
pnpm --filter @agentlens/runners-ts perf           # 60 s trace at 4x CPU throttle; --breakdown, --runs=N
```

`pnpm --filter @agentlens/runners-ts perf` loads the fixture in headless Chromium at 4× CPU throttle, drives a 60 s mouse, keyboard and wheel session three times, and reports init time and main-thread time from a Chrome trace (median of the runs). A no-op control listener on the same events runs ahead of the library, so the report splits the browser's per-event floor from the library's own time. The budget is relative so it holds on any machine: the library's own time must stay within 3.25× the control floor (M1: 2.3× locally, 2.8× on a GitHub runner). Init is reported against a 10 ms developer-machine budget. CI runs it as a non-blocking `perf` job.

**Releasing.** Pushing a `v<version>` tag that matches `packages/core`'s version runs `.github/workflows/release.yml`: every CI check, a build, and a **draft** GitHub Release with the five files and `SHA256SUMS` attached. A maintainer states the gate result in the notes and publishes it.

## Layout

`packages/core` (library: `src/extractors` one module per signal family, `src/probes`, `src/scorer` rules as data, `src/detector.ts` wiring through an injected `Env`), `apps/fixture` (static task page), `harness/recorder` (JSONL sink and run labels), `harness/runners-ts` (Playwright, Patchright, ghost-cursor, perf, smoke and axe tests), `harness/runners-py` (Browser Use and computer-use-demo), `harness/human` (consent form), `harness/smoke` (consumer pages for the smoke test), `eval` (metrics, baselines, gate), `fixtures/golden`, `docs/plan` (research and architecture), `docs/decisions` (decision records).

## Licence

MIT.
