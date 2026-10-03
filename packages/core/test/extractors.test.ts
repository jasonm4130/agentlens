import { describe, expect, it } from "vitest";
import { foldKeyboard, classifyKey } from "../src/extractors/keyboard";
import { foldPointer } from "../src/extractors/pointer";
import { foldScroll } from "../src/extractors/scroll";
import { emptyTransient } from "../src/extractors/transient";
import { cv, emptyFeatures, histMode } from "../src/features";
import type { Ev } from "../src/types";

const ev = (e: Partial<Ev> & Pick<Ev, "type" | "timeStamp">): Ev => ({ isTrusted: true, ...e });

describe("#6 keyboard", () => {
  it("puts a fixed 12 ms typing gap in the 10-15 ms bin with near-zero CV (xdotool --delay 12)", () => {
    const f = emptyFeatures();
    const tr = emptyTransient();
    for (let i = 0; i < 20; i++) {
      const t = 1000 + i * 12;
      foldKeyboard(f, tr, ev({ type: "keydown", timeStamp: t, key: "a", code: "KeyA" }));
      foldKeyboard(f, tr, ev({ type: "keyup", timeStamp: t + 2, key: "a", code: "KeyA" }));
    }
    expect(histMode(f.hist.interKey)).toBe(2);
    expect(cv(f.interKey)).toBeLessThan(0.05);
    expect(histMode(f.hist.keyHold)).toBe(0);
    expect(f.counts.chars).toBe(20);
  });

  it("keeps human-paced typing out of the 10-15 ms bin", () => {
    const f = emptyFeatures();
    const tr = emptyTransient();
    let t = 0;
    for (const gap of [120, 90, 210, 150, 80, 300, 110, 170]) {
      t += gap;
      foldKeyboard(f, tr, ev({ type: "keydown", timeStamp: t, key: "e", code: "KeyE" }));
    }
    expect(histMode(f.hist.interKey)).not.toBe(2);
    expect(cv(f.interKey)).toBeGreaterThan(0.2);
  });

  it("ignores untrusted events, IME keys, repeats and modifiers for gaps", () => {
    const f = emptyFeatures();
    const tr = emptyTransient();
    foldKeyboard(f, tr, { type: "keydown", timeStamp: 1, isTrusted: false, key: "a" });
    foldKeyboard(f, tr, ev({ type: "keydown", timeStamp: 2, key: "Process", keyCode: 229 }));
    foldKeyboard(f, tr, ev({ type: "keydown", timeStamp: 3, key: "Shift", code: "ShiftLeft" }));
    foldKeyboard(
      f,
      tr,
      ev({ type: "keydown", timeStamp: 4, key: "a", code: "KeyA", repeat: true }),
    );
    expect(f.counts).toMatchObject({ keys: 3, chars: 0, imeKeys: 1, repeatKeys: 1 });
    expect(f.hist.interKey).toBeNull();
  });

  it("classifies shortcuts", () => {
    expect(classifyKey(ev({ type: "keydown", timeStamp: 0, key: "v", metaKey: true }))).toBe(
      "paste",
    );
    expect(classifyKey(ev({ type: "keydown", timeStamp: 0, key: "f", ctrlKey: true }))).toBe(
      "find",
    );
    expect(classifyKey(ev({ type: "keydown", timeStamp: 0, key: "Enter" }))).toBe("edit");
  });
});

