// Architecture 4.5: the README's "data collected" table is generated from the Features schema,
// so this fails when a field is added, removed or re-bounded without regenerating it.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { dataTable, normalise, README, withTable } from "../src/data-table";

describe("README data-collected table", () => {
  it("matches the Features schema", () => {
    const readme = readFileSync(README, "utf8");
    expect(
      normalise(withTable(readme)) === normalise(readme),
      "run `pnpm --filter @agentlens/runners-ts data-table --write`",
    ).toBe(true);
  });

  it("documents every field with no blank descriptions", () => {
    for (const row of dataTable()
      .split("\n")
      .filter((l) => l.startsWith("| `")))
      expect(row).not.toMatch(/\|\s*(undefined)?\s*\|$/);
  });
});
