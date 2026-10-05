import { describe, expect, it } from "vitest";
import type { Ev } from "../src/extractors/extractor";
import { emptyFeatures, type Features } from "../src/features";
import { RULESET } from "../src/scorer/ruleset";
import type { RuleContext, RuleResult } from "../src/scorer/rules";
import { cohortOf, score } from "../src/scorer/score";
import {
  el,
  ev,
  IPHONE_UA,
  jitter,
  mouseClick,
  session,
  typeText,
  wheelTicks,
  type FakeEnvOptions,
} from "./helpers";

const SOFTWARE: FakeEnvOptions = { renderer: "Google SwiftShader" };

function check(id: string, f: Features): RuleResult {
  const rule = RULESET.rules.find((r) => r.id === id);
  if (!rule) throw new Error(`no rule ${id}`);
  const ctx: RuleContext = { f, th: RULESET.thresholds, cohort: cohortOf(f) };
  return rule.check(ctx);
}

/** Warped clicks: one move, ~2 ms dwell, dead centre of targets of two sizes, 3 s apart. */
function agentClicks(n: number, t0 = 1000, gap = 3000): Ev[] {
  const targets = [el({ rect: [0, 0, 120, 40] }), el({ rect: [300, 200, 200, 60] })];
  return Array.from({ length: n }, (_, i) => {
    const target = targets[i % 2] ?? el();
    const r = target.getBoundingClientRect?.() ?? { left: 0, top: 0, width: 0, height: 0 };
    return mouseClick(t0 + i * gap, r.left + r.width / 2, r.top + r.height / 2, {
      dwell: 2,
      target,
    });
  }).flat();
}

/** Human clicks: a curved-ish path of many moves, 80-140 ms dwell, off-centre, stray hovers. */
function humanClicks(n: number, t0 = 1000, seed = 7): Ev[] {
  const r = jitter(seed);
  const out: Ev[] = [];
  let t = t0;
  let x = 50;
  let y = 50;
  for (let i = 0; i < n; i++) {
    const tx = 100 + Math.round(r() * 800);
    const ty = 100 + Math.round(r() * 500);
    // wander between actions
    for (let k = 0; k < 20; k++)
      out.push(
        ev({
          type: "pointermove",
          timeStamp: t + k * 60,
          pointerType: "mouse",
          clientX: x + k,
          clientY: y + k,
          buttons: 0,
        }),
      );
    out.push(
      ev({ type: "pointermove", timeStamp: t + 5, pointerType: "mouse", buttons: 0, target: el() }),
    );
    t += 1500 + Math.round(r() * 3000);
    const target = el({ rect: [tx - 30 - r() * 20, ty - 10, 100 + Math.round(r() * 80), 40] });
    out.push(
      ...mouseClick(t, tx, ty, {
        moves: 15,
        dwell: 80 + Math.round(r() * 60),
        target,
        fromX: x,
        fromY: y,
      }),
    );
    x = tx;
    y = ty;
    t += 400;
  }
  return out;
}

const field = (value = "") => el({ value });

