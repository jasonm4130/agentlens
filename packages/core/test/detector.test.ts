// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDetector } from "../src";
import { emptyFeatures } from "../src/features";
import { clearState } from "../src/state";
import type { Verdict } from "../src/types";

afterEach(() => clearState());

function trusted<E extends Event>(e: E): E {
  Object.defineProperty(e, "isTrusted", { value: true });
  return e;
}

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

  it("saves features gathered after the first flush when the page hides again", () => {
    const first = createDetector();
    window.dispatchEvent(new Event("pagehide"));
    for (let i = 0; i < 3; i++)
      window.dispatchEvent(trusted(new KeyboardEvent("keydown", { key: "a" })));
    window.dispatchEvent(new Event("pagehide"));
    first.destroy();
    const second = createDetector();
    expect(second.snapshot().features.counts.keys).toBe(3);
    second.destroy({ clear: true });
  });

  it("keeps the built-in exclusions when a consumer ignore selector is invalid", () => {
    const pw = document.createElement("input");
    pw.type = "password";
    document.body.append(pw);
    const d = createDetector({ ignore: ["[data-foo"] });
    pw.dispatchEvent(trusted(new KeyboardEvent("keydown", { key: "a", bubbles: true })));
    expect(d.snapshot().features.counts.keys).toBe(0);
    d.destroy({ clear: true });
    pw.remove();
  });

  it("in minimal mode attaches only the flush triggers and emits one abstain verdict", () => {
    const spy = vi.spyOn(window, "addEventListener");
    const d = createDetector({ minimal: true });
    const added = spy.mock.calls.map((c) => c[0]);
    spy.mockRestore();
    expect(added.sort()).toEqual(["pagehide", "visibilitychange"]);

    const seen: Verdict[] = [];
    d.on("verdict", (v) => seen.push(v));
    window.dispatchEvent(new Event("pagehide"));
    window.dispatchEvent(new Event("pagehide"));
    expect(seen).toHaveLength(1);
    const v = seen[0] as Verdict;
    expect(v.reason).toBe("flush");
    expect(v.mode).toBe("minimal");
    expect(v.label).toBe("abstain");
    expect(v.evidence[0]?.rule).toBe("minimal");
    expect(v.features).toEqual(emptyFeatures());
    d.destroy({ clear: true });
  });

  it("uses evidence rule gpc when Global Privacy Control forces minimal mode", () => {
    Object.defineProperty(navigator, "globalPrivacyControl", { value: true, configurable: true });
    try {
      const d = createDetector();
      const v = d.snapshot();
      expect(v.mode).toBe("minimal");
      expect(v.evidence[0]?.rule).toBe("gpc");
      d.destroy();
    } finally {
      Reflect.deleteProperty(navigator, "globalPrivacyControl");
    }
  });
});
