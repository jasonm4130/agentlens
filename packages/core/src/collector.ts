import { validSelectors, type Env } from "./env";
import { ACTION, emptyTransient, type Ev, type Extractor, type Sink } from "./extractors/extractor";
import type { Features } from "./features";

/** Sensitive fields and opted-out subtrees are never observed. */
const IGNORE_SELECTORS = [
  'input[type="password"]',
  'input[autocomplete^="cc-"]',
  'input[autocomplete="one-time-code"]',
  "[data-al-ignore]",
];

const LISTEN: AddEventListenerOptions = { passive: true, capture: true };

/** Subscribes `fns` on the env target; returns the detach function. */
export function listen(env: Env, fns: [string, (e: Event) => void][]): () => void {
  for (const [type, fn] of fns) env.target.addEventListener(type, fn, LISTEN);
  return () => {
    for (const [type, fn] of fns) env.target.removeEventListener(type, fn, LISTEN);
  };
}

export interface CollectorHooks {
  /** A countable action happened (debounced re-score). */
  onAction(): void;
  /** A hard tell landed (immediate re-score). */
  onTell(): void;
}

/**
 * Routes each DOM event to the extractors that asked for it, with one passive capture
 * listener per event type on the window. Invalid `ignore` selectors are dropped so they
 * cannot disable the built-in exclusions. Returns the detach function.
 */
export function attachCollector(
  env: Env,
  features: Features,
  extractors: readonly Extractor[],
  ignore: readonly string[],
  hooks: CollectorHooks,
): () => void {
  const tr = emptyTransient();
  tr.pageHeight = env.geometry()?.innerH || tr.pageHeight;
  const selector = [...IGNORE_SELECTORS, ...validSelectors(env, ignore)].join(",");
  const isIgnored = (e: Ev): boolean => {
    const t = e.target;
    return !!t && typeof t.closest === "function" && t.closest(selector) !== null;
  };

  const byType = new Map<string, Extractor[]>();
  for (const x of extractors)
    for (const type of x.events) byType.set(type, [...(byType.get(type) ?? []), x]);

  const dispatch = (e: Ev): void => {
    let ignored: boolean | undefined;
    for (const x of byType.get(e.type) ?? []) {
      if (x.skipIgnored && (ignored ??= isIgnored(e))) continue;
      x.fold(features, tr, e, sink);
    }
  };
  const sink: Sink = {
    action(t) {
      dispatch({ type: ACTION, timeStamp: t, isTrusted: true });
      hooks.onAction();
    },
    tell: () => hooks.onTell(),
  };

  const domTypes = [...byType.keys()].filter((t) => t !== ACTION);
  return listen(
    env,
    domTypes.map((type) => [type, (e: Event) => dispatch(e as unknown as Ev)]),
  );
}
