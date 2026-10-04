import { addMoment, addToHist, bump, type Features } from "../features";
import type { Ev, Extractor, Transient } from "./extractor";
import { inFindWindow } from "./keyboard";

const GESTURE_GAP_MS = 300;
const SAME_DELTA_WINDOW_MS = 500;
const NO_INPUT_MS = 500;
const SCROLL_BURST_GAP_MS = 1000;
/** Scroll events closer than this belong to one stream (smooth or momentum scrolling). */
const STREAM_MS = 150;
/** An action this soon after a no-input scroll acts on what the scroll revealed. */
const REVEAL_MS = 1000;
const SMALL_DELTA_PX = 4;
const LINE_PX = 16;

/** Normalises a wheel delta to pixels, so a 3-line tick and a 48 px tick compare equal. */
export function normalisedDelta(e: Ev, pageHeight: number): number {
  const d = Math.abs(e.deltaY ?? 0);
  if (e.deltaMode === 1) return d * LINE_PX;
  if (e.deltaMode === 2) return d * pageHeight;
  return d;
}

function noInputScroll(f: Features, tr: Transient, t: number): boolean {
  const c = f.counts;
  // Touch momentum scrolling outlives the last touch event, so touch cohorts abstain.
  if (c.touchEvents > 0) return false;
  // A stream started by input (a keypress, a smooth scroll after a click) stays input-driven.
  if (t - tr.lastScrollAt < STREAM_MS) return tr.scrollNoInput;
  if (tr.heldButton !== null || t - tr.lastInputAt <= NO_INPUT_MS) return false;
  return t >= tr.suppressScrollUntil && !inFindWindow(tr, t);
}

/**
 * #10. Folds wheel ticks (delta bucket, inter-tick dt, repeated identical deltas, trackpad
 * hints) and counts scroll bursts with no wheel, touch, key or pointer input in the previous
 * 500 ms and no mouse button held (scrollbar drag, middle-button autoscroll), plus clicks
 * that land within a second of such a burst. hashchange and focus-driven scrolls abstain.
 */
export const scroll: Extractor = {
  events: ["wheel", "scroll", "click", "hashchange", "focusin"],
  fold(f, tr, e, sink) {
    const c = f.counts;
    const t = e.timeStamp;

    switch (e.type) {
      case "hashchange":
      case "focusin":
        tr.suppressScrollUntil = t + NO_INPUT_MS;
        return;
      case "click":
        if (!tr.scrollActed && t - tr.lastNoInputScrollAt <= REVEAL_MS) {
          tr.scrollActed = true;
          bump(c, "scrollThenAct");
        }
        return;
      case "wheel": {
        if (!e.isTrusted) return;
        const delta = normalisedDelta(e, tr.pageHeight);
        bump(c, "wheelTicks");
        if (!Number.isInteger(e.deltaY ?? 0)) bump(c, "wheelFractional");
        if (delta > 0 && delta < SMALL_DELTA_PX) bump(c, "wheelSmall");
        addToHist(f, "wheelDelta", delta);
        if (tr.lastWheelAt === null || t - tr.lastWheelAt > GESTURE_GAP_MS) {
          bump(c, "wheelGestures");
          sink.action(t);
        } else {
          const dt = t - tr.lastWheelAt;
          addToHist(f, "wheelDt", dt);
          addMoment(f, "wheelDt", dt);
          if (tr.lastWheelDelta === delta && dt < SAME_DELTA_WINDOW_MS) bump(c, "wheelSameDelta");
        }
        tr.lastWheelAt = t;
        tr.lastWheelDelta = delta;
        tr.lastInputAt = t;
        return;
      }
      case "scroll": {
        const none = noInputScroll(f, tr, t);
        tr.lastScrollAt = t;
        tr.scrollNoInput = none;
        if (!none) return;
        const newBurst = t - tr.lastNoInputScrollAt > SCROLL_BURST_GAP_MS;
        tr.lastNoInputScrollAt = t;
        if (!newBurst) return;
        tr.scrollActed = false;
        bump(c, "noInputScrolls");
        sink.action(t);
      }
    }
  },
};
