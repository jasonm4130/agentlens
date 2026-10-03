import type { AgentClass, Cohort, Confidence, Evidence, Features, Label } from "../types";

export const RULESET = { version: "2026.10.0", rules: [] as readonly never[] };
export type Ruleset = typeof RULESET;

export interface ScoreContext {
  mode: "full" | "minimal";
  /** Minimal mode came from Global Privacy Control rather than `minimal: true`. */
  gpc: boolean;
  minActions: number;
}

export interface Scored {
  label: Label;
  agentClass?: AgentClass;
  confidence: Confidence;
  evidence: Evidence[];
  cohort: Cohort;
  actions: number;
}

/** Modality from raw counts only; no disability inference. */
export function cohortOf(f: Features): Cohort {
  const c = f.counts;
  const pointer = c.mouseEvents > 0;
  const touch = c.touchEvents + c.penEvents > 0;
  if (pointer && touch) return "mixed";
  if (pointer) return "mouse";
  if (touch) return "touch";
  if (c.keys > 0) return "keyboard";
  return "none";
}

export function actionsOf(f: Features): number {
  const c = f.counts;
  return c.clicks + c.chars + c.wheelGestures + c.noInputScrolls;
}

/**
 * M0 stub. Pure and deterministic, but it has no rules yet: it only separates
 * minimal mode and too-little-data, and abstains otherwise. The real rules land in M1.
 */
export function score(features: Features, _ruleset: Ruleset, ctx: ScoreContext): Scored {
  const cohort = cohortOf(features);
  const actions = actionsOf(features);
  const base = { cohort, actions, agentClass: undefined as AgentClass | undefined };
  if (ctx.mode === "minimal") {
    return {
      ...base,
      label: "abstain",
      confidence: "low",
      evidence: [{ rule: ctx.gpc ? "gpc" : "minimal", detail: "minimal mode" }],
    };
  }
  if (actions < ctx.minActions) {
    return {
      ...base,
      label: "insufficient-data",
      confidence: "low",
      evidence: [{ rule: "min-actions", detail: `${actions}/${ctx.minActions} actions` }],
    };
  }
  return {
    ...base,
    label: "abstain",
    confidence: "low",
    evidence: [{ rule: "stub-scorer", detail: "no rules in ruleset" }],
  };
}
