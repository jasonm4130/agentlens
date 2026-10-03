import { attach, attachFlush } from "./collector";
import { emptyTransient } from "./extractors/transient";
import { FEATURES_VERSION, emptyFeatures } from "./features";
import { RULESET, score, type Scored } from "./scorer";
import { clearState, freshState, loadState, saveState, type SessionState } from "./state";
import type { Detector, DetectorOptions, Signal, Verdict } from "./types";

let instance: Detector | null = null;

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function inertDetector(): Detector {
  const state = freshState();
  const features = emptyFeatures();
  return {
    on: () => () => {},
    snapshot: () => ({
      label: "abstain",
      confidence: "low",
      evidence: [{ rule: "ssr", detail: "no window" }],
      cohort: "none",
      mode: "full",
      features,
      featuresVersion: FEATURES_VERSION,
      rulesetVersion: RULESET.version,
      sessionId: state.sessionId,
      seq: 0,
      reason: "snapshot",
    }),
    destroy: () => {},
  };
}

/** Returns the page's detector; on the server it returns an inert one that abstains. */
export function createDetector(options: DetectorOptions = {}): Detector {
  if (typeof window === "undefined" || typeof document === "undefined") return inertDetector();
  if (instance) return instance;

  const minActions = options.minActions ?? 3;
  const debounceMs = options.scoreDebounceMs ?? 1000;
  const gpc =
    options.respectGPC !== false &&
    (navigator as { globalPrivacyControl?: boolean }).globalPrivacyControl === true;
  const mode: "full" | "minimal" = gpc || options.minimal ? "minimal" : "full";
  const storage: "session" | "memory" = gpc || options.storage === "memory" ? "memory" : "session";

  const state: SessionState = loadState(storage);
  const features = mode === "minimal" ? emptyFeatures() : state.features;
  const persist = () => {
    if (mode === "full") saveState(state, storage);
  };
  const tr = emptyTransient();
  const verdictCbs = new Set<(v: Verdict) => void>();
  const signalCbs = new Set<(s: Signal) => void>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let flushed = false;

  const run = (): Scored => score(features, RULESET, { mode, gpc, minActions });
  const key = (s: Scored) => `${s.label}/${s.agentClass ?? ""}`;
  let lastKey = key(run());

  const build = (s: Scored, reason: Verdict["reason"]): Verdict => ({
    label: s.label,
    ...(s.agentClass ? { agentClass: s.agentClass } : {}),
    confidence: s.confidence,
    evidence: s.evidence,
    cohort: s.cohort,
    mode,
    features: clone(features),
    featuresVersion: FEATURES_VERSION,
    rulesetVersion: RULESET.version,
    sessionId: state.sessionId,
    seq: state.seq,
    reason,
  });

  const emit = (s: Scored, reason: "flush" | "label-change") => {
    state.seq++;
    const v = build(s, reason);
    persist();
    for (const cb of verdictCbs) cb(v);
  };

  const flush = () => {
    if (flushed) {
      persist();
      return;
    }
    flushed = true;
    emit(run(), "flush");
  };

  const rescore = () => {
    timer = undefined;
    const s = run();
    if (key(s) !== lastKey) {
      lastKey = key(s);
      emit(s, "label-change");
    }
  };

  const detachFlush = attachFlush(window, flush);
  const detachInput =
    mode === "minimal"
      ? () => {}
      : attach(window, features, tr, options.ignore ?? [], () => {
          if (timer === undefined) timer = setTimeout(rescore, debounceMs);
        });

  const detector: Detector = {
    on(event: "verdict" | "signal", cb: never): () => void {
      const set = (event === "verdict" ? verdictCbs : signalCbs) as Set<unknown>;
      set.add(cb);
      return () => void set.delete(cb);
    },
    snapshot: () => build(run(), "snapshot"),
    destroy(opts) {
      detachFlush();
      detachInput();
      if (timer !== undefined) clearTimeout(timer);
      verdictCbs.clear();
      signalCbs.clear();
      if (opts?.clear) clearState();
      instance = null;
    },
  };
  instance = detector;
  return detector;
}
