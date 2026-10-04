import { FEATURES_VERSION, type Features } from "../features";
import type { AgentClass, Cohort, Confidence, Evidence, Label, Mode } from "../types";
import { RULESET, type Ruleset } from "./ruleset";
import type { RuleContext } from "./rules";

export interface ScoreOptions {
  /** `minimal` scores probes and markers only (Tier 1). Default `full`. */
  mode?: Mode;
  /** Minimal mode came from Global Privacy Control (evidence rule `gpc`, not `minimal`). */
  gpc?: boolean;
  /** Default 3. */
  minActions?: number;
}

/** A Tier 1 rule that fired. */
export interface Tell extends Evidence {
  agentClass?: AgentClass;
}

export interface Scored {
  label: Label;
  agentClass?: AgentClass;
  confidence: Confidence;
  evidence: Evidence[];
  cohort: Cohort;
  actions: number;
  tells: Tell[];
}

/** Modality from raw counts only; no disability inference. */
export function cohortOf(f: Features): Cohort {
  const c = f.counts;
  const mouse = c.mouseEvents > 0;
  const touch = c.touchEvents + c.penEvents > 0;
  if (mouse && touch) return "mixed";
  if (mouse) return "mouse";
  if (touch) return "touch";
  return c.keys > 0 ? "keyboard" : "none";
}

/** Qualifying actions for `minActions`. */
export function actionsOf(f: Features): number {
  const c = f.counts;
  return c.clicks + c.activations + c.chars + c.wheelGestures + c.noInputScrolls + c.valueJumps;
}

/**
 * Scores `features` against a ruleset. Pure and deterministic: the same input always gives
 * the same output, in the browser, in Node, or on a consumer's server re-scoring stored
 * features. Order: Tier 1, then minimal mode, then too little data, then Tier 2 with gates.
 */
export function score(
  features: Features,
  ruleset: Ruleset = RULESET,
  options: ScoreOptions = {},
): Scored {
  const cohort = cohortOf(features);
  const actions = actionsOf(features);
  const minActions = options.minActions ?? 3;
  const ctx: RuleContext = { f: features, th: ruleset.thresholds, cohort };
  const base = { cohort, actions };

  if (ruleset.featuresVersion !== FEATURES_VERSION) {
    const detail = `ruleset needs features v${ruleset.featuresVersion}, got v${FEATURES_VERSION}`;
    const evidence = [{ rule: "version", detail }];
    return { ...base, label: "abstain", confidence: "low", evidence, tells: [] };
  }

  const tells: Tell[] = [];
  for (const rule of ruleset.rules) {
    if (rule.tier !== 1) continue;
    const r = rule.check(ctx);
    if (typeof r === "string")
      tells.push({
        rule: rule.id,
        detail: r,
        ...(rule.agentClass ? { agentClass: rule.agentClass } : {}),
      });
  }
  if (tells.length) {
    const agentClass = tells.find((t) => t.agentClass)?.agentClass;
    const evidence = tells.map(({ rule, detail }) => ({ rule, detail }));
    return {
      ...base,
      label: "agent-likely",
      ...(agentClass ? { agentClass } : {}),
      confidence: "certain",
      evidence,
      tells,
    };
  }

  if (options.mode === "minimal") {
    const evidence = [{ rule: options.gpc ? "gpc" : "minimal", detail: "minimal mode" }];
    return { ...base, label: "abstain", confidence: "low", evidence, tells };
  }
  if (actions < minActions) {
    const evidence = [{ rule: "min-actions", detail: `${actions}/${minActions} actions` }];
    return { ...base, label: "insufficient-data", confidence: "low", evidence, tells };
  }

  const evidence: Evidence[] = [];
  const fired = new Set<string>();
  let qualifying = 0;
  let corroborating = 0;
  let gatesOpen = 0;
  for (const rule of ruleset.rules) {
    if (rule.tier !== 2) continue;
    const r = rule.check(ctx);
    if (r === null) continue;
    gatesOpen++;
    if (r === false) continue;
    fired.add(rule.id);
    evidence.push({ rule: rule.id, detail: r });
    if (rule.corroborator) corroborating++;
    else qualifying++;
  }

  if (qualifying >= 2) {
    const confidence = qualifying + corroborating >= 3 ? "high" : "medium";
    const classes = ruleset.profiles.filter((p) => p.matches(ctx, fired)).map((p) => p.agentClass);
    // A session matching two profiles stays unattributed.
    if (classes.length === 1) {
      const agentClass = classes[0] as AgentClass;
      return { ...base, label: "agent-likely", agentClass, confidence, evidence, tells };
    }
    return { ...base, label: "agent-unattributed", confidence, evidence, tells };
  }
  if (gatesOpen === 0) {
    evidence.push({ rule: "gates", detail: "every behavioural gate abstained" });
    return { ...base, label: "abstain", confidence: "low", evidence, tells };
  }
  // "No agent rule reached threshold", never "verified human": at most `medium`.
  const confidence = evidence.length ? "low" : "medium";
  return { ...base, label: "human-like", confidence, evidence, tells };
}
