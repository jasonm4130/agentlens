import { describe, expect, it } from "vitest";
import { createDetectorWith } from "../src/detector";
import {
  COUNT_KEYS,
  emptyFeatures,
  FEATURES_VERSION,
  HIST_EDGES,
  MOMENT_CLAMP,
  PROBE_BOUNDS,
  validateFeatures,
  type Features,
} from "../src/features";
import { bucketRenderer, PROBES, rendererProbe, runProbes } from "../src/probes";
import { el, ev, fakeEnv, mouseClick, typeText } from "./helpers";

/** Walks every leaf and returns the paths of anything that is not a bounded, non-string value. */
function leaks(value: unknown, path = "features"): string[] {
  if (value === null || typeof value === "boolean") return [];
  if (typeof value === "number")
    return Number.isInteger(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER ? [] : [path];
  if (typeof value === "string")
    return path === "features.probes.renderer" ? [] : [`${path} (string)`];
  if (Array.isArray(value)) return value.flatMap((v, i) => leaks(v, `${path}[${i}]`));
  if (typeof value === "object")
    return Object.entries(value).flatMap(([k, v]) => leaks(v, `${path}.${k}`));
  return [`${path} (${typeof value})`];
}

describe("Features schema privacy", () => {
  // A session with distinctive coordinates, key values, field contents and URLs, none of which
  // may appear in what leaves the device.
  const SECRET = "hunter2-Ada-Lovelace-4111111111111111";
  function busySession(): Features {
    const env = fakeEnv();
    const d = createDetectorWith(env);
    const field = el({ value: "" });
    for (const e of mouseClick(1000, 1234.5, 987.25, {
      moves: 5,
      target: el({ rect: [1200, 950, 77, 33] }),
    }))
      env.fire(e);
    for (const e of typeText(5000, 30, () => 13, 3, field))
      env.fire({ ...e, key: "Q", code: "KeyQ" });
    field.value = SECRET;
    env.fire(
      ev({
        type: "input",
        timeStamp: 9000,
        target: field,
        inputType: "insertFromPaste",
        data: SECRET,
      }),
    );
    env.fire(ev({ type: "paste", timeStamp: 9001, target: field }));
    env.fire(ev({ type: "wheel", timeStamp: 9500, deltaY: 133.7 }));
    env.fire(ev({ type: "scroll", timeStamp: 15000 }));
    env.fire(ev({ type: "pagehide", timeStamp: 16000 }));
    const f = d.snapshot().features;
    d.destroy({ clear: true });
    return f;
  }

  it("every field is a bounded integer, histogram, boolean, null or closed enum", () => {
    const f = busySession();
    expect(leaks(f)).toEqual([]);
    expect(validateFeatures(f)).toEqual({ ok: true, features: f });
  });

  it("never carries coordinates, key values, field contents or sizes", () => {
    const json = JSON.stringify(busySession());
    for (const needle of [
      "1234",
      "987",
      "KeyQ",
      '"Q"',
      "hunter2",
      "Lovelace",
      "4111",
      "133.7",
      "77x33",
    ])
      expect(json).not.toContain(needle);
  });

  it("the schema declares no free-string field", () => {
    expect(
      Object.values(PROBE_BOUNDS).every(
        (b) => b === "bool" || b === "renderer" || Array.isArray(b),
      ),
    ).toBe(true);
    const f = emptyFeatures();
    expect(Object.keys(f.counts)).toEqual([...COUNT_KEYS]);
    expect(Object.keys(f.hist).sort()).toEqual(Object.keys(HIST_EDGES).sort());
    expect(Object.keys(f.moments).sort()).toEqual(Object.keys(MOMENT_CLAMP).sort());
  });
});

describe("validateFeatures", () => {
  const DELETE = Symbol("delete");
  /** Sets (or deletes) `features.<path>` on a copy of empty features and validates it. */
  const bad = (path: string, value: unknown, version = FEATURES_VERSION) => {
    const f = JSON.parse(JSON.stringify(emptyFeatures())) as Record<string, unknown>;
    const keys = path.split(".");
    const last = keys.pop() as string;
    let node = f;
    for (const k of keys) node = node[k] as Record<string, unknown>;
    if (value === DELETE) delete node[last];
    else node[last] = value;
    return validateFeatures(f, version);
  };

  it("accepts empty features and rejects a wrong version", () => {
    expect(validateFeatures(emptyFeatures()).ok).toBe(true);
    expect(bad("counts.keys", 0, FEATURES_VERSION - 1)).toEqual({
      ok: false,
      reason: `featuresVersion ${FEATURES_VERSION - 1} is not supported`,
    });
  });

  it.each([
    ["a free string in counts", "counts.keys", "Ada"],
    ["a negative count", "counts.keys", -1],
    ["a fractional count", "counts.keys", 1.5],
    ["an unbounded count", "counts.keys", 1e9],
    ["an extra key", "counts.clientX", 12],
    ["a missing key", "counts.keys", DELETE],
    ["a wrong-length histogram", "hist.interKey", [1, 2]],
    ["a coordinate pair", "hist.clickDwell", [[10, 20]]],
    ["a raw renderer string", "probes.renderer", "ANGLE (Apple M2)"],
    ["an out-of-range probe", "probes.maxTouchPoints", 1000],
    ["inconsistent moments", "moments.interKey", { n: 1, sum: 1e9, sumSq: 0 }],
    ["a non-boolean marker", "markers.claude", "yes"],
    ["a non-object section", "counts", null],
  ])("rejects %s", (_, path, value) => {
    expect(bad(path, value).ok).toBe(false);
  });
});

describe("one-shot probes", () => {
  const probe = (o: Parameters<typeof fakeEnv>[0]) => {
    const f = emptyFeatures();
    runProbes(fakeEnv(o), [...PROBES, rendererProbe], f.probes);
    return f.probes;
  };

  it("reports a stock desktop as clean", () => {
    expect(probe({})).toMatchObject({
      webdriver: false,
      webdriverOwn: false,
      headlessUA: false,
      platformMismatch: null,
      pointerMediaTell: false,
      renderer: "hardware",
      outerEqInner: false,
      availEqScreen: false,
      xgaDpr1: false,
      fwGlobals: false,
      tzQuarterHours: 40,
      maxTouchPoints: 0,
      desktopUA: true,
    });
  });

  it("buckets the renderer and never keeps the string", () => {
    expect(bucketRenderer("ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)))")).toBe(
      "swiftshader",
    );
    expect(bucketRenderer("llvmpipe (LLVM 15.0.7, 256 bits)")).toBe("llvmpipe");
    expect(bucketRenderer("Microsoft Basic Render Driver")).toBe("other-software");
    expect(bucketRenderer("Mesa Intel(R) UHD Graphics 620")).toBe("hardware");
    expect(bucketRenderer(null)).toBeNull();
  });

  it("flags the reference harness geometry and headless pointer media", () => {
    const p = probe({
      geometry: {
        screenW: 1024,
        screenH: 768,
        availW: 1024,
        availH: 768,
        outerW: 1024,
        outerH: 768,
        innerW: 1024,
        innerH: 768,
        dpr: 1,
      },
      media: { "(hover: hover)": false, "(pointer: fine)": false },
    });
    expect(p).toMatchObject({
      xgaDpr1: true,
      outerEqInner: true,
      availEqScreen: true,
      pointerMediaTell: true,
    });
  });

  it("compares Client Hints platform with the UA OS", () => {
    expect(probe({ nav: { userAgentData: { platform: "Linux" } } }).platformMismatch).toBe(true);
    expect(probe({ nav: { userAgentData: { platform: "macOS" } } }).platformMismatch).toBe(false);
  });

  it("degrades a missing or throwing API to null", () => {
    const env = fakeEnv({ geometry: null, renderer: null });
    env.media = () => {
      throw new Error("no matchMedia");
    };
    const f = emptyFeatures();
    runProbes(env, [...PROBES, rendererProbe], f.probes);
    expect(f.probes).toMatchObject({
      renderer: null,
      outerEqInner: null,
      pointerMediaTell: null,
      webdriver: false,
    });
  });
});
