// Release gate check 6 (architecture 7.6): axe reports no violations on the fixture pages.
// The library adds no DOM, so this guards the harness page the gate's numbers come from.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixtureMounts, startRecorder, type Recorder } from "@agentlens/recorder";
import axe from "axe-core";
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

interface AxeViolation {
  id: string;
  impact: string | null;
  nodes: { target: string[] }[];
}

describe("axe on the fixture pages", () => {
  let rec: Recorder;
  let browser: Browser;
  beforeAll(async () => {
    rec = await startRecorder({
      outDir: mkdtempSync(join(tmpdir(), "agentlens-axe-")),
      mounts: fixtureMounts(),
    });
    browser = await chromium.launch();
  });
  afterAll(async () => {
    await browser?.close();
    await rec?.close();
  });

  it.each(["/", "/page2.html", "/page3.html"])(
    "%s has no violations",
    async (path) => {
      const page = await browser.newPage();
      await page.goto(`${rec.url}${path}?run=axe`);
      await page.addScriptTag({ content: axe.source });
      const { violations, passes } = await page.evaluate(async () => {
        const result = await (
          window as unknown as {
            axe: { run(): Promise<{ violations: AxeViolation[]; passes: unknown[] }> };
          }
        ).axe.run();
        return {
          passes: result.passes.length,
          violations: result.violations.map((v) => ({
            id: v.id,
            impact: v.impact,
            nodes: v.nodes.map((n) => ({ target: n.target })),
          })),
        };
      });
      // Rules ran (an empty page passes nothing), and none failed.
      expect(passes).toBeGreaterThan(0);
      expect(violations).toEqual([]);
    },
    30_000,
  );
});
