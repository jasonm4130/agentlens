# Agent-vs-human signal catalogue (2026-10-02)

Scope: a lightweight detector, embedded on our own site, that tells when an AI agent rather than a human with a mouse is using it. Every signal is judged against three classes:

- **A. CDP-driven automation.** Playwright, Puppeteer or Selenium under Browser Use, Stagehand, Browserbase, Steel, or a hosted Chromium such as the one ChatGPT agent runs.
- **B. OS-level computer use.** A VM desktop driven by a screenshot, model and xdotool/pyautogui loop. Events are trusted and `navigator.webdriver` is unset.
- **C. Agents inside the user's own browser.** Claude in Chrome, ChatGPT Atlas agent mode, Perplexity Comet and Gemini in Chrome.

Provenance: this file merges four research passes and applies two adversarial critiques, one checking evidence and one checking adversaries and false positives. No new web fetches were made while writing it. "Verified" means a critic or researcher fetched the primary source or code. UNVERIFIED means nobody did. Where the critics disagreed, the one with the stronger primary evidence (fetched source code or paper HTML) wins, and the disagreement is noted.

---

## 1. Bottom line

Classic runtime fingerprints (webdriver, CDP leaks, headless tells) do nothing against class B, and FP-Agent found browser fingerprints weak against commercial agents in general. Only behaviour separates B from humans. For B, the evidence is verified only for Anthropic's reference computer-use harness (`computer.py` in anthropics/claude-quickstarts). That harness has six tells:

- It warps the cursor with `xdotool mousemove --sync` and never interpolates.
- It clicks with `xdotool click 1` and no delay, so down and up arrive back to back.
- It types with `xdotool type --delay 12`, a fixed 12 ms inter-key gap.
- It scrolls with `xdotool click --repeat N` on buttons 4/5, which gives identical, evenly spaced wheel ticks.
- The cursor stays frozen between model calls.
- It runs on Xvfb with no GPU, so the browser falls back to software GL.

Each of these can be removed in a line of harness code. The one durable residual is the shape of the screenshot-model loop: bursts of action separated by multi-second, quasi-regular inference gaps, with zero pointer activity in between. OSWorld-Human attributes 75-94% of agent latency to planning and reflection calls. That tell is weak on its own, because humans who read and then act are also bimodal, so it only works as a session-level score combined with frozen-cursor gaps and zero-dwell clicks.

The commercial agents measured so far (Atlas, Claude for Chrome, Comet, the hosted ChatGPT Agent and Manus in FP-Agent, arXiv 2605.01247) are easier. All except Skyvern send a single mousemove and then an immediate mousedown/mouseup, type in under 1-5 ms per key or paste, and scroll in discrete jumps. A cheap pointer, keyboard and scroll collector therefore catches today's A and C agents, and class B agents on reference harnesses. For tomorrow's humanised B, plan on a probabilistic score, not a verdict.

---

## 2. Ranked table: signals kept for v1 or v1.5

Ranked by value for a lightweight, embedded detector: precision against current agents, then client cost, then evasion cost.

FP = false-positive risk. Client cost = JS size and CPU on the visitor's page.

