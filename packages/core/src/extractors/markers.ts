import { validSelectors, type Env } from "../env";
import type { Features, Markers } from "../features";
import type { Ruleset } from "../scorer/ruleset";
import type { ExtractorFactory } from "./extractor";

/**
 * Builds the #9 check: compiled-in selectors from the ruleset plus the consumer's
 * `extraMarkers`. Hits are sticky in `features.markers`; returns true on a new hit.
 */
export function markerCheck(
  env: Env,
  ruleset: Ruleset,
  extra: readonly string[],
): (f: Features) => boolean {
  const groups: [keyof Markers, string[]][] = [
    ["claude", [...ruleset.markers.claude]],
    ["browserUse", [...ruleset.markers.browserUse]],
    ["custom", validSelectors(env, extra)],
  ];
  return (f) => {
    let found = false;
    for (const [key, selectors] of groups) {
      if (f.markers[key] || !selectors.some((s) => env.matches(s))) continue;
      f.markers[key] = true;
      found = true;
    }
    return found;
  };
}

/** Re-checks the markers on each mouse pointerdown (no MutationObserver). */
export const markers: ExtractorFactory = ({ checkMarkers }) => ({
  events: ["pointerdown"],
  fold(f, _tr, e, sink) {
    if (e.pointerType === "mouse" && checkMarkers(f)) sink.tell();
  },
});
