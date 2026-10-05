/**
 * Writes the ground-truth label for a run that no script drives (human, computer-use-demo,
 * Claude in Chrome). Usage:
 *   pnpm --filter @agentlens/recorder label --run=h-P01-mouse-1 --generator=human \
 *     --cohort=mouse --participant=P01
 *   pnpm --filter @agentlens/recorder label --run=cic-1 --generator=claude-in-chrome
 */
import { parseArgs } from "node:util";
import { type Generator, type HumanCohort, writeLabel } from "./label";
import { OUT_DIR } from "./mounts";

const { values } = parseArgs({
  options: {
    run: { type: "string" },
    generator: { type: "string" },
    config: { type: "string" },
    cohort: { type: "string" },
    participant: { type: "string" },
    task: { type: "string" },
    group: { type: "string" },
  },
});

try {
  const label = writeLabel(OUT_DIR, {
    run: values.run ?? "",
    generator: (values.generator ?? "") as Generator,
    ...(values.config ? { config: values.config } : {}),
    ...(values.cohort ? { cohort: values.cohort as HumanCohort } : {}),
    ...(values.participant ? { participant: values.participant } : {}),
    ...(values.task ? { task: values.task } : {}),
    ...(values.group ? { group: values.group } : {}),
  });
  console.log(`labelled ${label.run}: ${JSON.stringify(label)}`);
} catch (err) {
  console.error((err as Error).message);
  process.exitCode = 2;
}
