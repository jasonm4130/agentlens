import type { Env } from "./env";
import {
  COUNT_MAX,
  emptyFeatures,
  FEATURES_VERSION,
  validateFeatures,
  type Features,
} from "./features";

const KEY = "al:v1";

export type StorageMode = "session" | "memory";

export interface SessionState {
  v: number;
  sessionId: string;
  seq: number;
  pageCount: number;
  features: Features;
  /** Last emitted `label/class`, so a new page does not re-announce an unchanged label. */
  last: string;
  /** Tier 1 rules already announced as `'signal'` this session. */
  signalled: string[];
}

export function randomId(env: Env): string {
  const bytes = new Uint8Array(16);
  env.randomBytes(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function freshState(env: Env): SessionState {
  return {
    v: FEATURES_VERSION,
    sessionId: randomId(env),
    seq: 0,
    pageCount: 1,
    features: emptyFeatures(),
    last: "",
    signalled: [],
  };
}

const isCount = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= Number.MAX_SAFE_INTEGER;

/** Restores a stored session (counting this page), or starts one on a miss, mismatch or bad data. */
export function loadState(env: Env, storage: StorageMode): SessionState {
  if (storage === "session") {
    try {
      const raw = env.storage()?.getItem(KEY);
      const s = raw ? (JSON.parse(raw) as Partial<SessionState>) : null;
      if (
        s &&
        s.v === FEATURES_VERSION &&
        typeof s.sessionId === "string" &&
        /^[0-9a-f]{32}$/.test(s.sessionId) &&
        isCount(s.seq) &&
        isCount(s.pageCount) &&
        typeof s.last === "string" &&
        Array.isArray(s.signalled) &&
        validateFeatures(s.features).ok
      ) {
        const state = s as SessionState;
        state.pageCount = Math.min(state.pageCount + 1, COUNT_MAX);
        return state;
      }
    } catch {
      // fall through to a new session
    }
  }
  return freshState(env);
}

export function saveState(env: Env, state: SessionState, storage: StorageMode): void {
  if (storage !== "session") return;
  try {
    env.storage()?.setItem(KEY, JSON.stringify(state));
  } catch {
    // storage errors fall back to memory silently
  }
}

export function clearState(env: Env): void {
  try {
    env.storage()?.removeItem(KEY);
  } catch {
    // ignore
  }
}
