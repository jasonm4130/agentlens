import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startRecorder, validRunId, type Recorder } from "../src/server";

let rec: Recorder;
let out: string;

beforeAll(async () => {
  out = mkdtempSync(join(tmpdir(), "al-rec-"));
  const site = mkdtempSync(join(tmpdir(), "al-site-"));
  writeFileSync(join(site, "index.html"), "<h1>hi</h1>");
  rec = await startRecorder({ outDir: out, mounts: { "/": site } });
});
afterAll(() => rec.close());

describe("recorder", () => {
  it("appends one JSONL line per POST, keyed by run id", async () => {
    for (const n of [1, 2]) {
      const r = await fetch(`${rec.url}/record?run=r1`, {
        method: "POST",
        body: JSON.stringify({ n }),
      });
      expect(r.status).toBe(204);
    }
    expect(readFileSync(join(out, "r1.jsonl"), "utf8")).toBe('{"n":1}\n{"n":2}\n');
  });

  it("rejects unsafe run ids and non-JSON bodies", async () => {
    expect((await fetch(`${rec.url}/record?run=../x`, { method: "POST", body: "{}" })).status).toBe(
      400,
    );
    expect((await fetch(`${rec.url}/record?run=ok`, { method: "POST", body: "nope" })).status).toBe(
      400,
    );
    expect(validRunId(".hidden")).toBe(false);
    expect(validRunId(null)).toBe(false);
  });

  it("serves the mount and blocks path traversal", async () => {
    expect(await (await fetch(`${rec.url}/`)).text()).toBe("<h1>hi</h1>");
    const raw = await fetch(`${rec.url}/..%2f..%2fetc%2fpasswd`);
    expect(raw.status).toBe(404);
  });
});