| #   | Signal                                                                                          | Family              | A / B / C                                                        | FP risk                                                               | Evasion cost                                         | Client cost                            |
| --- | ----------------------------------------------------------------------------------------------- | ------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------- | -------------------------------------- |
| 1   | No pointer path before click (single-move or teleport click) and low mouse-event rate           | pointer             | **A strong / B strong (ref harness) / C strong (measured)**      | Medium: touch, keyboard and AT users; gate on `pointerType==='mouse'` | Low (interpolated moves)                             | ~1-2 KB, passive listeners             |
| 2   | Click hold time (down-to-up dwell) near 0 ms                                                    | pointer             | A strong / B strong (ref harness) / C strong                     | Medium: trackpad tap-to-click                                         | Low                                                  | Negligible                             |
| 3   | Think-time burst cadence (loop rhythm)                                                          | temporal            | A / B / C; the main residual for B                               | Medium: readers, AT users, slow networks                              | Low-medium (jitter, at a latency cost)               | Tiny; stats computed on the server     |
| 4   | Frozen cursor between actions; no hover or incidental interaction                               | pointer             | A / B (ref harness) / C                                          | Medium: keyboard, touch, AT                                           | Medium                                               | Small                                  |
| 5   | Form fill without keystrokes; paste with no copy or shortcut history                            | keyboard/form       | A strong / B weak / C strong (Atlas, Comet, ChatGPT Agent paste) | Medium: autofill, password managers, real paste                       | Low (costs the agent speed)                          | Trivial                                |
| 6   | Keystroke timing (uniform sub-15 ms or fixed 12 ms gaps, no overlap)                            | keyboard/form       | A / B (ref harness 12 ms) / C (Claude for Chrome <1 ms)          | Low-medium: IME, dictation                                            | Low-medium                                           | Small; timings only                    |
| 7   | Trusted input while `visibilityState==='hidden'`                                                | provenance          | A / ? / C (UNVERIFIED that C agents act in hidden tabs)          | Very low                                                              | Medium for C, which would have to foreground the tab | Negligible                             |
| 8   | Untrusted events and broken event chains (incl. Browser Use's synthetic input/change/blur trio) | provenance          | A (Browser Use) / no / C via content-script paths only           | Low-medium: AT and extensions                                         | Low                                                  | Negligible                             |
| 9   | Known agent DOM markers (Claude in Chrome, Browser Use)                                         | extension artifacts | A (Browser Use) / no / C (Claude in Chrome)                      | Near zero                                                             | Vendor-controlled; markers rot per release           | Small, using a scoped MutationObserver |
| 10  | Scroll without wheel; discrete, evenly spaced wheel ticks                                       | scroll              | A strong / B moderate / C medium                                 | Medium: notched wheels, keyboard scrolling                            | Low-medium                                           | Trivial                                |
| 11  | Click at exact element centre                                                                   | pointer             | A strong / B-C low                                               | Low-medium                                                            | Low                                                  | Negligible                             |
| 12  | Web Bot Auth (and Visa TAP) signature verification                                              | server identity     | Cooperative A only                                               | ~0                                                                    | n/a; absence proves nothing                          | None                                   |
| 13  | `navigator.webdriver` and its property descriptor                                               | runtime             | Unpatched or headless A                                          | Very low                                                              | Trivial                                              | Negligible                             |
| 14  | UA / Client Hints / platform coherence, incl. `HeadlessChrome`                                  | runtime             | A (default Playwright headless still uses headless-shell)        | Low-moderate; Chromium only                                           | Low                                                  | Negligible                             |
| 15  | Headless pointer-media tell (`hover`/`pointer` media queries)                                   | runtime             | Headless Playwright A                                            | Low (UNVERIFIED)                                                      | Low                                                  | Negligible                             |
| 16  | Sec-Fetch-* semantic consistency                                                                | server/network      | A (Browser Use 100% violation)                                   | Low-moderate: proxies                                                 | Medium                                               | None                                   |
| 17  | Software GPU renderer (SwiftShader, llvmpipe)                                                   | environment         | A / B (ref harness: Xvfb) / no                                   | Moderate: VDI, acceleration off                                       | Medium                                               | Small-medium                           |
| 18  | Screen/window geometry cohort (XGA/WXGA, DPR 1, no browser chrome)                              | environment         | A / B / weak                                                     | Moderate-high                                                         | Low                                                  | Negligible                             |
| 19  | Datacenter ASN                                                                                  | network             | A strong / B partly / no                                         | High: VPN, Private Relay                                              | Low-medium                                           | None (`request.cf.asn`)                |
| 20  | Timezone/locale vs IP geo                                                                       | environment         | A / B / no                                                       | Moderate (VPNs are common in AU)                                      | Low                                                  | Negligible                             |
| 21  | Injected-script and framework-global leaks                                                      | runtime             | Default-config A                                                 | Low                                                                   | Medium-low                                           | <1 ms                                  |
| 22  | screenX/Y and movementX/Y consistency on CDP events                                             | pointer             | A (and C via chrome.debugger, UNVERIFIED)                        | Moderate; needs calibration per browser                               | Medium                                               | Negligible                             |
| 23  | Declared agent UA tokens plus vendor IP ranges                                                  | server identity     | Cooperative fetchers                                             | Low                                                                   | Zero                                                 | None                                   |
| 24  | Unthrottled timers in a hidden tab                                                              | runtime             | Playwright A (UNVERIFIED in practice)                            | Unknown                                                               | Low                                                  | Small                                  |
| 25  | chrome.debugger infobar viewport step (~30-40 px)                                               | extension artifacts | Corroborates C                                                   | High                                                                  | Low (policy install suppresses it)                   | Negligible                             |
| 26  | Cross-signal coherence score with per-class label                                               | aggregation         | Combines all of the above                                        | Threshold-controlled                                                  | High relative to single signals                      | 3-10 KB gz total; scored on the server |

Signals moved to feature-only or phase-2 status are covered in section 3 under "downgraded". Rejected signals are in section 4.

---

## 3. Per-family detail

### 3.1 Pointer kinematics

**Absent pointer path and teleport click (rank 1).** How to measure:

- Track the last `pointermove` (x, y, t) with passive capture listeners.
- On `pointerdown`, record:
  - the number of moves in the previous ~300 ms and since the last click;
  - the displacement from the last known position;
  - the time since the last move.
- `single_move_click_ratio` = clicks with ≤1 prior move and displacement > N px, divided by all mouse clicks.
- `mouse_event_rate` = moves per second of active pointer time.
- Also flag a first interaction that is a `pointerdown` with no prior move.
- Gate on `pointerType==='mouse'`, and skip clicks with `detail===0` (keyboard activation).
- Send counters, not coordinates.

Evidence:

- **FP-Agent (arXiv 2605.01247).** Tested Atlas, ChatGPT Agent, Claude for Chrome, Comet, Manus, Browser Use and Skyvern. All except Skyvern "produce mouse events only at click time … single mousemove followed immediately by mousedown and mouseup". Skyvern produced long, human-like trajectories (arXiv 2606.20910).
- **Playwright.** `mouse.move` defaults to `steps = 1` (playwright-core `server/input.ts`).
- **Anthropic reference harness.** Uses `xdotool mousemove --sync x y` with no interpolation (claude-quickstarts `computer.py`).
- **Correction to the merged catalogue.** arXiv 2607.26935 defines "teleport ratio" differently: the fraction of clicks preceded within 100 ms by a raw move jump >100 px in <50 ms. That is a fast human flick, and humans score about 0.05. Agents score 0 because they emit no raw move stream at all. The paper therefore supports low `mouse_event_rate` and absence of movement. It does not support our ≤1-move metric, which stays a hypothesis to validate locally.
- **Human baselines.** The paper's human figures (15 ± 7 Hz) are distribution parameters from CaptchaSolve30k CAPTCHA data, not general browsing. Its agent was Claude driving Chrome via MCP only, and paths that bypass CDP are explicitly out of scope.

False positives: touch and pen, keyboard activation, screen readers and voice or switch control (synthetic clicks), a cursor resting on the target at load, and coarse remote desktop. Evasion: Bezier or WindMouse humanizers (ghost-cursor), `pyautogui.moveTo(duration=…)`. cside claims a trained model still catches humanizers 97-100% of the time (vendor claim, UNVERIFIED).

**Click hold time (rank 2).** dwell = `pointerup.timeStamp - pointerdown.timeStamp`. Features: median, the share of clicks under 20 ms, and the standard deviation across clicks. Also record movement between down and up (humans jitter 0-3 px).

- Anthropic reference `left_click` is `xdotool click 1` with no delay. Double and triple clicks use `--repeat N --delay 10` (verified in `computer.py`).
- FP-Agent: "mousedown and mouseup immediately follow".
- Browser Use awaits the CDP `mousePressed` and `mouseReleased` calls back to back (`default_action_watchdog.py`, commit 302d8fc, 2026-10-01).
- The human baseline of about 110 ± 30 ms is a CAPTCHA-dataset parameter (arXiv 2607.26935 Table 1), so re-baseline on our own traffic.
- Trackpad tap-to-click gives near-zero dwell. Use the aggregate share across several clicks, never a single click.

**Frozen cursor, hover and incidental interactions (rank 4).** For gaps over 1 s between actions, count:

- moves per idle second;
- distinct elements hovered but never clicked (hashed element paths);
- hover-to-click latency;
- incidental human actions: `selectionchange`, `dblclick`, `contextmenu`.

FP-Agent found no movement between clicks for 6 of 7 agents. The Anthropic harness moves the cursor only as part of an action, so it sits frozen during inference. Skyvern is the known mouse-heavy exception. The signal is unusable on touch-primary traffic and should get reduced weight in assistive-technology cohorts (see section 5).

**Click at exact centre (rank 11).** Compute `(clientX - rect.left) / width` and the y equivalent, and flag 0.5 ± 0.01 across several clicks on elements of different sizes.

- Playwright `locator.click()` and Puppeteer `element.click()` default to the element centre.
- Browser Use's current code dispatches the CDP press and release at `center_x/center_y` (`default_action_watchdog.py` ~L995, commit 302d8fc). This is verified.
- Vision agents (B, and pixel-mode C) click a predicted pixel, so the spread is unknown (UNVERIFIED).

**screenX and movementX consistency (rank 22).** Check that `screenX ≈ clientX + window.screenX` (plus the browser chrome offset), and that `movementX/Y` matches the clientX/Y deltas. A current stealth package (`@mochi.js/inject`) patches the `MouseEvent.prototype.screenX/Y` getters to return `clientX + window.screenX` behind a native-looking `toString`. That only makes sense if CDP-dispatched events break the relationship, so the leak is corroborated by a secondary source but not tested on current Chrome. Also check the getters for own-property and `toString` integrity.

**Downgraded to classifier features only (no standalone rule):**

- **Path straightness and curvature.** Playwright's linear tween is verified (`input.ts` L227-229), but most agents emit no path, and Bezier humanizers defeat the measure.
- **Velocity, acceleration and jerk profile.** The 93% single-trajectory figure (arXiv 2005.00890) was not re-checked.
- **Fitts-law consistency.** Warp-based agents have no movement time to fit, and the measure needs 10+ clicks.
- **Overshoot and homing.**
- **Event density and dt distribution.** This is where `mouse_event_rate` lives. The "dt is an exact multiple of a base period" sub-feature is rejected (section 4).
- **Pointer coalescing and `pointerrawupdate`.** The core claim, that CDP dispatch gives a coalesced length of about 1, is UNVERIFIED. `pointerrawupdate` is Chromium-only and needs a secure context. VDI sessions look the same.
- **Coordinate quantisation.** Rounding is browser-specific, and one line of jitter evades it.
- **Viewport exit and entry.** Unmeasured. It is weak for C, because the human can move the mouse out of the window while the agent works. Fullscreen and touch also break it.
- **Touch and pen cross-modality.** Off-question; it only catches CDP mobile emulation.
- **Learned trajectory classifier.** Phase 2. It needs a labelled corpus and carries a behavioural-biometrics privacy burden.

Sources: https://arxiv.org/html/2605.01247v1 · https://arxiv.org/html/2607.26935v1 · https://arxiv.org/html/2606.20910v1 · https://playwright.dev/python/docs/api/class-mouse · https://github.com/anthropics/claude-quickstarts (computer-use-demo/computer_use_demo/tools/computer.py) · https://github.com/browser-use/browser-use (browser_use/browser/watchdogs/default_action_watchdog.py, commit 302d8fc) · https://py-cdp.readthedocs.io/en/latest/api/input_.html · https://cside.com/blog/catching-playwright-and-browserless-bots-by-the-cursor · https://socket.dev/npm/package/@mochi.js/inject/diff/0.2.0 · https://arxiv.org/abs/2005.00890v1

### 3.2 Input provenance

**Untrusted events and broken event chains (rank 8).** Put capture-phase listeners on `window`. For each click, log the event chain: pointerover, pointerenter, mouseover, pointermove, pointerdown, mousedown, focus, pointerup, mouseup, click. Record `isTrusted`, `detail`, the gap from enter to down, and a keydown that never gets its keyup.

Verified product signatures:

- **Browser Use, after CDP typing.** It runs a page script that dispatches `new InputEvent('input', {inputType:'insertText', data: element.value})`, then `change`, then `blur`, all with `isTrusted=false`. An untrusted `input` whose `data` equals the whole field value, followed by an untrusted `blur`, is a high-precision Browser Use signature (`default_action_watchdog.py` ~L2105-2165).
- **Browser Use fallback.** For checkboxes, and when a CDP click fails, it calls `Runtime.callFunctionOn('function(){ this.click(); }')`. That produces an untrusted click with no pointerdown (L816, L973).

The evidence critic verified this from source. The adversary critic had flagged the fallback as UNVERIFIED from memory. The source-code evidence wins.

Claude in Chrome uses `chrome.debugger`/CDP to "synthesize user-like events indistinguishable from genuine hardware input" (CHEQ), so its events have `isTrusted=true`. For that product the useful sub-signals are no move before the click and a zero gap from enter to down. `isTrusted=false` only catches content-script paths.

`navigator.userActivation` corroborates: untrusted events do not grant user activation. This is an untested proposal.

**Trusted input while hidden (rank 7).** Promoted to a standalone rule. A pointer or key event with `isTrusted===true` that arrives while `document.visibilityState==='hidden'` should be impossible for a human. The noisier focus sub-signals are demoted:

- `hasFocus()===false` fires on dual monitors and on iframes.
- "Never blurred in the session" is weak.

The merged catalogue claimed Claude in Chrome and Atlas act in background tab groups. That claim is not in the CHEQ article, so it is UNVERIFIED and must be tested on the harness. CDP `Emulation.setFocusEmulationEnabled` makes `hasFocus()` return true, so `hasFocus()` being true while no focus event ever fired is a weak extra tell.

Sources: https://developer.mozilla.org/en-US/docs/Web/API/Event/isTrusted · https://developer.mozilla.org/en-US/docs/Web/API/UserActivation · https://cheq.ai/blog/the-cyborg-session-reversing-detecting-claude-ai-agent-chrome-extension/ · browser-use `default_action_watchdog.py` (commit 302d8fc)

### 3.3 Scroll

**Scroll without wheel; discrete, evenly spaced ticks (rank 10).** Use passive `wheel` and `scroll` listeners. Measure:

- the counts of wheel events vs scroll events (a `scrollTop` change with no preceding wheel, touch or key event means a programmatic scroll);
- the distribution of step sizes;
- the regularity of wheel cadence;
- the presence of inertial decay;
- reversals;
- actions on elements below the fold without any scroll.

Evidence:

- FP-Agent: agents scroll elements into view instantly or emit short discrete bursts.
- Browser Use uses `DOM.scrollIntoViewIfNeeded` (no wheel) and CDP `mouseWheel`.
- arXiv 2607.26935 saw zero wheel events, but for one stack only.
- Anthropic harness: `xdotool click --repeat N` on buttons 4/5 gives identical deltas at a fixed spacing. That looks like a notched wheel, but with perfectly regular cadence. The xdotool default repeat delay is UNVERIFIED.

False positives: notched wheels, keyboard scrolling, anchors, find-in-page, scrollbar drags. Normalise `deltaMode` per browser, since Firefox can report lines (`deltaMode=1`).

Sources: https://arxiv.org/html/2605.01247v1 · https://arxiv.org/html/2607.26935v1 · https://developer.mozilla.org/en-US/docs/Web/API/WheelEvent/deltaMode · https://pyautogui.readthedocs.io/en/latest/mouse.html · computer.py

### 3.4 Keyboard and form

**Keystroke timing (rank 6).** Record only `(code, timeStamp)` on keydown and keyup: never key values, and skip password fields. Features:

- dwell median and coefficient of variation;
- fraction of negative flight times (key overlap);
- inter-key coefficient of variation;
- the exact constant-gap signature.

Verified figures from FP-Agent (paper HTML, now verified), inter-key gap and key hold:

| Agent             | Inter-key | Hold     |
| ----------------- | --------- | -------- |
| Manus             | 1.39 ms   | 52.92 ms |
| Browser Use       | 5.31 ms   | 10.19 ms |
| Skyvern           | 9.52 ms   | 11.33 ms |
| Claude for Chrome | <1 ms     | <1 ms    |

ChatGPT Agent pastes with Ctrl+V (hold 66.58 ms). Atlas and Comet inject text as paste events.

Browser Use's source has a fixed `asyncio.sleep(0.010)` per character. The Anthropic harness sets `TYPING_DELAY_MS = 12` and runs `xdotool type --delay 12` in chunks (verified). OpenAI CUA and Gemini harness timings are UNVERIFIED.

False positives: IME (keyCode 229), dictation, on-screen keyboards, password managers.

**Form fill without keystrokes and suspicious paste (rank 5).** Compare `beforeinput`/`input` `inputType` against keydown counts per field. Flag:

- a value jump of more than 3 characters with no paste event and no Ctrl/Cmd+V;
- `insertFromPaste` with no prior copy, cut or context-menu event in the session;
- `isTrusted=false` on an `input` event.

Playwright `fill()`, CDP `Input.insertText` and value setters all skip key events. Atlas, Comet and ChatGPT Agent paste (FP-Agent), so hosted and class C agents are strong targets, not only class A. Claude in Chrome exposes a separate `form_input` tool alongside `computer`, which implies a value-setting path. Its DOM mechanism, including whether `isTrusted` is set, is UNVERIFIED and should be measured. Allowlist autofill and real paste on low-risk fields, and never read clipboard contents.

Sources: https://arxiv.org/html/2605.01247v1 · https://www.semicomplete.com/projects/xdotool/xdotool.xhtml · https://playwright.dev/python/docs/api/class-keyboard · https://developer.mozilla.org/en-US/docs/Web/API/InputEvent/inputType · computer.py · browser-use default_action_watchdog.py

### 3.5 Temporal cadence

**Think-time burst cadence (rank 3).** Timestamp every input with `performance.now()` and collapse runs of moves into actions. Features:

- median and coefficient of variation of the gaps between actions;
- share of gaps in the 1.5-8 s range;
- burst ratio;
- bimodality;
- gap autocorrelation;
- time to first action after load;
- a cursor static for seconds followed by a single warp.

Send timestamp deltas only and compute the statistics on the server.

Evidence:

- OSWorld-Human: planning and reflection calls are 75-94% of agent latency (verified).
- Step counts: cite precisely. The abstract says the best agents take 2.7-4.3× more steps than necessary. The body says 1.4-2.7× vs human trajectories.
- arXiv 2606.20910 confirms that inter-request intervals cluster by agent (Claude and Gemini shorter, AutoGen and Skyvern longer).
- arXiv 2605.14786's abstract reports up to 96% F1 for model identification. The merged catalogue's "72-79% macro F1" was not found and is withdrawn. Both figures are agent-vs-agent, not agent-vs-human.
- The "2-5 s per screenshot action" figure is from a secondary blog: UNVERIFIED.

This is the only signal that spans A, B and C and survives humanizers. Its weakness is that humans who read and then act are bimodal too, and AT users and slow networks collide. Use it at session level only, after several actions.

Sources: https://arxiv.org/html/2506.16042v1 · https://arxiv.org/abs/2605.14786 · https://arxiv.org/html/2606.20910v1 · https://arxiv.org/html/2607.26935v1

### 3.6 Navigation, content and server behaviour

- _*Sec-Fetch-* semantic consistency (rank 16, new)._* Check that Sec-Fetch-Site, Mode, Dest and User match the request context: a navigation needs `navigate`/`document`/`?1` when user-initiated, and a subresource must not claim `navigate`. arXiv 2606.20910 found Browser Use sent impossible Sec-Fetch semantics in 100% of requests. It costs nothing on the server.
- **Navigation provenance (new, weak, UNVERIFIED).** CDP `Page.navigate` and agent "navigate" tools produce browser-initiated loads (`Sec-Fetch-Site: none`, no Referer). A deep-link jump in mid-session with no preceding link click is suspicious, but bookmarks and typed URLs collide.
- **Subresource-fetch pattern (downgraded).** It only catches thin fetchers, because real browsers load assets. The cadence part duplicates think-time.
- **Reading time vs content length (downgraded).** No published measurement and huge human variance. Weak prior only.
- **Task-directed navigation graph (downgraded).** The evidence is contradictory (OSWorld-Human agents take more steps, not fewer) and site-specific.
- **Retry and resubmit patterns (downgraded).** They measure persistence, not agent-ness, and rage-clickers collide. Corroborating only.

Sources: https://arxiv.org/html/2606.20910v1 · https://arxiv.org/html/2506.16042v1 · https://arxiv.org/html/2605.14786v1

### 3.7 Runtime automation fingerprint (class A only)

**`navigator.webdriver` (rank 13).** Check `navigator.webdriver===true`, and check `Object.getOwnPropertyDescriptor(navigator,'webdriver')`: a stock browser has no own property, so one present means a stealth patch. Two corrections to the merged catalogue:

1. MDN lists the Chrome triggers as `--enable-automation`, `--headless` and `--remote-debugging-port=0`, not `--remote-debugging-pipe`.
2. Current Playwright no longer passes `--enable-automation`. It is absent from `chromiumSwitches.ts` and `chromium.ts` on main, and headful launches use `--remote-debugging-pipe`. Headful Playwright therefore likely reports `webdriver=false`. A secondary source dates the change to Playwright 1.53, June 2025 (UNVERIFIED). Headless still sets the flag via `--headless`.

**UA / Client Hints / platform coherence (rank 14).** Check the following:

- `HeadlessChrome` in the UA;
- `userAgentData.brands` vs the UA;
- `getHighEntropyValues` vs the UA;
- `navigator.platform` vs the UA's OS;
- empty `languages`;
- a `plugins` length of 0 (modern Chrome reports a fixed list of 5);
- a missing `window.chrome`;
- Sec-CH-UA headers vs the JS beacon;
- Accept-Language vs `navigator.languages`.

Correction: Playwright's default headless runs `chromium-headless-shell` (`chromium.ts` L423), which is the old-headless lineage. `HeadlessChrome` and the old-headless tells therefore still fire for default Playwright headless. The merged catalogue understated this.

The engine-vs-UA checks from the dropped Camoufox signal live here too: `mozInnerScreenX`, the `fn@url:line:col` stack format, and `CSS.supports('-moz-appearance:none')` under a Chrome UA. Run Client Hints checks only within Chromium.

**Headless pointer-media tell (rank 15, new).** Playwright headless passes `--blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4`. As a result, `matchMedia('(hover: hover)')` and `('(pointer: fine)')` report non-default values under a desktop UA (verified in `chromium.ts` `_innerDefaultArgs`). The false-positive rate on real desktops is UNVERIFIED.

**Unthrottled hidden-tab timers (rank 24, new, UNVERIFIED in practice).** Playwright passes `--disable-background-timer-throttling`, `--disable-renderer-backgrounding` and `--disable-backgrounding-occluded-windows`. A `setTimeout` loop that keeps full cadence while the tab is hidden is therefore the inverse of normal Chrome behaviour. This also means that timing features must be measured with visibility in mind.

**Injected-script and framework-global leaks (rank 21).** Look for:

- `__playwright*`, `__pwInitScripts`, `cdc_*`, `__selenium_*`, `__webdriver_*`, `domAutomation*`;
- stack frames containing `pptr:`, `__puppeteer_evaluation_script__` or `UtilityScript`;
- non-native exposed bindings.

It is a cheap catch for the long tail of unpatched frameworks. Never flag `chrome-extension://` frames. The rebrowser README was not fetched.

**Downgraded:** stealth and lie detection for patched runtimes (`Function.prototype.toString` integrity). Brave farbling and privacy extensions fail the same tests, it costs several ms, and B and C are out of reach, so it is optional. Also downgraded: blank-profile tells (usage near zero, history length 1-2). These misfire on every first visit and incognito session, so use them only as a returning-visitor consistency check.

Sources: https://developer.mozilla.org/en-US/docs/Web/API/Navigator/webdriver · playwright-core `src/server/chromium/chromium.ts` and `chromiumSwitches.ts` (main) · https://github.com/microsoft/playwright/issues/33566 · https://www.centinelanalytica.com/blog/patched-chromium-browsers · https://datadome.co/threat-research/how-new-headless-chrome-the-cdp-signal-are-impacting-bot-detection/ · https://blog.castle.io/why-a-classic-cdp-bot-detection-signal-suddenly-stopped-working-and-nobody-noticed/ · https://cljdoc.org/d/com.blockether/spel/0.9.9/api/com.blockether.spel.stealth (secondary)

### 3.8 Environment, VM and display

**Software GPU (rank 17).** Read `UNMASKED_RENDERER_WEBGL` and flag SwiftShader, llvmpipe, softpipe, SVGA3D, VirtualBox or Microsoft Basic Render Driver. Also flag `navigator.gpu.requestAdapter()` returning null or `isFallbackAdapter`.

- Playwright always passes `--enable-unsafe-swiftshader`, so SwiftShader is the fallback on GPU-less hosts.
- The Anthropic reference container is Xvfb with no GPU.
- FP-Agent found that Atlas, Claude and Comet share real macOS fingerprints (1440x900), which confirms the signal does nothing for C.

False positives: VDI, users with hardware acceleration turned off, Linux llvmpipe users. Weight it; never block on it.

**Geometry cohort (rank 18).** Collect screen, avail, outer and inner sizes, DPR, colorDepth and resize events. Flags:

- outer equals inner (no browser chrome);
- avail equals screen (no taskbar);
- XGA, WXGA or 1280x720 at DPR 1 under a Mac UA.

The Anthropic harness scales screenshots to XGA 1024x768 and WXGA 1280x800 and has a zoom action. The scaling target is not the Xvfb display size the page sees, which is configurable.

FP-Agent measured hosted environments:

- ChatGPT Agent: font list of only Calibri, 13 CPU cores, Linux x86_64 or MacIntel.
- Manus: Linux x86_64, 4 GB RAM, 6 cores, no HDR.

These describe the test-time environments and will drift. Treat geometry as a cohort feature, never a rule, because 1366x768 and 1920x1080 are common real desktops.

**Timezone/locale vs IP geo (rank 20).** Compare `Intl…timeZone` and languages with `request.cf.timezone`/`country` and Accept-Language. Weight it low: VPN use is common in Australia.

**Downgraded:**

- **Font set and capability profile.** A classic fingerprinting vector with a privacy-policy burden and a cost of tens of ms. GPU and UA coherence catch the same Linux-claiming-Mac case more cheaply. The "only Calibri" ChatGPT Agent result is a concrete positive example.
- **Private Access Tokens.** Turnstile Siteverify documents no field showing whether a PAT was used (success, error-codes, challenge_ts, hostname, action, cdata, metadata), so "record via Turnstile" is likely not implementable. It would need our own PrivateToken challenge against a public issuer. A token is positive evidence only, is absent on all non-Apple traffic, and does nothing for C. Later-phase experiment.

Sources: https://arxiv.org/html/2605.01247v1 · computer.py · https://www.centinelanalytica.com/blog/patched-chromium-browsers · https://blog.cloudflare.com/eliminating-captchas-on-iphones-and-macs-using-new-standard/ · https://datatracker.ietf.org/doc/rfc9577/

### 3.9 Extension and agent artifacts

**Known DOM markers (rank 9).** Use a MutationObserver plus targeted queries.

Claude in Chrome (verified via CHEQ):

- `#claude-agent-stop-container`: the Stop button, present while the agent acts.
- `<style id="claude-agent-animation-styles">`.
- Install probe: `chrome-extension://<id>/assets/accessibility-tree.js-<hash>.js` (the hash rots per release; installed is not the same as acting).
- CHEQ does not state the persistence or removal behaviour of the two IDs, so test it.

Browser Use (verified from source, commit 302d8fc, `session.py` L2794-3303, `profile.py` L697):

- attributes `data-browser-use-highlight`, `data-browser-use-interaction-highlight` and `data-browser-use-coordinate-highlight`;
- container `#browser-use-debug-highlights`;
- `highlight_elements` defaults to True.
- The older `playwright-highlight-container` appears in copies of the historical `buildDomTree.js`. Keep it as a legacy marker.

Still UNVERIFIED: Stagehand's `stagehandV3`, and markers for Atlas, Comet and Gemini in Chrome. Discover them on the harness by dumping the DOM and shadow roots.

**chrome.debugger infobar step (rank 25, downgraded to corroborating).** Claude in Chrome uses chrome.debugger (CHEQ), and a user-filed issue reports the "Claude started debugging this browser" banner on every tab. The ~30-40 px drop in `innerHeight` therefore happens in all open tabs, not only the agent's. Suppression paths exist:

- `--silent-debugger-extension-api`;
- enterprise force-install via `ExtensionInstallForcelist`;
- Playwright passes `--disable-infobars`.

False positives are high: bookmarks, downloads and translate bars, and docked DevTools all cause the same step.

**Generic injected-node monitoring (downgraded to telemetry).** Grammarly, password managers and translators make it noisy, and CPU cost on large DOMs conflicts with "lightweight". Use it to grow the marker library: record tag, id and class only.

Sources: https://cheq.ai/blog/the-cyborg-session-reversing-detecting-claude-ai-agent-chrome-extension/ · https://github.com/browser-use/browser-use · https://claudeissues.com/issue/69287-claude-in-chrome-started-debugging-this-browser-banner-shows-on-every-tab-please

### 3.10 Server identity, network and vendor signals

**Web Bot Auth and Visa TAP verification (rank 12).** When `Signature-Agent` and `Signature-Input` are present, verify the request per RFC 9421:

- fetch the key directory at `/.well-known/http-message-signatures-directory` and cache it;
- verify the Ed25519 signature, which must cover the `Signature-Agent` member;
- check that `created`/`expires` fall within 24 hours;
- check that `keyid` is the JWK SHA-256 thumbprint.

Header and tag rules:

- `Signature-Agent` is a Dictionary structured header. Signers MUST send the dictionary form; verifiers MAY accept the legacy string form (draft verified, so the merged catalogue's UNVERIFIED note is removed).
- Accept the Visa Trusted Agent Protocol tags `agent-browser-auth` and `agent-payer-auth` as well as `web-bot-auth`. A verifier that hard-requires `web-bot-auth` rejects TAP agents. TAP was announced with Cloudflare on 2025-10-14 and uses RFC 9421 with Ed25519 keys in a Visa-operated directory. It is verifiable at the HTTP layer while browsing, not only at checkout.
- ChatGPT agent signs with `Signature-Agent: https://chatgpt.com`. This is corroborated by search; the OpenAI help page returned 403.

This gives high precision and zero recall for uncooperative agents. It belongs in v1 as a positive "declared agent" label.

Draft status as of 2026-10-02: draft-ietf-webbotauth-httpsig-protocol-00 is an active WG draft, updated 2026-09-01 and expiring 2027-03-05. It is not an RFC, so version-pin the verifier.

**Cloudflare fields.** The "signed agent" classification was retired on 2026-07-01. End-user-controlled agents that self-identify with Web Bot Auth are now Verified bots, with Intermediary (rather than Direct) operator metadata. `cf.bot_management.signed_agent` / `request.cf.botManagement.signedAgent` still exists per the variables page. Most fields need Bot Management (Enterprise), which is a real constraint for this project. Cloudflare claims no B or C detection, and FP-Agent found it blocked only Manus of seven agents. `request.cf.asn`, `country` and `timezone` are available on every plan.

**Datacenter ASN (rank 19).** A prior only: strong for hosted A, useless for C.

**Declared UA tokens and vendor IP ranges (rank 23).** Claims to log, verified by IP list:

- OpenAI per-agent JSON files;
- Anthropic `claude.com/crawling/bots.json`, with no dedicated ranges for Claude-User (secondary sources).

Browser-driving agents present normal Chrome UAs.

**JA4 vs UA (downgraded).** It needs Enterprise or our own TLS terminator. Correction: it is not "no signal" for hosted agents. arXiv 2606.20910 saw Operator match Firefox JA4 in 39% of HTTP/2 sessions, and Skyvern send a distinct 17-extension ClientHello. Keep it only if the field is already available.

**JA4H and header order (downgraded).** Thin clients only. Sec-Fetch semantics are promoted to rank 16.

**Cross-request consistency (keep, server).** Watch for mid-session IP/ASN, UA or Client Hints drift and a missing cookie jar. Drop the JA4 component unless JA4 is available.

**Verified-agent directories.** Use them to seed allowlists. Cloudflare opened BotBase operator submissions on 2026-08-28 (search snippet). The DataDome and Akamai pages are UNVERIFIED.

Sources: https://datatracker.ietf.org/doc/draft-ietf-webbotauth-httpsig-protocol/ · https://developers.cloudflare.com/bots/concepts/bot/verified-bots/ · https://developers.cloudflare.com/bots/reference/bot-management-variables/ · https://blog.cloudflare.com/secure-agentic-commerce/ · https://eco.com/support/en/articles/14845482-visa-trusted-agent-protocol-tap-explained · https://help.openai.com/en/articles/11845367-chatgpt-works-cloud-browser-allowlisting · https://botcrawl.com/bots/chatgpt-agent/ · https://arxiv.org/html/2606.20910v1 · https://github.com/FoxIO-LLC/ja4 · https://trustmyip.com/claudebot-verifier

### 3.11 Honeypots and probes (research route only, not the shipped detector)

- **Invisible-link honeypot (downgraded).** The merged citations were wrong. arXiv 2505.13076 covers agent security and prompt injection, and arXiv 2609.19140 (AgentLSD) covers CTF security agents. Neither measures hidden-link traps against web agents. There is also a design conflict:
  - Marking a trap `aria-hidden`/`tabindex=-1` protects screen-reader users, but it also removes the trap from the accessibility tree that a11y-tree agents read (Claude in Chrome ships `accessibility-tree.js`). Such a trap then only catches raw-DOM serialisers and crawlers.
  - Leaving the trap visible in the a11y tree brings the screen-reader false positives back.

  Screenshot-only B agents never see either kind. The AgentSnare repo returned 404, so do not cite it as working code.

- **Prompt-injection canary (downgraded to opt-in research probe).** False negatives are high and rising as vendors harden against injection. It is a deliberate injection against a user's delegated agent, so it carries legal and ethical exposure (CFAA applicability is unsettled; not legal advice). Never ship it in production.
- **Perception-channel probes (downgraded).** A mismatched accessible name violates WCAG 2.5.3, and sr-only traps hit screen-reader users. No source tests the idea. Use it only on the harness test page, to label our own traces by perception channel.

Sources: https://github.com/KhaiB10/honeyprompt · https://github.com/AAH20/canary-mcp · https://www.cornellpolicyreview.com/ignore-prior-instructions-how-indirect-prompt-injection-falls-through-the-cracks-of-cybercrime-law/ · https://www.lawfaremedia.org/article/when-manipulating-ai-is-a-crime · https://arxiv.org/abs/2505.13076 · https://arxiv.org/abs/2609.19140

### 3.12 Aggregation (rank 26)

Never ship rules that rest on a single signal. Log the full vector first, then score it on the server with a small interpretable model (logistic or shallow boosted trees on 5-10 features). Emit labels:

- `verified-agent` (Web Bot Auth or TAP);
- `automation-flag`;
- `extension-agent-signature`;
- `likely-A`;
- `likely-B`;
- `likely-C`;
- `clean`.

Corrected label definitions:

- **likely-A:** single-move or centre clicks, plus no wheel, plus fill or instant typing, plus headless or datacenter tells.
- **likely-B:** frozen-cursor gaps, plus zero-dwell clicks, plus fixed ~12 ms typing, plus regular wheel ticks, plus think-time cadence, plus software GPU or XGA/WXGA geometry, on trusted, coherent events. Verified for the Anthropic reference harness only.
- **likely-C:** single-move clicks, paste or sub-ms typing, a DOM marker or debugger-infobar step, on a real lived-in macOS or Windows fingerprint. The merged definition, "synthetic events = C", conflicted with CHEQ: Claude in Chrome emits trusted events.

Evidence caveat: the arXiv 2607.26935 numbers (macro-F1 ≥0.99, 100% recall) come from one LLM, one framework and CAPTCHA-only human data. The authors scope out non-CDP paths. FP-Agent saw behavioural F1 fall by up to 0.369 on held-out tasks. Do not quote either for our site.

Ship the output as a soft signal (label, rate-limit, step-up), never as a hard block. Client collectors should total about 3-10 KB gzipped, use under 50 ms of main thread, and send aggregate features only.

Sources: https://arxiv.org/html/2607.26935v1 · https://arxiv.org/html/2605.01247v1 · https://cheq.ai/blog/the-cyborg-session-reversing-detecting-claude-ai-agent-chrome-extension/

---

## 4. Signals considered and rejected

| Signal                                                         | Reason                                                                                                                                                                                                                                           |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| CDP `Runtime.enable` side effect via an `Error.stack` getter   | Dead on Chromium since the V8 commits of 2025-05-07 ("Avoid error side effects in DevTools") and 2025-05-09 ("Apply getter guard throughout error preview"). Castle says other unnamed CDP signals still work (UNVERIFIED).                      |
| Notification.permission vs permissions.query mismatch          | A legacy-headless tell, with no evidence of current hits. The critics split: the evidence critic notes default Playwright headless uses headless-shell, so it may still fire. Parked: test once on the harness and adopt only if it fires there. |
| Camoufox / Firefox patched-build coherence as its own signal   | A niche stack that needs TLS/H2 at our own edge. Its engine-vs-UA part is folded into UA coherence (rank 14).                                                                                                                                    |
| JA4 population statistics                                      | Enterprise-only or needs large traffic volume. Useless for B and C.                                                                                                                                                                              |
| HTTP/2 (Akamai-style) fingerprint                              | Behind a CDN we see the CDN's fingerprint. Nothing against real Chrome.                                                                                                                                                                          |
| Forward-confirmed reverse DNS                                  | Crawler verification, not human vs agent. Cloudflare does it upstream.                                                                                                                                                                           |
| Mastercard Agent Pay / PSP checkout identity                   | Checkout-only and secondary sources. Visa TAP's HTTP-layer part is kept inside the Web Bot Auth verifier.                                                                                                                                        |
| KYA / operator identity credentials                            | No adopted standard exists. Web Bot Auth key allowlisting covers the practical case.                                                                                                                                                             |
| "dt is an exact multiple of a base period"                     | Chromium aligns pointer events to animation frames, so human dt clusters on frame multiples too. Use `getCoalescedEvents()` timestamps instead (rAF-alignment claim UNVERIFIED, from known behaviour).                                           |
| `hasFocus()===false` as a rule                                 | Fires on dual monitors and iframes. Only the hidden-tab trusted-input rule survives.                                                                                                                                                             |
| Prompt-injection canary or honeypot in the production detector | Legal and ethical exposure, accessibility harm, high false-negative rate. Research route only (section 3.11).                                                                                                                                    |

---

## 5. Open questions that need our own data

Before building a harness from scratch, use FP-Agent's measurements (7 commercial agents) and arXiv 2605.14786's released harness and labelled trace corpus (14 LLMs) for calibration. Then build a logging test page plus scripted runs for the gaps below.

1. **Class B beyond Anthropic's reference harness.** OpenAI CUA, Gemini computer use, and self-hosted VMs using pyautogui with `duration`. Do frozen-cursor gaps, zero dwell and fixed typing delays survive? No published measurement of B on a self-hosted VM with OS input exists.
2. **Gemini in Chrome.** It is entirely unmeasured: input path, DOM markers, typing, background-tab behaviour.
3. **Background tabs.** Do Claude in Chrome, Atlas and Comet act in hidden or unfocused tabs? This determines the value of rank 7.
4. **Claude in Chrome `form_input`.** What mechanism does it use: value setter, `insertText`, trusted or untrusted events?
5. **Human baselines on our own traffic.** The single-move click ratio, dwell, mouse event rate and wheel regularity for mouse, trackpad, touch and AT cohorts. All current baselines are CAPTCHA-dataset parameters.
6. **CDP-dispatched events.** Do they give a coalesced-events length of 1? Do they break `screenX === clientX + window.screenX` on current Chrome? Does `movementX` derive correctly?
7. **Viewport exits.** Do humans produce `mouseleave` frequently enough on our site for "never leaves the viewport" to mean anything?
8. **Stale-coordinate clicks (new, UNVERIFIED).** Do pixel agents (B and pixel-mode C) click where an element was in a screenshot taken seconds ago? A controlled layout shift on a decoy route could provoke it.
9. **Screenshot side effects (new, UNVERIFIED).** Does `Page.captureScreenshot` (fullPage / `captureBeyondViewport`) cause resize, `visualViewport` changes or rAF bursts in a hidden tab, aligned with think-time cadence?
10. **DOM-extraction bursts (new, UNVERIFIED).** Do counters on `getBoundingClientRect`, `getComputedStyle`, `checkVisibility`, `elementFromPoint` and `TreeWalker` see thousands of calls within milliseconds of each action from main-world serialisers? Isolated worlds (Patchright, content scripts) bypass page-world hooks.
11. **Assistive-technology cohort gate.** Can keyboard-only, switch, voice and forced-colors sessions be identified reliably enough to down-weight pointer features rather than flag them? This is the main false-positive control.
12. **False positives on real desktops.** How often do the headless pointer-media tell and unthrottled hidden-tab timers fire?
13. **Drift.** How fast do the verified product signatures change: Browser Use markers, the CHEQ IDs, FP-Agent environment values? Set a re-verification cadence.
14. **Cost of a fixed false-positive rate.** What precision and recall does the coherence score reach on our traffic at, say, 0.1% FP, and what does a humanised B agent cost to run past it?
