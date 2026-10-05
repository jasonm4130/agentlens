import { describe, expect, it } from "vitest";
import { cadence } from "../src/extractors/cadence";
import { ACTION, emptyTransient } from "../src/extractors/extractor";
import { form } from "../src/extractors/form";
import { hover } from "../src/extractors/hover";
import { classifyKey, keyboard } from "../src/extractors/keyboard";
import { pointer } from "../src/extractors/pointer";
import { scroll } from "../src/extractors/scroll";
import { visibility } from "../src/extractors/visibility";
import { addMoment, COUNT_MAX, cv, emptyFeatures, histMode } from "../src/features";
import { el, ev, fakeEnv, fold, mouseClick } from "./helpers";

describe("#6 keyboard", () => {
  it("puts a fixed 12 ms typing gap in the 10-15 ms bin with near-zero CV (xdotool --delay 12)", () => {
    const f = emptyFeatures();
    const tr = emptyTransient();
    const { actions } = fold(
      keyboard,
      f,
      tr,
      ...Array.from({ length: 20 }, (_, i) => [
        ev({ type: "keydown", timeStamp: 1000 + i * 12, key: "a", code: "KeyA" }),
        ev({ type: "keyup", timeStamp: 1002 + i * 12, key: "a", code: "KeyA" }),
      ]).flat(),
    );
    expect(histMode(f.hist.interKey)).toBe(2);
    expect(cv(f.moments.interKey)).toBeLessThan(0.05);
    expect(histMode(f.hist.keyHold)).toBe(0);
    expect(f.counts.chars).toBe(20);
    expect(actions).toHaveLength(20);
  });

  it("keeps human-paced typing out of the 10-15 ms bin", () => {
    const f = emptyFeatures();
    let t = 0;
    const events = [120, 90, 210, 150, 80, 300, 110, 170].map((gap) =>
      ev({ type: "keydown", timeStamp: (t += gap), key: "e", code: "KeyE" }),
    );
    fold(keyboard, f, emptyTransient(), ...events);
    expect(histMode(f.hist.interKey)).not.toBe(2);
    expect(cv(f.moments.interKey)).toBeGreaterThan(0.2);
  });

  it("ignores untrusted events, IME keys, repeats and modifiers for gaps", () => {
    const f = emptyFeatures();
    fold(
      keyboard,
      f,
      emptyTransient(),
      { type: "keydown", timeStamp: 1, isTrusted: false, key: "a" },
      ev({ type: "keydown", timeStamp: 2, key: "Process", keyCode: 229 }),
      ev({ type: "keydown", timeStamp: 3, key: "Shift", code: "ShiftLeft" }),
      ev({ type: "keydown", timeStamp: 4, key: "a", code: "KeyA", repeat: true }),
    );
    expect(f.counts).toMatchObject({ keys: 3, chars: 0, imeKeys: 1, repeatKeys: 1 });
    expect(f.hist.interKey).toBeNull();
  });

  it("classifies shortcuts and counts nav, paste and find keys", () => {
    const k = (key: string, chord = false) =>
      classifyKey(ev({ type: "keydown", timeStamp: 0, key, metaKey: chord }));
    expect([k("v", true), k("f", true), k("Enter"), k("Tab"), k("Shift"), k("x")]).toEqual([
      "paste",
      "find",
      "edit",
      "nav",
      "modifier",
      "char",
    ]);
    const f = emptyFeatures();
    fold(
      keyboard,
      f,
      emptyTransient(),
      ev({ type: "keydown", timeStamp: 1, key: "Tab" }),
      ev({ type: "keydown", timeStamp: 2, key: "v", ctrlKey: true }),
      ev({ type: "keydown", timeStamp: 3, key: "f", metaKey: true }),
    );
    expect(f.counts).toMatchObject({ navKeys: 1, pasteKeys: 1, findKeys: 1, chars: 0 });
  });
});

