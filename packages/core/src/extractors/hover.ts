import { bump } from "../features";
import type { Extractor } from "./extractor";

/**
 * #4 incidental interaction: distinct elements the mouse passed over, and how many of them
 * were then clicked. Only the two counts are kept; the element sets are weak and per page.
 */
export const hover: Extractor = {
  events: ["mouseover", "click"],
  fold(f, tr, e) {
    const el = e.target;
    if (!e.isTrusted || !el || typeof el !== "object") return;
    if (e.type === "mouseover") {
      // Touch taps emit compatibility mouseovers; they are not hover evidence.
      if (f.counts.touchEvents > 0 || tr.hovered.has(el)) return;
      tr.hovered.add(el);
      bump(f.counts, "hovered");
    } else if (tr.hovered.has(el) && !tr.hoveredClicked.has(el)) {
      tr.hoveredClicked.add(el);
      bump(f.counts, "hoveredClicked");
    }
  },
};
