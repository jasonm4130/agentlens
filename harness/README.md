# Harness runbooks

How to produce every run the release gate (architecture 7.6) needs. Each run is one task flow on the fixture page (`apps/fixture`: search, open a result, scroll, fill a 5-field form, click a below-the-fold button, 3 pages), recorded by `harness/recorder` into `harness/recorder/out/<run>.jsonl` together with one ground-truth **label line**. `eval/` counts only labelled runs.

```sh
pnpm install && pnpm build
pnpm --filter @agentlens/runners-ts exec playwright install chromium chromium-headless-shell
pnpm --filter @agentlens/recorder start      # fixture + recorder on http://127.0.0.1:8787
```

Open the fixture as `http://127.0.0.1:8787/?run=<id>&baselines=1`: `run` names the JSONL file, and `baselines=1` also runs BotD and agent-detector on the same pages so the eval can compare them. Run ids are letters, digits, `.`, `_` and `-`.

## Label lines

Scripted runners write their own label. For anything driven by hand, write it with the label CLI before the run (it appends to the same file):

```sh
pnpm --filter @agentlens/recorder label --run=cic-01 --generator=claude-in-chrome
pnpm --filter @agentlens/recorder label --run=h-P03-voiceover-ios-1 --generator=human \
  --cohort=voiceover-ios --participant=P03
```

Generators: `playwright-headless`, `playwright-headful`, `patchright`, `browser-use`, `ghost-cursor`, `ghost-cursor-patchright` (class A); `computer-use-demo` (B); `claude-in-chrome`, `atlas`, `comet`, `gemini-in-chrome` (C); `human`. Human cohorts: `mouse`, `trackpad-tap`, `trackpad-click`, `touch-phone`, `keyboard-only`, `voiceover-macos`, `voiceover-ios`, `voice-control`, `dragon`, `dictation`, `ime`, `password-autofill`. Participants are pseudonyms (`P01`), never names.

## The matrix (architecture 7.2)

