/**
 * The red-team matrix (architecture 7.2) for the class A generators that need no credentials:
 * stock Playwright headless and headful, Patchright headful, and Playwright or Patchright with
 * a ghost-cursor humanised pointer. Each run gets a fresh browser, a ground-truth label line
 * and, with --baselines, the BotD and agent-detector results on the same pages.
 *
 * Usage (headful generators need a display; on Linux run under Xvfb):
 *   pnpm --filter @agentlens/runners-ts matrix --generator=playwright-headless --runs=15 --baselines
 *   generators: playwright-headless, playwright-headful, patchright, ghost-cursor,
 *               ghost-cursor-patchright
 * Browser Use, computer-use-demo, Claude in Chrome and human sessions are not driven here;
 * see harness/README.md.
 */
import {
  fixtureMounts,
  OUT_DIR,
  startRecorder,
  writeLabel,
  type Generator,
} from "@agentlens/recorder";
import { path as ghostPath } from "ghost-cursor";
import { chromium as patchright } from "patchright";
import { chromium, type Browser, type Locator, type Page } from "playwright";
import { FORM_VALUES, fixtureUrl, readRecorded, runTaskFlow } from "./playwright";

const flag = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];

type Flow = (
  page: Page,
  base: string,
  run: string,
  variant: string,
  baselines: boolean,
) => Promise<void>;

interface MatrixGenerator {
  config: string;
  launch(): Promise<Browser>;
  flow: Flow;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const between = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

/** Patchright mirrors Playwright's API; its types are a separate copy of the same shapes. */
const launchPatchright = async (): Promise<Browser> =>
  (await patchright.launch({ headless: false })) as unknown as Browser;

/** A ghost-cursor Bezier path with Fitts timing to a random point inside the target. */
async function humanMove(page: Page, at: { x: number; y: number }, target: Locator) {
  const box = await target.boundingBox();
  if (!box) throw new Error("target has no box");
  const points = ghostPath(at, box, { useTimestamps: true }) as {
    x: number;
    y: number;
    timestamp: number;
  }[];
  let last = points[0]?.timestamp ?? 0;
  for (const p of points) {
    await page.mouse.move(p.x, p.y);
    await sleep(Math.max(0, p.timestamp - last));
    last = p.timestamp;
  }
  const end = points.at(-1) ?? at;
  return { x: end.x, y: end.y };
}

/** Wheels in small, irregular ticks until the target is inside the viewport (no programmatic scroll). */
async function wheelIntoView(page: Page, target: Locator) {
  const height = page.viewportSize()?.height ?? 720;
  for (let i = 0; i < 60; i++) {
    const box = await target.boundingBox();
    if (box && box.y >= 0 && box.y + box.height <= height - 20) return;
    await page.mouse.wheel(0, Math.round(between(70, 130)));
    await sleep(between(40, 160));
  }
}

/** The fixture flow with every pointer action humanised; form values still go in with fill(). */
const ghostFlow: Flow = async (page, base, run, variant, baselines) => {
  let at = { x: between(100, 600), y: between(100, 500) };
  await page.mouse.move(at.x, at.y);
  const click = async (selector: string) => {
    const target = page.locator(selector).first();
    await wheelIntoView(page, target);
    at = await humanMove(page, at, target);
    await sleep(between(80, 250));
    await page.mouse.down();
    await sleep(between(60, 140));
    await page.mouse.up();
    await sleep(between(300, 900));
  };
  await page.goto(fixtureUrl(base, run, variant, baselines));
  await page.fill("#q", "agent detection");
  await click("button[type=submit]");
  await Promise.all([page.waitForURL(/page2\.html/), click("a[data-next]")]);
  for (let i = 0; i < 8; i++) {
    await page.mouse.wheel(0, Math.round(between(80, 140)));
    await sleep(between(60, 220));
  }
  for (const [id, value] of FORM_VALUES) await page.fill(`#${id}`, value);
  await click("#details button[type=submit]");
  await Promise.all([page.waitForURL(/page3\.html/), click("a[data-next]")]);
  await click("#confirm");
  await page.goto("about:blank");
  await page.waitForTimeout(250);
};

export const MATRIX: Partial<Record<Generator, MatrixGenerator>> = {
  "playwright-headless": {
    config: "fill/click, chromium-headless-shell",
    launch: () => chromium.launch(),
    flow: runTaskFlow,
  },
  "playwright-headful": {
    config: "fill/click, headful chromium",
    launch: () => chromium.launch({ headless: false }),
    flow: runTaskFlow,
  },
  patchright: {
    config: "stock, headful chromium",
    launch: launchPatchright,
    flow: runTaskFlow,
  },
  "ghost-cursor": {
    config: "Playwright headful, ghost-cursor pointer, fill()",
    launch: () => chromium.launch({ headless: false }),
    flow: ghostFlow,
  },
  "ghost-cursor-patchright": {
    config: "Patchright headful, ghost-cursor pointer, fill()",
    launch: launchPatchright,
    flow: ghostFlow,
  },
};

function stamp(d = new Date()): string {
  return d.toISOString().slice(0, 16).replace(/[-:T]/g, "");
}

async function main(): Promise<void> {
  const name = (flag("generator") ?? "") as Generator;
  const gen = MATRIX[name];
  if (!gen) {
    console.error(`--generator must be one of ${Object.keys(MATRIX).join(", ")}`);
    process.exitCode = 2;
    return;
  }
  const runs = Number(flag("runs") ?? 1);
  const variant = flag("variant") === "iife" ? "iife" : "esm";
  const baselines = process.argv.includes("--baselines");
  const prefix = flag("prefix") ?? `${name}-${stamp()}`;
  const outDir = flag("out") ?? OUT_DIR;
  const rec = await startRecorder({ outDir, mounts: fixtureMounts() });
  try {
    for (let i = 1; i <= runs; i++) {
      const run = `${prefix}-${String(i).padStart(2, "0")}`;
      writeLabel(outDir, { run, generator: name, config: gen.config });
      const browser = await gen.launch();
      try {
        await gen.flow(await browser.newPage(), rec.url, run, variant, baselines);
      } finally {
        await browser.close();
      }
      const verdicts = readRecorded(outDir, run).filter((r) => r.kind === "verdict");
      const last = verdicts.at(-1)?.payload;
      console.log(`${run}: ${verdicts.length} verdicts, last ${last?.label}/${last?.confidence}`);
    }
  } finally {
    await rec.close();
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) await main();
