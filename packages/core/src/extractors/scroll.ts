import { addMoment, addToHist, bump, WHEEL_DELTA_EDGES, WHEEL_DT_EDGES } from "../features";
import type { Ev, Features } from "../types";
import { inFindWindow } from "./keyboard";
import type { Transient } from "./transient";

const GESTURE_GAP_MS = 300;
const SAME_DELTA_WINDOW_MS = 500;
const NO_INPUT_MS = 500;
const SCROLL_BURST_GAP_MS = 1000;
const LINE_PX = 16;

/** Normalises a wheel delta to pixels, so a 3-line tick and a 48 px tick compare equal. */
export function normalisedDelta(e: Ev, pageHeight: number): number {
  const d = Math.abs(e.deltaY ?? 0);
  if (e.deltaMode === 1) return d * LINE_PX;
  if (e.deltaMode === 2) return d * pageHeight;
  return d;
}

/**
 * #10. Folds wheel ticks (delta bucket, inter-tick dt, repeated identical deltas) and
 * counts scroll bursts with no wheel, touch, key or pointer input in the previous 500 ms.
 * Returns true when a new wheel gesture or no-input scroll burst began.
 */
export function foldScroll(f: Features, tr: Transient, e: Ev): boolean {
  const c = f.counts;
  const t = e.timeStamp;

  if (e.type === "wheel") {
    if (!e.isTrusted) return false;
    const delta = normalisedDelta(e, tr.pageHeight);
    const raw = e.deltaY ?? 0;
    bump(c, "wheelTicks");
    if (!Number.isInteger(raw)) bump(c, "wheelFractional");
    f.hist.wheelDelta = addToHist(f.hist.wheelDelta, delta, WHEEL_DELTA_EDGES);
    let began = false;
    if (tr.lastWheelAt === null || t - tr.lastWheelAt > GESTURE_GAP_MS) {
      bump(c, "wheelGestures");
      began = true;
    } else {
      const dt = t - tr.lastWheelAt;
      f.hist.wheelDt = addToHist(f.hist.wheelDt, dt, WHEEL_DT_EDGES);
      f.wheelDt = addMoment(f.wheelDt, dt);
      if (tr.lastWheelDelta === delta && dt < SAME_DELTA_WINDOW_MS) bump(c, "wheelSameDelta");
    }
    tr.lastWheelAt = t;
    tr.lastWheelDelta = delta;
    tr.lastInputAt = t;
    return began;
  }

  if (e.type === "scroll") {
    // Touch momentum scrolling outlives the last touch event, so touch cohorts abstain.
    if (c.touchEvents > 0) return false;
    if (t - tr.lastInputAt <= NO_INPUT_MS) return false;
    if (t < tr.suppressScrollUntil || inFindWindow(tr, t)) return false;
    const newBurst = t - tr.lastNoInputScrollAt > SCROLL_BURST_GAP_MS;
    tr.lastNoInputScrollAt = t;
    if (newBurst) bump(c, "noInputScrolls");
    return newBurst;
  }
  return false;
}

/** hashchange and focus-driven scrolls are not agent evidence. */
export function suppressScrolls(tr: Transient, t: number): void {
  tr.suppressScrollUntil = t + NO_INPUT_MS;
}
