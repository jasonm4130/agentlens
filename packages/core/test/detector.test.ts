import { describe, expect, it } from "vitest";
import { createDetectorWith } from "../src/detector";
import type { Ev } from "../src/extractors/extractor";
import { emptyFeatures } from "../src/features";
import type { SessionState } from "../src/state";
import type { Signal, Verdict } from "../src/types";
import { el, ev, fakeEnv, mouseClick, type FakeEnv } from "./helpers";

function record(d: ReturnType<typeof createDetectorWith>) {
  const verdicts: Verdict[] = [];
  const signals: Signal[] = [];
  d.on("verdict", (v) => verdicts.push(v));
  d.on("signal", (s) => signals.push(s));
  return { verdicts, signals };
}

const hide = (env: FakeEnv, t = 99999) => {
  env.setVisibility("hidden");
  env.fire(ev({ type: "visibilitychange", timeStamp: t }));
};
const pagehide = (env: FakeEnv) => env.fire(ev({ type: "pagehide", timeStamp: 0 }));
const stored = (env: FakeEnv) => JSON.parse(env.store.get("al:v1") ?? "null") as SessionState;

/** Warped agent clicks on targets of two sizes, 3 s apart. */
const agentClicks = (n: number): Ev[] =>
  Array.from({ length: n }, (_, i) => {
    const target = el({ rect: i % 2 ? [0, 0, 100, 40] : [200, 200, 300, 60] });
    return mouseClick(1000 + i * 3000, i % 2 ? 50 : 350, i % 2 ? 20 : 230, { dwell: 2, target });
  }).flat();

describe("verdict semantics", () => {
  it("flushes once per page on pagehide or hidden, with seq increasing", () => {
    const env = fakeEnv();
    const d = createDetectorWith(env);
    const { verdicts } = record(d);
    pagehide(env);
    hide(env);
    pagehide(env);
    expect(verdicts.map((v) => [v.reason, v.seq])).toEqual([["flush", 1]]);
    expect(verdicts[0]?.label).toBe("insufficient-data");
    d.destroy();
  });

  it("saves features gathered after the first flush when the page hides again", () => {
    const env = fakeEnv();
    const a = createDetectorWith(env);
    pagehide(env);
    for (let i = 0; i < 3; i++) env.fire(ev({ type: "keydown", timeStamp: i * 100, key: "a" }));
    pagehide(env);
    a.destroy();
    const b = createDetectorWith(env);
    expect(b.snapshot().features.counts.keys).toBe(3);
    pagehide(env);
    expect(stored(env).pageCount).toBe(2);
    b.destroy();
  });

  it("emits label-change after the debounce when the label changes, never for quiet labels", () => {
    const env = fakeEnv();
    const d = createDetectorWith(env);
    const { verdicts } = record(d);
    env.runTimers();
    expect(verdicts).toEqual([]);
    for (const e of agentClicks(2)) env.fire(e);
    env.runTimers();
    expect(verdicts).toEqual([]); // insufficient-data is quiet
    for (const e of agentClicks(6)) env.fire({ ...e, timeStamp: e.timeStamp + 20000 });
    expect(env.pendingTimers()).toBe(1);
    env.runTimers();
    expect(verdicts.map((v) => [v.reason, v.label])).toEqual([
      ["label-change", "agent-unattributed"],
    ]);
    env.runTimers();
    pagehide(env);
    expect(verdicts.map((v) => v.reason)).toEqual(["label-change", "flush"]);
    expect(verdicts.map((v) => v.seq)).toEqual([1, 2]);
    d.destroy();
  });

  it("does not re-announce an unchanged label on the next page", () => {
    const env = fakeEnv({ nav: { webdriver: true } });
    const a = createDetectorWith(env);
    const first = record(a);
    env.runTimers();
    pagehide(env);
    a.destroy();
    const b = createDetectorWith(env);
    const second = record(b);
    env.runTimers();
    expect(first.verdicts.map((v) => v.reason)).toEqual(["label-change", "flush"]);
    expect(second.verdicts).toEqual([]);
    expect(second.signals).toEqual([]);
    b.destroy();
  });

  it("returns features as a copy and snapshot emits nothing", () => {
    const env = fakeEnv();
    const d = createDetectorWith(env);
    const { verdicts } = record(d);
    const v = d.snapshot();
    v.features.counts.keys = 999;
    expect(d.snapshot().features.counts.keys).toBe(0);
    expect(v.reason).toBe("snapshot");
    expect(verdicts).toEqual([]);
    d.destroy();
  });

  it("isolates a throwing consumer listener", () => {
    const env = fakeEnv();
    const d = createDetectorWith(env);
    d.on("verdict", () => {
      throw new Error("consumer bug");
    });
    const { verdicts } = record(d);
    expect(() => pagehide(env)).not.toThrow();
    expect(verdicts).toHaveLength(1);
    d.destroy();
  });
});

