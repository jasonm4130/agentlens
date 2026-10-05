// Golden fixtures (architecture 7.5): every labelled harness run's final `features`, re-scored
// with the current ruleset on every commit. A ruleset change that flips a label fails here
// until the fixture's `expected` is updated in the same commit, with an entry in its `changes`
// list saying why, so label drift is always reviewed. Fixtures come from recorded runs only
// (`uv run eval.py golden` in eval/); never write one by hand.
import { describe, expect, it } from "vitest";
import { validateFeatures } from "../src/features";
import { RULESET } from "../src/scorer/ruleset";
import { score } from "../src/scorer/score";
import type { AgentClass, Confidence, Label, Mode } from "../src/types";

interface Golden {
  run: string;
  truth: { truth: "agent" | "human"; generator: string; agent_class?: AgentClass };
  mode: Mode;
  gpc: boolean;
  rulesetVersion: string;
  featuresVersion: number;
  expected: { label: Label; confidence: Confidence; agentClass?: AgentClass };
  changes: { rulesetVersion: string; from: string; to: string; reason: string }[];
  features: unknown;
}

const fixtures = Object.values(
  import.meta.glob<Golden>("../../../fixtures/golden/*.json", { eager: true, import: "default" }),
);

describe("golden fixtures", () => {
  it("has recorded runs to check", () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  it.each(fixtures.map((g) => [g.run, g] as const))("%s keeps its label", (_run, g) => {
    const check = validateFeatures(g.features, g.featuresVersion);
    // A failed check shows its reason in the diff.
    expect(check).toMatchObject({ ok: true });
    if (!check.ok) return;
    const s = score(check.features, RULESET, { mode: g.mode, gpc: g.gpc });
    const got = {
      label: s.label,
      confidence: s.confidence,
      ...(s.agentClass ? { agentClass: s.agentClass } : {}),
    };
    expect(
      got,
      `ruleset ${RULESET.version} changes ${g.run}; if intended, update expected and add a changes entry with the reason`,
    ).toEqual(g.expected);
  });
});
