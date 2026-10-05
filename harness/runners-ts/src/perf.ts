/**
 * Perf trace (architecture 4.4): loads the fixture under 4x CPU throttling, drives a scripted
 * session, and reports the library's init time and its total main-thread time from a Chrome
 * performance trace.
 *
 * Each run also registers a no-op control listener for the same DOM events ahead of the
 * library. The first JS listener an event reaches pays for creating its JS wrapper, so the
 * control's time is the floor any script listening to these events pays, and the library's
 * own time is then its cost on a page that already listens (most sites do).
 *
 * Budgets (architecture 4.4, restated at M1 so they hold on any machine): the library's own
 * time is at most RATIO_CAP times the control floor, median of runs; that is the verdict.
 * Init is printed against the 10 ms developer-machine budget but not gated, since a CI
 * runner's absolute times run about twice a developer machine's.
 *
 * Usage: pnpm --filter @agentlens/runners-ts perf [--seconds=60] [--runs=3] [--variant=iife]
 */
import { fixtureMounts, OUT_DIR, startRecorder } from "@agentlens/recorder";
import { chromium, type CDPSession, type Page } from "playwright";

const flag = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];

export interface PerfResult {
  initMs: number;
  /** Library + control: the library's cost as the only listener. */
  totalMs: number;
  /** The library alone, after the control listener created each event's wrapper. */
  ownMs: number;
  /** The no-op control listener: the per-event floor of listening at all. */
  controlMs: number;
  seconds: number;
  throttle: number;
  /** The fixture's last verdict label, to show what the session scored as. */
  label: string;
}

interface TraceEvent {
  name: string;
  ph: string;
  ts: number;
  tid: number;
  dur?: number;
  args?: { data?: { url?: string; scriptName?: string; type?: string } };
}

/** The library's time split by the DOM event (or timer) that ran it, for `--breakdown`. */
export function breakdown(events: TraceEvent[], ours: (url: string) => boolean): string[] {
  const dispatches = events.filter((e) => e.ph === "X" && e.name === "EventDispatch");
  const rows = new Map<string, { us: number; n: number }>();
  for (const e of events) {
    if (e.ph !== "X" || !e.dur || e.name !== "FunctionCall" || !ours(e.args?.data?.url ?? ""))
      continue;
    const end = e.ts + e.dur;
    const d = dispatches.find((d) => d.tid === e.tid && d.ts <= e.ts && d.ts + (d.dur ?? 0) >= end);
    const key = d?.args?.data?.type ?? "timer";
    const row = rows.get(key) ?? { us: 0, n: 0 };
    row.us += e.dur;
    row.n++;
    rows.set(key, row);
  }
  return [...rows]
    .sort((a, b) => b[1].us - a[1].us)
    .map(
      ([k, r]) =>
        `  ${k}: ${(r.us / 1000).toFixed(1)} ms over ${r.n} calls (${(r.us / r.n).toFixed(1)} us each)`,
    );
}

/**
 * Main-thread time in the library, in ms, from a Chrome performance trace: the duration of
 * every top-level script entry (`FunctionCall` for listeners and timers, `EvaluateScript`
 * for loading) whose script is the agentlens bundle.
 */
export function attributedMs(events: TraceEvent[], ours: (url: string) => boolean): number {
  let us = 0;
  for (const e of events) {
    if (e.ph !== "X" || !e.dur) continue;
    if (e.name !== "FunctionCall" && e.name !== "EvaluateScript") continue;
    const url = e.args?.data?.url ?? e.args?.data?.scriptName ?? "";
    if (ours(url)) us += e.dur;
  }
  return us / 1000;
}

/** A scripted human-paced session: wandering mouse, clicks, typing, wheel scrolling. */
async function drive(page: Page, seconds: number): Promise<void> {
  const end = Date.now() + seconds * 1000;
  let i = 0;
  while (Date.now() < end) {
    const x = 100 + ((i * 137) % 700);
    const y = 120 + ((i * 89) % 400);
    await page.mouse.move(x, y, { steps: 25 });
    if (i % 3 === 0) await page.mouse.wheel(0, 120);
    if (i % 4 === 0) {
      await page.mouse.click(x, y, { delay: 80 });
      await page.keyboard.type("hello world", { delay: 90 });
    }
    await page.waitForTimeout(400);
    i++;
  }
}

