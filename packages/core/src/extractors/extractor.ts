import type { Env } from "../env";
import type { Features } from "../features";

/** The element fields an extractor may read. Read on the spot, never retained. */
export interface EvTarget {
  closest?: (selector: string) => unknown;
  getBoundingClientRect?: () => { left: number; top: number; width: number; height: number };
  value?: unknown;
  autocomplete?: unknown;
}

/** The subset of a DOM event the extractors read, so tests can feed plain objects. */
export interface Ev {
  type: string;
  timeStamp: number;
  isTrusted: boolean;
  target?: EvTarget | null;
  pointerType?: string;
  clientX?: number;
  clientY?: number;
  button?: number;
  buttons?: number;
  detail?: number;
  deltaY?: number;
  deltaMode?: number;
  key?: string;
  code?: string;
  keyCode?: number;
  repeat?: boolean;
  isComposing?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  inputType?: string;
  data?: string | null;
}

/** What an extractor reports back besides folding into `features`. */
export interface Sink {
  /** A countable action happened at `t` (feeds cadence and the debounced re-score). */
  action(t: number): void;
  /** A hard tell landed: score now instead of after the debounce. */
  tell(): void;
}

/**
 * One signal family. It names the DOM events it needs and folds each into `features`;
 * the raw event is dropped. Adding a signal means adding an extractor to `EXTRACTORS`,
 * not editing the collector or the scorer.
 */
export interface Extractor {
  readonly events: readonly string[];
  /**
   * Skip events whose target is in an ignored subtree (sensitive fields, `[data-al-ignore]`).
   * `pointermove` is never filtered: it carries no target data and is the hot path.
   */
  readonly skipIgnored?: boolean;
  fold(f: Features, tr: Transient, e: Ev, sink: Sink): void;
}

export interface ExtractorDeps {
  env: Env;
  /** Checks the #9 marker selectors and records hits; true when a new marker was found. */
  checkMarkers: (f: Features) => boolean;
}

export type ExtractorFactory = (deps: ExtractorDeps) => Extractor;

/** The pseudo-event the collector dispatches to extractors after any `sink.action`. */
export const ACTION = "al:action";

export interface FieldState {
  keys: number;
  len: number;
  composed: boolean;
  menuAt: number;
  flagged: boolean;
  trio: 0 | 1 | 2;
}

/**
 * Working state shared between extractors on one page. It is never persisted and never
 * leaves the page: positions, sizes and element references live here only transiently.
 */
export interface Transient {
  // pointer
  moves: number[];
  anchorX: number | null;
  anchorY: number | null;
  down: {
    t: number;
    x: number;
    y: number;
    singleMove: boolean;
    displaced: boolean;
    anchored: boolean;
  } | null;
  /** Mouse button held since its pointerdown; middle stays set until the next press (autoscroll). */
  heldButton: number | null;
  /** Last pointerdown of any kind, for chain-less and orphan clicks. */
  lastDownAt: number;
  lastMouseSec: number;
  centreSizes: Set<string>;
  /** The element under the mouse at the last move. */
  overEl: object | null;
  hovered: WeakSet<object>;
  hoveredClicked: WeakSet<object>;
  // keyboard and forms
  lastCharAt: number | null;
  keyDown: Map<string, { t: number; isChar: boolean }>;
  findAt: number;
  fields: WeakMap<object, FieldState>;
  // scroll
  lastInputAt: number;
  lastWheelAt: number | null;
  lastWheelDelta: number | null;
  lastScrollAt: number;
  scrollNoInput: boolean;
  lastNoInputScrollAt: number;
  scrollActed: boolean;
  suppressScrollUntil: number;
  pageHeight: number;
  // visibility and cadence
  hiddenAt: number | null;
  lastActionAt: number | null;
  /** `counts.mouseMoves` at the last action burst. */
  movesAtAction: number;
}

const NEVER = Number.NEGATIVE_INFINITY;

export function emptyTransient(): Transient {
  return {
    moves: [],
    anchorX: null,
    anchorY: null,
    down: null,
    heldButton: null,
    lastDownAt: NEVER,
    lastMouseSec: NEVER,
    centreSizes: new Set(),
    overEl: null,
    hovered: new WeakSet(),
    hoveredClicked: new WeakSet(),
    lastCharAt: null,
    keyDown: new Map(),
    findAt: NEVER,
    fields: new WeakMap(),
    lastInputAt: NEVER,
    lastWheelAt: null,
    lastWheelDelta: null,
    lastScrollAt: NEVER,
    scrollNoInput: false,
    lastNoInputScrollAt: NEVER,
    scrollActed: true,
    suppressScrollUntil: NEVER,
    pageHeight: 800,
    hiddenAt: null,
    lastActionAt: null,
    movesAtAction: 0,
  };
}
