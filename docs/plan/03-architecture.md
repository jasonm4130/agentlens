# 03 — Architecture v2: agentlens as a browser-only library, distributed from GitHub (2026-10-02)

**Supersedes** `03-architecture-v1-server.md` (Worker + D1 + dashboard). The signal choices, rules, gates, class-honesty statements, privacy rules and eval design carry over; everything that needed a server is either moved into the bundle or dropped (§11). Signal numbers (#n) refer to `01-signals.md` §2; tools are named as in `02-tooling.md`.

**Distribution (owner decision, 2026-10-02): GitHub repo only, no npm.** Consumers take the built files from a tagged GitHub Release (`agentlens.mjs`, `agentlens.iife.js`, `scorer.mjs`, `.d.ts`) or vendor the source. All `agentlens/...` import paths below are repo paths, not registry packages; the workspace packages are `private: true`. npm can be added later without API changes (note: unscoped `agentlens` is taken on npm, verified with `pnpm view` 2026-10-02). `tsdown` is 0.23.0 (still 0.x) and `size-limit` 14.1.0. **Remembered, not verified:** GA4 parameter limits, PostHog `capture()` semantics, and `sendBeacon` with `text/plain` being CORS-safelisted.

---

## 1. Bottom line

agentlens is a dependency-free TypeScript library, an **estimated 7–9 KB gzipped** for collector plus scorer (an estimate; M1 measures it with size-limit). It listens passively to pointer, keyboard, form and scroll events, folds them on the device into fixed-bin histograms, keeps session state in `sessionStorage` so cadence works across pages, scores the session with a compiled-in, versioned rules engine, and emits a verdict to the consumer's callback. **The core never makes a network request.** What the consumer does with the verdict (log it, send it to analytics, show it in a debug panel) is theirs; copy-paste reporting recipes in `recipes/` make the common cases a few lines.

### The trade-off, first

**A verdict computed in the visitor's browser is readable and forgeable.** The rules and thresholds are public, the bundle is on the page, and any script running in the page (including an agent's own injected code or an in-browser extension agent) can read the verdict, stub the listeners, dispatch events that satisfy the gates, or call the consumer's callback with a fabricated `human-like`. This is acceptable for the job the library is for: **understanding your own traffic in aggregate**, where an adversary who bothers to forge the verdict is a small, documented bias. It is **not** acceptable for enforcement. Core therefore ships **no blocking, gating, challenge or step-up features**. A consumer who wants to act on the verdict must re-validate on their own server with signals the page cannot fake (§6.3), and should assume a determined agent passes.

### What it can honestly detect, by class

