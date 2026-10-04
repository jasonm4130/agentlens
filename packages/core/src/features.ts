/**
 * The `Features` schema: the single source for the type, `emptyFeatures`, `validateFeatures`
 * and the privacy test. Every field is a bounded integer, a bounded histogram of integers,
 * a boolean, `null`, or a closed-enum member; nothing else may leave the device.
 */

export const FEATURES_VERSION = 2;
export const COUNT_MAX = 65535;

export const COUNT_KEYS = [
  // modality: trusted pointer events by pointerType
  "mouseEvents",
  "touchEvents",
  "penEvents",
  // #1, #2: trusted primary-button mouse clicks (pointerdown then pointerup)
  "clicks",
  "anchoredClicks",
  "singleMoveClicks",
  "displacedSingleMoveClicks",
  "shortDwellClicks",
  "singleMoveShortDwellClicks",
  "mouseMoves",
  "mouseActiveSecs",
  // #8: click provenance; activations are trusted clicks with detail 0 or no pointer chain
  "activations",
  "untrustedClicks",
  "orphanClicks",
  // #11: first 12 mouse clicks
  "centreSampled",
  "centreHits",
  "centreSizes",
  // #4: hover and idle gaps
  "hovered",
  "hoveredClicked",
  "idleGaps",
  "idleMoves",
  "idleSecs",
  // #6: keyboard, classes only
  "keys",
  "chars",
  "imeKeys",
  "repeatKeys",
  "navKeys",
  "pasteKeys",
  "findKeys",
  // #5, #8: forms
  "inputs",
  "untrustedInputs",
  "compositions",
  "valueJumps",
  "fillFields",
  "keylessInsertText",
  "autofillJumps",
  "pastes",
  "copies",
  "contextmenus",
  "pasteNoCopy",
  "buTrio",
  // #10: scroll
  "wheelTicks",
  "wheelGestures",
  "wheelSameDelta",
  "wheelFractional",
  "wheelSmall",
  "noInputScrolls",
  "scrollThenAct",
  // #7: visibility
  "hiddenTransitions",
  "hiddenInputs",
  // #3: cadence
  "actionGaps",
  "cadenceGaps",
  "stillGaps",
] as const;

export type CountKey = (typeof COUNT_KEYS)[number];
export type Counts = Record<CountKey, number>;

/** Upper bin edges. A value goes in the first bin whose edge exceeds it, else the last. */
export const HIST_EDGES = {
  /** ms */
  clickDwell: [5, 10, 20, 40, 80, 160, 320, 640, 1280],
  /** ms; bin 2 is 10-15 ms, which isolates the 12 ms xdotool typing gap */
  interKey: [5, 10, 15, 20, 40, 80, 160, 320, 640, 1280],
  /** ms */
  keyHold: [5, 10, 20, 40, 80, 160, 320, 640, 1280],
  /** ms */
  wheelDt: [10, 20, 40, 80, 160, 320, 640, 1280],
  /** px, deltaMode-normalised */
  wheelDelta: [1, 4, 16, 32, 64, 100, 200, 400],
  /** ms between actions; 1500-8000 is the think-time band */
  actionGap: [500, 1000, 1500, 2000, 3000, 4000, 6000, 8000, 16000, 32000],
  /** distance from the element centre as a fraction of its size, in 0.05 steps */
  centreDev: [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45],
  /** px moved between pointerdown and pointerup */
  clickSlip: [1, 2, 4, 8, 16, 32],
} as const;

export type HistKey = keyof typeof HIST_EDGES;
/** Each histogram is `null` until it has a sample, never a zero-filled array. */
export type Histograms = Record<HistKey, number[] | null>;

/** Per-sample clamp for each running moment, so sums stay exact in a double. */
export const MOMENT_CLAMP = { interKey: 10000, wheelDt: 10000, actionGap: 60000 } as const;
export type MomentKey = keyof typeof MOMENT_CLAMP;

/** Running count, sum and sum of squares, in integer ms, for a CV without storing samples. */
export interface Moments {
  n: number;
  sum: number;
  sumSq: number;
}

export const RENDERERS = ["hardware", "swiftshader", "llvmpipe", "other-software"] as const;
export type Renderer = (typeof RENDERERS)[number];

