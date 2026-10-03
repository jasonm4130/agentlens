import { addMoment, addToHist, bump, DWELL_EDGES, KEY_GAP_EDGES } from "../features";
import type { Ev, Features } from "../types";
import type { Transient } from "./transient";

export type KeyClass = "char" | "modifier" | "nav" | "edit" | "paste" | "find" | "ime" | "other";

const MODIFIERS = new Set(["Shift", "Control", "Alt", "Meta", "CapsLock", "AltGraph"]);
const NAV = new Set([
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Tab",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "Escape",
]);
const EDIT = new Set(["Backspace", "Delete", "Enter"]);
/** Gaps at or above this are pauses between bursts, not typing cadence. */
const BURST_GAP_MS = 2000;
const FIND_SUPPRESS_MS = 3000;

/** Coarse class only; `key` and `code` are read here and never retained. */
export function classifyKey(e: Ev): KeyClass {
  if (e.keyCode === 229 || e.isComposing) return "ime";
  const key = e.key ?? "";
  const chord = e.ctrlKey || e.metaKey;
  if (chord && (key === "v" || key === "V")) return "paste";
  if (chord && (key === "f" || key === "F")) return "find";
  if (MODIFIERS.has(key)) return "modifier";
  if (NAV.has(key)) return "nav";
  if (EDIT.has(key)) return "edit";
  if (!chord && key.length === 1) return "char";
  return "other";
}

/**
 * #6. Folds trusted key events into class counts, the inter-key gap histogram and
 * moments (typed characters only), and the key hold histogram.
 * Returns true when a typed character counted as an action.
 */
export function foldKeyboard(f: Features, tr: Transient, e: Ev): boolean {
  if (!e.isTrusted) return false;
  const c = f.counts;
  const t = e.timeStamp;

  if (e.type === "keyup") {
    const code = e.code ?? "";
    const d = tr.keyDown.get(code);
    tr.keyDown.delete(code);
    if (d?.isChar) f.hist.keyHold = addToHist(f.hist.keyHold, t - d.t, DWELL_EDGES);
    return false;
  }
  if (e.type !== "keydown") return false;

  bump(c, "keys");
  tr.lastInputAt = t;
  const cls = classifyKey(e);
  if (cls === "find") tr.findAt = t;
  if (cls === "ime") {
    bump(c, "imeKeys");
    tr.lastCharAt = null;
    return false;
  }
  if (e.repeat) {
    bump(c, "repeatKeys");
    return false;
  }
  const isChar = cls === "char";
  if (tr.keyDown.size < 16) tr.keyDown.set(e.code ?? "", { t, isChar });
  if (!isChar) return false;

  bump(c, "chars");
  if (tr.lastCharAt !== null) {
    const gap = t - tr.lastCharAt;
    f.hist.interKey = addToHist(f.hist.interKey, gap, KEY_GAP_EDGES);
    if (gap < BURST_GAP_MS) f.interKey = addMoment(f.interKey, gap);
  }
  tr.lastCharAt = t;
  return true;
}

export function inFindWindow(tr: Transient, t: number): boolean {
  return t - tr.findAt < FIND_SUPPRESS_MS;
}