- **Class A (CDP or Playwright-driven browsers).** Stock _headless_ frameworks and stock Browser Use are caught with near-certainty by runtime and marker artefacts: #13 webdriver, #14 HeadlessChrome, #21 framework globals, #9 Browser Use markers, and #8 Browser Use's synthetic input trio. Stock _headful_ Playwright is not in that set: current Playwright no longer passes `--enable-automation`, so it likely reports `webdriver=false` (01-signals §3.7), and `__playwright*`/`__pwInitScripts` appear only in some configurations. Headful Playwright is therefore caught by behaviour (Tier 2) unless M0 finds a runtime tell. Patchright and Camoufox remove those artefacts; then A is caught only by behaviour (#1, #2, #5, #10, #11), and a ghost-cursor humaniser defeats most of that.
- **Class B (OS-level computer use).** Detected only when it behaves like Anthropic's reference harness (`computer.py`): warped cursor, zero dwell, fixed 12 ms typing gap, regular wheel ticks, software GL (01-signals §1). Each tell is one line of harness code to remove. **B is always a lower bound.**
- **Class C (in-browser extension agents).** Attributed to C **only** when a C-specific DOM marker is present (#9: Claude in Chrome's `#claude-agent-stop-container` and `#claude-agent-animation-styles`). Atlas and Comet often trip behavioural rules (FP-Agent measured single-move clicks and paste-typing), but on a real macOS or Windows fingerprint that is indistinguishable from a human false positive, so it is reported as **agent-unattributed**, never as C. **Gemini in Chrome is entirely unmeasured** (01-signals Q2); nothing is claimed for it.
- **Class C is also the class best placed to forge the verdict**, because it runs inside the visitor's browser with page access. Treat any C result as best-effort.

---

## 2. Library internals

```
 host page ──import / <script>──► createDetector(opts)        (SSR: returns no-op detector)
 ┌───────────────────────────────────── agentlens core (in page)   ─────────────────────────────────────┐
 │                                                                                                      │
 │  LISTENERS (passive, capture, on window)      ONE-SHOT PROBES (init)        MARKER CHECK              │
 │  pointer* click key* beforeinput/input        #13 #14 #15 #17 #18 #20 #21   #9 compiled-in selectors  │
 │  paste/copy wheel/scroll visibility mouseover  + modality coherence          + opts.extraMarkers      │
 │        │  (skip: password, cc-*, otp, [data-al-ignore], opts.ignore)  │                │              │
 │        ▼                                                              ▼                ▼              │
 │  EXTRACTORS: fold each event into counters + log-binned histograms; raw event dropped immediately    │
 │        │                                                                                             │
 │        ▼                                                                                             │
 │  SESSION STATE  { sessionId, seq, pageCount, cohort, histograms, counts, probeBits, markerHits }     │
 │     sessionStorage "al:v1" (per tab, survives navigation)  |  memory-only (per page; GPC forces it)   │
 │        │                                                                                             │
 │        ▼                                                                                             │
 │  SCORER  score(features, RULESET_vN) → pure, deterministic; Tier 1 → gates → Tier 2 → class priors    │
 │     runs: on idle after actions (debounced ≥1 s), on hard tell, before flush                          │
 │        │                                                                                             │
 │        ▼                                                                                             │
 │  EMITTER  'signal' (hard tell, once per rule) · 'verdict' (flush: hidden/pagehide; and label change)  │
 └────────┬────────────────────────────────────────────────────────────────────────────────────────────┘
          ▼
   consumer callback ──► own code │ recipes/beacon → own endpoint │ recipes/posthog │ recipes/ga4
                                   (separate packages; the only code that touches the network)
                                                     │
                                                     ▼  optional, consumer's server
                                   re-score `features` with agentlens scorer.mjs (Node)   + own
                                   server-side signals (§6.3) — the only place enforcement may live
```

The detector puts nothing on `window` except, in the IIFE build, the `agentlens` namespace.

---

## 3. Public API and lifecycle

```ts
export type Label =
  "human-like" | "agent-likely" | "agent-unattributed" | "insufficient-data" | "abstain";
export type AgentClass = "A" | "B" | "C";
export type Confidence = "certain" | "high" | "medium" | "low";
export type Cohort = "mouse" | "touch" | "keyboard" | "mixed" | "none";

export interface Evidence {
  rule: string;
  detail: string;
} // detail is a fixed template, e.g. "R4: 9/10 gaps in 10–15 ms bin"

export interface Verdict {
  label: Label;
  agentClass?: AgentClass; // only with 'agent-likely'
  confidence: Confidence; // ordinal tier, NOT a probability (see §5.3)
  evidence: Evidence[]; // rules that fired, plus abstain reasons
  cohort: Cohort;
  mode: "full" | "minimal"; // 'minimal' under GPC or opts.minimal
  features: Features; // always included, so consumers can re-score offline
  featuresVersion: number; // schema of `features`
  rulesetVersion: string; // e.g. "2026.10.1"
  sessionId: string; // random 128-bit, per tab (per page in memory-only mode)
  seq: number; // monotonically increasing per session
  reason: "flush" | "label-change" | "snapshot";
}

export interface Signal {
  rule: string;
  agentClass?: AgentClass;
  detail: string;
  sessionId: string;
}

export interface DetectorOptions {
  minActions?: number; // default 3; below → 'insufficient-data'
  storage?: "session" | "memory"; // default 'session'
  respectGPC?: boolean; // default true → minimal mode + memory storage
  minimal?: boolean; // force minimal mode
  ignore?: string[]; // extra CSS selectors to skip, in addition to [data-al-ignore]
  extraMarkers?: string[]; // consumer-supplied id/attribute selectors, reported as 'custom-marker'
  scoreDebounceMs?: number; // default 1000
}

export interface Detector {
  on(event: "verdict", cb: (v: Verdict) => void): () => void; // returns unsubscribe
  on(event: "signal", cb: (s: Signal) => void): () => void;
  snapshot(): Verdict; // score now, no event emitted
  destroy(): void; // remove listeners, clear timers; keeps sessionStorage unless destroy({ clear: true })
}

export function createDetector(opts?: DetectorOptions): Detector;
// subpath export for Node / offline / server re-validation:
// import { score, RULESET, validateFeatures } from './vendor/agentlens/scorer.mjs'
```

**Lifecycle.**

1. `createDetector()` on the server (`typeof window === 'undefined'`) returns an inert detector whose `snapshot()` returns `{label:'abstain', evidence:[{rule:'ssr', ...}]}`. The package has no top-level side effects and declares `"sideEffects": false`, so importing it under SSR or in a test runner does nothing.
2. In the browser it reads or creates session state, runs the one-shot probes and marker check, and attaches listeners. Calling `createDetector` twice returns the same instance (a module-level singleton), so a framework re-render cannot double-count.
3. Scoring runs on idle after actions (debounced), immediately on a hard tell, and before each flush. `'signal'` fires once per Tier 1 rule per session. `'verdict'` fires (a) on the first `visibilitychange` to hidden and on `pagehide`, deduplicated per page, and (b) whenever the label or class changes. Under `minActions` the label is `insufficient-data`, so consumers are not spammed during the first seconds.
4. `destroy()` detaches everything. No framework bindings ship; the docs show `createDetector` in an effect with `destroy` in cleanup for React, Vue and Svelte.

**Builds.** ESM (`.` and `./scorer`), an IIFE (`window.agentlens.createDetector`) for a plain `<script>` tag, `.d.ts`, all attached to each GitHub Release; no runtime dependencies; ES2020 evergreen browsers. A missing API degrades its feature to `null`, never throws.

---

## 4. Collector

### 4.1 Listeners

All passive, capture-phase, on `window`. Carried over from v1 unchanged except where noted.

| Listener                                                         | Feeds                                                                                                                                                                                                                                                    | Signal  |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| `pointermove` (mouse only)                                       | moves since the last click and in the last 300 ms; moves per idle second in gaps over 1 s; active-time event rate                                                                                                                                        | #1, #4  |
| `pointerdown` / `pointerup`                                      | dwell; displacement bucket between down and up; `pointerType` mix; for the first 12 mouse clicks only, `getBoundingClientRect()` of the target for the centre fraction                                                                                   | #2, #11 |
| `click`                                                          | `isTrusted`, `detail`, whether a pointerdown preceded it; trusted clicks with `detail===0` are keyboard/AT activations, excluded from pointer statistics                                                                                                 | #1, #8  |
| `keydown` / `keyup`                                              | timestamps plus a coarse class (char / modifier / nav / edit / paste-shortcut / find-shortcut / IME-229); `key` and `code` are never retained                                                                                                            | #6      |
| `beforeinput` / `input` / `compositionstart` / `change` / `blur` | `inputType`, `isTrusted`, a value-length jump boolean (>3 chars), the Browser Use trio (untrusted `input` with `data.length === value.length`, then untrusted `change` and `blur`); composition and dictation context                                    | #5, #8  |
| `paste` / `copy` / `cut` / `contextmenu`                         | counts only; the clipboard is never read                                                                                                                                                                                                                 | #5      |
| `wheel` / `scroll`                                               | `deltaMode`-normalised delta bucket; inter-tick dt histogram; scrolls with no wheel, touch or key input in the previous 500 ms, excluding `hashchange`, focus-driven scrolls, scrollbar or middle-button pointerdowns, and the 3 s after a find shortcut | #10     |
| `visibilitychange`                                               | transition timestamps; trusted non-modifier `keydown`/`pointerdown` ≥500 ms after going hidden, while still hidden                                                                                                                                       | #7      |
| `mouseover` (mouse only)                                         | a `WeakSet` of hovered-not-clicked elements; only the count is kept                                                                                                                                                                                      | #4      |

**One-shot probes**, hand-ported from fpscanner and BotD rather than depended on (02-tooling §1); each yields a bit or a bucket, never a string: #13 `navigator.webdriver` and own-property descriptor; #14 `HeadlessChrome` and a `userAgentData` platform vs UA mismatch (Chromium only); #15 `(hover:hover)`/`(pointer:fine)` under a desktop UA (attribution only); #17 WebGL renderer mapped on device to {hardware, swiftshader, llvmpipe, other-software}; #18 geometry flags (outer==inner, avail==screen, XGA/WXGA at DPR 1); #21 framework globals (`__playwright*`, `__pwInitScripts`, `cdc_*`, `__selenium_*`, `__webdriver_*`, `domAutomation*`); #20 a timezone bucket (attribution only, and weak without IP geo, see §11); **modality coherence**: `maxTouchPoints`, `(any-pointer:coarse)`, desktop-UA flag.

**DOM markers (#9)** are now **compiled into the ruleset** (v1 fetched them from the Worker): Claude in Chrome's two ids, Browser Use's `data-browser-use-*` attributes and `#browser-use-debug-highlights`, and legacy `#playwright-highlight-container`. They are checked with `getElementById`/`querySelector` on each mouse pointerdown and before each flush; no MutationObserver. Marker rot is therefore fixed by a **patch release**, not a data push, so marker updates follow a fast-release policy (§9). `extraMarkers` lets a consumer add their own selectors, reported under a generic `custom-marker` rule with no class. Further C markers are discovered on the harness (DOM and shadow-root dumps), cross-checked against the superliaye lab as a reference only (no licence; its code is not copied, 02-tooling §2).

### 4.2 On-device feature extraction

Every distribution is a fixed-bin, log-spaced histogram (8–12 bins) plus counts: click dwell, inter-key gap (bins must isolate 10–15 ms for the 12 ms xdotool gap), key hold, inter-action gap, wheel dt, centre fraction (0.05 steps). An ungated feature is `null`, never `0`, so a later model trains on the same masking. Only raw modality counts feed the cohort gate; no disability inference is computed. Cadence (#3) is now computed on device: a gap histogram plus a running mean/variance for the CV, excluding gaps that span a hidden period or page load.

### 4.3 Session state

`sessionStorage["al:v1"]` holds the serialised `Features`, `sessionId`, `seq` and `pageCount` (expected 1–2 KB), written on flush and label change and read on init; a version mismatch starts a new session. `storage:'memory'` makes each page its own session, so R8 has fewer actions and abstains more often. Any storage exception falls back to memory silently.

### 4.4 Performance and size budget

| Budget                                                      | Value                                                                                                                                                                                                                                                                                                                                                   | Enforced by                                                     |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Bundle (collector + scorer + ruleset), ESM, gz              | **ESTIMATE 7–9 KB**; hard cap set at M1 from the first measurement, not above 10 KB                                                                                                                                                                                                                                                                     | `size-limit` in CI, output quoted in the M1 exit                |
| IIFE build, gz                                              | same cap + ≤0.5 KB                                                                                                                                                                                                                                                                                                                                      | `size-limit`                                                    |
| Init main-thread time                                       | ≤10 ms at 4× CPU throttle on a developer machine (M1: 4.3 ms); the CI runner figure is reported, not gated (M1: 10.3 ms)                                                                                                                                                                                                                                | `perf` runner (Chrome trace)                                    |
| Main-thread over a scripted 60 s session at 4× CPU throttle | Library time ≤3.25× a no-op control listener on the same events, same session, median of 3, scorer included (M1: 2.3× locally, 2.8× on the GitHub runner). Restated at M1 from the absolute ≤50 ms of 01-signals §3.12, which measured 77 ms locally and 142 ms on the runner; about a third of that is the browser's per-event floor any listener pays | `perf` runner; non-blocking CI job, reported in the job summary |
| One scorer run                                              | ≤1 ms on the throttled profile                                                                                                                                                                                                                                                                                                                          | vitest bench + trace                                            |
| sessionStorage footprint                                    | ≤4 KB                                                                                                                                                                                                                                                                                                                                                   | unit test                                                       |

Forced layout happens only in the #11 rect read (capped at 12 clicks). The estimate is v1's ≤4 KB collector target plus ~17 rules, markers and the scorer; nothing is built or measured yet.

### 4.5 Privacy rules (enforced in CI)

- **`Features` schema test.** Every field is a bounded integer, a bounded histogram array, a boolean, `null`, or a closed-enum member. Any free string, coordinate pair or unbounded number fails the build. The README's "data collected" table is generated from the schema. `Evidence.detail` strings come from fixed templates filled with numbers only.
- **Never collected:** pointer coordinates, key values or codes, field values or lengths beyond the jump boolean, clipboard contents, element text, URLs, raw UA, raw renderer, fonts, canvas.
- **Skipped entirely:** `type=password`, `autocomplete=cc-*` and `one-time-code` fields, `[data-al-ignore]` subtrees, and `opts.ignore` selectors.
- **No cookies, no network.** The id is per tab. Core sends nothing; what leaves the device is decided by the consumer's code or adapter.
- **GPC** (`navigator.globalPrivacyControl===true`, with `respectGPC` on by default) forces minimal mode: probe bits, marker hits and counts only, no timing histograms, memory-only storage. Tier 2 cannot run, so the label is `abstain` (evidence `gpc`) unless a Tier 1 rule fires. It is never `human-like`, because an agent browser sending GPC would otherwise hide there.

---

## 5. Scorer

`score(features, ruleset) → Verdict-core` is pure and deterministic, lives in `src/scorer/`, and is built as a separate `scorer.mjs` so the same code runs in the browser, in Node for offline re-scoring, and in a consumer's server. Rules are data: `{id, signalRef, classHint, tier, gate, predicate, threshold}`, compiled into the bundle.

### 5.1 Rules

**Tier 1, certain** (one is enough; near-zero FP per 01-signals §2). Each also fires a `'signal'` event.

| Rule        | Signal                                                                 | Result                     |
| ----------- | ---------------------------------------------------------------------- | -------------------------- |
| C-marker    | #9 Claude in Chrome ids                                                | agent-likely / C / certain |
| BU-marker   | #9 Browser Use attributes or container, or legacy Playwright highlight | agent-likely / A / certain |
| webdriver   | #13 `true`, or an own-property descriptor present                      | agent-likely / A / certain |
| headless-ua | #14 `HeadlessChrome`                                                   | agent-likely / A / certain |
| fw-globals  | #21                                                                    | agent-likely / A / certain |
| BU-trio     | #8 untrusted `input` (data length = value length) → `change` → `blur`  | agent-likely / A / certain |

**#7 trusted input while hidden** stays a _candidate_, counted as one Tier 2 rule, until the harness and human panel show zero human hits (01-signals Q3). Definition: ≥2 trusted non-modifier `keydown` or `pointerdown` events, each ≥500 ms after the hidden transition, while still hidden; `keyup`/`pointerup` never count (Cmd/Ctrl+Tab and Cmd+W keyups arrive after the transition).

**Tier 2, behavioural.** Each rule abstains unless its gate passes; a label needs **≥2 qualifying rules**; R8 and attribution priors never count toward the 2.

| Rule                    | Signal | Gate                                                                             | Fires when                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------- | ------ | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1 path                 | #1     | ≥3 trusted mouse clicks with `detail>0`                                          | share of clicks with ≤1 move in the prior 300 ms **and** displacement >N px ≥0.6, or mouse event rate below threshold. The ≤1-move metric is a local hypothesis (01-signals §3.1 correction); N and the rate threshold come from the M2 mouse cohort, and the rate clause is disabled until then                                                                                                                                                                                                                       |
| R2 dwell                | #2     | as R1, **and** no trackpad hint (fractional or small-delta wheel streams)        | share of clicks that are both ≤1-move and <20 ms dwell ≥0.6 (trackpad tap has near-zero dwell but still has a path). Shares R1's ≤1-move predicate, so R1 and R2 firing together count as one rule; both thresholds are re-validated on the M2 mouse and trackpad cohorts                                                                                                                                                                                                                                              |
| R3 frozen               | #4     | mouse cohort, ≥3 gaps >1 s                                                       | moves per idle second ≈0 **and** hovered-not-clicked count = 0                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| R4 typing               | #6     | ≥8 inter-key gaps, no IME-229 or composition in the field                        | median <15 ms, or constant-gap CV <0.1 (catches the 12 ms xdotool gap), or hold <5 ms                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| R5 fill                 | #5     | no autofill hint on the field; no composition or dictation path                  | value jump >3 chars with zero keydowns **and** (untrusted `input`, or `inputType` not in {`insertText`, `insertReplacementText`, `insertFromDictation`}) on ≥2 fields. Trusted keyless `insertText` abstains (dictation, Voice Control). **Known cost:** Playwright `fill()` very likely uses CDP `Input.insertText`, which emits exactly that, so R5 will usually miss `fill()` (M0 check). Right-click paste (`contextmenu` in the field within 10 s) abstains. Paste-without-copy is a logged feature, never a rule |
| R6 scroll               | #10    | ≥2 occurrences                                                                   | a no-input document scroll (element scrolls such as carousels are ignored; container no-input scrolls as an agent tell is an M2 hypothesis to validate with harness data) followed within 1 s by an action on content it revealed, **or** ≥6 wheel ticks with identical normalised delta and dt CV <0.05                                                                                                                                                                                                               |
| R7 centre               | #11    | ≥3 mouse clicks on targets of different sizes                                    | all within 0.5±0.05 of the element's x and y fractions                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| R9 orphan click         | #8     | —                                                                                | ≥2 untrusted clicks with no pointerdown (Browser Use `this.click()` fallback). Never Tier 1: in-page switch and voice tools produce these                                                                                                                                                                                                                                                                                                                                                                              |
| R10 incoherent modality | —      | —                                                                                | touch pointer events while `maxTouchPoints==0`, or touch-only input on a `(pointer:fine)`, `(any-pointer:coarse)=false` desktop                                                                                                                                                                                                                                                                                                                                                                                        |
| R8 cadence              | #3     | off for the keyboard cohort; gaps spanning hidden periods or page loads excluded | ≥5 actions, gaps mostly 1.5–8 s, CV below a threshold set from the M2 human cohort, zero pointer activity in the gaps. **+1 corroborator only**                                                                                                                                                                                                                                                                                                                                                                        |

### 5.2 Gates and labels

Accessibility gates are structural, not tuned: a session with no trusted mouse pointer events gets cohort touch, keyboard or none, and R1, R2, R3 and R7 abstain; `detail===0` or chain-less trusted clicks are activations, not pointer evidence; heavy Tab/arrow navigation disables R8; **abstain beats flag**.

| Condition (evaluated in order)                                       | label                | agentClass | confidence                                                         |
| -------------------------------------------------------------------- | -------------------- | ---------- | ------------------------------------------------------------------ |
| any Tier 1 rule                                                      | `agent-likely`       | per rule   | `certain`                                                          |
| GPC/minimal mode, no Tier 1                                          | `abstain`            | —          | — (`low`)                                                          |
| < `minActions` qualifying actions                                    | `insufficient-data`  | —          | `low`                                                              |
| ≥2 Tier 2 rules + class profile (below)                              | `agent-likely`       | A or B     | `high` if ≥3 rules, else `medium`                                  |
| ≥2 Tier 2 rules, no class profile                                    | `agent-unattributed` | —          | `high` if ≥3, else `medium`                                        |
| enough actions, but every Tier 2 gate abstained (e.g. keyboard-only) | `abstain`            | —          | `low`                                                              |
| 0–1 Tier 2 rules                                                     | `human-like`         | —          | `medium` if 0 rules, `low` if 1 (the rule is listed in `evidence`) |

`human-like` means "no agent rule reached threshold", never "verified human", and its confidence is never above `medium`, because a humanised B agent or a patched A agent lands here. v1's `possible` tier is folded into `human-like`/`low`; whether that is the right public label is open question 5.

**Class profiles for Tier 2.** _A:_ behavioural hit plus an A prior (#15 pointer-media tell or #14 UA/platform incoherence; #19 datacenter ASN is gone with the server). _B (reference-harness profile):_ all events trusted, no runtime tells, R4 constant-gap or R6 regular ticks firing, plus #17 software GL or a #18 XGA/WXGA flag. **#17 does not separate A from B**: Chromium on any GPU-less host falls back to SwiftShader and Firefox on Mesa reports llvmpipe, and the computer-use-demo container is remembered to ship Firefox (M0 verifies), which also silences the Chromium-only #14/#15. A session matching both profiles stays unattributed. _C:_ only via a Tier 1 marker. Everything else is `agent-unattributed` ("includes any undetected C and any behavioural false positives").

**Gate evasion is visible, not hidden.** A keyboard-activation-only agent abstains. The eval reports abstain share per agent class; consumers can count `abstain` on `(pointer:fine)` desktops as a drift metric, never as a flag, because keyboard-only and screen-reader users look the same.

### 5.3 Confidence, versioning, rescoring

`confidence` is an ordinal tier, not a probability; rules cannot produce a calibrated number and the type says so. A numeric `p` field arrives only with a calibrated model (§5.4), as an additive minor-version change.

`rulesetVersion` (`YYYY.MM.patch`) is stamped on every verdict, and `featuresVersion` on every `features`. Any threshold, gate or marker change bumps the ruleset version and the release tag's minor (`v0.x`). Because `features` ships in every verdict, a consumer who stored them can re-score history with a newer release's `scorer.mjs` (`score(features, RULESET)`), which replaces v1's server-side retroactive rescoring. `validateFeatures()` rejects out-of-range or wrong-version input. `features` from an older `featuresVersion` are scored by the newest ruleset that supports that version, or rejected with a reason.

### 5.4 How a learned model ships later (M3+)

An L1 logistic regression trained on harness `features` (null masked as indicator columns; harness gold labels plus Tier 1 silver kept separate; grouped held-out splits by generator, task and participant, because FP-Agent saw F1 drop by up to 0.369 on held-out tasks; global Platt/isotonic calibration only; no monotone constraint that makes modality exculpatory). It ships as **compiled weights**: a generated `model_vN.ts` of coefficients evaluated by a dot product (estimated under 1 KB gz; to be measured). It replaces Tier 2 only if it beats the rules **and** the arXiv 2607.26935 minimal baseline on grouped held-out recall at equal human flags; otherwise the decision is recorded and rules stay. Tier 1 and the accessibility gates stay rules; the top-3 contributions become `evidence`.

---

## 6. Reporting adapters and recipes

Reporting adapters are copy-paste recipes in `recipes/`, each a few dozen lines, tested in CI against a mock sink. They are the only agentlens code that touches the network. None is required.

| Package              | Does                                                                                                              | Milestone                                      |
| -------------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `recipes/beacon.ts`  | `sendBeacon(url, text/plain JSON)` on each `'verdict'`, deduped by `(sessionId, seq)`; optional `features: false` | M3 (the harness dogfoods a local copy from M0) |
| `recipes/posthog.ts` | `posthog.capture('agentlens_verdict', {...})` with flattened label/class/confidence/rules; features opt-in        | M3                                             |
| `recipes/ga4.ts`     | `gtag('event', 'agentlens_verdict', {...})` with label/class/confidence only (no features)                        | M3                                             |

### 6.1 sendBeacon to your own endpoint (no adapter)

```ts
const d = createDetector();
d.on("verdict", (v) => {
  const body = new Blob([JSON.stringify(v)], { type: "text/plain;charset=UTF-8" });
  navigator.sendBeacon("/analytics/agentlens", body);
});
```

`text/plain` keeps the request CORS-safelisted if the endpoint is cross-origin (remembered, not verified; v1 listed it as an M0 check and it moves to the adapter's M3 tests). `sendBeacon` on `pagehide` is best-effort, so some verdicts are lost; count them as missing, never as evidence.

### 6.2 PostHog and GA4

PostHog: label, class, confidence, `rulesetVersion` and fired rule ids as event properties; `features` only if the consumer's privacy notice covers it. GA4: low-cardinality fields only; its parameter count and value-length limits (remembered, not verified: ~25 parameters, 100 characters) rule out `features`. Both vendor APIs are re-checked in M3.

Docs note for all recipes: an aggregate share is the share of sessions that _ran the library_ (blockers, `noscript`, consent gating and lost beacons shrink the denominator); report `insufficient-data` and `abstain` as their own bars, with Wilson intervals.

### 6.3 Server-side re-validation (minimal note)

If a verdict is going to change what a server does, the server must not trust it. The minimum: re-run `score(v.features, RULESET)` with `scorer.mjs` in Node and reject a verdict whose label disagrees with its own features (this catches a lazily forged label, not forged features); and combine it with signals the page cannot fake, such as Web Bot Auth signature verification, Sec-Fetch consistency, ASN and Turnstile. Even then, treat the behavioural verdict as a soft signal (label, rate-limit), never as a block on its own. agentlens core will not provide this; see §11 for the possible `verify` server companion.

---

## 7. Eval harness, red-team matrix, baselines, release gate

### 7.1 Harness

- **`apps/fixture`** is a static page that loads the library from the local build (ESM and, in a second variant, the IIFE). Task flow as v1: search, open a result, scroll a long page, fill a 5-field form with autofill hints on two fields, click a below-the-fold button, visit 3 pages.
- **Test hook.** The fixture page (not the library) subscribes to `'verdict'`/`'signal'`, pushes each into `window.__alVerdicts`, and beacons it to `harness/recorder` (a local Node JSONL sink). Playwright asserts on `__alVerdicts` via `page.evaluate`; B, C and human runs rely on the recorder. Avoid `page.exposeFunction`/`exposeBinding`: their page globals could trip #21 on our own runs. M0 checks whether `page.evaluate` leaves anything #21 sees.
- **Run labelling:** the runner passes `?run=<id>`; the recorder joins on it.
- **M0 proof step.** Before any tuning, the harness must reproduce the three verified computer-use tells from `computer.py` (`TYPING_DELAY_MS = 12` with `xdotool type --delay 12`, `xdotool mousemove --sync` warps, `xdotool click --repeat N` wheel scrolling) **in the library's emitted verdict** (§9 M0 exit). If a source-verified tell does not reproduce, the collector is wrong, not the literature. The wheel-cadence check rests on xdotool's default repeat delay, which is UNVERIFIED (01-signals §3.3), so a miss there is a recorded finding, not a bug.
- **M0 also records** what Playwright `fill()` emits (R5); whether headful Playwright shows any runtime tell (§1); which browser and WebGL renderer the computer-use-demo container exposes (§5.2); whether Claude in Chrome's two ids are present at pointerdown and flush time (CHEQ does not say).
- **Read before tuning:** FP-Agent's per-agent measurements (arXiv 2605.01247) and the Proof of Human reCAPTCHA study (research.poh.org; vendor source, numbers are claims).

### 7.2 Red-team matrix

| Class | Generator                                                      | Config             | Runs (M2) |
| ----- | -------------------------------------------------------------- | ------------------ | --------- |
| A     | Playwright (`chromium-headless-shell` default; headful)        | `fill()`/`click()` | 15 + 15   |
| A     | **Patchright** headful (primary adversary, 02-tooling §3)      | stock              | 15        |
| A     | Browser Use (stock, LLM task)                                  | highlights on      | 15        |
| A     | Playwright + **ghost-cursor**                                  | humanised pointer  | 10        |
| B     | anthropics/claude-quickstarts computer-use-demo (Docker, Xvfb) | stock              | 10        |
| C     | Claude in Chrome, operator hands-off                           | stock              | 10        |
| C     | Atlas / Comet / Gemini in Chrome                               | if accessible      | 5 each    |

**M3+ adds** Camoufox, Stagehand, Skyvern (AGPL, external process only); the **B ablation ladder** (each of the six tells removed in turn, then all); OSWorld and openai-cua-sample-app; mixed-control C runs; a **forgery run** (an init script that stubs listeners or replays human-shaped events) demonstrating §1; an **evasion-cost curve** as the honest headline; and 01-signals §5 Q6/Q8/Q9/Q10 as feature candidates. C runs also answer Q3 (hidden tabs) and Q4 (`form_input`).

### 7.3 Human and AT baselines

The owner plus 4–6 people, about 40–60 sessions, across: mouse; trackpad with tap-to-click on and off; touch phone; keyboard-only; VoiceOver on macOS and iOS; macOS Voice Control or Dragon; dictation into fields; an IME (Japanese or Chinese); password-manager autofill. Recruit at least one daily AT user. Public human datasets (SapiMouse, Bogazici, Balabit) are sanity checks on pointer-feature distributions only, never the FP set (01-signals §3.1).

### 7.4 Metrics (`uv run eval.py`, polars, over the recorder's JSONL)

Recall per class and generator at `certain` and at `agent-likely or agent-unattributed`; attribution accuracy among flagged sessions; abstain and insufficient-data share per agent class; human flag count per cohort; every rate with a Wilson 95% interval **and** a rule-of-three upper bound (3/n at zero events); **baselines** on the same runs: doubleagent-so/agent-detector, BotD, and the arXiv 2607.26935 minimal model (mouse_event_rate plus teleport/no-move ratio, one depth-3 tree, trained and scored on the same grouped splits as ours). If the rules cannot beat the minimal model on A and C, simplify.

**Honest power statement.** Zero flags in n human sessions bounds FPR only below about 3/n: 40 sessions → ~7.5%; 5–8 in one cohort → ~40–60%; 120 AT sessions → ~2.5%; ~1,000 AT sessions → ~0.3%. **The harness proves the gates work; it does not prove the FPR is low.** The README states this next to any accuracy number.

### 7.5 Golden fixtures

Every labelled harness run's final `features` is saved to `fixtures/golden/<run>.json` with its expected label. A vitest suite re-scores all of them on every commit; a ruleset change that flips any golden label must update the fixture in the same commit with a reason, so label drift is always reviewed.

### 7.6 Release gate (before any `v0.x` release that emits `agent-likely` from Tier 2; every check binary)

1. Zero human sessions labelled `agent-likely` or `agent-unattributed` in **every** cohort; the report states the 3/n bound beside it.
2. Tier 1 rules: zero human hits across all harness humans.
3. Recall at agent-likely-or-unattributed: ≥12/15 on stock Playwright headless, headful, and Browser Use; ≥8/10 on Claude in Chrome (marker-driven; restated as behavioural recall if the M0 persistence check fails).
4. The minimal baseline's recall is at or below ours on A and C at equal human flags.
5. B, Patchright and ghost-cursor recall are **reported, not gated**, and published as known gaps.
6. Bundle within the M1 size cap (size-limit output quoted); perf trace within the §4.4 budgets; `Features` schema privacy test green; golden suite green; SSR import test green; axe clean on the fixture page.

---

## 8. Privacy, accessibility, open source vs evasion

**Privacy.** On-device extraction with histograms, not samples; a CI-enforced schema with no strings or coordinates; no cookies; per-tab id or memory-only; GPC → minimal; no fingerprinting library (fingerprintjs excluded; fonts and canvas downgraded in 01-signals §3.8); no disability inference. Core transmits nothing, so the legal question moves to the consumer; the docs ship a checklist for their counsel (not legal advice): is `sessionStorage` access "strictly necessary" under ePrivacy Art 5(3) or does it need consent (if so, `storage:'memory'` or create the detector after consent); is stored behavioural timing biometric data under GDPR; AU Privacy Act APP 1/APP 5 notice text (template provided). Consent and a deletion path for harness participants are our own obligation.

**Accessibility.** Core locks nobody out. The §5.2 gates (trusted-mouse-only pointer rules, abstaining activations, dictation/Voice Control/IME paths, keyboard scrolls as input, no cadence for keyboard cohorts, two independent rules, abstain beats flag) are the no-false-positive mechanism, and the M1 counterexample tests and §7.6 gate enforce them. **No honeypots, sr-only traps, mismatched accessible names or prompt-injection canaries, ever** (01-signals §3.11). The library adds no DOM. The docs say a behavioural verdict must never gate access.

**Open source vs evasion.** Everything is public (Apache-2.0 recommended: patent grant, matches cloudflare/web-bot-auth). We assume agent builders read the repo: probes fall to Patchright and Camoufox, behaviour to humanisers, and a page-resident agent can forge the verdict. Accepted, because the goal is understanding traffic, not a security boundary. No obfuscation, anti-tamper or seeded probes: bytes and FP risk for nothing against an adversary with the source. No private marker list; consumers may pass their own `extraMarkers`. From M3 the headline is the evasion-cost curve, not a recall claim.

---

## 9. Repo layout and milestones

```
agentlens/                       pnpm workspace; oxlint; oxfmt; vitest; Apache-2.0
├─ packages/
│  ├─ core/                      private workspace pkg: src/{collector,scorer,state,emitter}, rulesets/*.ts,
│  │                             features schema (single source → types, validator, README table),
│  │                             happy-dom unit tests, golden-fixture tests, size-limit config;
│  │                             build: tsdown (or esbuild) → ESM + IIFE + d.ts
│  ├─ beacon/ posthog/ ga4/      adapters (M3)
├─ apps/
│  └─ fixture/                   static harness page (ESM + IIFE variants)
├─ harness/
│  ├─ recorder/                  local JSONL verdict sink (Node)
│  ├─ runners-ts/                Playwright, Patchright, ghost-cursor, perf-trace, SSR import test
│  └─ runners-py/                uv project: Browser Use, computer-use-demo driver
├─ eval/                         uv project: eval.py, baselines/ (2607.26935 tree; agent-detector and
│                                BotD fixture variants), polars, pytest, ruff
└─ fixtures/golden/              one features JSON per labelled run
```

Secrets (the Anthropic key for B runs and LLM keys for Browser Use) come only from a committed `.env.op` via `op run --env-file .env.op -- <cmd>`.

| Milestone                                                        | Scope                                                                                                                                                                                                                                                                                                        | Exit criteria (each a check with quoted output)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **M0 — Scaffold + B tells** (days 1–3)                           | Workspace, tsdown/esbuild ESM+IIFE builds, oxlint/oxfmt/vitest wired; `createDetector` skeleton with #1, #2, #6, #10 extractors, session state and a stub scorer that emits `features`; fixture page; recorder; computer-use-demo and Playwright runners                                                     | (a) `pnpm -r build` emits ESM and IIFE; a Node test imports the built `agentlens.mjs` with no `window` and `snapshot().label === 'abstain'`. (b) From computer-use-demo runs, the recorded verdict `features` show: inter-key histogram mode in the 10–15 ms bin; single-move click share ≥0.9 and dwell <5 ms (mousemove --sync warp + `click 1`); wheel dt CV <0.05 under `--repeat` (or the miss recorded as a finding, per §7.1). (c) Recorded answers for the four §7.1 checks: `fill()` input path, computer-use-demo browser + renderer bucket, headful Playwright runtime tells, Claude in Chrome id persistence.          |
| **M1 — All signals + rules** (days 4–7)                          | All §4 listeners and probes; on-device histograms and cadence; GPC, memory-only, ignore selectors, extraMarkers; scorer Tier 1 + Tier 2 with gates, #7 guard, R10, labels and confidence; `'signal'`/`'verdict'` semantics; `/scorer` subpath; size-limit                                                    | `size-limit` output quoted, and the cap fixed in config at ≤10 KB gz; perf trace within the §4.4 budgets (library time ≤3.25× the control floor at 4× throttle; init ≤10 ms on a developer machine); `Features` schema privacy test green; a vitest case for every rule, **including AT counterexamples that must abstain or stay human-like**: keyless trusted `insertText`, IME-229 typing, `detail===0` activations, Cmd+Tab keyup while hidden, trackpad tap-to-click, keyboard-only session, touch phone session; Playwright stock headless test asserts `label==='agent-likely' && confidence==='certain'` from the fixture. |
| **M2 — Release gate + GitHub Release v0.1.0 + docs** (days 8–12) | Full §7.2 matrix and §7.3 humans; `eval.py` with baselines and bounds; golden fixtures; README (API, "data collected" table, the forgeability trade-off up front, class honesty, recipes §6.1–6.3, framework snippets, privacy checklist and APP notice template); CI release workflow attaching built files | §7.6 gate passes (report committed); golden suite green; `gh release view v0.1.0 --json assets` lists `agentlens.mjs`, `agentlens.iife.js`, `scorer.mjs` and types; a fresh Vite app vendoring `agentlens.mjs` and a plain `<script>` page using the IIFE asset each log a verdict in a Playwright smoke test. If the gate fails, release with Tier 2 labels downgraded to evidence-only and say so in the release notes.                                                                                                                                                                                                          |
| **M3+ — Adversary ladder, model, adapters** (weeks 3–14)         | §7.2 additions incl. forgery run and B ablation ladder; AT panel toward 120 sessions (≥20 per modality); learned model as compiled weights (§5.4); `recipes/beacon`, `posthog`, `ga4`; monthly marker re-verification run                                                                                    | Matrix published with Wilson CIs per cell; evasion-cost curve published; AT FPR upper bound ≤2.5% stated (0/120) or the failing rule demoted; model promoted only on the §5.4 criterion, else the decision recorded; each recipe has a test against a mock sink; the monthly run fails CI when any Tier 1 marker stops firing, and a patch release is tagged within 7 days.                                                                                                                                                                                                                                                        |

---

## 10. Risks and open questions

**Risks.**

1. **Forgeability** (§1): mitigated only by having no enforcement in core, stating it first, and publishing the forgery run.
2. **B is thin and brittle**: verified on the reference harness only; always a lower bound; ablation ladder in M3+.
3. **C attribution rides on markers that rot** (01-signals Q13), and markers are now compiled in, so a fix needs a release and consumers need to upgrade. Mitigations: monthly re-run, a 7-day patch policy, `extraMarkers` for consumers who cannot wait.
4. **AT false positives** in under-tested modalities (Windows switch access, Dragon on Windows, older AT); gates reduce it, small n cannot rule it out.
5. **Gate evasion**: keyboard-only agents abstain by design, reported as abstain share.
6. **Bundle budget**: 7–9 KB gz is an estimate; size-limit fails CI, and probes are cut first.
7. **Thresholds come from CAPTCHA and FP-Agent parameters** (01-signals §3.1), not real traffic, and core has no telemetry of its own to recalibrate from. Recalibration depends on consumers or the owner's own site sharing `features`; golden fixtures make ruleset changes reviewable.
8. **Session fragmentation**: per-tab state splits agents that open new tabs; mixed human-to-agent sessions are not separated.
9. **Lost signals from v1's server.** No #19 ASN, #20 IP-geo comparison, #12/#23 identity or #16 Sec-Fetch, so A attribution relies on #14/#15 priors only and more sessions end `agent-unattributed`.

**Open questions for the owner.**

1. **Is the owner's own site EU-facing?** That decides whether the docs recommend `storage:'memory'` by default and whether harness participants need a formal consent form.
2. **Which C products can the owner access** for harness runs (Atlas, Comet, Gemini in Chrome)? Without them, C validation is Claude in Chrome only.
3. **Licence:** Apache-2.0 (proposed) or MIT?
4. **AT panel budget for M3+** (paid participants through AU disability or AT user organisations), and is the ~2.5% bound that 120 sessions buy acceptable for a public accuracy statement?
5. **Headline label policy:** should one-rule sessions be `human-like`/`low` (proposed), or get their own label (v1's `possible`)? And should docs tell consumers to count only `agent-likely` in an "agent share", or `agent-likely + agent-unattributed`?
6. Should the `known_actions` corpus (arXiv 2605.14786, no licence) be requested from its authors for calibration?

---

## 11. Changes from v1, and what is out of scope

Removed with the server: Worker ingest, D1, crons and rollups, the Access-protected dashboard and `/api/*`, HMAC harness labels, beacon clamps and the data-quality cohort, the private marker list, M4 production shadow review and the FP tripwire, and M6 enforcement. Moved: the scorer into the bundle (offline rescoring via `scorer.mjs` replaces server rescoring); the marker list into the ruleset. Relabelled: `agent-certain` became confidence `certain`, `possible` folds into `human-like`/`low`, `gpc-minimal` became `abstain`.

**Out of scope for now:** npm distribution (add later; unscoped `agentlens` is taken, so it would need a scope or rename), and a `verify` server companion that verifies Web Bot Auth / Visa TAP signatures (#12) with cloudflare/web-bot-auth (Apache-2.0), checks declared UA tokens against vendor IP lists (#23, arcjet/well-known-bots), Sec-Fetch semantics (#16) and ASN (#19), and re-scores submitted `features`. TLS/JA4 stays out entirely. Any such package would be the place for enforcement-grade signals, and would carry its own gate (v1 M6's ≤0.3% AT FPR bound) before anything it emits is used to act on a visitor.
