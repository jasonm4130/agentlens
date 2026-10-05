import { cv, histTotal, shareBelow, type Features } from "../features";
import type { AgentClass, Cohort } from "../types";

/**
 * Thresholds the rules read. Values marked "placeholder" are literature or CAPTCHA-dataset
 * parameters until the M2 human cohorts set them; changing any value bumps the ruleset version.
 */
export interface Thresholds {
  minClicks: number;
  minAnchoredClicks: number;
  pathShare: number;
  dwellShare: number;
  minIdleGaps: number;
  frozenMovesPerSec: number;
  minKeyGaps: number;
  /** Bins of `interKey` below 15 ms. */
  fastKeyBins: number;
  typingCv: number;
  /** Bins of `keyHold` below 5 ms. */
  shortHoldBins: number;
  minFillFields: number;
  minScrollActs: number;
  minWheelTicks: number;
  wheelCv: number;
  minCentreClicks: number;
  minCentreSizes: number;
  minOrphanClicks: number;
  minHiddenInputs: number;
  minCadenceGaps: number;
  cadenceShare: number;
  cadenceCv: number;
  heavyNavKeys: number;
}

export interface RuleContext {
  f: Features;
  th: Thresholds;
  cohort: Cohort;
}

/**
 * `null`: the rule abstained (its gate is closed, or a gateless rule saw nothing).
 * `false`: the gate passed and the rule did not fire. A string: it fired, with this detail.
 */
export type RuleResult = string | false | null;

export interface Rule {
  id: string;
  /** 1: one is enough (`certain`). 2: behavioural, needs two. */
  tier: 1 | 2;
  /** Tier 1 attribution. */
  agentClass?: AgentClass;
  /** Raises confidence but never counts toward the two Tier 2 rules (R8). */
  corroborator?: boolean;
  check(ctx: RuleContext): RuleResult;
}

/** A Tier 2 class profile: the label is `agent-likely` with this class when it matches. */
export interface Profile {
  agentClass: AgentClass;
  matches(ctx: RuleContext, fired: ReadonlySet<string>): boolean;
}

const share = (n: number, d: number): number => (d > 0 ? n / d : 0);
const ratio = (n: number, d: number): string => `${n}/${d}`;
const fixed = (x: number): string => x.toFixed(2);

const tell = (hit: boolean | null, detail: string): RuleResult => (hit ? detail : null);
const gated = (open: boolean, fires: () => RuleResult): RuleResult => (open ? fires() : null);

/** R4's constant-gap clause, shared with the B profile. */
export function constantTyping({ f, th }: RuleContext): boolean {
  const c = cv(f.moments.interKey);
  return (f.moments.interKey?.n ?? 0) >= th.minKeyGaps && c !== null && c < th.typingCv;
}

/** R6's regular-ticks clause, shared with the B profile. */
export function regularTicks({ f, th }: RuleContext): boolean {
  const c = cv(f.moments.wheelDt);
  return (
    f.counts.wheelTicks >= th.minWheelTicks &&
    f.counts.wheelSameDelta >= th.minWheelTicks - 1 &&
    c !== null &&
    c < th.wheelCv
  );
}

const mouseClicksGate = ({ f, th, cohort }: RuleContext): boolean =>
  (cohort === "mouse" || cohort === "mixed") && f.counts.clicks >= th.minClicks;

const trackpadHint = (f: Features): boolean =>
  f.counts.wheelFractional > 0 || f.counts.wheelSmall >= 3;

