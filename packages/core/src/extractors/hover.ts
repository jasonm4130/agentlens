import { bump } from "../features";
import type { Extractor } from "./extractor";

/**
 * #4 incidental interaction: distinct elements the mouse passed over, and how many of them
 * were then clicked. Read from the `pointermove` target rather than a `mouseover` listener,
 * which would cost a second listener call per crossing. Only the two counts are kept; the
 * element sets are weak and per page.
 */
export const hover: Extractor = {
  events: ["pointermove", "click"],
  fold(f, tr, e) {
    const el = e.target;
    if (!el || typeof el !== "object") return;
    if (e.type === "pointermove") {
      // Most moves stay on the same element: one comparison and out.
      if (el === tr.overEl || !e.isTrusted || e.pointerType !== "mouse") return;
      tr.overEl = el;
      if (tr.hovered.has(el)) return;
      tr.hovered.add(el);
      bump(f.counts, "hovered");
    } else if (e.isTrusted && tr.hovered.has(el) && !tr.hoveredClicked.has(el)) {
      tr.hoveredClicked.add(el);
      bump(f.counts, "hoveredClicked");
    }
  },
};
