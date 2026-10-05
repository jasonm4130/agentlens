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
  /** A countable action happened at `t` (debounced re-score). */
  onAction(t: number): void;
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
  // `closest` is too slow to run on every pointermove, so each element's answer is cached.
  const ignored = new WeakMap<object, boolean>();
  const isIgnored = (e: Ev): boolean => {
    const t = e.target;
    if (!t || typeof t.closest !== "function") return false;
    let hit = ignored.get(t);
    if (hit === undefined) ignored.set(t, (hit = t.closest(selector) !== null));
    return hit;
  };

  const byType = new Map<string, Extractor[]>();
  for (const x of extractors)
    for (const type of x.events) byType.set(type, [...(byType.get(type) ?? []), x]);

  // One listener per type over a fixed extractor list: this runs on every pointermove.
  const dispatcher = (type: string): ((e: Ev) => void) => {
    const xs = byType.get(type) ?? [];
    const filter = type !== "pointermove" && xs.some((x) => x.skipIgnored);
    return (e) => {
      const skip = filter && isIgnored(e);
      for (let i = 0; i < xs.length; i++) {
        const x = xs[i] as Extractor;
        if (!(skip && x.skipIgnored)) x.fold(features, tr, e, sink);
      }
    };
  };
  const onAction = dispatcher(ACTION);
  const sink: Sink = {
    action(t) {
      onAction({ type: ACTION, timeStamp: t, isTrusted: true });
      hooks.onAction(t);
    },
    tell: () => hooks.onTell(),
  };

  const domTypes = [...byType.keys()].filter((t) => t !== ACTION);
  return listen(
    env,
    domTypes.map((type) => [type, dispatcher(type) as unknown as (e: Event) => void]),
  );
}