describe("#1, #2, #8, #11 pointer", () => {
  it("flags a warped click: one move, large displacement, ~2 ms dwell (mousemove --sync, click 1)", () => {
    const f = emptyFeatures();
    const tr = emptyTransient();
    fold(
      pointer,
      f,
      tr,
      ...mouseClick(1000, 100, 100, { dwell: 2 }),
      ...mouseClick(3000, 600, 400, { dwell: 2 }),
      ...mouseClick(5000, 200, 700, { dwell: 2 }),
    );
    expect(f.counts).toMatchObject({
      clicks: 3,
      anchoredClicks: 2,
      singleMoveClicks: 3,
      displacedSingleMoveClicks: 2,
      shortDwellClicks: 3,
      singleMoveShortDwellClicks: 3,
      activations: 0,
    });
    expect(histMode(f.hist.clickDwell)).toBe(0);
  });

  it("does not flag a human-like click: many moves, 90 ms dwell", () => {
    const f = emptyFeatures();
    const tr = emptyTransient();
    fold(
      pointer,
      f,
      tr,
      ...mouseClick(1000, 100, 100, { moves: 12, fromX: 40, fromY: 300 }),
      ...mouseClick(3000, 600, 400, { moves: 14, dwell: 110, fromX: 100, fromY: 100 }),
    );
    expect(f.counts).toMatchObject({ clicks: 2, singleMoveClicks: 0, shortDwellClicks: 0 });
  });

  it("counts touch and pen as modality only and ignores untrusted pointer events", () => {
    const f = emptyFeatures();
    fold(
      pointer,
      f,
      emptyTransient(),
      ev({ type: "pointerdown", timeStamp: 1, pointerType: "touch" }),
      ev({ type: "pointerdown", timeStamp: 2, pointerType: "pen" }),
      { type: "pointerdown", timeStamp: 3, isTrusted: false, pointerType: "mouse", button: 0 },
    );
    expect(f.counts).toMatchObject({ touchEvents: 1, penEvents: 1, mouseEvents: 0, clicks: 0 });
  });

  it("ignores non-primary buttons", () => {
    const f = emptyFeatures();
    fold(
      pointer,
      f,
      emptyTransient(),
      ev({ type: "pointerdown", timeStamp: 1, pointerType: "mouse", button: 2 }),
      ev({ type: "pointerup", timeStamp: 2, pointerType: "mouse", button: 2 }),
    );
    expect(f.counts.clicks).toBe(0);
  });

  it("treats detail 0 and chain-less trusted clicks as activations, not pointer clicks", () => {
    const f = emptyFeatures();
    const { actions } = fold(
      pointer,
      f,
      emptyTransient(),
      ev({ type: "click", timeStamp: 100, detail: 0 }),
      ev({ type: "click", timeStamp: 5000, detail: 1 }),
    );
    expect(f.counts).toMatchObject({ activations: 2, clicks: 0, orphanClicks: 0 });
    expect(actions).toEqual([100, 5000]);
  });

  it("counts untrusted clicks with no pointerdown as orphans (Browser Use this.click())", () => {
    const f = emptyFeatures();
    fold(
      pointer,
      f,
      emptyTransient(),
      { type: "click", timeStamp: 100, isTrusted: false, detail: 0 },
      { type: "pointerdown", timeStamp: 900, isTrusted: false, pointerType: "mouse" },
      { type: "click", timeStamp: 1000, isTrusted: false, detail: 1 },
    );
    expect(f.counts).toMatchObject({ untrustedClicks: 2, orphanClicks: 1, activations: 0 });
  });

  it("samples the centre fraction of the first 12 clicks on targets of different sizes", () => {
    const f = emptyFeatures();
    const tr = emptyTransient();
    const targets = [el({ rect: [0, 0, 100, 40] }), el({ rect: [200, 100, 300, 60] })];
    const events = Array.from({ length: 14 }, (_, i) => {
      const target = targets[i % 2] ?? el();
      const r = target.getBoundingClientRect?.() ?? { left: 0, top: 0, width: 0, height: 0 };
      return mouseClick(1000 * (i + 1), r.left + r.width / 2, r.top + r.height / 2, { target });
    }).flat();
    fold(pointer, f, tr, ...events);
    expect(f.counts).toMatchObject({ centreSampled: 12, centreHits: 12, centreSizes: 2 });
    expect(histMode(f.hist.centreDev)).toBe(0);
  });
});

