import { defineConfig } from "tsdown";

const entry = { agentlens: "src/index.ts" };

export default defineConfig([
  {
    entry,
    format: "esm",
    platform: "browser",
    target: "es2020",
    dts: true,
    clean: false,
    minify: true,
    outExtensions: () => ({ js: ".mjs", dts: ".d.ts" }),
  },
  {
    entry,
    format: "iife",
    globalName: "agentlens",
    platform: "browser",
    target: "es2020",
    dts: false,
    clean: false,
    minify: true,
  },
]);
