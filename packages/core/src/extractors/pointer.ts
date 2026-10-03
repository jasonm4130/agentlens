import { addToHist, bump, DWELL_EDGES } from "../features";
import type { Ev, Features } from "../types";
import type { Transient } from "./transient";

/** Placeholder until the M2 mouse cohort sets N (architecture section 5.1, R1). */
const DISPLACED_PX = 50;
const SHORT_DWELL_MS = 20;
const MOVE_WINDOW_MS = 300;

/**
 * #1 and #2. Folds trusted pointer events into click counts and a dwell histogram.
 * Returns true when a click completed, which counts as an action.
 */
export function foldPointer(f: Features, tr: Transient, e: Ev): boolean {
  if (!e.isTrusted) return false;
  const c = f.counts;
  const t = e.timeStamp;
  const type = e.pointerType;

  if (type === "touch") {
    bump(c, "touchEvents");
    tr.lastInputAt = t;
    return false;
  }
  if (type === "pen") {
    bump(c, "penEvents");
    tr.lastInputAt = t;
    return false;
  }
  if (type !== "mouse") return false;
  bump(c, "mouseEvents");

  if (e.type === "pointermove") {
    bump(c, "mouseMoves");
    tr.moves.push(t);
    if (tr.moves.length > 8) tr.moves.shift();
    return false;
  }

  if (e.type === "pointerdown") {
    tr.lastInputAt = t;
    if (e.button !== 0) return false;
    let recent = 0;
    for (const m of tr.moves) if (m >= t - MOVE_WINDOW_MS) recent++;
    const x = e.clientX ?? 0;
    const y = e.clientY ?? 0;
    // Unknown anchor (first click of the session) is treated as not displaced.
    const displaced =
      tr.anchorX !== null &&
      tr.anchorY !== null &&
      Math.hypot(x - tr.anchorX, y - tr.anchorY) > DISPLACED_PX;
    tr.down = { t, singleMove: recent <= 1, displaced };
    return false;
  }

  if (e.type === "pointerup" && tr.down) {
    const d = tr.down;
    tr.down = null;
    tr.anchorX = e.clientX ?? null;
    tr.anchorY = e.clientY ?? null;
    tr.moves = [];
    const dwell = t - d.t;
    const short = dwell < SHORT_DWELL_MS;
    bump(c, "clicks");
    if (d.singleMove) bump(c, "singleMoveClicks");
    if (d.singleMove && d.displaced) bump(c, "displacedSingleMoveClicks");
    if (short) bump(c, "shortDwellClicks");
    if (d.singleMove && short) bump(c, "singleMoveShortDwellClicks");
    f.hist.clickDwell = addToHist(f.hist.clickDwell, dwell, DWELL_EDGES);
    return true;
  }
  return false;
}