describe("#4 hover", () => {
  const move = (t: number, target: object) =>
    ev({ type: "pointermove", timeStamp: t, pointerType: "mouse", target });

  it("counts distinct hovered elements and those then clicked; touch is not hover", () => {
    const f = emptyFeatures();
    const a = el();
    const b = el();
    fold(
      hover,
      f,
      emptyTransient(),
      move(1, a),
      move(2, a),
      move(3, b),
      move(4, a),
      ev({ type: "pointermove", timeStamp: 5, pointerType: "touch", target: el() }),
      ev({ type: "click", timeStamp: 6, target: a }),
      ev({ type: "click", timeStamp: 7, target: a }),
    );
    expect(f.counts).toMatchObject({ hovered: 2, hoveredClicked: 1 });
  });
});

describe("#5, #8 forms", () => {
  const input = (t: number, target: object, extra: Partial<Parameters<typeof ev>[0]> = {}) =>
    ev({ type: "input", timeStamp: t, target, inputType: "insertText", ...extra });

  it("flags a keyless jump with an untrusted or non-typing input type, once per field", () => {
    const f = emptyFeatures();
    const a = el({ value: "" });
    const b = el({ value: "" });
    a.value = "Ada Lovelace";
    b.value = "ada@example.com";
    fold(
      form,
      f,
      emptyTransient(),
      { ...input(10, a), isTrusted: false },
      input(20, b, { inputType: "insertFromPaste" }),
      input(30, b, { inputType: "insertFromPaste" }),
    );
    expect(f.counts).toMatchObject({ fillFields: 2, valueJumps: 2, untrustedInputs: 1 });
  });

  it("abstains on trusted keyless insertText (dictation, Voice Control, CDP insertText)", () => {
    const f = emptyFeatures();
    const a = el({ value: "hello world" });
    fold(form, f, emptyTransient(), input(10, a));
    expect(f.counts).toMatchObject({ keylessInsertText: 1, fillFields: 0 });
  });

  it("does not count growth after keystrokes, composition, autofill hints or right-click paste", () => {
    const f = emptyFeatures();
    const typed = el({ value: "abcdef" });
    const composed = el({ value: "こんにちは世界" });
    const autofill = el({ value: "Ada Lovelace", autocomplete: "name" });
    const menu = el({ value: "pasted text" });
    fold(
      form,
      f,
      emptyTransient(),
      ev({ type: "keydown", timeStamp: 1, key: "a", target: typed }),
      input(2, typed),
      ev({ type: "compositionstart", timeStamp: 3, target: composed }),
      input(4, composed, { inputType: "insertCompositionText" }),
      input(5, autofill, { inputType: "insertReplacementText" }),
      ev({ type: "contextmenu", timeStamp: 6, target: menu }),
      input(7, menu, { inputType: "insertFromPaste" }),
    );
    expect(f.counts).toMatchObject({ fillFields: 0, autofillJumps: 1, compositions: 1 });
  });

  it("detects Browser Use's untrusted input/change/blur trio", () => {
    const f = emptyFeatures();
    const a = el({ value: "ada@example.com" });
    const { tells } = fold(
      form,
      f,
      emptyTransient(),
      { ...input(10, a, { data: "ada@example.com" }), isTrusted: false },
      { type: "change", timeStamp: 11, isTrusted: false, target: a },
      { type: "blur", timeStamp: 12, isTrusted: false, target: a },
    );
    expect(f.counts.buTrio).toBe(1);
    expect(tells()).toBe(1);
  });

  it("does not take a partial or trusted sequence for the trio", () => {
    const f = emptyFeatures();
    const a = el({ value: "ada@example.com" });
    fold(
      form,
      f,
      emptyTransient(),
      { ...input(10, a, { data: "a" }), isTrusted: false },
      { type: "change", timeStamp: 11, isTrusted: false, target: a },
      { type: "blur", timeStamp: 12, isTrusted: false, target: a },
      { ...input(20, a, { data: "ada@example.com" }), isTrusted: false },
      ev({ type: "change", timeStamp: 21, target: a }),
      { type: "blur", timeStamp: 22, isTrusted: false, target: a },
    );
    expect(f.counts.buTrio).toBe(0);
  });

  it("counts paste with no prior copy or context menu, and never reads the clipboard", () => {
    const f = emptyFeatures();
    fold(
      form,
      f,
      emptyTransient(),
      ev({ type: "paste", timeStamp: 1 }),
      ev({ type: "copy", timeStamp: 2 }),
      ev({ type: "paste", timeStamp: 3 }),
    );
    expect(f.counts).toMatchObject({ pastes: 2, copies: 1, pasteNoCopy: 1 });
  });
});

