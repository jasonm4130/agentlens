/**
 * Working state the extractors need between events. It is never persisted and never
 * leaves the page: positions and key codes live here only until the next event.
 */
export interface Transient {
  // pointer
  moves: number[];
  anchorX: number | null;
  anchorY: number | null;
  down: { t: number; singleMove: boolean; displaced: boolean } | null;
  // keyboard
  lastCharAt: number | null;
  keyDown: Map<string, { t: number; isChar: boolean }>;
  findAt: number;
  // scroll
  lastInputAt: number;
  lastWheelAt: number | null;
  lastWheelDelta: number | null;
  lastNoInputScrollAt: number;
  suppressScrollUntil: number;
  pageHeight: number;
}

export function emptyTransient(): Transient {
  return {
    moves: [],
    anchorX: null,
    anchorY: null,
    down: null,
    lastCharAt: null,
    keyDown: new Map(),
    findAt: Number.NEGATIVE_INFINITY,
    lastInputAt: Number.NEGATIVE_INFINITY,
    lastWheelAt: null,
    lastWheelDelta: null,
    lastNoInputScrollAt: Number.NEGATIVE_INFINITY,
    suppressScrollUntil: Number.NEGATIVE_INFINITY,
    pageHeight: 800,
  };
}
