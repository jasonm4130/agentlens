import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { validRunId } from "./server";

/**
 * Ground truth for one harness run, written as a `{"kind":"label"}` line into the run's JSONL
 * next to the verdicts the page recorded. The eval (`eval/eval.py`) reads truth only from these
 * lines, never from the page, so a run without one is left out of every metric.
 *
 * The same shape is written by the Python runners; `eval/agentlens_eval/load.py` validates it.
 */

/** Generators of the architecture's 7.2 matrix, plus `human` for 7.3 sessions. */
export const GENERATORS = {
  "playwright-headless": "A",
  "playwright-headful": "A",
  patchright: "A",
  "browser-use": "A",
  "ghost-cursor": "A",
  "ghost-cursor-patchright": "A",
  "computer-use-demo": "B",
  "claude-in-chrome": "C",
  atlas: "C",
  comet: "C",
  "gemini-in-chrome": "C",
  human: null,
} as const;
export type Generator = keyof typeof GENERATORS;

/** Human and assistive-technology cohorts of the architecture's 7.3. */
export const HUMAN_COHORTS = [
  "mouse",
  "trackpad-tap",
  "trackpad-click",
  "touch-phone",
  "keyboard-only",
  "voiceover-macos",
  "voiceover-ios",
  "voice-control",
  "dragon",
  "dictation",
  "ime",
  "password-autofill",
] as const;
export type HumanCohort = (typeof HUMAN_COHORTS)[number];

export interface RunLabel {
  kind: "label";
  run: string;
  at: number;
  truth: "agent" | "human";
  /** Agents only; implied by the generator. */
  agentClass?: "A" | "B" | "C";
  generator: Generator;
  /** Free-form generator configuration, e.g. "fill/click" or "highlights on". */
  config?: string;
  /** Humans only. */
  cohort?: HumanCohort;
  /** Humans only: a pseudonymous id such as P01, never a name. */
  participant?: string;
  task: string;
  /** Grouped-split key: participant for humans, generator for agents unless set. */
  group: string;
}

export interface LabelInput {
  run: string;
  generator: Generator;
  config?: string;
  cohort?: HumanCohort;
  participant?: string;
  task?: string;
  group?: string;
}

const PSEUDONYM = /^P\d{2,3}$/;

/** Builds and checks a label; throws on anything the eval would reject. */
export function makeLabel(input: LabelInput, at = Date.now()): RunLabel {
  const { run, generator } = input;
  if (!validRunId(run)) throw new Error(`bad run id: ${JSON.stringify(run)}`);
  if (!(generator in GENERATORS)) throw new Error(`unknown generator: ${String(generator)}`);
  const agentClass = GENERATORS[generator];
  const human = agentClass === null;
  if (human) {
    if (!input.cohort || !HUMAN_COHORTS.includes(input.cohort))
      throw new Error(`a human run needs --cohort, one of ${HUMAN_COHORTS.join(", ")}`);
    if (!input.participant || !PSEUDONYM.test(input.participant))
      throw new Error("a human run needs --participant as a pseudonym like P01");
  } else if (input.cohort || input.participant) {
    throw new Error("cohort and participant are for human runs only");
  }
  const label: RunLabel = {
    kind: "label",
    run,
    at,
    truth: human ? "human" : "agent",
    generator,
    task: input.task ?? "fixture-flow",
    group: input.group ?? (human ? (input.participant as string) : generator),
  };
  if (agentClass) label.agentClass = agentClass;
  if (input.config) label.config = input.config;
  if (human) {
    label.cohort = input.cohort as HumanCohort;
    label.participant = input.participant as string;
  }
  return label;
}

/** Appends the label line to `<outDir>/<run>.jsonl`, the file the page's verdicts go to. */
export function writeLabel(outDir: string, input: LabelInput): RunLabel {
  const label = makeLabel(input);
  mkdirSync(outDir, { recursive: true });
  appendFileSync(join(outDir, `${label.run}.jsonl`), `${JSON.stringify(label)}\n`);
  return label;
}
