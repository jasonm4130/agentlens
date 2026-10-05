// M1 exit criterion: stock headless Chromium driven by Playwright is labelled agent-likely
// with confidence certain, from the fixture flow, for both builds.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { startRecorder, type Recorder } from "@agentlens/recorder";
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readRecorded, runTaskFlow } from "../src/playwright";

const root = (p: string) => fileURLToPath(new URL(`../../../${p}`, import.meta.url));

describe("Playwright stock headless Chromium on the fixture", () => {
  const outDir = mkdtempSync(join(tmpdir(), "agentlens-headless-"));
  let rec: Recorder;
  let browser: Browser;

  beforeAll(async () => {
    rec = await startRecorder({
      outDir,
      mounts: { "/lib": root("packages/core/dist"), "/": root("apps/fixture") },
    });
    browser = await chromium.launch();
  });

  afterAll(async () => {
    await browser?.close();
    await rec?.close();
  });

  it.each(["esm", "iife"])(
    "%s: every verdict is agent-likely/certain and the Tier 1 tells are signalled",
    async (variant) => {
      const run = `headless-${variant}`;
      await runTaskFlow(await browser.newPage(), rec.url, run, variant);
      const recorded = readRecorded(outDir, run);
      const verdicts = recorded.filter((r) => r.kind === "verdict").map((r) => r.payload);
      const signals = recorded.filter((r) => r.kind === "signal").map((r) => r.payload);

      // One flush per page across the three pages, plus the first label-change.
      expect(verdicts.length).toBeGreaterThanOrEqual(3);
      for (const v of verdicts) {
        expect(v.label).toBe("agent-likely");
        expect(v.confidence).toBe("certain");
      }
      const rules = signals.map((s) => (s as { rule?: string }).rule);
      expect(rules).toContain("webdriver");
      expect(rules).toContain("headless-ua");
      // 'signal' fires once per rule per session, not once per page.
      expect(new Set(rules).size).toBe(rules.length);
    },
    60_000,
  );
});