describe("Tier 1 rules: one is enough, confidence certain, and a signal each", () => {
  const cases: [string, FakeEnvOptions, Ev[], string, string | undefined][] = [
    ["C-marker", { present: ["#claude-agent-stop-container"] }, [], "C-marker", "C"],
    ["BU-marker", { present: ["#browser-use-debug-highlights"] }, [], "BU-marker", "A"],
    ["webdriver", { nav: { webdriver: true } }, [], "webdriver", "A"],
    ["webdriver own property", { ownWebdriver: true }, [], "webdriver", "A"],
    [
      "headless-ua",
      { nav: { userAgent: "Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/141.0.0.0" } },
      [],
      "headless-ua",
      "A",
    ],
    ["fw-globals", { globals: ["document", "__playwright__binding__"] }, [], "fw-globals", "A"],
    [
      "fw-globals (chromedriver)",
      { globals: ["$cdc_asdjflasutopfhvcZLmcfl_"] },
      [],
      "fw-globals",
      "A",
    ],
  ];
  for (const [name, env, events, rule, cls] of cases) {
    it(`${name} → agent-likely/${cls}/certain`, () => {
      const s = session(events, env).score();
      expect(s).toMatchObject({ label: "agent-likely", agentClass: cls, confidence: "certain" });
      expect(s.tells.map((t) => t.rule)).toContain(rule);
    });
  }

  it("BU-trio → agent-likely/A/certain", () => {
    const a = field("ada@example.com");
    const s = session([
      { type: "input", timeStamp: 10, isTrusted: false, target: a, data: "ada@example.com" },
      { type: "change", timeStamp: 11, isTrusted: false, target: a },
      { type: "blur", timeStamp: 12, isTrusted: false, target: a },
    ]).score();
    expect(s).toMatchObject({ label: "agent-likely", agentClass: "A", confidence: "certain" });
    expect(s.evidence[0]?.rule).toBe("BU-trio");
  });

  it("Tier 1 fires even in minimal mode and below minActions", () => {
    const s = session([], { nav: { webdriver: true } }).score({ mode: "minimal", gpc: true });
    expect(s.label).toBe("agent-likely");
  });

  it("a stock desktop with no tells has none", () => {
    expect(session([]).score().tells).toEqual([]);
  });
});

