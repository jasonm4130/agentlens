// M0 acceptance (a): the built ESM bundle imports in Node with no window.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const built = fileURLToPath(new URL("../../../packages/core/dist/agentlens.mjs", import.meta.url));

describe("SSR import of the built agentlens.mjs", () => {
  it("has been built", () => {
    expect(existsSync(built), "run `pnpm -r build` first").toBe(true);
  });

  it("imports with no window and abstains", async () => {
    expect(typeof (globalThis as { window?: unknown }).window).toBe("undefined");
    const { createDetector } = (await import(built)) as typeof import("../../../packages/core/src");
    const d = createDetector();
    const v = d.snapshot();
    expect(v.label).toBe("abstain");
    expect(v.evidence[0]?.rule).toBe("ssr");
    d.on("verdict", () => {})();
    d.destroy();
  });
});
