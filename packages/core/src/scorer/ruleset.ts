import { FEATURES_VERSION } from "../features";
import { PROFILES, RULES, type Profile, type Rule, type Thresholds } from "./rules";

/** The compiled-in ruleset: data the scorer consumes. */
export interface Ruleset {
  /** `YYYY.MM.patch`; any threshold, gate or marker change bumps it. */
  version: string;
  featuresVersion: number;
  thresholds: Thresholds;
  /** #9 selectors, checked with `querySelector` on mouse pointerdown and before each flush. */
  markers: { claude: readonly string[]; browserUse: readonly string[] };
  rules: readonly Rule[];
  profiles: readonly Profile[];
}

export const RULESET: Ruleset = {
  version: "2026.10.1",
  featuresVersion: FEATURES_VERSION,
  thresholds: {
    minClicks: 3,
    minAnchoredClicks: 2,
    pathShare: 0.6,
    dwellShare: 0.6,
    minIdleGaps: 3,
    frozenMovesPerSec: 1,
    minKeyGaps: 8,
    fastKeyBins: 3,
    typingCv: 0.1,
    shortHoldBins: 1,
    minFillFields: 2,
    minScrollActs: 2,
    minWheelTicks: 6,
    wheelCv: 0.05,
    minCentreClicks: 3,
    minCentreSizes: 2,
    minOrphanClicks: 2,
    minHiddenInputs: 2,
    minCadenceGaps: 4,
    // placeholder until the M2 human cohort
    cadenceShare: 0.7,
    cadenceCv: 0.5,
    heavyNavKeys: 10,
  },
  markers: {
    claude: ["#claude-agent-stop-container", "#claude-agent-animation-styles"],
    browserUse: [
      "[data-browser-use-highlight]",
      "[data-browser-use-interaction-highlight]",
      "[data-browser-use-coordinate-highlight]",
      "#browser-use-debug-highlights",
      "#playwright-highlight-container",
    ],
  },
  rules: RULES,
  profiles: PROFILES,
};
