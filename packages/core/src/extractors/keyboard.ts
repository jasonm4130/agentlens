import { addMoment, addToHist, bump, type CountKey } from "../features";
import type { Ev, Extractor, Transient } from "./extractor";

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

const CLASS_COUNT: Partial<Record<KeyClass, CountKey>> = {
  nav: "navKeys",
  paste: "pasteKeys",
  find: "findKeys",
  ime: "imeKeys",
};

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
 * #6. Folds trusted key events into class counts, the inter-key gap histogram and moments
 * (typed characters only), and the key hold histogram. A typed character is an action.
 */
export const keyboard: Extractor = {
  events: ["keydown", "keyup"],
  skipIgnored: true,
  fold(f, tr, e, sink) {
    if (!e.isTrusted) return;
    const c = f.counts;
    const t = e.timeStamp;

    if (e.type === "keyup") {
      const code = e.code ?? "";
      const d = tr.keyDown.get(code);
      tr.keyDown.delete(code);
      if (d?.isChar) addToHist(f, "keyHold", t - d.t);
      return;
    }

    bump(c, "keys");
    tr.lastInputAt = t;
    const cls = classifyKey(e);
    const counter = CLASS_COUNT[cls];
    if (counter) bump(c, counter);
    if (cls === "find") tr.findAt = t;
    if (cls === "ime") {
      tr.lastCharAt = null;
      return;
    }
    if (e.repeat) {
      bump(c, "repeatKeys");
      return;
    }
    const isChar = cls === "char";
    if (tr.keyDown.size < 16) tr.keyDown.set(e.code ?? "", { t, isChar });
    if (!isChar) return;

    bump(c, "chars");
    if (tr.lastCharAt !== null) {
      const gap = t - tr.lastCharAt;
      addToHist(f, "interKey", gap);
      if (gap < BURST_GAP_MS) addMoment(f, "interKey", gap);
    }
    tr.lastCharAt = t;
    sink.action(t);
  },
};

export function inFindWindow(tr: Transient, t: number): boolean {
  return t - tr.findAt < FIND_SUPPRESS_MS;
}
