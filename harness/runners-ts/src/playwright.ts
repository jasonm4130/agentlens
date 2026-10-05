/**
 * Drives the fixture task flow with Playwright (class A) and prints the recorded
 * verdicts. Needs no credentials. Usage:
 *   pnpm --filter @agentlens/runners-ts exec playwright install chromium   # once
 *   pnpm --filter @agentlens/runners-ts playwright [--headful] [--variant=iife] [--run=<id>]
 */
import { existsSync, readFileSync } from "node:fs";
import { fixtureMounts, OUT_DIR, startRecorder } from "@agentlens/recorder";
import { chromium, type Page } from "playwright";

const flag = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];

export interface Recorded {
  kind: "verdict" | "signal" | "baseline" | "label";
  run: string;
  variant: string;
  payload: {
    label?: string;
    confidence?: string;
    reason?: string;
    seq?: number;
    features?: { counts: Record<string, number> };
  };
}

/** The fixture's start page for a run; `baselines` also loads BotD and agent-detector. */
export function fixtureUrl(base: string, run: string, variant: string, baselines = false): string {
  return `${base}/?run=${encodeURIComponent(run)}&variant=${variant}${baselines ? "&baselines=1" : ""}`;
}

/** The five fields of the fixture form; name and email carry autofill hints. */
export const FORM_VALUES = [
  ["name", "Ada Lovelace"],
  ["email", "ada@example.com"],
  ["topic", "engines"],
  ["company", "Analytical"],
  ["notes", "none"],
] as const;

/** The scripted fixture flow: search, open a result, scroll, fill 5 fields, click, visit 3 pages. */
export async function runTaskFlow(
  page: Page,
  base: string,
  run: string,
  variant: string,
  baselines = false,
): Promise<void> {
  await page.goto(fixtureUrl(base, run, variant, baselines));
  await page.fill("#q", "agent detection");
  await page.click("button[type=submit]");
  await page.click("a[data-next]");
  await page.mouse.wheel(0, 600);
  await page.mouse.wheel(0, 600);
  for (const [id, value] of FORM_VALUES) await page.fill(`#${id}`, value);
  await page.click("#details button[type=submit]");
  await page.click("a[data-next]");
  await page.click("#confirm");
  // Leaving the page flushes a verdict (pagehide); the beacon needs a moment to land.
  await page.goto("about:blank");
  await page.waitForTimeout(250);
}

export function readRecorded(outDir: string, run: string): Recorded[] {
  const file = `${outDir}/${run}.jsonl`;
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Recorded);
}

async function main(): Promise<void> {
  const run = flag("run") ?? `playwright-${Date.now()}`;
  const variant = flag("variant") === "iife" ? "iife" : "esm";
  const outDir = OUT_DIR;
  const rec = await startRecorder({
    outDir,
    mounts: fixtureMounts(),
  });
  const browser = await chromium.launch({ headless: !process.argv.includes("--headful") });
  try {
    await runTaskFlow(await browser.newPage(), rec.url, run, variant);
  } finally {
    await browser.close();
    await rec.close();
  }
  const verdicts = readRecorded(outDir, run).filter((r) => r.kind === "verdict");
  const last = verdicts.at(-1);
  console.log(
    `run ${run} (${variant}): ${verdicts.length} verdicts recorded in ${outDir}/${run}.jsonl`,
  );
  console.log(
    `last: ${last?.payload.label} (${last?.payload.reason}) ${JSON.stringify(last?.payload.features?.counts)}`,
  );
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) await main();
