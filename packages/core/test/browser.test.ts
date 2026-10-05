// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDetector } from "../src";
import type { Signal, Verdict } from "../src/types";

const navProto = Object.getPrototypeOf(navigator) as object;
const webdriver = Object.getOwnPropertyDescriptor(navProto, "webdriver");

// happy-dom reports navigator.webdriver === true, which is itself a Tier 1 tell. Present a
// stock browser (on the prototype, so no own property appears) for the wiring tests.
beforeEach(() => {
  Object.defineProperty(navProto, "webdriver", { get: () => false, configurable: true });
});

afterEach(() => {
  if (webdriver) Object.defineProperty(navProto, "webdriver", webdriver);
  sessionStorage.clear();
  document.body.replaceChildren();
});

function trusted<E extends Event>(e: E): E {
  Object.defineProperty(e, "isTrusted", { value: true });
  return e;
}

describe("createDetector in a real DOM (happy-dom)", () => {
  it("flags happy-dom itself, which reports navigator.webdriver", () => {
    if (webdriver) Object.defineProperty(navProto, "webdriver", webdriver);
    const d = createDetector();
    expect(d.snapshot()).toMatchObject({
      label: "agent-likely",
      agentClass: "A",
      confidence: "certain",
    });
    d.destroy({ clear: true });
  });

  it("returns a singleton, starts at insufficient-data and puts nothing on window", () => {
    const before = new Set(Object.getOwnPropertyNames(window));
    const d = createDetector();
    expect(createDetector()).toBe(d);
    const v = d.snapshot();
    expect(v).toMatchObject({ label: "insufficient-data", reason: "snapshot", cohort: "none" });
    expect(v.sessionId).toMatch(/^[0-9a-f]{32}$/);
    expect(Object.getOwnPropertyNames(window).filter((k) => !before.has(k))).toEqual([]);
    d.destroy();
    expect(createDetector()).not.toBe(d);
    createDetector().destroy();
  });

  it("ignores untrusted (script-dispatched) input", () => {
    const d = createDetector();
    for (let i = 0; i < 20; i++) window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    expect(d.snapshot().features.counts.keys).toBe(0);
    d.destroy();
  });

  it("persists the session in sessionStorage across pages until destroy({ clear: true })", () => {
    const first = createDetector();
    const id = first.snapshot().sessionId;
    window.dispatchEvent(new Event("pagehide"));
    first.destroy();
    const second = createDetector();
    expect(second.snapshot().sessionId).toBe(id);
    second.destroy({ clear: true });
    const third = createDetector();
    expect(third.snapshot().sessionId).not.toBe(id);
    third.destroy();
  });

  it("skips password fields and finds DOM markers with real selectors", async () => {
    const pw = document.createElement("input");
    pw.type = "password";
    const banner = document.createElement("div");
    banner.id = "claude-agent-stop-container";
    document.body.append(pw, banner);
    const d = createDetector({ ignore: ["[data-foo"] });
    const signals: Signal[] = [];
    const verdicts: Verdict[] = [];
    d.on("signal", (s) => signals.push(s));
    d.on("verdict", (v) => verdicts.push(v));
    pw.dispatchEvent(trusted(new KeyboardEvent("keydown", { key: "a", bubbles: true })));
    await new Promise((r) => setTimeout(r, 5));
    expect(d.snapshot().features.counts.keys).toBe(0);
    expect(signals.map((s) => [s.rule, s.agentClass])).toEqual([["C-marker", "C"]]);
    expect(verdicts.map((v) => [v.reason, v.label, v.agentClass])).toEqual([
      ["label-change", "agent-likely", "C"],
    ]);
    d.destroy({ clear: true });
  });
});