| Class | Generator                                             | Runs   | Needs                                    | How                                                                                                |
| ----- | ----------------------------------------------------- | ------ | ---------------------------------------- | -------------------------------------------------------------------------------------------------- |
| A     | Playwright headless                                   | 15     | nothing                                  | `pnpm --filter @agentlens/runners-ts matrix --generator=playwright-headless --runs=15 --baselines` |
| A     | Playwright headful                                    | 15     | a display (Xvfb on Linux)                | `... matrix --generator=playwright-headful --runs=15 --baselines`                                  |
| A     | Patchright headful                                    | 15     | a display                                | `... matrix --generator=patchright --runs=15 --baselines`                                          |
| A     | Playwright + ghost-cursor                             | 10     | a display                                | `... matrix --generator=ghost-cursor --runs=10 --baselines`                                        |
| A     | Patchright + ghost-cursor (extra)                     | 10     | a display                                | `... matrix --generator=ghost-cursor-patchright --runs=10 --baselines`                             |
| A     | Browser Use, stock (highlights on)                    | 15     | an LLM key                               | [Browser Use](#browser-use)                                                                        |
| B     | computer-use-demo (Docker, Xvfb), deferred for v0.1.0 | 10     | `ANTHROPIC_API_KEY`, Docker, an operator | [computer-use-demo](#computer-use-demo)                                                            |
| C     | Claude in Chrome, hands-off                           | 10     | an operator with Claude in Chrome        | [Claude in Chrome](#claude-in-chrome-and-other-class-c-agents)                                     |
| C     | Atlas, Comet, Gemini in Chrome                        | 5 each | access to each product                   | same as Claude in Chrome                                                                           |

Anthropic keys come only from 1Password through the committed `.env.op`: `op run --env-file .env.op -- <command>`. Confirm the vault and item with `op item list` before the first live run. Browser Use can instead go through OpenRouter (below); its key lives only in the environment of the runner process, never in the repo or a log.

### Browser Use

```sh
pnpm --filter @agentlens/recorder start      # in another terminal
cd harness/runners-py
op run --env-file ../../.env.op -- uv run --with browser-use==0.13.10 \
  agentlens-runner browser-use --runs 15     # --model defaults to claude-opus-5-5
```

Browser Use is not in the runner's lockfile (it pins a large dependency tree); `--with` adds it for the run. It launches its own Chromium (`uvx browser-use install` if it asks), headless when it finds no screen; under Xvfb set `BROWSER_USE_HEADLESS=false` so it runs headful as on a desktop. Each run writes its label, then gives the agent the task with the fixture URL.

With browser-use 0.13.10, `claude-opus-5-5` declines Browser Use's agent prompt (`stop_reason` `refusal`, category `reasoning_extraction`), so pass another model, such as `--model claude-sonnet-5`. The 2026-10-05 runs went through OpenRouter on Claude Sonnet 5:

```sh
cd harness/runners-py
# OPENROUTER_API_KEY set in this process only
uv run --with browser-use==0.13.10 agentlens-runner browser-use --provider openrouter \
  --runs 15 --budget 15    # --model defaults to anthropic/claude-sonnet-5 on OpenRouter
```

`--provider openrouter` talks to OpenRouter's Anthropic-compatible endpoint and prints each run's OpenRouter cost; `--budget` (USD) stops the series between runs once it is spent, and `--start` resumes a numbered series.

### computer-use-demo

For each of 10 runs (`cud-01` ... `cud-10`):

```sh
cd harness/runners-py
op run --env-file ../../.env.op -- uv run agentlens-runner run --run-id cud-01
```

The v0.1.0 release gate defers these runs (the gate report says DEFERRED: neither passed nor failed). They need a direct Anthropic key: on 2026-10-05 OpenRouter's Anthropic-compatible endpoint rejected every computer-use tool version (`computer_toolset_20260801`, `computer_20251124`, `computer_20250124`) with a 400, while the same request without the tool went through.

It writes the class B label and prints the Docker command and the prompt to paste into the demo UI at `http://localhost:8501`. The demo's browser reaches the recorder at `host.docker.internal:8787`. Leave the agent alone until it clicks Confirm, then close the browser tab so the page flushes its verdict. M0's open check also applies: note which browser and WebGL renderer bucket the container reports (`features.probes.renderer` in the JSONL).

### Claude in Chrome (and other class C agents)

For each of 10 runs: write the label (`--generator=claude-in-chrome --run=cic-NN`), open `http://127.0.0.1:8787/?run=cic-NN&baselines=1` in Chrome with the extension, and ask Claude: "Search for 'agent detection', open the first result, scroll to the bottom, fill in the form (name Ada Lovelace, email ada@example.com, topic engines, company Analytical, notes none), click Save details, follow the Continue link, and click Confirm." Keep your hands off the mouse and keyboard until it finishes, then close the tab. The gate's C recall is marker-driven; if the `C-marker` rule does not fire, record that the marker did not persist (the M0 persistence check) so the gate is restated as behavioural recall.

## Human and assistive-technology sessions (architecture 7.3)

About 40-60 sessions from the owner plus 4-6 people, with at least one daily assistive-technology user, across every cohort above. Before each participant's first session, go through [the consent form](human/consent.md) and record their agreement. Then for each session:

1. Write the label: `pnpm --filter @agentlens/recorder label --run=h-P03-mouse-1 --generator=human --cohort=mouse --participant=P03`.
2. Open `http://<host>:8787/?run=h-P03-mouse-1&baselines=1` on the participant's own device and setup. For a phone, start the recorder with `HOST=0.0.0.0` and use the computer's LAN address (only on a network you trust).
3. Ask them to do the task their usual way (give the made-up form values), then close the tab.

Public human datasets are sanity checks on pointer features only, never the false-positive set.

**Deleting a participant's sessions** (on request, within the time the consent form promises): delete `harness/recorder/out/h-<code>-*.jsonl`, `eval/runs/*/h-<code>-*.jsonl` and `fixtures/golden/h-<code>-*.json`, regenerate the gate report, commit, and tell them. Copies in git history stay unless the history is rewritten; the consent form says so.

## After the runs

```sh
mkdir -p eval/runs/<date> && cp harness/recorder/out/*.jsonl eval/runs/<date>/
cd eval
uv run eval.py golden --runs runs/<date>          # fixtures/golden/<run>.json for new runs
uv run eval.py gate --runs runs/* --out reports/gate-<date>.md
```

Commit the runs, the new golden fixtures and the report together. `gate` also runs the size, perf, privacy, golden, SSR and axe checks (`--commands none` skips them, which leaves those checks NOT RUN); it exits non-zero unless every gated check passes.
