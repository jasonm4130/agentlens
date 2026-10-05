import type { Features } from "./features";

export type { Counts, Features, Histograms, Markers, Moments, Probes, Renderer } from "./features";

export type Label =
  | "human-like"
  | "agent-likely"
  | "agent-unattributed"
  | "insufficient-data"
  | "abstain";
export type AgentClass = "A" | "B" | "C";
/** An ordinal tier, not a probability. */
export type Confidence = "certain" | "high" | "medium" | "low";
export type Cohort = "mouse" | "touch" | "keyboard" | "mixed" | "none";
export type Mode = "full" | "minimal";

/** `detail` is a fixed template filled with numbers only. */
export interface Evidence {
  rule: string;
  detail: string;
}

export interface Verdict {
  label: Label;
  /** Only with `agent-likely`, and not for a consumer `custom-marker`. */
  agentClass?: AgentClass;
  confidence: Confidence;
  /** Rules that fired, plus abstain reasons. */
  evidence: Evidence[];
  cohort: Cohort;
  /** `minimal` under Global Privacy Control or `minimal: true`. */
  mode: Mode;
  /** Always included, so consumers can re-score offline with `scorer.mjs`. */
  features: Features;
  featuresVersion: number;
  rulesetVersion: string;
  /** Random 128-bit hex, per tab (per page with memory storage). */
  sessionId: string;
  /** Increases with every emitted verdict in the session. */
  seq: number;
  reason: "flush" | "label-change" | "snapshot";
}

/** A Tier 1 hard tell. Fires once per rule per session. */
export interface Signal {
  rule: string;
  agentClass?: AgentClass;
  detail: string;
  sessionId: string;
}

export interface DetectorOptions {
  /** Below this many qualifying actions the label is `insufficient-data`. Default 3. */
  minActions?: number;
  /** `session` (default) keeps state per tab across pages; `memory` makes each page its own session. */
  storage?: "session" | "memory";
  /** Default true: Global Privacy Control forces minimal mode and memory storage. */
  respectGPC?: boolean;
  /** Force minimal mode: probes and markers only, no behavioural listeners. */
  minimal?: boolean;
  /** Extra CSS selectors whose subtrees are skipped, on top of `[data-al-ignore]` and sensitive fields. */
  ignore?: string[];
  /** Extra marker selectors; a hit is reported as rule `custom-marker` with no class. */
  extraMarkers?: string[];
  /** Quiet period after input before re-scoring. Default 1000 ms. */
  scoreDebounceMs?: number;
}

export interface Detector {
  /** Subscribe; returns the unsubscribe function. */
  on(event: "verdict", cb: (v: Verdict) => void): () => void;
  on(event: "signal", cb: (s: Signal) => void): () => void;
  /** Score now without emitting. */
  snapshot(): Verdict;
  /** Detach listeners and timers. Saves the session state first, or erases it if `clear` is set. */
  destroy(options?: { clear?: boolean }): void;
}
