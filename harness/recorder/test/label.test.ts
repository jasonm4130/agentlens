import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeLabel, writeLabel } from "../src/label";

describe("run labels", () => {
  it("derive class, truth and group from the generator", () => {
    expect(makeLabel({ run: "pr-01", generator: "patchright" }, 1)).toEqual({
      kind: "label",
      run: "pr-01",
      at: 1,
      truth: "agent",
      agentClass: "A",
      generator: "patchright",
      task: "fixture-flow",
      group: "patchright",
    });
    const h = makeLabel({ run: "h1", generator: "human", cohort: "ime", participant: "P07" });
    expect(h).toMatchObject({ truth: "human", cohort: "ime", participant: "P07", group: "P07" });
    expect(h.agentClass).toBeUndefined();
  });

  it("reject what the eval would reject", () => {
    expect(() => makeLabel({ run: "../x", generator: "patchright" })).toThrow(/run id/);
    expect(() => makeLabel({ run: "h1", generator: "human", cohort: "mouse" })).toThrow(
      /pseudonym/,
    );
    expect(() =>
      makeLabel({ run: "h1", generator: "human", cohort: "mouse", participant: "Ada" }),
    ).toThrow(/pseudonym/);
    expect(() =>
      makeLabel({ run: "a1", generator: "patchright", cohort: "mouse", participant: "P01" }),
    ).toThrow(/human runs only/);
  });

  it("append to the run's JSONL", () => {
    const out = mkdtempSync(join(tmpdir(), "al-label-"));
    writeLabel(out, { run: "cic-01", generator: "claude-in-chrome" });
    const line = JSON.parse(readFileSync(join(out, "cic-01.jsonl"), "utf8")) as {
      agentClass: string;
    };
    expect(line.agentClass).toBe("C");
  });
});
