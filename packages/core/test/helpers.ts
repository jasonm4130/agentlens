import { attachCollector } from "../src/collector";
import type { Env, Geometry, NavigatorLike } from "../src/env";
import { EXTRACTORS, instantiate } from "../src/extractors";
import type { Ev, EvTarget, Extractor, Sink, Transient } from "../src/extractors/extractor";
import { markerCheck } from "../src/extractors/markers";
import { emptyFeatures, type Features } from "../src/features";
import { PROBES, rendererProbe, runProbes } from "../src/probes";
import { RULESET } from "../src/scorer/ruleset";
import { score, type ScoreOptions, type Scored } from "../src/scorer/score";

export const MAC_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
export const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

type Listener = (e: Event) => void;

export interface FakeEnv extends Env {
  /** Dispatches a plain event object to the listeners, as the browser would. */
  fire(e: Ev): void;
  setVisibility(v: "visible" | "hidden"): void;
  /** Runs pending timers (in order); returns how many ran. */
  runTimers(): number;
  listenerCount(): number;
  pendingTimers(): number;
  store: Map<string, string>;
  /** Selectors that currently match; mutate to add or remove page markers. */
  present: Set<string>;
}

export interface FakeEnvOptions {
  nav?: NavigatorLike;
  media?: Record<string, boolean | null>;
  geometry?: Geometry | null;
  globals?: string[];
  renderer?: string | null;
  /** Selectors that match an element on the page. */
  present?: string[];
  ownWebdriver?: boolean;
  storage?: "ok" | "none" | "throws";
}

const DESKTOP_GEOMETRY: Geometry = {
  screenW: 1512,
  screenH: 982,
  availW: 1512,
  availH: 944,
  outerW: 1400,
  outerH: 900,
  innerW: 1400,
  innerH: 790,
  dpr: 2,
};

/** A desktop Mac with a hardware GPU unless overridden. No globals, no DOM. */
export function fakeEnv(o: FakeEnvOptions = {}): FakeEnv {
  const listeners = new Map<string, Set<Listener>>();
  const timers = new Map<number, () => void>();
  let nextTimer = 1;
  let vis = "visible";
  const store = new Map<string, string>();
  const media: Record<string, boolean | null> = {
    "(hover: hover)": true,
    "(pointer: fine)": true,
    "(any-pointer: coarse)": false,
    ...o.media,
  };
  const storage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  } as unknown as Storage;
  const present = new Set(o.present ?? []);
  return {
    target: {
      addEventListener(type: string, fn: unknown) {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type)?.add(fn as Listener);
      },
      removeEventListener(type: string, fn: unknown) {
        listeners.get(type)?.delete(fn as Listener);
      },
    },
    visibility: () => vis,
    matches: (s) => {
      if (s.includes("[")) {
        const open = (s.match(/\[/g) ?? []).length;
        const close = (s.match(/]/g) ?? []).length;
        if (open !== close) return false;
      }
      if (s.endsWith(",*")) return true;
      return s.split(",").some((part) => present.has(part.trim()));
    },
    nav: { userAgent: MAC_UA, webdriver: false, maxTouchPoints: 0, ...o.nav },
    ownWebdriver: () => o.ownWebdriver ?? false,
    media: (q) => media[q] ?? null,
    geometry: () => (o.geometry === undefined ? DESKTOP_GEOMETRY : o.geometry),
    globals: () => o.globals ?? ["document", "location", "navigator"],
    renderer: () => (o.renderer === undefined ? "ANGLE (Apple, Apple M2, OpenGL 4.1)" : o.renderer),
    tzOffset: () => 600,
    storage: () => {
      if (o.storage === "none") return null;
      if (o.storage === "throws") throw new Error("SecurityError");
      return storage;
    },
    setTimeout: (fn) => {
      const id = nextTimer++;
      timers.set(id, fn);
      return id;
    },
    clearTimeout: (id) => void timers.delete(id as number),
    randomBytes: (out) => crypto.getRandomValues(out),
    fire(e) {
      for (const fn of Array.from(listeners.get(e.type) ?? [])) fn(e as unknown as Event);
    },
    setVisibility(v) {
      vis = v;
    },
    runTimers() {
      let ran = 0;
      for (const [id, fn] of Array.from(timers)) {
        timers.delete(id);
        fn();
        ran++;
      }
      return ran;
    },
    listenerCount: () => [...listeners.values()].reduce((n, s) => n + s.size, 0),
    pendingTimers: () => timers.size,
    store,
    present,
  };
}

