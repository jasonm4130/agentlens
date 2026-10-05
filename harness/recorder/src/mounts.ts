import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = (p: string) => fileURLToPath(new URL(`../../../${p}`, import.meta.url));
const packageDir = (spec: string) => dirname(fileURLToPath(import.meta.resolve(spec)));

/**
 * What the recorder serves for the fixture: the built library at `/lib`, the two baseline
 * detectors (architecture 7.4) at `/baselines/*` straight from their published packages, and
 * the static fixture pages at `/`. The baselines load only when the page has `?baselines=1`.
 */
export function fixtureMounts(): Record<string, string> {
  return {
    "/lib": root("packages/core/dist"),
    "/baselines/botd": packageDir("@fingerprintjs/botd"),
    "/baselines/agent-detector": packageDir("@doubleagent-so/agent-detector"),
    "/": root("apps/fixture"),
  };
}

/** Where every runner writes its JSONL, and where `eval.py` reads by default. */
export const OUT_DIR: string = root("harness/recorder/out");
