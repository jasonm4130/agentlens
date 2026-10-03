// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { createDetector } from "../src";
import { clearState } from "../src/state";

afterEach(() => clearState());

describe("createDetector in a browser-like environment", () => {
  it("returns a singleton and starts at insufficient-data", () => {
    const d = createDetector();
    expect(createDetector()).toBe(d);
    const v = d.snapshot();
    expect(v.label).toBe("insufficient-data");
    expect(v.reason).toBe("snapshot");
    expect(v.cohort).toBe("none");
    expect(v.sessionId).toMatch(/^[0-9a-f]{32}$/);
    d.destroy();
  });

  it("ignores untrusted (script-dispatched) input", () => {
    const d = createDetector();
    for (let i = 0; i < 20; i++) window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    expect(d.snapshot().features.counts.keys).toBe(0);
    d.destroy();
  });

  it("persists the session across pages and starts fresh after destroy({clear:true})", () => {
    const first = createDetector();
    const id = first.snapshot().sessionId;
    first.on("verdict", () => {});
    window.dispatchEvent(new Event("pagehide"));
    first.destroy();
    const second = createDetector();
    expect(second.snapshot().sessionId).toBe(id);
    second.destroy({ clear: true });
    const third = createDetector();
    expect(third.snapshot().sessionId).not.toBe(id);
    third.destroy();
  });

  it("flushes once per page on pagehide and increments seq", () => {
    const d = createDetector();
    const seen: number[] = [];
    d.on("verdict", (v) => seen.push(v.seq));
    window.dispatchEvent(new Event("pagehide"));
    window.dispatchEvent(new Event("pagehide"));
    expect(seen).toEqual([1]);
    d.destroy({ clear: true });
  });

  it("reports abstain in minimal mode and attaches no listeners", () => {
    const d = createDetector({ minimal: true });
    const v = d.snapshot();
    expect(v.mode).toBe("minimal");
    expect(v.label).toBe("abstain");
    expect(v.evidence[0]?.rule).toBe("gpc");
    d.destroy();
  });
});
