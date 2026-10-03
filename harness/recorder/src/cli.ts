import { fileURLToPath } from "node:url";
import { startRecorder } from "./server";

const root = (p: string) => fileURLToPath(new URL(`../../../${p}`, import.meta.url));

const rec = await startRecorder({
  outDir: root("harness/recorder/out"),
  mounts: { "/lib": root("packages/core/dist"), "/": root("apps/fixture") },
  port: Number(process.env.PORT ?? 8787),
});
console.log(
  `recorder + fixture on ${rec.url}/?run=<id>  (records to harness/recorder/out/<id>.jsonl)`,
);
