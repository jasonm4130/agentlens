import { attachCollector, listen } from "./collector";
import { createEmitter } from "./emitter";
import { browserEnv, type Env } from "./env";
import { EXTRACTORS, instantiate } from "./extractors";
import { markerCheck } from "./extractors/markers";
import { emptyFeatures, emptyProbes, FEATURES_VERSION } from "./features";
import { PROBES, rendererProbe, runProbes } from "./probes";
import { RULESET } from "./scorer/ruleset";
import { score, type Scored } from "./scorer/score";
import { clearState, loadState, saveState } from "./state";
import type { Detector, DetectorOptions, Label, Mode, Signal, Verdict } from "./types";

/** Labels that never trigger a `label-change` verdict, so consumers are not spammed early. */
const QUIET: ReadonlySet<Label> = new Set<Label>(["insufficient-data", "abstain"]);
/** Continuous activity still re-scores this often, though the debounce never goes quiet. */
const MAX_WAIT_MS = 10000;

let instance: Detector | null = null;

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const keyOf = (s: Scored): string => `${s.label}/${s.agentClass ?? ""}`;

function inertDetector(): Detector {
  return {
    on: () => () => {},
    snapshot: () => ({
      label: "abstain",
      confidence: "low",
      evidence: [{ rule: "ssr", detail: "no window" }],
      cohort: "none",
      mode: "full",
      features: emptyFeatures(),
      featuresVersion: FEATURES_VERSION,
      rulesetVersion: RULESET.version,
      sessionId: "0".repeat(32),
      seq: 0,
      reason: "snapshot",
    }),
    destroy: () => {},
  };
}

/**
 * Returns the page's detector. Calling it again returns the same instance until `destroy`,
 * so a framework re-render cannot double-count. On the server it returns an inert detector
 * whose snapshot abstains with rule `ssr`.
 */
export function createDetector(options: DetectorOptions = {}): Detector {
  if (typeof window === "undefined" || typeof document === "undefined") return inertDetector();
  instance ??= createDetectorWith(browserEnv(), options, () => {
    instance = null;
  });
  return instance;
}

/** The detector over an injected environment; `createDetector` passes the real browser. */
export function createDetectorWith(
  env: Env,
  options: DetectorOptions = {},
  onDestroy: () => void = () => {},
): Detector {
  const minActions = options.minActions ?? 3;
  const debounceMs = options.scoreDebounceMs ?? 1000;
  const gpc = options.respectGPC !== false && env.nav.globalPrivacyControl === true;
  const mode: Mode = gpc || options.minimal ? "minimal" : "full";
  const storage = gpc || options.storage === "memory" ? "memory" : "session";

  const state = loadState(env, storage);
  // A minimal page scores probes and markers only, and leaves stored behavioural features alone.
  const features = mode === "minimal" ? emptyFeatures() : state.features;
  features.probes = emptyProbes();
  runProbes(env, PROBES, features.probes);
  const checkMarkers = markerCheck(env, RULESET, options.extraMarkers ?? []);
  checkMarkers(features);

  const emitter = createEmitter<{ verdict: Verdict; signal: Signal }>();
  let timer: unknown;
  /** First and latest actions not yet scored, and the action the timer was set from. */
  let firstAt: number | null = null;
  let lastAt = 0;
  let armedAt = 0;
  let flushed = false;

  let glProbed = false;
  /**
   * Scores the features. #17 needs a WebGL context (milliseconds of main thread), and only
   * the class-B profile reads it, so it is probed the first time Tier 2 reaches an agent
   * label and the session is re-scored; most human sessions never pay for it.
   */
  const scoreOpts = { mode, gpc, minActions };
  const run = (): Scored => {
    const s = score(features, RULESET, scoreOpts);
    if (glProbed || s.tells.length > 0 || !s.label.startsWith("agent")) return s;
    glProbed = true;
    runProbes(env, [rendererProbe], features.probes);
    return score(features, RULESET, scoreOpts);
  };

  const build = ({ actions: _a, tells: _t, ...s }: Scored, reason: Verdict["reason"]): Verdict => ({
    ...s,
    mode,
    features: clone(features),
    featuresVersion: FEATURES_VERSION,
    rulesetVersion: RULESET.version,
    sessionId: state.sessionId,
    seq: state.seq,
    reason,
  });

  /** Fires `'signal'` once per Tier 1 rule per session. */
  const announce = (s: Scored): void => {
    for (const t of s.tells) {
      if (state.signalled.includes(t.rule)) continue;
      state.signalled.push(t.rule);
      const sig: Signal = { rule: t.rule, detail: t.detail, sessionId: state.sessionId };
      if (t.agentClass) sig.agentClass = t.agentClass;
      emitter.emit("signal", sig);
    }
  };

  const emitVerdict = (s: Scored, reason: "flush" | "label-change"): void => {
    state.seq++;
    state.last = keyOf(s);
    const v = build(s, reason);
    saveState(env, state, storage);
    emitter.emit("verdict", v);
  };

  const cancel = (): void => {
    if (timer !== undefined) env.clearTimeout(timer);
    timer = undefined;
    firstAt = null;
  };

  const rescore = (): void => {
    cancel();
    const s = run();
    announce(s);
    if (!QUIET.has(s.label) && keyOf(s) !== state.last) emitVerdict(s, "label-change");
  };

  /**
   * Debounce without a timer per action: when the timer fires, any action since it was set
   * pushes it back by the difference, so scoring waits for `debounceMs` of quiet.
   */
  const quiet = (): void => {
    timer = undefined;
    if (lastAt <= armedAt) return rescore();
    timer = env.setTimeout(quiet, lastAt - armedAt);
    armedAt = lastAt;
  };

  const flush = (): void => {
    checkMarkers(features);
    if (flushed) return saveState(env, state, storage);
    flushed = true;
    cancel();
    const s = run();
    announce(s);
    emitVerdict(s, "flush");
  };

  const detachFlush = listen(env, [
    ["visibilitychange", () => env.visibility() === "hidden" && flush()],
    ["pagehide", flush],
  ]);
  const detachInput =
    mode === "minimal"
      ? () => {}
      : attachCollector(
          env,
          features,
          instantiate(EXTRACTORS, { env, checkMarkers }),
          options.ignore ?? [],
          {
            onAction: (t) => {
              lastAt = t;
              firstAt ??= t;
              if (t - firstAt >= MAX_WAIT_MS) return rescore();
              if (timer !== undefined) return;
              armedAt = t;
              timer = env.setTimeout(quiet, debounceMs);
            },
            onTell: rescore,
          },
        );

  // A first score once the caller has subscribed, so init-time tells reach `'signal'` listeners.
  let initTimer: unknown = env.setTimeout(() => {
    initTimer = undefined;
    rescore();
  }, 0);

  return {
    on(event: "verdict" | "signal", cb: never): () => void {
      return emitter.on(event, cb);
    },
    snapshot: () => build(run(), "snapshot"),
    destroy(opts) {
      detachFlush();
      detachInput();
      cancel();
      if (initTimer !== undefined) env.clearTimeout(initTimer);
      emitter.clear();
      if (opts?.clear) clearState(env);
      else saveState(env, state, storage);
      onDestroy();
    },
  };
}