describe("Tier 2 rules: each fires on its tell and abstains outside its gate", () => {
  it("R1 path: single-move displaced clicks fire; human paths do not; touch abstains", () => {
    expect(check("R1", session(agentClicks(4)).f)).toMatch(/single-move displaced clicks/);
    expect(check("R1", session(humanClicks(4)).f)).toBe(false);
    expect(check("R1", session(agentClicks(2)).f)).toBeNull();
    expect(check("R1", emptyFeatures())).toBeNull();
  });

  it("R2 dwell: zero-dwell single-move clicks fire; a trackpad hint closes the gate", () => {
    expect(check("R2", session(agentClicks(4)).f)).toMatch(/under 20 ms dwell/);
    expect(check("R2", session(humanClicks(4)).f)).toBe(false);
    const trackpad = session([
      ...wheelTicks(
        100,
        5,
        () => 16,
        () => 2.5,
      ),
      ...agentClicks(4, 2000),
    ]);
    expect(check("R2", trackpad.f)).toBeNull();
  });

  it("R3 frozen: no moves in idle gaps and no stray hovers fire; a wandering mouse does not", () => {
    expect(check("R3", session(agentClicks(5)).f)).toMatch(/moves\/idle s/);
    expect(check("R3", session(humanClicks(5)).f)).toBe(false);
    expect(check("R3", session(typeText(0, 20, () => 3000)).f)).toBeNull();
  });

  it("R4 typing: 12 ms gaps, constant gaps or 1 ms holds fire; human typing does not; IME abstains", () => {
    expect(check("R4", session(typeText(0, 20, () => 12, 2)).f)).toMatch(/under 15 ms/);
    expect(check("R4", session(typeText(0, 20, () => 50, 40)).f)).toMatch(/key gap CV/);
    const r = jitter(3);
    expect(check("R4", session(typeText(0, 20, () => 90 + r() * 200, 1)).f)).toMatch(
      /holds under 5 ms/,
    );
    const human = jitter(5);
    expect(check("R4", session(typeText(0, 30, () => 80 + human() * 250, 90)).f)).toBe(false);
    const ime = [
      ...typeText(0, 20, () => 12, 2),
      ev({ type: "keydown", timeStamp: 1000, key: "Process", keyCode: 229 }),
    ];
    expect(check("R4", session(ime).f)).toBeNull();
    expect(check("R4", session(typeText(0, 5, () => 12)).f)).toBeNull();
  });

  it("R5 fill: keyless jumps on two fields fire; one field does not", () => {
    const a = field("Ada Lovelace");
    const b = field("ada@example.com");
    const fill = (t: number, target: object) =>
      ev({ type: "input", timeStamp: t, target, inputType: "insertFromPaste" });
    expect(check("R5", session([fill(10, a), fill(20, b)]).f)).toMatch(/2 fields/);
    expect(check("R5", session([fill(10, a)]).f)).toBe(false);
    expect(check("R5", emptyFeatures())).toBeNull();
  });

  it("R6 scroll: regular ticks fire, and so do two scroll-then-click bursts; a human wheel does not", () => {
    expect(
      check(
        "R6",
        session(
          wheelTicks(
            0,
            10,
            () => 50,
            () => 100,
          ),
        ).f,
      ),
    ).toMatch(/wheel dt CV/);
    const reveal = [5000, 9000].flatMap((t) => [
      ev({ type: "scroll", timeStamp: t }),
      ev({ type: "click", timeStamp: t + 300 }),
    ]);
    expect(check("R6", session(reveal).f)).toMatch(/followed by a click/);
    const r = jitter(11);
    const human = wheelTicks(
      0,
      12,
      () => 30 + r() * 120,
      () => 100,
    );
    expect(check("R6", session(human).f)).toBe(false);
    expect(
      check(
        "R6",
        session(
          wheelTicks(
            0,
            3,
            () => 50,
            () => 100,
          ),
        ).f,
      ),
    ).toBeNull();
  });

  it("R7 centre: dead-centre clicks on two sizes fire; off-centre do not", () => {
    expect(check("R7", session(agentClicks(4)).f)).toMatch(/within 5% of centre/);
    expect(check("R7", session(humanClicks(4)).f)).toBe(false);
  });

  it("R9 orphan click: two untrusted clicks with no pointerdown fire", () => {
    const orphan = (t: number): Ev => ({
      type: "click",
      timeStamp: t,
      isTrusted: false,
      detail: 0,
    });
    expect(check("R9", session([orphan(10), orphan(5000)]).f)).toMatch(/2 untrusted clicks/);
    expect(check("R9", session([orphan(10)]).f)).toBeNull();
  });

  it("R10 modality: touch with maxTouchPoints 0, or touch-only on a fine-pointer desktop, fires", () => {
    const tap = [ev({ type: "pointerdown", timeStamp: 1, pointerType: "touch" })];
    expect(check("R10", session(tap).f)).toMatch(/maxTouchPoints is 0/);
    const laptop = session(tap, { nav: { maxTouchPoints: 10 } });
    expect(check("R10", laptop.f)).toMatch(/fine-pointer desktop/);
    const phone = session(tap, {
      nav: { userAgent: IPHONE_UA, maxTouchPoints: 5 },
      media: { "(hover: hover)": false, "(pointer: fine)": false, "(any-pointer: coarse)": true },
    });
    expect(check("R10", phone.f)).toBeNull();
  });

  it("#7 hidden input: two trusted keydowns while hidden fire", () => {
    const s = session([
      ev({ type: "visibilitychange", timeStamp: 1000, data: "hidden" }),
      ev({ type: "keydown", timeStamp: 2000, key: "a" }),
      ev({ type: "pointerdown", timeStamp: 2500, pointerType: "mouse" }),
    ]);
    expect(check("hidden-input", s.f)).toMatch(/while hidden/);
  });

  it("R8 cadence: still 1.5-8 s think gaps fire; it is off for keyboard cohorts", () => {
    expect(check("R8", session(agentClicks(6)).f)).toMatch(/gaps in 1.5-8 s/);
    expect(check("R8", session(humanClicks(6)).f)).toBe(false);
    expect(check("R8", session(typeText(0, 8, () => 3000)).f)).toBeNull();
  });
});

