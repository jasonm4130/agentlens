// M2 exit check: a fresh Vite app vendoring the release's agentlens.mjs, and a plain page
// loading agentlens.iife.js with a <script> tag, each log a verdict in a real browser. Uses the
// built files exactly as a GitHub Release attaches them (packages/core/dist).
import { cpSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { startRecorder } from "@agentlens/recorder";
import { chromium, type Browser, type Page } from "playwright";
import { build, preview } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const root = (p: string) => fileURLToPath(new URL(`../../../${p}`, import.meta.url));
const dist = (file: string) => root(`packages/core/dist/${file}`);

/** Resolves with the first `agentlens verdict ...` console line the page logs. */
function firstVerdict(page: Page): Promise<string> {
  return new Promise((resolve) => {
    page.on("console", (m) => {
      if (m.text().startsWith("agentlens verdict ")) resolve(m.text());
    });
  });
}

describe("release files in a consumer page", () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await chromium.launch();
  });
  afterAll(async () => {
    await browser?.close();
  });

  it("a Vite app vendoring agentlens.mjs logs a verdict", async () => {
    const app = mkdtempSync(join(tmpdir(), "agentlens-vite-"));
    cpSync(root("harness/smoke/vite-app"), app, { recursive: true });
    mkdirSync(join(app, "vendor/agentlens"), { recursive: true });
    for (const f of ["agentlens.mjs", "agentlens.d.ts"])
      cpSync(dist(f), join(app, "vendor/agentlens", f));
    await build({ root: app, configFile: false, logLevel: "silent" });
    const server = await preview({
      root: app,
      configFile: false,
      logLevel: "silent",
      preview: { port: 0, host: "127.0.0.1" },
    });
    try {
      const page = await browser.newPage();
      const logged = firstVerdict(page);
      await page.goto(server.resolvedUrls?.local[0] ?? "");
      // Headless Chromium trips Tier 1 at init, so a label-change verdict fires at once.
      expect(await logged).toMatch(/^agentlens verdict agent-likely /);
    } finally {
      await server.close();
    }
  }, 60_000);

  it("a plain page loading agentlens.iife.js logs a verdict", async () => {
    const site = mkdtempSync(join(tmpdir(), "agentlens-iife-"));
    cpSync(root("harness/smoke/script-page"), site, { recursive: true });
    cpSync(dist("agentlens.iife.js"), join(site, "agentlens.iife.js"));
    const rec = await startRecorder({ outDir: join(site, "out"), mounts: { "/": site } });
    try {
      const page = await browser.newPage();
      const logged = firstVerdict(page);
      await page.goto(`${rec.url}/`);
      expect(await logged).toMatch(/^agentlens verdict agent-likely /);
    } finally {
      await rec.close();
    }
  }, 60_000);
});
