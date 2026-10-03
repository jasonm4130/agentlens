export type Label =
  | "human-like"
  | "agent-likely"
  | "agent-unattributed"
  | "insufficient-data"
  | "abstain";
export type AgentClass = "A" | "B" | "C";
export type Confidence = "certain" | "high" | "medium" | "low";
export type Cohort = "mouse" | "touch" | "keyboard" | "mixed" | "none";

/** `detail` is a fixed template filled with numbers only. */
export interface Evidence {
  rule: string;
  detail: string;
}

/** Running count, sum and sum of squares, in integer ms, for a CV without storing samples. */
export interface Moments {
  n: number;
  sum: number;
  sumSq: number;
}

export interface Counts {
  // modality: trusted pointer events by pointerType
  mouseEvents: number;
  touchEvents: number;
  penEvents: number;
  // #1, #2: trusted primary-button mouse clicks (pointerdown then pointerup)
  clicks: number;
  singleMoveClicks: number;
  displacedSingleMoveClicks: number;
  shortDwellClicks: number;
  singleMoveShortDwellClicks: number;
  mouseMoves: number;
  // #6: keyboard, classes only
  keys: number;
  chars: number;
  imeKeys: number;
  repeatKeys: number;
  // #10: scroll
  wheelTicks: number;
  wheelGestures: number;
  wheelSameDelta: number;
  wheelFractional: number;
  noInputScrolls: number;
}

/** Each histogram is `null` until it has a sample, never a zero-filled array. */
export interface Histograms {
  clickDwell: number[] | null;
  interKey: number[] | null;
  keyHold: number[] | null;
  wheelDt: number[] | null;
  wheelDelta: number[] | null;
}

export interface Features {
  counts: Counts;
  hist: Histograms;
  interKey: Moments | null;
  wheelDt: Moments | null;
}

export interface Verdict {
  label: Label;
  agentClass?: AgentClass;
  confidence: Confidence;
  evidence: Evidence[];
  cohort: Cohort;
  mode: "full" | "minimal";
  features: Features;
  featuresVersion: number;
  rulesetVersion: string;
  sessionId: string;
  seq: number;
  reason: "flush" | "label-change" | "snapshot";
}

export interface Signal {
  rule: string;
  agentClass?: AgentClass;
  detail: string;
  sessionId: string;
}

export interface DetectorOptions {
  minActions?: number;
  storage?: "session" | "memory";
  respectGPC?: boolean;
  minimal?: boolean;
  ignore?: string[];
  scoreDebounceMs?: number;
}

export interface Detector {
  on(event: "verdict", cb: (v: Verdict) => void): () => void;
  on(event: "signal", cb: (s: Signal) => void): () => void;
  snapshot(): Verdict;
  destroy(options?: { clear?: boolean }): void;
}

/** The subset of a DOM event the extractors read, so tests can feed plain objects. */
export interface Ev {
  type: string;
  timeStamp: number;
  isTrusted: boolean;
  pointerType?: string;
  clientX?: number;
  clientY?: number;
  button?: number;
  deltaY?: number;
  deltaMode?: number;
  key?: string;
  code?: string;
  keyCode?: number;
  repeat?: boolean;
  isComposing?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
}