describe("labels, classes and confidence", () => {
  it("a class A agent: behavioural rules plus a pointer-media prior", () => {
    const s = session(agentClicks(6), { media: { "(hover: hover)": false } }).score();
    expect(s).toMatchObject({ label: "agent-likely", agentClass: "A", confidence: "high" });
    expect(s.evidence.map((e) => e.rule)).toEqual(
      expect.arrayContaining(["R1", "R2", "R3", "R7", "R8"]),
    );
  });

  it("a class B reference harness: 12 ms typing, regular ticks, software GL, all trusted", () => {
    const events = [
      ...agentClicks(3),
      ...typeText(20000, 20, () => 12, 2, field()),
      ...wheelTicks(
        30000,
        10,
        () => 50,
        () => 100,
      ),
    ];
    const s = session(events, SOFTWARE).score();
    expect(s).toMatchObject({ label: "agent-likely", agentClass: "B" });
  });

  it("matching both profiles stays unattributed", () => {
    const events = [...agentClicks(3), ...typeText(20000, 20, () => 12, 2, field())];
    const s = session(events, { ...SOFTWARE, media: { "(hover: hover)": false } }).score();
    expect(s.label).toBe("agent-unattributed");
  });

  it("behavioural hits with no class profile are agent-unattributed", () => {
    const s = session(agentClicks(3, 1000, 400)).score();
    expect(s.label).toBe("agent-unattributed");
    expect(s.agentClass).toBeUndefined();
    expect(["medium", "high"]).toContain(s.confidence);
  });

  it("R8 alone never labels: one rule plus cadence stays human-like/low", () => {
    const events = [...humanClicks(6), ...typeText(60000, 20, () => 12, 2, field())];
    const s = session(events).score();
    expect(s.label).toBe("human-like");
    expect(s.confidence).toBe("low");
  });

  it("a human mouse session is human-like/medium with no evidence", () => {
    const s = session([
      ...humanClicks(6),
      ...typeText(60000, 30, (i) => 90 + ((i * 37) % 150)),
    ]).score();
    expect(s).toMatchObject({ label: "human-like", confidence: "medium", evidence: [] });
  });

  it("under minActions the label is insufficient-data", () => {
    const s = session(agentClicks(2)).score();
    expect(s).toMatchObject({ label: "insufficient-data", confidence: "low" });
  });

  it("GPC/minimal with no Tier 1 is abstain, never human-like", () => {
    expect(session(humanClicks(6)).score({ mode: "minimal", gpc: true })).toMatchObject({
      label: "abstain",
      evidence: [{ rule: "gpc", detail: "minimal mode" }],
    });
  });

  it("is pure and deterministic", () => {
    const { f } = session(agentClicks(6));
    const before = JSON.stringify(f);
    expect(score(f)).toEqual(score(f));
    expect(JSON.stringify(f)).toBe(before);
  });
});

