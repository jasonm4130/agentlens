/**
 * The narrow slice of the browser the detector touches. Extractors, probes, state and the
 * detector read the page only through this, so tests can pass a plain object instead of
 * relying on globals. Every accessor degrades to `null` (or `false`) rather than throwing.
 */
export interface Env {
  /** Where listeners attach (the window). */
  readonly target: Pick<EventTarget, "addEventListener" | "removeEventListener">;
  visibility(): string;
  /** True when any element matches `selector`; false on no match or an invalid selector. */
  matches(selector: string): boolean;
  readonly nav: NavigatorLike;
  /** Whether `webdriver` is an own property of the navigator object (a stealth patch). */
  ownWebdriver(): boolean;
  media(query: string): boolean | null;
  geometry(): Geometry | null;
  /** Own property names of the window and document, for framework-global leaks (#21). */
  globals(): string[];
  /** Unmasked WebGL renderer string; read on device and bucketed, never stored. */
  renderer(): string | null;
  /** Minutes east of UTC. */
  tzOffset(): number | null;
  storage(): Storage | null;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
  randomBytes(out: Uint8Array<ArrayBuffer>): void;
}

export interface NavigatorLike {
  userAgent?: string;
  webdriver?: boolean;
  maxTouchPoints?: number;
  globalPrivacyControl?: boolean;
  userAgentData?: { platform?: string } | null;
}

export interface Geometry {
  screenW: number;
  screenH: number;
  availW: number;
  availH: number;
  outerW: number;
  outerH: number;
  innerW: number;
  innerH: number;
  dpr: number;
}

function attempt<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

/** The smallest context there is: no buffers beyond colour, no antialiasing, low power GPU. */
const GL_ATTRS: WebGLContextAttributes = {
  alpha: false,
  antialias: false,
  depth: false,
  stencil: false,
  powerPreference: "low-power",
};

function readRenderer(doc: Document): string | null {
  const canvas = doc.createElement("canvas");
  canvas.width = canvas.height = 1;
  const gl = canvas.getContext("webgl", GL_ATTRS);
  if (!gl) return null;
  const ext = gl.getExtension("WEBGL_debug_renderer_info");
  const r = gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) as unknown;
  gl.getExtension("WEBGL_lose_context")?.loseContext();
  return typeof r === "string" ? r : null;
}

/** The real browser environment. Only call where `window` exists. */
export function browserEnv(win: Window = window): Env {
  const doc = win.document;
  return {
    target: win,
    visibility: () => doc.visibilityState,
    matches: (s) => attempt(() => doc.querySelector(s) !== null, false),
    nav: win.navigator as NavigatorLike,
    ownWebdriver: () =>
      attempt(
        () => Object.getOwnPropertyDescriptor(win.navigator, "webdriver") !== undefined,
        false,
      ),
    media: (q) => attempt(() => win.matchMedia(q).matches, null),
    geometry: () =>
      attempt(
        () => ({
          screenW: win.screen.width,
          screenH: win.screen.height,
          availW: win.screen.availWidth,
          availH: win.screen.availHeight,
          outerW: win.outerWidth,
          outerH: win.outerHeight,
          innerW: win.innerWidth,
          innerH: win.innerHeight,
          dpr: win.devicePixelRatio,
        }),
        null,
      ),
    globals: () =>
      attempt(() => [...Object.getOwnPropertyNames(win), ...Object.getOwnPropertyNames(doc)], []),
    renderer: () => attempt(() => readRenderer(doc), null),
    tzOffset: () => attempt(() => -new Date().getTimezoneOffset(), null),
    storage: () => attempt(() => win.sessionStorage, null),
    setTimeout: (fn, ms) => win.setTimeout(fn, ms),
    clearTimeout: (id) => win.clearTimeout(id as number),
    // In every browser the ES2020 target covers, secure context or not.
    randomBytes: (out) => {
      win.crypto.getRandomValues(out);
    },
  };
}

/** Drops selectors that do not parse (`s,*` always matches when `s` is valid). */
export function validSelectors(env: Env, list: readonly string[]): string[] {
  return list.filter((s) => typeof s === "string" && s.trim() !== "" && env.matches(`${s},*`));
}
