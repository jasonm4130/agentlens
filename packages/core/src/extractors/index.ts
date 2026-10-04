import { cadence } from "./cadence";
import type { Extractor, ExtractorDeps, ExtractorFactory } from "./extractor";
import { form } from "./form";
import { hover } from "./hover";
import { keyboard } from "./keyboard";
import { markers } from "./markers";
import { pointer } from "./pointer";
import { scroll } from "./scroll";
import { visibility } from "./visibility";

/**
 * The registered signal families. Order matters only where one reads shared state another
 * writes in the same event (visibility resets the cadence anchor before cadence runs).
 */
export const EXTRACTORS: readonly (Extractor | ExtractorFactory)[] = [
  pointer,
  hover,
  keyboard,
  form,
  scroll,
  visibility,
  cadence,
  markers,
];

export function instantiate(
  list: readonly (Extractor | ExtractorFactory)[],
  deps: ExtractorDeps,
): Extractor[] {
  return list.map((x) => (typeof x === "function" ? x(deps) : x));
}