describe("accessibility counterexamples: must abstain or stay human-like", () => {
  const expectSafe = (label: string) =>
    expect(["abstain", "human-like", "insufficient-data"]).toContain(label);

  it("dictation: keyless trusted insertText into several fields", () => {
    const events = [1, 2, 3, 4].map((i) =>
      ev({
        type: "input",
        timeStamp: i * 4000,
        target: field("a dictated sentence"),
        inputType: "insertText",
      }),
    );
    const s = session([...humanClicks(2), ...events]).score();
    expectSafe(s.label);
    expect(s.evidence.map((e) => e.rule)).not.toContain("R5");
  });

  it("IME typing (keyCode 229) with fast composition events", () => {
    const events = Array.from({ length: 30 }, (_, i) =>
      ev({ type: "keydown", timeStamp: i * 8, key: "Process", keyCode: 229, target: field() }),
    );
    const s = session([
      ev({ type: "compositionstart", timeStamp: 0, target: field() }),
      ...events,
      ...typeText(1000, 10, () => 8, 2),
    ]).score();
    expectSafe(s.label);
  });

  it("keyboard and switch activations: detail 0 clicks with Tab navigation", () => {
    const events: Ev[] = [];
    for (let i = 0; i < 12; i++) {
      events.push(ev({ type: "keydown", timeStamp: i * 2500, key: "Tab" }));
      events.push(ev({ type: "keydown", timeStamp: i * 2500 + 300, key: "Enter" }));
      events.push(ev({ type: "click", timeStamp: i * 2500 + 301, detail: 0 }));
    }
    const s = session(events).score();
    expectSafe(s.label);
    expect(s.cohort).toBe("keyboard");
  });

  it("Cmd+Tab: keyups arriving after the tab is hidden never count", () => {
    const events = [
      ...humanClicks(4),
      ev({ type: "keydown", timeStamp: 40000, key: "Meta", code: "MetaLeft" }),
      ev({ type: "keydown", timeStamp: 40100, key: "Tab", code: "Tab", metaKey: true }),
      ev({ type: "visibilitychange", timeStamp: 40150, data: "hidden" }),
      ev({ type: "keyup", timeStamp: 40800, key: "Tab", code: "Tab" }),
      ev({ type: "keyup", timeStamp: 41000, key: "Meta", code: "MetaLeft" }),
    ];
    const s = session(events);
    expect(s.f.counts.hiddenInputs).toBe(0);
    expectSafe(s.score().label);
  });

  it("trackpad tap-to-click: near-zero dwell but a real path and fractional wheel deltas", () => {
    const r = jitter(13);
    const events: Ev[] = [
      ...wheelTicks(
        0,
        20,
        () => 16,
        () => 1 + r() * 4,
      ),
    ];
    for (let i = 0; i < 6; i++)
      events.push(
        ...mouseClick(2000 + i * 2500, 200 + i * 90, 300, {
          moves: 18,
          dwell: 1,
          fromX: 100 + i * 50,
          fromY: 500,
          target: el({ rect: [150 + i * 90, 280, 160, 50] }),
        }),
      );
    const s = session(events).score();
    expectSafe(s.label);
  });

  it("keyboard-only session: Tab, arrows, typing and keyboard scrolling", () => {
    const r = jitter(17);
    const events: Ev[] = [];
    let t = 0;
    for (let i = 0; i < 15; i++) {
      events.push(ev({ type: "keydown", timeStamp: (t += 400 + r() * 900), key: "Tab" }));
      events.push(ev({ type: "keydown", timeStamp: (t += 300), key: "ArrowDown" }));
      events.push(ev({ type: "scroll", timeStamp: t + 20 }));
    }
    events.push(...typeText(t + 1000, 25, () => 90 + r() * 160, 80, field()));
    const s = session(events).score();
    expectSafe(s.label);
    expect(s.cohort).toBe("keyboard");
  });

  it("touch phone session: taps, momentum scrolls and a keyboard", () => {
    const phone: FakeEnvOptions = {
      nav: { userAgent: IPHONE_UA, maxTouchPoints: 5 },
      media: { "(hover: hover)": false, "(pointer: fine)": false, "(any-pointer: coarse)": true },
      geometry: null,
    };
    const events: Ev[] = [];
    for (let i = 0; i < 8; i++) {
      const t = i * 3000;
      events.push(ev({ type: "pointerdown", timeStamp: t, pointerType: "touch" }));
      events.push(ev({ type: "pointerup", timeStamp: t + 70, pointerType: "touch" }));
      events.push(
        ev({ type: "pointermove", timeStamp: t + 80, pointerType: "touch", target: el() }),
      );
      events.push(ev({ type: "click", timeStamp: t + 90, detail: 1 }));
      for (let k = 0; k < 20; k++) events.push(ev({ type: "scroll", timeStamp: t + 600 + k * 40 }));
    }
    events.push(...typeText(30000, 10, () => 180, 60, field()));
    const s = session(events, phone).score();
    expectSafe(s.label);
    expect(s.cohort).toBe("touch");
  });
});