/** One-shot probe results: bits and buckets only, never the raw string. `null` = unavailable. */
export interface Probes {
  /** #13 */
  webdriver: boolean | null;
  /** #13: `webdriver` defined on the navigator object itself (a stealth patch) */
  webdriverOwn: boolean | null;
  /** #14 */
  headlessUA: boolean | null;
  /** #14: Client Hints platform disagrees with the UA's OS (Chromium only) */
  platformMismatch: boolean | null;
  /** #15: desktop UA without `(hover:hover)` and `(pointer:fine)` */
  pointerMediaTell: boolean | null;
  /** #17 */
  renderer: Renderer | null;
  /** #18 */
  outerEqInner: boolean | null;
  availEqScreen: boolean | null;
  xgaDpr1: boolean | null;
  /** #21 */
  fwGlobals: boolean | null;
  /** #20: UTC offset in 15-minute steps */
  tzQuarterHours: number | null;
  /** modality coherence (R10) */
  maxTouchPoints: number | null;
  anyCoarse: boolean | null;
  pointerFine: boolean | null;
  desktopUA: boolean | null;
}

export const PROBE_BOUNDS: {
  [K in keyof Probes]: "bool" | readonly [number, number] | "renderer";
} = {
  webdriver: "bool",
  webdriverOwn: "bool",
  headlessUA: "bool",
  platformMismatch: "bool",
  pointerMediaTell: "bool",
  renderer: "renderer",
  outerEqInner: "bool",
  availEqScreen: "bool",
  xgaDpr1: "bool",
  fwGlobals: "bool",
  tzQuarterHours: [-64, 64],
  maxTouchPoints: [0, 64],
  anyCoarse: "bool",
  pointerFine: "bool",
  desktopUA: "bool",
};

/** #9 marker hits, sticky for the session. */
export interface Markers {
  claude: boolean;
  browserUse: boolean;
  custom: boolean;
}
export const MARKER_KEYS: readonly (keyof Markers)[] = ["claude", "browserUse", "custom"];

export interface Features {
  counts: Counts;
  hist: Histograms;
  moments: Record<MomentKey, Moments | null>;
  probes: Probes;
  markers: Markers;
}

function keysOf<T extends object>(o: T): (keyof T)[] {
  return Object.keys(o) as (keyof T)[];
}

export function emptyProbes(): Probes {
  const p = {} as Probes;
  for (const k of keysOf(PROBE_BOUNDS)) p[k] = null;
  return p;
}

export function emptyFeatures(): Features {
  const counts = {} as Counts;
  for (const k of COUNT_KEYS) counts[k] = 0;
  const hist = {} as Histograms;
  for (const k of keysOf(HIST_EDGES)) hist[k] = null;
  return {
    counts,
    hist,
    moments: { interKey: null, wheelDt: null, actionGap: null },
    probes: emptyProbes(),
    markers: { claude: false, browserUse: false, custom: false },
  };
}

export function bump(counts: Counts, key: CountKey, by = 1): void {
  counts[key] = Math.min(counts[key] + by, COUNT_MAX);
}

export function binIndex(value: number, edges: readonly number[]): number {
  for (let i = 0; i < edges.length; i++) if (value < (edges[i] as number)) return i;
  return edges.length;
}

export function addToHist(f: Features, key: HistKey, value: number): void {
  const edges = HIST_EDGES[key];
  const h = f.hist[key] ?? Array.from({ length: edges.length + 1 }, () => 0);
  const i = binIndex(value, edges);
  h[i] = Math.min((h[i] as number) + 1, COUNT_MAX);
  f.hist[key] = h;
}

export function addMoment(f: Features, key: MomentKey, value: number): void {
  const x = Math.round(Math.min(Math.max(value, 0), MOMENT_CLAMP[key]));
  const m = f.moments[key] ?? { n: 0, sum: 0, sumSq: 0 };
  if (m.n < COUNT_MAX) {
    m.n++;
    m.sum += x;
    m.sumSq += x * x;
  }
  f.moments[key] = m;
}

