import { bump } from "../features";
import type { ExtractorFactory } from "./extractor";
import { classifyKey } from "./keyboard";

/** Input this long after the tab went hidden cannot be the keypress that hid it. */
const HIDDEN_GRACE_MS = 500;

/**
 * #7. Trusted non-modifier keydown or pointerdown at least 500 ms after the tab went hidden,
 * while it is still hidden. keyup and pointerup never count: the keyups of Cmd/Ctrl+Tab and
 * Cmd+W arrive after the transition.
 */
export const visibility: ExtractorFactory = ({ env }) => ({
  events: ["visibilitychange", "keydown", "pointerdown"],
  fold(f, tr, e) {
    const hidden = env.visibility() === "hidden";
    if (e.type === "visibilitychange") {
      tr.hiddenAt = hidden ? e.timeStamp : null;
      // Gaps spanning a hidden period are not think time.
      tr.lastActionAt = null;
      if (hidden) bump(f.counts, "hiddenTransitions");
      return;
    }
    if (e.type === "keyup" || !e.isTrusted || !hidden || tr.hiddenAt === null) return;
    if (e.timeStamp - tr.hiddenAt < HIDDEN_GRACE_MS) return;
    if (e.type === "keydown" && classifyKey(e) === "modifier") return;
    bump(f.counts, "hiddenInputs");
  },
});