describe("#1 and #2 pointer", () => {
  const click = (
    f = emptyFeatures(),
    tr = emptyTransient(),
    x: number,
    y: number,
    t: number,
    dwell: number,
    moves: number[],
  ) => {
    for (const m of moves)
      foldPointer(
        f,
        tr,
        ev({ type: "pointermove", timeStamp: m, pointerType: "mouse", clientX: x, clientY: y }),
      );
    foldPointer(
      f,
      tr,
      ev({
        type: "pointerdown",
        timeStamp: t,
        pointerType: "mouse",
        button: 0,
        clientX: x,
        clientY: y,
      }),
    );
    foldPointer(
      f,
      tr,
      ev({
        type: "pointerup",
        timeStamp: t + dwell,
        pointerType: "mouse",
        button: 0,
        clientX: x,
        clientY: y,
      }),
    );
    return { f, tr };
  };

  it("flags a warped click: one move, large displacement, ~2 ms dwell (mousemove --sync, click 1)", () => {
    const f = emptyFeatures();
    const tr = emptyTransient();
    click(f, tr, 100, 100, 1000, 2, [995]);
    click(f, tr, 600, 400, 3000, 2, [2995]);
    click(f, tr, 200, 700, 5000, 2, [4995]);
    expect(f.counts).toMatchObject({
      clicks: 3,
      singleMoveClicks: 3,
      displacedSingleMoveClicks: 2,
      shortDwellClicks: 3,
      singleMoveShortDwellClicks: 3,
    });
    expect(histMode(f.hist.clickDwell)).toBe(0);
  });

  it("does not flag a human-like click: many moves, 90 ms dwell", () => {
    const f = emptyFeatures();
    const tr = emptyTransient();
    click(f, tr, 100, 100, 1000, 90, [900, 920, 940, 960, 980]);
    click(f, tr, 600, 400, 3000, 110, [2800, 2850, 2900, 2950, 2980]);
    expect(f.counts).toMatchObject({ clicks: 2, singleMoveClicks: 0, shortDwellClicks: 0 });
  });

  it("counts touch and pen as modality only and ignores untrusted pointer events", () => {
    const f = emptyFeatures();
    const tr = emptyTransient();
    foldPointer(f, tr, ev({ type: "pointerdown", timeStamp: 1, pointerType: "touch" }));
    foldPointer(f, tr, ev({ type: "pointerdown", timeStamp: 2, pointerType: "pen" }));
    foldPointer(f, tr, {
      type: "pointerdown",
      timeStamp: 3,
      isTrusted: false,
      pointerType: "mouse",
      button: 0,
    });
    expect(f.counts).toMatchObject({ touchEvents: 1, penEvents: 1, mouseEvents: 0, clicks: 0 });
  });

  it("ignores non-primary buttons", () => {
    const f = emptyFeatures();
    const tr = emptyTransient();
    foldPointer(f, tr, ev({ type: "pointerdown", timeStamp: 1, pointerType: "mouse", button: 2 }));
    foldPointer(f, tr, ev({ type: "pointerup", timeStamp: 2, pointerType: "mouse", button: 2 }));
    expect(f.counts.clicks).toBe(0);
  });
});

describe("#10 scroll", () => {
  it("shows regular wheel ticks with a low dt CV (xdotool click --repeat)", () => {
    const f = emptyFeatures();
    const tr = emptyTransient();
    for (let i = 0; i < 12; i++)
      foldScroll(f, tr, ev({ type: "wheel", timeStamp: 1000 + i * 50, deltaY: 100, deltaMode: 0 }));
    expect(cv(f.wheelDt)).toBeLessThan(0.05);
    expect(f.counts).toMatchObject({
      wheelTicks: 12,
      wheelGestures: 1,
      wheelSameDelta: 11,
      wheelFractional: 0,
    });
  });

  it("normalises line-mode deltas and flags fractional trackpad deltas", () => {
    const f = emptyFeatures();
    const tr = emptyTransient();
    foldScroll(f, tr, ev({ type: "wheel", timeStamp: 1, deltaY: 3, deltaMode: 1 }));
    foldScroll(f, tr, ev({ type: "wheel", timeStamp: 20, deltaY: 48, deltaMode: 0 }));
    foldScroll(f, tr, ev({ type: "wheel", timeStamp: 40, deltaY: 1.5, deltaMode: 0 }));
    expect(f.counts.wheelSameDelta).toBe(1);
    expect(f.counts.wheelFractional).toBe(1);
  });

  it("counts a scroll burst with no recent input once, and not after wheel or find input", () => {
    const f = emptyFeatures();
    const tr = emptyTransient();
    for (const t of [2000, 2016, 2032, 2048])
      foldScroll(f, tr, ev({ type: "scroll", timeStamp: t }));
    expect(f.counts.noInputScrolls).toBe(1);

    foldScroll(f, tr, ev({ type: "wheel", timeStamp: 9000, deltaY: 100 }));
    foldScroll(f, tr, ev({ type: "scroll", timeStamp: 9100 }));
    expect(f.counts.noInputScrolls).toBe(1);

    foldKeyboard(f, tr, ev({ type: "keydown", timeStamp: 20000, key: "f", metaKey: true }));
    foldScroll(f, tr, ev({ type: "scroll", timeStamp: 21500 }));
    expect(f.counts.noInputScrolls).toBe(1);
  });

  it("abstains on scrolls for touch sessions", () => {
    const f = emptyFeatures();
    const tr = emptyTransient();
    foldPointer(f, tr, ev({ type: "pointerdown", timeStamp: 1, pointerType: "touch" }));
    foldScroll(f, tr, ev({ type: "scroll", timeStamp: 5000 }));
    expect(f.counts.noInputScrolls).toBe(0);
  });
});
