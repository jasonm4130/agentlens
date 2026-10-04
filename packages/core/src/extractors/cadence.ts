import { addMoment, addToHist, bump } from "../features";
import { ACTION, type Extractor } from "./extractor";

/** Actions closer than this are one burst (a typed word, a double click). */
const BURST_MS = 1000;
const THINK_MIN_MS = 1500;
const THINK_MAX_MS = 8000;
/** One stray move (the agent's own move to its target) still counts as a still gap. */
const STILL_MOVES = 1;

/**
 * #3 and the gap half of #4. Measures gaps between action bursts: a histogram and running
 * moments for the CV, how many fall in the 1.5-8 s think-time band, and whether the mouse
 * moved during them. Gaps spanning a hidden period or a page load are never counted, because
 * the visibility extractor and a new page both reset the last action.
 */
export const cadence: Extractor = {
  events: ["pointermove", ACTION],
  fold(f, tr, e) {
    if (e.type === "pointermove") {
      if (e.isTrusted && e.pointerType === "mouse") tr.movesSinceAction++;
      return;
    }
    const t = e.timeStamp;
    const last = tr.lastActionAt;
    tr.lastActionAt = t;
    if (last === null) {
      tr.movesSinceAction = 0;
      return;
    }
    const gap = t - last;
    if (gap < BURST_MS) return;
    const c = f.counts;
    const moves = tr.movesSinceAction;
    tr.movesSinceAction = 0;
    bump(c, "actionGaps");
    addToHist(f, "actionGap", gap);
    addMoment(f, "actionGap", gap);
    bump(c, "idleGaps");
    bump(c, "idleMoves", moves);
    bump(c, "idleSecs", Math.round(gap / 1000));
    if (gap >= THINK_MIN_MS && gap <= THINK_MAX_MS) {
      bump(c, "cadenceGaps");
      if (moves <= STILL_MOVES) bump(c, "stillGaps");
    }
  },
};