export const ev = (e: Partial<Ev> & Pick<Ev, "type" | "timeStamp">): Ev => ({
  isTrusted: true,
  ...e,
});

/** A stand-in element. Identity is what the extractors key on. */
export function el(
  props: Partial<EvTarget> & { rect?: [number, number, number, number] } = {},
): EvTarget {
  const { rect, ...rest } = props;
  const [left, top, width, height] = rect ?? [0, 0, 100, 40];
  return {
    closest: () => null,
    getBoundingClientRect: () => ({ left, top, width, height }),
    ...rest,
  };
}

/** Folds events through one extractor with a recording sink. */
export interface Folded {
  actions: number[];
  tells: () => number;
}

export function fold(x: Extractor, f: Features, tr: Transient, ...events: Ev[]): Folded {
  const actions: number[] = [];
  let tells = 0;
  const sink: Sink = { action: (t) => void actions.push(t), tell: () => void tells++ };
  for (const e of events) x.fold(f, tr, e, sink);
  return { actions, tells: () => tells };
}

/**
 * A full page session: probes, markers and every registered extractor wired through the
 * real collector on a fake env. `events` are dispatched in order; returns the features and
 * a scorer for them.
 */
export interface Session {
  f: Features;
  env: FakeEnv;
  score(o?: ScoreOptions): Scored;
}

export function session(events: Ev[], options: FakeEnvOptions = {}): Session {
  const env = fakeEnv(options);
  const f = emptyFeatures();
  runProbes(env, [...PROBES, rendererProbe], f.probes);
  const checkMarkers = markerCheck(env, RULESET, []);
  checkMarkers(f);
  attachCollector(env, f, instantiate(EXTRACTORS, { env, checkMarkers }), [], {
    onAction: () => {},
    onTell: () => {},
  });
  for (const e of events) {
    if (e.type === "visibilitychange")
      env.setVisibility(e.data === "hidden" ? "hidden" : "visible");
    env.fire(e);
  }
  return { f, env, score: (o: ScoreOptions = {}): Scored => score(f, RULESET, o) };
}

// Event script builders, all trusted unless noted.

export function mouseClick(
  t: number,
  x: number,
  y: number,
  o: { moves?: number; dwell?: number; target?: EvTarget; fromX?: number; fromY?: number } = {},
): Ev[] {
  const moves = o.moves ?? 1;
  const target = o.target ?? el();
  const out: Ev[] = [];
  const fromX = o.fromX ?? x;
  const fromY = o.fromY ?? y;
  // `moves` points along a straight path ending on the target, 8 ms apart.
  for (let i = 1; i <= moves; i++) {
    const k = i / moves;
    out.push(
      ev({
        type: "pointermove",
        timeStamp: t - (moves - i + 1) * 8,
        pointerType: "mouse",
        clientX: Math.round(fromX + (x - fromX) * k),
        clientY: Math.round(fromY + (y - fromY) * k),
        buttons: 0,
        target,
      }),
    );
  }
  if (moves > 0) out.push(ev({ type: "mouseover", timeStamp: t - 4, target }));
  const p = { pointerType: "mouse", clientX: x, clientY: y, button: 0, target };
  out.push(ev({ type: "pointerdown", timeStamp: t, ...p }));
  out.push(ev({ type: "pointerup", timeStamp: t + (o.dwell ?? 90), ...p }));
  out.push(ev({ type: "click", timeStamp: t + (o.dwell ?? 90) + 1, detail: 1, target }));
  return out;
}

export function typeText(
  t0: number,
  n: number,
  gap: (i: number) => number,
  hold = 60,
  target: EvTarget = el({ value: "" }),
): Ev[] {
  const out: Ev[] = [];
  let t = t0;
  for (let i = 0; i < n; i++) {
    const code = `Key${String.fromCharCode(65 + (i % 26))}`;
    out.push(ev({ type: "keydown", timeStamp: t, key: "a", code, target }));
    out.push(ev({ type: "keyup", timeStamp: t + hold, key: "a", code, target }));
    t += gap(i);
  }
  return out;
}

export function wheelTicks(
  t0: number,
  n: number,
  dt: (i: number) => number,
  delta: (i: number) => number,
): Ev[] {
  const out: Ev[] = [];
  let t = t0;
  for (let i = 0; i < n; i++) {
    out.push(ev({ type: "wheel", timeStamp: t, deltaY: delta(i), deltaMode: 0 }));
    t += dt(i);
  }
  return out;
}

/** A deterministic pseudo-random sequence for human-like jitter. */
export function jitter(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}
