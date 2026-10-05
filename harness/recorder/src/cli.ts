import { fixtureMounts, OUT_DIR } from "./mounts";
import { startRecorder } from "./server";

const rec = await startRecorder({
  outDir: OUT_DIR,
  mounts: fixtureMounts(),
  port: Number(process.env.PORT ?? 8787),
  ...(process.env.HOST ? { host: process.env.HOST } : {}),
});
console.log(
  `recorder + fixture on ${rec.url}/?run=<id>  (records to harness/recorder/out/<id>.jsonl)`,
);
console.log("add &baselines=1 to also record the BotD and agent-detector baselines");