describe("#10 scroll", () => {
  const wheel = (t: number, deltaY: number, deltaMode = 0) =>
    ev({ type: "wheel", timeStamp: t, deltaY, deltaMode });

  it("shows regular wheel ticks with a low dt CV (xdotool click --repeat)", () => {
    const f = emptyFeatures();
    fold(
      scroll,
      f,
      emptyTransient(),
      ...Array.from({ length: 12 }, (_, i) => wheel(1000 + i * 50, 100)),
    );
    expect(cv(f.moments.wheelDt)).toBeLessThan(0.05);
    expect(f.counts).toMatchObject({
      wheelTicks: 12,
      wheelGestures: 1,
      wheelSameDelta: 11,
      wheelFractional: 0,
    });
  });

  it("normalises line-mode deltas and flags fractional and small trackpad deltas", () => {
    const f = emptyFeatures();
    fold(scroll, f, emptyTransient(), wheel(1, 3, 1), wheel(20, 48), wheel(40, 1.5));
    expect(f.counts).toMatchObject({ wheelSameDelta: 1, wheelFractional: 1, wheelSmall: 1 });
  });

  it("counts a scroll burst with no recent input once, and not after wheel or find input", () => {
    const f = emptyFeatures();
    const tr = emptyTransient();
    fold(
      scroll,
      f,
      tr,
      ...[2000, 2016, 2032, 2048].map((t) => ev({ type: "scroll", timeStamp: t })),
    );
    expect(f.counts.noInputScrolls).toBe(1);

    fold(scroll, f, tr, wheel(9000, 100), ev({ type: "scroll", timeStamp: 9100 }));
    expect(f.counts.noInputScrolls).toBe(1);

    fold(keyboard, f, tr, ev({ type: "keydown", timeStamp: 20000, key: "f", metaKey: true }));
    fold(scroll, f, tr, ev({ type: "scroll", timeStamp: 21500 }));
    expect(f.counts.noInputScrolls).toBe(1);
  });

  it("keeps a scroll stream started by input input-driven (smooth scroll after a click)", () => {
    const f = emptyFeatures();
    const tr = emptyTransient();
    fold(pointer, f, tr, ...mouseClick(1000, 10, 10));
    const stream = Array.from({ length: 60 }, (_, i) =>
      ev({ type: "scroll", timeStamp: 1100 + i * 16 }),
    );
    fold(scroll, f, tr, ...stream);
    expect(f.counts.noInputScrolls).toBe(0);
  });

  it("does not count scrolls while a mouse button is held or after a middle-button autoscroll press", () => {
    const f = emptyFeatures();
    const tr = emptyTransient();
    const p = (type: string, t: number, button: number, buttons?: number) =>
      ev({
        type,
        timeStamp: t,
        pointerType: "mouse",
        button,
        ...(buttons === undefined ? {} : { buttons }),
      });
    fold(pointer, f, tr, p("pointerdown", 1000, 0));
    fold(
      scroll,
      f,
      tr,
      ev({ type: "scroll", timeStamp: 2000 }),
      ev({ type: "scroll", timeStamp: 4000 }),
    );
    fold(pointer, f, tr, p("pointerup", 4100, 0));
    expect(f.counts.noInputScrolls).toBe(0);

    fold(
      pointer,
      f,
      tr,
      p("pointerdown", 5000, 1),
      p("pointerup", 5100, 1),
      p("pointermove", 5200, 0, 0),
    );
    fold(scroll, f, tr, ev({ type: "scroll", timeStamp: 7000 }));
    expect(f.counts.noInputScrolls).toBe(0);

    fold(pointer, f, tr, p("pointerdown", 8000, 0), p("pointerup", 8100, 0));
    fold(scroll, f, tr, ev({ type: "scroll", timeStamp: 10000 }));
    expect(f.counts.noInputScrolls).toBe(1);
  });

  it("counts a click within a second of a no-input scroll once per burst", () => {
    const f = emptyFeatures();
    const tr = emptyTransient();
    fold(
      scroll,
      f,
      tr,
      ev({ type: "scroll", timeStamp: 5000 }),
      ev({ type: "click", timeStamp: 5400 }),
      ev({ type: "click", timeStamp: 5600 }),
      ev({ type: "scroll", timeStamp: 9000 }),
      ev({ type: "click", timeStamp: 10500 }),
    );
    expect(f.counts).toMatchObject({ noInputScrolls: 2, scrollThenAct: 1 });
  });

  it("abstains on scrolls for touch sessions and after hashchange or focus", () => {
    const f = emptyFeatures();
    const tr = emptyTransient();
    fold(
      scroll,
      f,
      tr,
      ev({ type: "hashchange", timeStamp: 1000 }),
      ev({ type: "scroll", timeStamp: 1200 }),
    );
    fold(pointer, f, tr, ev({ type: "pointerdown", timeStamp: 2000, pointerType: "touch" }));
    fold(scroll, f, tr, ev({ type: "scroll", timeStamp: 5000 }));
    expect(f.counts.noInputScrolls).toBe(0);
  });
});

