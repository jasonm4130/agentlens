import { addToHist, bump, type Features } from "../features";
import type { Ev, Extractor, Sink, Transient } from "./extractor";

/** Placeholder until the M2 mouse cohort sets N (architecture section 5.1, R1). */
const DISPLACED_PX = 50;
const SHORT_DWELL_MS = 20;
const MOVE_WINDOW_MS = 300;
/** #11 reads layout, so only the first clicks are sampled. */
const CENTRE_SAMPLES = 12;
const CENTRE_HIT = 0.05;
/** A click this long after the last pointerdown has no pointer chain. */
const CHAIN_MS = 1000;

function sampleCentre(f: Features, tr: Transient, e: Ev): void {
  const rect = e.target?.getBoundingClientRect?.();
  if (!rect || rect.width <= 0 || rect.height <= 0) return;
  const fx = ((e.clientX ?? 0) - rect.left) / rect.width;
  const fy = ((e.clientY ?? 0) - rect.top) / rect.height;
  const dev = Math.max(Math.abs(fx - 0.5), Math.abs(fy - 0.5));
  bump(f.counts, "centreSampled");
  if (dev <= CENTRE_HIT) bump(f.counts, "centreHits");
  addToHist(f, "centreDev", dev);
  tr.centreSizes.add(`${Math.round(rect.width)}x${Math.round(rect.height)}`);
  f.counts.centreSizes = Math.min(Math.max(f.counts.centreSizes, tr.centreSizes.size), 65535);
}

function onClick(f: Features, tr: Transient, e: Ev, sink: Sink): void {
  const c = f.counts;
  const chained = e.timeStamp - tr.lastDownAt < CHAIN_MS;
  if (!e.isTrusted) {
    bump(c, "untrustedClicks");
    if (!chained) bump(c, "orphanClicks");
    return;
  }
  // Keyboard, switch and screen-reader activations: not pointer evidence, but an action.
  if (e.detail === 0 || !chained) {
    bump(c, "activations");
    sink.action(e.timeStamp);
  }
}

/**
 * #1, #2, #8 and #11. Folds trusted mouse pointer events into click counts, the dwell and
 * slip histograms and the centre fraction; counts touch and pen for the cohort; and
 * classifies click events as activations, untrusted or orphan clicks.
 */
export const pointer: Extractor = {
  events: ["pointermove", "pointerdown", "pointerup", "click"],
  skipIgnored: true,
  fold(f, tr, e, sink) {
    // DOM getters cost on the pointermove hot path, so each field is read once.
    const t = e.timeStamp;
    const kind = e.type;
    if (kind === "click") return onClick(f, tr, e, sink);
    if (kind === "pointerdown") tr.lastDownAt = t;
    if (!e.isTrusted) return;
    const c = f.counts;
    const type = e.pointerType;

    if (type === "touch" || type === "pen") {
      bump(c, type === "touch" ? "touchEvents" : "penEvents");
      tr.lastInputAt = t;
      return;
    }
    if (type !== "mouse") return;
    bump(c, "mouseEvents");
    const sec = Math.floor(t / 1000);
    if (sec !== tr.lastMouseSec) {
      tr.lastMouseSec = sec;
      bump(c, "mouseActiveSecs");
    }

    if (kind === "pointermove") {
      if (e.buttons === 0 && tr.heldButton !== 1) tr.heldButton = null;
      bump(c, "mouseMoves");
      tr.moves.push(t);
      if (tr.moves.length > 8) tr.moves.shift();
      return;
    }

    const x = e.clientX ?? 0;
    const y = e.clientY ?? 0;
    if (kind === "pointerdown") {
      tr.lastInputAt = t;
      tr.heldButton = e.button ?? 0;
      if (e.button !== 0) return;
      let recent = 0;
      for (const m of tr.moves) if (m >= t - MOVE_WINDOW_MS) recent++;
      // The first click on a page has no known start point, so it is not anchored.
      const anchored = tr.anchorX !== null && tr.anchorY !== null;
      const displaced =
        anchored && Math.hypot(x - (tr.anchorX ?? 0), y - (tr.anchorY ?? 0)) > DISPLACED_PX;
      tr.down = { t, x, y, singleMove: recent <= 1, displaced, anchored };
      if (c.centreSampled < CENTRE_SAMPLES) sampleCentre(f, tr, e);
      return;
    }

    if (kind !== "pointerup") return;
    if (tr.heldButton !== 1) tr.heldButton = null;
    const d = tr.down;
    if (!d) return;
    tr.down = null;
    tr.anchorX = x;
    tr.anchorY = y;
    tr.moves = [];
    const dwell = t - d.t;
    const short = dwell < SHORT_DWELL_MS;
    bump(c, "clicks");
    if (d.anchored) bump(c, "anchoredClicks");
    if (d.singleMove) bump(c, "singleMoveClicks");
    if (d.singleMove && d.displaced) bump(c, "displacedSingleMoveClicks");
    if (short) bump(c, "shortDwellClicks");
    if (d.singleMove && short) bump(c, "singleMoveShortDwellClicks");
    addToHist(f, "clickDwell", dwell);
    addToHist(f, "clickSlip", Math.hypot(x - d.x, y - d.y));
    sink.action(t);
  },
};