describe("signal semantics", () => {
  it("fires each Tier 1 rule once per session, after the caller subscribes", () => {
    const env = fakeEnv({ nav: { webdriver: true }, globals: ["__pwInitScripts"] });
    const d = createDetectorWith(env);
    const { signals } = record(d);
    expect(signals).toEqual([]);
    env.runTimers();
    expect(signals.map((s) => [s.rule, s.agentClass])).toEqual([
      ["webdriver", "A"],
      ["fw-globals", "A"],
    ]);
    expect(signals[0]?.sessionId).toBe(d.snapshot().sessionId);
    pagehide(env);
    expect(signals).toHaveLength(2);
    d.destroy();
  });

  it("scores a hard tell immediately, without waiting for the debounce", () => {
    const env = fakeEnv();
    const d = createDetectorWith(env);
    const { signals, verdicts } = record(d);
    const a = el({ value: "ada@example.com" });
    env.fire({
      type: "input",
      timeStamp: 10,
      isTrusted: false,
      target: a,
      data: "ada@example.com",
    });
    env.fire({ type: "change", timeStamp: 11, isTrusted: false, target: a });
    env.fire({ type: "blur", timeStamp: 12, isTrusted: false, target: a });
    expect(signals.map((s) => s.rule)).toEqual(["BU-trio"]);
    expect(verdicts.map((v) => [v.label, v.agentClass, v.confidence])).toEqual([
      ["agent-likely", "A", "certain"],
    ]);
    d.destroy();
  });

  it("re-checks markers on mouse pointerdown and before flush", () => {
    const env = fakeEnv();
    const d = createDetectorWith(env);
    const { signals } = record(d);
    env.runTimers();
    env.present.add("#claude-agent-stop-container");
    env.fire(
      ev({ type: "pointerdown", timeStamp: 5, pointerType: "mouse", button: 0, target: el() }),
    );
    expect(signals.map((s) => [s.rule, s.agentClass])).toEqual([["C-marker", "C"]]);
    env.present.add("[data-browser-use-highlight]");
    pagehide(env);
    expect(signals.map((s) => s.rule)).toEqual(["C-marker", "BU-marker"]);
    d.destroy();
  });

  it("reports consumer extraMarkers as custom-marker with no class and drops invalid ones", () => {
    const env = fakeEnv({ present: ["#my-agent-banner"] });
    const d = createDetectorWith(env, { extraMarkers: ["#my-agent-banner", "[broken"] });
    const { signals } = record(d);
    env.runTimers();
    expect(signals).toEqual([
      { rule: "custom-marker", detail: "consumer marker present", sessionId: expect.any(String) },
    ]);
    const v = d.snapshot();
    expect(v).toMatchObject({ label: "agent-likely", confidence: "certain" });
    expect(v.agentClass).toBeUndefined();
    d.destroy();
  });
});

