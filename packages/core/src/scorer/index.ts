/**
 * The `/scorer` subpath (`scorer.mjs`): pure, DOM-free, for offline re-scoring in Node or on
 * a consumer's server, e.g. `score(verdict.features, RULESET, { mode: verdict.mode })`.
 */
export { FEATURES_VERSION, validateFeatures, type Validation } from "../features";
export { RULESET, type Ruleset } from "./ruleset";
export {
  RULES,
  PROFILES,
  type Profile,
  type Rule,
  type RuleContext,
  type RuleResult,
  type Thresholds,
} from "./rules";
export { actionsOf, cohortOf, score, type ScoreOptions, type Scored, type Tell } from "./score";
export type * from "../types";
