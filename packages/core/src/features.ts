import type { Counts, Features, Moments } from "./types";

export const FEATURES_VERSION = 1;

/** Upper bin edges in ms. A value goes in the first bin whose edge exceeds it, else the last. */
export const DWELL_EDGES: number[] = [5, 10, 20, 40, 80, 160, 320, 640, 1280];
/** Bin 2 is 10-15 ms, which isolates the 12 ms xdotool typing gap. */
export const KEY_GAP_EDGES: number[] = [5, 10, 15, 20, 40, 80, 160, 320, 640, 1280];
export const WHEEL_DT_EDGES: number[] = [10, 20, 40, 80, 160, 320, 640, 1280];
export const WHEEL_DELTA_EDGES: number[] = [1, 4, 16, 32, 64, 100, 200, 400];

export const COUNT_MAX = 65535;
const MOMENT_SAMPLE_MAX = 10000;

const COUNT_KEYS: (keyof Counts)[] = [
  "mouseEvents",
  "touchEvents",
  "penEvents",
  "clicks",
  "singleMoveClicks",
  "displacedSingleMoveClicks",
  "shortDwellClicks",
  "singleMoveShortDwellClicks",
  "mouseMoves",
  "keys",
  "chars",
  "imeKeys",
  "repeatKeys",
  "wheelTicks",
  "wheelGestures",
  "wheelSameDelta",
  "wheelFractional",
  "noInputScrolls",
];

export function emptyFeatures(): Features {
  const counts = {} as Counts;
  for (const k of COUNT_KEYS) counts[k] = 0;
  return {
    counts,
    hist: { clickDwell: null, interKey: null, keyHold: null, wheelDt: null, wheelDelta: null },
    interKey: null,
    wheelDt: null,
  };
}

export function bump(counts: Counts, key: keyof Counts): void {
  if (counts[key] < COUNT_MAX) counts[key]++;
}

export function binIndex(value: number, edges: number[]): number {
  for (let i = 0; i < edges.length; i++) if (value < (edges[i] as number)) return i;
  return edges.length;
}

export function addToHist(hist: number[] | null, value: number, edges: number[]): number[] {
  const h = hist ?? Array.from({ length: edges.length + 1 }, () => 0);
  const i = binIndex(value, edges);
  if ((h[i] as number) < COUNT_MAX) h[i] = (h[i] as number) + 1;
  return h;
}

export function addMoment(m: Moments | null, value: number): Moments {
  const x = Math.round(Math.min(Math.max(value, 0), MOMENT_SAMPLE_MAX));
  const r = m ?? { n: 0, sum: 0, sumSq: 0 };
  if (r.n >= COUNT_MAX) return r;
  r.n++;
  r.sum += x;
  r.sumSq += x * x;
  return r;
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
