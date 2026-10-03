import { foldKeyboard } from "./extractors/keyboard";
import { foldPointer } from "./extractors/pointer";
import { foldScroll, suppressScrolls } from "./extractors/scroll";
import type { Transient } from "./extractors/transient";
import type { Ev, Features } from "./types";

const IGNORE_SELECTORS = [
  'input[type="password"]',
  'input[autocomplete^="cc-"]',
  'input[autocomplete="one-time-code"]',
  "[data-al-ignore]",
];

const opts: AddEventListenerOptions = { passive: true, capture: true };

function listen(win: Window, listeners: [string, EventListener][]): () => void {
  for (const [type, fn] of listeners) win.addEventListener(type, fn, opts);
  return () => {
    for (const [type, fn] of listeners) win.removeEventListener(type, fn, opts);
  };
}

/** Attaches the flush triggers only (tab hidden, page hide). Returns the detach function. */
export function attachFlush(win: Window, flush: () => void): () => void {
  const visibility = () => {
    if (win.document.visibilityState === "hidden") flush();
  };
  return listen(win, [
    ["visibilitychange", visibility],
    ["pagehide", flush],
  ]);
}

/**
 * Attaches passive capture listeners for behavioural input on `window`. Events fold into
 * `features` and the raw event is dropped. `onAction` fires on each countable action.
 * Invalid `ignore` selectors are dropped so they cannot disable the built-in exclusions.
 * Returns the detach function.
 */
export function attach(
  win: Window,
  features: Features,
  tr: Transient,
  ignore: string[],
  onAction: () => void,
): () => void {
  const valid = (s: string): boolean => {
    try {
      win.document.querySelector(s);
      return true;
    } catch {
      return false;
    }
  };
  const selector = [...IGNORE_SELECTORS, ...ignore.filter(valid)].join(",");
  const isIgnored = (e: Event): boolean => {
    const t = e.target as Element | null;
    return !!t && typeof t.closest === "function" && t.closest(selector) !== null;
  };

  const fold =
    (fn: (f: Features, t: Transient, e: Ev) => boolean, checkIgnore: boolean) => (e: Event) => {
      if (checkIgnore && isIgnored(e)) return;
      tr.pageHeight = win.innerHeight || tr.pageHeight;
      if (fn(features, tr, e as unknown as Ev)) onAction();
    };

  const pointer = fold(foldPointer, true);
  const key = fold(foldKeyboard, true);
  const scroll = fold(foldScroll, false);
  const suppress = (e: Event) => suppressScrolls(tr, e.timeStamp);
  return listen(win, [
    ["pointermove", pointer],
    ["pointerdown", pointer],
    ["pointerup", pointer],
    ["keydown", key],
    ["keyup", key],
    ["wheel", scroll],
    ["scroll", scroll],
    ["hashchange", suppress],
    ["focusin", suppress],
  ]);
}