describe("modes and storage", () => {
  it("in minimal mode attaches only the flush triggers and still runs probes and markers", () => {
    const env = fakeEnv({ present: ["#claude-agent-stop-container"] });
    const d = createDetectorWith(env, { minimal: true });
    expect(env.listenerCount()).toBe(2);
    const { verdicts, signals } = record(d);
    env.runTimers();
    pagehide(env);
    pagehide(env);
    expect(signals.map((s) => s.rule)).toEqual(["C-marker"]);
    const v = verdicts[verdicts.length - 1];
    expect(v).toMatchObject({ reason: "flush", mode: "minimal", label: "agent-likely" });
    expect(v?.features.counts).toEqual(emptyFeatures().counts);
    expect(v?.features.probes.desktopUA).toBe(true);
    d.destroy();
  });

  it("minimal without a tell abstains and keeps stored behavioural features across pages", () => {
    const env = fakeEnv();
    const seqs: number[] = [];
    const a = createDetectorWith(env);
    a.on("verdict", (v) => seqs.push(v.seq));
    for (let i = 0; i < 3; i++) env.fire(ev({ type: "keydown", timeStamp: i * 100, key: "a" }));
    pagehide(env);
    a.destroy();
    const before = stored(env);

    const b = createDetectorWith(env, { minimal: true });
    const seen: Verdict[] = [];
    b.on("verdict", (v) => {
      seen.push(v);
      seqs.push(v.seq);
    });
    env.runTimers();
    pagehide(env);
    b.destroy();
    expect(seen.map((v) => [v.label, v.evidence[0]?.rule])).toEqual([["abstain", "minimal"]]);
    const after = stored(env);
    expect(after.features).toEqual(before.features);
    expect(after.seq).toBe(before.seq + 1);
    expect(after.pageCount).toBe(before.pageCount + 1);

    const c = createDetectorWith(env);
    c.on("verdict", (v) => seqs.push(v.seq));
    expect(c.snapshot().features.counts.keys).toBe(3);
    pagehide(env);
    c.destroy();
    expect(seqs).toEqual([1, 2, 3]);
  });

  it("Global Privacy Control forces minimal mode, rule gpc and memory-only storage", () => {
    const env = fakeEnv({ nav: { globalPrivacyControl: true } });
    const d = createDetectorWith(env);
    const { verdicts } = record(d);
    expect(d.snapshot()).toMatchObject({ mode: "minimal", evidence: [{ rule: "gpc" }] });
    pagehide(env);
    expect(verdicts).toHaveLength(1);
    expect(env.store.size).toBe(0);
    d.destroy();
  });

  it("respectGPC: false keeps full mode under GPC", () => {
    const env = fakeEnv({ nav: { globalPrivacyControl: true } });
    const d = createDetectorWith(env, { respectGPC: false });
    expect(d.snapshot().mode).toBe("full");
    d.destroy();
  });

  it("memory storage makes each page its own session and writes nothing", () => {
    const env = fakeEnv();
    const a = createDetectorWith(env, { storage: "memory" });
    const id = a.snapshot().sessionId;
    pagehide(env);
    a.destroy();
    const b = createDetectorWith(env, { storage: "memory" });
    expect(b.snapshot().sessionId).not.toBe(id);
    expect(env.store.size).toBe(0);
    b.destroy();
  });

  it("falls back to memory silently when storage is missing or throws", () => {
    for (const storage of ["none", "throws"] as const) {
      const env = fakeEnv({ storage });
      const d = createDetectorWith(env);
      expect(() => pagehide(env)).not.toThrow();
      expect(d.snapshot().sessionId).toMatch(/^[0-9a-f]{32}$/);
      d.destroy({ clear: true });
    }
  });

  it("rejects tampered stored state and starts a new session", () => {
    const env = fakeEnv();
    const a = createDetectorWith(env);
    pagehide(env);
    a.destroy();
    const s = stored(env);
    const id = s.sessionId;
    (s.features.counts as Record<string, unknown>).keys = "Ada Lovelace";
    env.store.set("al:v1", JSON.stringify(s));
    const b = createDetectorWith(env);
    expect(b.snapshot().sessionId).not.toBe(id);
    b.destroy();
  });

  it("keeps the stored session within 4 KB after a busy session", () => {
    const env = fakeEnv();
    const d = createDetectorWith(env);
    for (const e of agentClicks(40)) env.fire(e);
    for (let i = 0; i < 400; i++)
      env.fire(ev({ type: "keydown", timeStamp: 200000 + i * 97, key: "a", code: "KeyA" }));
    for (let i = 0; i < 100; i++)
      env.fire(ev({ type: "wheel", timeStamp: 300000 + i * 37, deltaY: 40 + (i % 7) }));
    pagehide(env);
    expect(env.store.get("al:v1")?.length).toBeLessThanOrEqual(4096);
    d.destroy();
  });

  it("destroy removes every listener and timer, and clear drops storage", () => {
    const env = fakeEnv();
    const d = createDetectorWith(env);
    for (const e of agentClicks(1)) env.fire(e);
    pagehide(env);
    expect(env.listenerCount()).toBeGreaterThan(10);
    d.destroy({ clear: true });
    expect(env.listenerCount()).toBe(0);
    expect(env.pendingTimers()).toBe(0);
    expect(env.store.size).toBe(0);
  });
});

describe("ignore selectors", () => {
  it("skips events inside ignored subtrees, keeping built-ins when a consumer selector is invalid", () => {
    const env = fakeEnv();
    const d = createDetectorWith(env, { ignore: ["[data-foo", ".private"] });
    const inside = (sel: string) => el({ closest: (s: string) => (s.includes(sel) ? {} : null) });
    env.fire(
      ev({ type: "keydown", timeStamp: 1, key: "a", target: inside('input[type="password"]') }),
    );
    env.fire(ev({ type: "keydown", timeStamp: 2, key: "a", target: inside(".private") }));
    env.fire(ev({ type: "keydown", timeStamp: 3, key: "a", target: el() }));
    expect(d.snapshot().features.counts.keys).toBe(1);
    d.destroy();
  });
});
