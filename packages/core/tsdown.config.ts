import { defineConfig, type UserConfig } from "tsdown";

const shared = {
  platform: "browser",
  target: "es2020",
  clean: false,
  minify: true,
  // Pure annotations only help a downstream bundler, and these files are vendored as is.
  outputOptions: { comments: false },
} as const;

// One build per entry, so agentlens.mjs and scorer.mjs are each a single self-contained
// file a consumer can vendor, with no shared chunk.
const esm = (name: string, entry: string): UserConfig => ({
  ...shared,
  entry: { [name]: entry },
  format: "esm",
  dts: true,
  outExtensions: () => ({ js: ".mjs", dts: ".d.ts" }),
});

const config: UserConfig[] = defineConfig([
  esm("agentlens", "src/index.ts"),
  esm("scorer", "src/scorer/index.ts"),
  {
    ...shared,
    entry: { agentlens: "src/index.ts" },
    format: "iife",
    globalName: "agentlens",
    dts: false,
  },
]);

export default config;
