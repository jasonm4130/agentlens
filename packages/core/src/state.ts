import { emptyFeatures, FEATURES_VERSION } from "./features";
import type { Features } from "./types";

const KEY = "al:v1";

export interface SessionState {
  v: number;
  sessionId: string;
  seq: number;
  pageCount: number;
  features: Features;
}

export function randomId(): string {
  const bytes = new Uint8Array(16);
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function freshState(): SessionState {
  return {
    v: FEATURES_VERSION,
    sessionId: randomId(),
    seq: 0,
    pageCount: 1,
    features: emptyFeatures(),
  };
}

function sessionStore(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** Restores a stored session (counting this page), or starts one on a miss or version mismatch. */
export function loadState(storage: "session" | "memory"): SessionState {
  if (storage === "session") {
    try {
      const raw = sessionStore()?.getItem(KEY);
      if (raw) {
        const s = JSON.parse(raw) as SessionState;
        if (s.v === FEATURES_VERSION && typeof s.sessionId === "string") {
          s.pageCount = Math.min(s.pageCount + 1, 65535);
          return s;
        }
      }
    } catch {
      // fall through to a new in-memory session
    }
  }
  return freshState();
}

export function saveState(state: SessionState, storage: "session" | "memory"): void {
  if (storage !== "session") return;
  try {
    sessionStore()?.setItem(KEY, JSON.stringify(state));
  } catch {
    // storage errors fall back to memory silently
  }
}

export function clearState(): void {
  try {
    sessionStore()?.removeItem(KEY);
  } catch {
    // ignore
  }
}