/** Coefficient of variation of the samples behind `m`, or null with fewer than 2. */
export function cv(m: Moments | null): number | null {
  if (!m || m.n < 2 || m.sum === 0) return null;
  const mean = m.sum / m.n;
  const variance = Math.max(m.sumSq / m.n - mean * mean, 0);
  return Math.sqrt(variance) / mean;
}

/** Index of the tallest bin, or null for an absent histogram. */
export function histMode(hist: number[] | null): number | null {
  if (!hist) return null;
  let best = 0;
  for (let i = 1; i < hist.length; i++) if ((hist[i] as number) > (hist[best] as number)) best = i;
  return best;
}

/** Share of samples in bins below `bin`, or null for an absent or empty histogram. */
export function shareBelow(hist: number[] | null, bin: number): number | null {
  if (!hist) return null;
  let below = 0;
  let total = 0;
  for (let i = 0; i < hist.length; i++) {
    total += hist[i] as number;
    if (i < bin) below += hist[i] as number;
  }
  return total ? below / total : null;
}

export function histTotal(hist: number[] | null): number {
  let total = 0;
  for (const n of hist ?? []) total += n;
  return total;
}

export type Validation = { ok: true; features: Features } | { ok: false; reason: string };

const isInt = (v: unknown, lo: number, hi: number): boolean =>
  typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;

function exactKeys(o: unknown, keys: readonly string[]): o is Record<string, unknown> {
  if (typeof o !== "object" || o === null || Array.isArray(o)) return false;
  const own = Object.keys(o);
  return own.length === keys.length && keys.every((k) => own.includes(k));
}

/**
 * Checks untrusted input (a stored session, or features sent to a server) against the schema.
 * Rejects wrong versions, unknown or missing keys, free strings and out-of-range numbers.
 */
export function validateFeatures(input: unknown, version: number = FEATURES_VERSION): Validation {
  const fail = (reason: string): Validation => ({ ok: false, reason });
  if (version !== FEATURES_VERSION) return fail(`featuresVersion ${version} is not supported`);
  if (!exactKeys(input, ["counts", "hist", "moments", "probes", "markers"]))
    return fail("bad shape");
  const { counts, hist, moments, probes, markers } = input;
  if (!exactKeys(counts, COUNT_KEYS)) return fail("bad counts");
  for (const k of COUNT_KEYS) if (!isInt(counts[k], 0, COUNT_MAX)) return fail(`counts.${k}`);
  const histKeys = keysOf(HIST_EDGES);
  if (!exactKeys(hist, histKeys)) return fail("bad hist");
  for (const k of histKeys) {
    const h = hist[k];
    if (h === null) continue;
    if (!Array.isArray(h) || h.length !== HIST_EDGES[k].length + 1) return fail(`hist.${k}`);
    if (!h.every((n) => isInt(n, 0, COUNT_MAX))) return fail(`hist.${k}`);
  }
  const momentKeys = keysOf(MOMENT_CLAMP);
  if (!exactKeys(moments, momentKeys)) return fail("bad moments");
  for (const k of momentKeys) {
    const m = moments[k];
    if (m === null) continue;
    const c = MOMENT_CLAMP[k];
    if (!exactKeys(m, ["n", "sum", "sumSq"])) return fail(`moments.${k}`);
    if (!isInt(m.n, 0, COUNT_MAX)) return fail(`moments.${k}`);
    const n = m.n as number;
    if (!isInt(m.sum, 0, n * c) || !isInt(m.sumSq, 0, n * c * c)) return fail(`moments.${k}`);
  }
  const probeKeys = keysOf(PROBE_BOUNDS);
  if (!exactKeys(probes, probeKeys)) return fail("bad probes");
  for (const k of probeKeys) {
    const v = probes[k];
    const b = PROBE_BOUNDS[k];
    if (v === null) continue;
    const ok =
      b === "bool"
        ? typeof v === "boolean"
        : b === "renderer"
          ? (RENDERERS as readonly unknown[]).includes(v)
          : isInt(v, b[0], b[1]);
    if (!ok) return fail(`probes.${k}`);
  }
  if (!exactKeys(markers, MARKER_KEYS)) return fail("bad markers");
  for (const k of MARKER_KEYS) if (typeof markers[k] !== "boolean") return fail(`markers.${k}`);
  return { ok: true, features: input as unknown as Features };
}