export const RULES: readonly Rule[] = [
  // Tier 1: hard tells, `certain`.
  {
    id: "C-marker", // signal #9 in 01-signals
    tier: 1,
    agentClass: "C",
    check: ({ f }) => tell(f.markers.claude, "Claude in Chrome marker"),
  },
  {
    id: "BU-marker", // signal #9 in 01-signals
    tier: 1,
    agentClass: "A",
    check: ({ f }) => tell(f.markers.browserUse, "Browser Use/Playwright highlight"),
  },
  {
    id: "webdriver", // signal #13 in 01-signals
    tier: 1,
    agentClass: "A",
    check: ({ f }) =>
      tell(
        f.probes.webdriver === true || f.probes.webdriverOwn === true,
        f.probes.webdriver ? "navigator.webdriver is true" : "own webdriver property",
      ),
  },
  {
    id: "headless-ua", // signal #14 in 01-signals
    tier: 1,
    agentClass: "A",
    check: ({ f }) => tell(f.probes.headlessUA, "HeadlessChrome user agent"),
  },
  {
    id: "fw-globals", // signal #21 in 01-signals
    tier: 1,
    agentClass: "A",
    check: ({ f }) => tell(f.probes.fwGlobals, "automation framework global"),
  },
  {
    id: "BU-trio", // signal #8 in 01-signals
    tier: 1,
    agentClass: "A",
    check: ({ f }) =>
      tell(f.counts.buTrio > 0, `${f.counts.buTrio} synthetic input/change/blur trio`),
  },
  {
    id: "custom-marker", // signal #9 in 01-signals
    tier: 1,
    check: ({ f }) => tell(f.markers.custom, "consumer marker"),
  },

  // Tier 2: behavioural; each abstains unless its gate passes.
  {
    id: "R1", // signal #1 in 01-signals
    tier: 2,
    check: (ctx) => {
      const c = ctx.f.counts;
      return gated(mouseClicksGate(ctx) && c.anchoredClicks >= ctx.th.minAnchoredClicks, () =>
        share(c.displacedSingleMoveClicks, c.anchoredClicks) >= ctx.th.pathShare
          ? `${ratio(c.displacedSingleMoveClicks, c.anchoredClicks)} single-move displaced clicks`
          : false,
      );
    },
  },
  {
    id: "R2", // signal #2 in 01-signals
    tier: 2,
    check: (ctx) => {
      const c = ctx.f.counts;
      return gated(mouseClicksGate(ctx) && !trackpadHint(ctx.f), () =>
        share(c.singleMoveShortDwellClicks, c.clicks) >= ctx.th.dwellShare
          ? `${ratio(c.singleMoveShortDwellClicks, c.clicks)} single-move clicks under 20 ms dwell`
          : false,
      );
    },
  },
  {
    id: "R3", // signal #4 in 01-signals
    tier: 2,
    check: ({ f, th, cohort }) => {
      const c = f.counts;
      return gated(cohort === "mouse" && c.idleGaps >= th.minIdleGaps, () => {
        const rate = share(c.idleMoves, c.idleSecs);
        return rate < th.frozenMovesPerSec && c.hovered <= c.hoveredClicked
          ? `${fixed(rate)} moves/idle s over ${c.idleGaps} gaps, no stray hovers`
          : false;
      });
    },
  },
  {
    id: "R4", // signal #6 in 01-signals
    tier: 2,
    check: (ctx) => {
      const { f, th } = ctx;
      const gaps = histTotal(f.hist.interKey);
      const open = gaps >= th.minKeyGaps && f.counts.imeKeys === 0 && f.counts.compositions === 0;
      return gated(open, () => {
        const fast = shareBelow(f.hist.interKey, th.fastKeyBins) ?? 0;
        if (fast > 0.5) return `${fixed(fast)} of ${gaps} key gaps under 15 ms`;
        if (constantTyping(ctx))
          return `key gap CV ${fixed(cv(f.moments.interKey) ?? 0)} over ${gaps} gaps`;
        const holds = histTotal(f.hist.keyHold);
        const short = shareBelow(f.hist.keyHold, th.shortHoldBins) ?? 0;
        return holds >= th.minKeyGaps && short > 0.5
          ? `${fixed(short)} of ${holds} key holds under 5 ms`
          : false;
      });
    },
  },
  {
    id: "R5", // signal #5 in 01-signals
    tier: 2,
    check: ({ f, th }) =>
      gated(f.counts.inputs > 0, () =>
        f.counts.fillFields >= th.minFillFields
          ? `${f.counts.fillFields} fields filled with no keystrokes`
          : false,
      ),
  },
  {
    id: "R6", // signal #10 in 01-signals
    tier: 2,
    check: (ctx) => {
      const c = ctx.f.counts;
      const open = c.noInputScrolls >= ctx.th.minScrollActs || c.wheelTicks >= ctx.th.minWheelTicks;
      return gated(open, () => {
        if (c.scrollThenAct >= ctx.th.minScrollActs)
          return `${c.scrollThenAct} no-input scrolls followed by a click`;
        return regularTicks(ctx)
          ? `${c.wheelTicks} wheel ticks, wheel dt CV ${fixed(cv(ctx.f.moments.wheelDt) ?? 0)}`
          : false;
      });
    },
  },
  {
    id: "R7", // signal #11 in 01-signals
    tier: 2,
    check: ({ f, th, cohort }) => {
      const c = f.counts;
      const open =
        (cohort === "mouse" || cohort === "mixed") &&
        c.centreSampled >= th.minCentreClicks &&
        c.centreSizes >= th.minCentreSizes;
      return gated(open, () =>
        c.centreHits === c.centreSampled
          ? `${ratio(c.centreHits, c.centreSampled)} clicks within 5% of centre`
          : false,
      );
    },
  },
  {
    id: "R9", // signal #8 in 01-signals
    tier: 2,
    check: ({ f, th }) =>
      tell(
        f.counts.orphanClicks >= th.minOrphanClicks,
        `${f.counts.orphanClicks} untrusted clicks with no pointerdown`,
      ),
  },
  {
    id: "R10", // signal modality in 01-signals
    tier: 2,
    check: ({ f }) => {
      const c = f.counts;
      const p = f.probes;
      if (c.touchEvents > 0 && p.maxTouchPoints === 0)
        return "touch events while maxTouchPoints is 0";
      return tell(
        c.touchEvents > 0 &&
          c.mouseEvents === 0 &&
          p.desktopUA === true &&
          p.pointerFine === true &&
          p.anyCoarse === false,
        "touch-only input on a fine-pointer desktop",
      );
    },
  },
  {
    id: "hidden-input", // signal #7 in 01-signals
    tier: 2,
    check: ({ f, th }) =>
      tell(
        f.counts.hiddenInputs >= th.minHiddenInputs,
        `${f.counts.hiddenInputs} trusted inputs while hidden`,
      ),
  },
  {
    id: "R8", // signal #3 in 01-signals
    tier: 2,
    corroborator: true,
    check: ({ f, th, cohort }) => {
      const c = f.counts;
      const heavyNav = c.navKeys >= th.heavyNavKeys && c.navKeys * 2 >= c.keys;
      const open = cohort !== "keyboard" && !heavyNav && c.actionGaps >= th.minCadenceGaps;
      return gated(open, () => {
        const v = cv(f.moments.actionGap);
        return share(c.cadenceGaps, c.actionGaps) >= th.cadenceShare &&
          v !== null &&
          v < th.cadenceCv &&
          c.stillGaps === c.cadenceGaps
          ? `${ratio(c.cadenceGaps, c.actionGaps)} gaps in 1.5-8 s, CV ${fixed(v)}, cursor still`
          : false;
      });
    },
  },
];

const SOFTWARE_GL = new Set(["swiftshader", "llvmpipe", "other-software"]);

export const PROFILES: readonly Profile[] = [
  {
    // A behavioural hit plus an automation prior from the runtime.
    agentClass: "A",
    matches: ({ f }) => f.probes.pointerMediaTell === true || f.probes.platformMismatch === true,
  },
  {
    // The reference computer-use harness: trusted events, its typing or wheel tell, and a VM.
    agentClass: "B",
    matches: (ctx, fired) => {
      const { f } = ctx;
      const trusted = f.counts.untrustedInputs === 0 && f.counts.untrustedClicks === 0;
      const tellFired =
        (fired.has("R4") && constantTyping(ctx)) || (fired.has("R6") && regularTicks(ctx));
      const vm = SOFTWARE_GL.has(f.probes.renderer ?? "") || f.probes.xgaDpr1 === true;
      return trusted && tellFired && vm;
    },
  },
];
