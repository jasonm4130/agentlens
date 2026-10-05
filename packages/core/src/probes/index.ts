import type { Env } from "../env";
import { RENDERERS, type Probes, type Renderer } from "../features";

/** One-shot check. Returns only the fields it owns; a missing API leaves them `null`. */
export type Probe = (env: Env) => Partial<Probes>;

const FW_GLOBAL = /^(__playwright|__pwInitScripts|\$?cdc_|__selenium_|__webdriver_|domAutomation)/;
const SOFTWARE_GL = /softpipe|svga3d|virtualbox|basic render|software|vmware/;
/** XGA and WXGA, the reference computer-use harness sizes, plus 1280x720 under a Mac UA. */
const HARNESS_SCREENS = ["1024x768", "1280x800"];

function uaOs(ua: string): string | null {
  if (/Android/.test(ua)) return "Android";
  if (/CrOS/.test(ua)) return "Chrome OS";
  if (/Windows/.test(ua)) return "Windows";
  if (/iPhone|iPad|iPod/.test(ua)) return "iOS";
  if (/Mac OS X|Macintosh/.test(ua)) return "macOS";
  if (/Linux/.test(ua)) return "Linux";
  return null;
}

export function bucketRenderer(r: string | null): Renderer | null {
  if (r === null) return null;
  const s = r.toLowerCase();
  if (s.includes("swiftshader")) return RENDERERS[1];
  if (s.includes("llvmpipe")) return RENDERERS[2];
  return SOFTWARE_GL.test(s) ? RENDERERS[3] : RENDERERS[0];
}

/** #13 */
const webdriver: Probe = (env) => ({
  webdriver: env.nav.webdriver === true,
  webdriverOwn: env.ownWebdriver(),
});

/** #14, #15 and the modality-coherence inputs for R10. */
const userAgent: Probe = (env) => {
  const ua = env.nav.userAgent;
  if (typeof ua !== "string") return {};
  const desktopUA = !/Mobi|Android|iPhone|iPad|iPod/.test(ua);
  const os = uaOs(ua);
  const hintOs = env.nav.userAgentData?.platform;
  const hover = env.media("(hover: hover)");
  const fine = env.media("(pointer: fine)");
  const points = env.nav.maxTouchPoints;
  return {
    headlessUA: /HeadlessChrome/.test(ua),
    platformMismatch: hintOs && os ? hintOs !== os : null,
    desktopUA,
    pointerMediaTell: hover === null || fine === null ? null : desktopUA && !(hover && fine),
    pointerFine: fine,
    anyCoarse: env.media("(any-pointer: coarse)"),
    maxTouchPoints: typeof points === "number" ? Math.min(Math.max(points, 0), 64) : null,
  };
};

/** #18 */
const geometry: Probe = (env) => {
  const g = env.geometry();
  if (!g) return {};
  const mac = /Macintosh/.test(env.nav.userAgent ?? "");
  const size = `${g.screenW}x${g.screenH}`;
  return {
    outerEqInner: g.outerW === g.innerW && g.outerH === g.innerH,
    availEqScreen: g.availW === g.screenW && g.availH === g.screenH,
    xgaDpr1: g.dpr === 1 && (HARNESS_SCREENS.includes(size) || (mac && size === "1280x720")),
  };
};

/** #21 */
const frameworkGlobals: Probe = (env) => ({
  fwGlobals: env.globals().some((name) => FW_GLOBAL.test(name)),
});

/** #20, attribution only. */
const timezone: Probe = (env) => {
  const m = env.tzOffset();
  return { tzQuarterHours: m === null ? null : Math.min(Math.max(Math.round(m / 15), -64), 64) };
};

/** Cheap probes, run at init. */
export const PROBES: readonly Probe[] = [
  webdriver,
  userAgent,
  geometry,
  frameworkGlobals,
  timezone,
];

/**
 * #17 creates a WebGL context, so the detector runs it only once Tier 2 reaches an agent
 * label (it feeds the class-B profile alone); `renderer` stays null until then.
 */
export const rendererProbe: Probe = (env) => ({ renderer: bucketRenderer(env.renderer()) });

export function runProbes(env: Env, probes: readonly Probe[], into: Probes): void {
  for (const probe of probes) {
    try {
      Object.assign(into, probe(env));
    } catch {
      // A probe that throws leaves its fields null.
    }
  }
}