/** The DOM events the library listens to (collector extractors plus the flush triggers). */
const EVENTS = [
  "pointermove",
  "pointerdown",
  "pointerup",
  "click",
  "keydown",
  "keyup",
  "wheel",
  "scroll",
  "input",
  "change",
  "blur",
  "paste",
  "copy",
  "cut",
  "contextmenu",
  "compositionstart",
  "focusin",
  "hashchange",
  "visibilitychange",
  "pagehide",
];
const CONTROL = `{const f=()=>{};for(const t of ${JSON.stringify(EVENTS)})addEventListener(t,f,{passive:true,capture:true});}
//# sourceURL=/control/noop.js`;

export async function measurePerf(
  seconds = 60,
  variant = "esm",
  throttle = 4,
): Promise<PerfResult> {
  const rec = await startRecorder({
    outDir: OUT_DIR,
    mounts: fixtureMounts(),
  });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const cdp: CDPSession = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle });
    await page.addInitScript({ content: CONTROL });
    await browser.startTracing(page, { categories: ["devtools.timeline"] });
    await page.goto(`${rec.url}/?run=perf&variant=${variant}`);
    await page.waitForFunction(
      () => typeof (window as { __alInitMs?: number }).__alInitMs === "number",
    );
    const initMs = await page.evaluate(
      () => (window as unknown as { __alInitMs: number }).__alInitMs,
    );
    await drive(page, seconds);
    const trace = JSON.parse((await browser.stopTracing()).toString("utf8")) as {
      traceEvents: TraceEvent[];
    };
    const ownMs = attributedMs(trace.traceEvents, (url) => url.includes("/lib/agentlens"));
    const controlMs = attributedMs(trace.traceEvents, (url) => url.endsWith("/control/noop.js"));
    const label = await page.evaluate(
      () => (window as unknown as { __alSnapshot: () => { label: string } }).__alSnapshot().label,
    );
    if (process.argv.includes("--breakdown")) {
      console.log(
        "library:",
        breakdown(trace.traceEvents, (u) => u.includes("/lib/agentlens")).join("\n"),
      );
      console.log(
        "control:",
        breakdown(trace.traceEvents, (u) => u.endsWith("/control/noop.js")).join("\n"),
      );
    }
    return { initMs, totalMs: ownMs + controlMs, ownMs, controlMs, seconds, throttle, label };
  } finally {
    await browser.close();
    await rec.close();
  }
}

/** Library own time over the control floor; measured 2.3x locally and 2.8x on GitHub's runner. */
export const RATIO_CAP = 3.25;
const INIT_BUDGET_MS = 10;

const median = (xs: number[]): number =>
  [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
const ms = (xs: number[]): string => xs.map((x) => x.toFixed(1)).join(", ");

/**
 * Throttled traces are noisy: a throttling pause or a GC that lands inside a listener is
 * charged to it. The verdict is on the median of `--runs` sessions; every run is printed.
 */
async function main(): Promise<void> {
  const seconds = Number(flag("seconds") ?? 60);
  const runs = Number(flag("runs") ?? 3);
  const variant = flag("variant") === "iife" ? "iife" : "esm";
  const results: PerfResult[] = [];
  for (let i = 0; i < runs; i++) results.push(await measurePerf(seconds, variant));
  const init = median(results.map((r) => r.initMs));
  const ratios = results.map((r) => (r.controlMs > 0 ? r.ownMs / r.controlMs : Infinity));
  const ratio = median(ratios);
  const ok = ratio <= RATIO_CAP;
  console.log(
    `perf (${variant}, 4x CPU throttle, ${seconds} s scripted session, median of ${runs}): ` +
      `library ${ratio.toFixed(2)}x the control floor (cap ${RATIO_CAP}x; runs ${ratios.map((x) => x.toFixed(2)).join(", ")}), ` +
      `library own ${ms(results.map((r) => r.ownMs))} ms, control floor ${ms(results.map((r) => r.controlMs))} ms, ` +
      `total ${ms(results.map((r) => r.totalMs))} ms; ` +
      `init ${init.toFixed(1)} ms (developer-machine budget ${INIT_BUDGET_MS}, not gated; runs ${ms(results.map((r) => r.initMs))}); ` +
      `labels ${results.map((r) => r.label).join(", ")} — ${ok ? "PASS" : "FAIL"}`,
  );
  if (!ok) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) await main();
