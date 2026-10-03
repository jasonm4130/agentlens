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

export interface CollectorHooks {
  /** A countable action happened; the detector schedules a scoring pass. */
  onAction(): void;
  onHidden(): void;
  onPageHide(): void;
}

/**
 * Attaches passive capture listeners on `window`. Events fold into `features` and the
 * raw event is dropped. Returns the detach function.
 */
export function attach(
  win: Window,
  features: Features,
  tr: Transient,
  ignore: string[],
  hooks: CollectorHooks,
): () => void {
  const selector = [...IGNORE_SELECTORS, ...ignore].join(",");
  const isIgnored = (e: Event): boolean => {
    const t = e.target as Element | null;
    if (!t || typeof t.closest !== "function") return false;
    try {
      return t.closest(selector) !== null;
    } catch {
      return false;
    }
  };

  const opts: AddEventListenerOptions = { passive: true, capture: true };
  const fold =
    (fn: (f: Features, t: Transient, e: Ev) => boolean, checkIgnore: boolean) => (e: Event) => {
      if (checkIgnore && isIgnored(e)) return;
      tr.pageHeight = win.innerHeight || tr.pageHeight;
      if (fn(features, tr, e as unknown as Ev)) hooks.onAction();
    };

  const pointer = fold(foldPointer, true);
  const key = fold(foldKeyboard, true);
  const scroll = fold(foldScroll, false);
  const suppress = (e: Event) => suppressScrolls(tr, e.timeStamp);
  const visibility = () => {
    if (win.document.visibilityState === "hidden") hooks.onHidden();
  };
  const pagehide = () => hooks.onPageHide();

  const listeners: [string, EventListener][] = [
    ["pointermove", pointer],
    ["pointerdown", pointer],
    ["pointerup", pointer],
    ["keydown", key],
    ["keyup", key],
    ["wheel", scroll],
    ["scroll", scroll],
    ["hashchange", suppress],
    ["focusin", suppress],
    ["visibilitychange", visibility],
    ["pagehide", pagehide],
  ];
  for (const [type, fn] of listeners) win.addEventListener(type, fn, opts);
  return () => {
    for (const [type, fn] of listeners) win.removeEventListener(type, fn, opts);
  };
}
