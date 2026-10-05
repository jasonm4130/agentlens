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
  const tells: Tell[] = [];
  const out = (
    label: Label,
    confidence: Confidence,
    evidence: Evidence[],
    agentClass?: AgentClass,
  ): Scored => ({
    label,
    ...(agentClass ? { agentClass } : {}),
    confidence,
    evidence,
    cohort,
    actions,
    tells,
  });
  const only = (rule: string, detail: string): Scored =>
    out(rule === "min-actions" ? "insufficient-data" : "abstain", "low", [{ rule, detail }]);

  if (ruleset.featuresVersion !== FEATURES_VERSION)
    return only(
      "version",
      `ruleset needs features v${ruleset.featuresVersion}, got v${FEATURES_VERSION}`,
    );

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
  if (tells.length)
    return out(
      "agent-likely",
      "certain",
      tells.map(({ rule, detail }) => ({ rule, detail })),
      tells.find((t) => t.agentClass)?.agentClass,
    );

  if (options.mode === "minimal") return only(options.gpc ? "gpc" : "minimal", "minimal mode");
  if (actions < minActions) return only("min-actions", `${actions}/${minActions} actions`);

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
    return classes.length === 1
      ? out("agent-likely", confidence, evidence, classes[0])
      : out("agent-unattributed", confidence, evidence);
  }
  if (gatesOpen === 0) {
    evidence.push({ rule: "gates", detail: "every behavioural gate abstained" });
    return out("abstain", "low", evidence);
  }
  // "No agent rule reached threshold", never "verified human": at most `medium`.
  return out("human-like", evidence.length ? "low" : "medium", evidence);
}