describe("#7 visibility", () => {
  it("counts trusted non-modifier input ≥500 ms after hiding, while hidden", () => {
    const env = fakeEnv();
    const x = visibility({ env, checkMarkers: () => false });
    const f = emptyFeatures();
    const tr = emptyTransient();
    env.setVisibility("hidden");
    fold(
      x,
      f,
      tr,
      ev({ type: "visibilitychange", timeStamp: 1000 }),
      ev({ type: "keydown", timeStamp: 1100, key: "a" }),
      ev({ type: "keyup", timeStamp: 1700, key: "Meta" }),
      ev({ type: "keydown", timeStamp: 1800, key: "Meta" }),
      ev({ type: "keydown", timeStamp: 2000, key: "a" }),
      ev({ type: "pointerdown", timeStamp: 2500, pointerType: "mouse" }),
      { type: "keydown", timeStamp: 2600, isTrusted: false, key: "a" },
    );
    expect(f.counts).toMatchObject({ hiddenTransitions: 1, hiddenInputs: 2 });
    env.setVisibility("visible");
    fold(
      x,
      f,
      tr,
      ev({ type: "visibilitychange", timeStamp: 3000 }),
      ev({ type: "keydown", timeStamp: 4000, key: "a" }),
    );
    expect(f.counts.hiddenInputs).toBe(2);
  });
});

describe("#3 cadence", () => {
  const action = (t: number) => ev({ type: ACTION, timeStamp: t });

  it("measures think-time gaps and whether the cursor moved in them", () => {
    const f = emptyFeatures();
    const tr = emptyTransient();
    const move = (t: number) => ev({ type: "pointermove", timeStamp: t, pointerType: "mouse" });
    const both = {
      events: ["pointermove", ACTION],
      fold: (...a: Parameters<typeof cadence.fold>) =>
        (a[2].type === ACTION ? cadence : pointer).fold(...a),
    };
    fold(
      both,
      f,
      tr,
      action(0),
      action(300), // same burst
      action(3300),
      move(4000),
      move(4100),
      action(6300),
      action(20000),
    );
    expect(f.counts).toMatchObject({ actionGaps: 3, cadenceGaps: 2, stillGaps: 1, idleMoves: 2 });
    expect(f.moments.actionGap?.n).toBe(3);
  });

  it("drops a gap that spans a hidden period", () => {
    const env = fakeEnv();
    const vis = visibility({ env, checkMarkers: () => false });
    const f = emptyFeatures();
    const tr = emptyTransient();
    fold(cadence, f, tr, action(0));
    env.setVisibility("hidden");
    fold(vis, f, tr, ev({ type: "visibilitychange", timeStamp: 1000 }));
    env.setVisibility("visible");
    fold(vis, f, tr, ev({ type: "visibilitychange", timeStamp: 5000 }));
    fold(cadence, f, tr, action(6000), action(9000));
    expect(f.counts.actionGaps).toBe(1);
  });
});

describe("moments", () => {
  it("keeps n, sum and sumSq consistent once n saturates", () => {
    const f = emptyFeatures();
    for (let i = 0; i < COUNT_MAX + 1000; i++) addMoment(f, "interKey", i % 2 ? 100 : 200);
    const m = f.moments.interKey;
    expect(m?.n).toBe(COUNT_MAX);
    expect((m?.sum ?? 0) / (m?.n ?? 1)).toBeCloseTo(150, 0);
    expect(cv(m)).toBeCloseTo(1 / 3, 2);
  });
});
