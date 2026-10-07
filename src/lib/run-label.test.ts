import { test } from "node:test";
import assert from "node:assert/strict";
import type { Run } from "../api/types.ts";
import { disambiguateRunLabels, setRunMetadata } from "./run-label.ts";
import { makeRun } from "./runs-table/test-run.ts";

let seq = 0;
function run(fields: Partial<Run>): Run {
  seq += 1;
  const id = `${String(seq).padStart(6, "0")}aaaaaaaaaaaaaaaaaaaaaaaaaa`;
  const r = makeRun(id, { display_name: null, created_at: "2026-10-07T12:00:00Z", ...fields });
  setRunMetadata([r]);
  return r;
}

test("a unique name is just the name", () => {
  const a = run({ display_name: "train", version: 3 });
  const b = run({ display_name: "evaluate", version: 1 });
  assert.deepEqual(disambiguateRunLabels([a.id, b.id]), { [a.id]: "train", [b.id]: "evaluate" });
});

test("a shared name gets the version instead of the time", () => {
  const a = run({ display_name: "train", version: 1, created_at: "2026-10-07T13:02:00Z" });
  const b = run({ display_name: "train", version: 2, created_at: "2026-10-07T14:34:00Z" });
  const c = run({ display_name: "evaluate", version: 1 });
  assert.deepEqual(disambiguateRunLabels([a.id, b.id, c.id]), {
    [a.id]: "train v1",
    [b.id]: "train v2",
    [c.id]: "evaluate",
  });
});

test("the same name and version in different groups adds the group", () => {
  const g1 = run({ display_name: "train", version: 1, group: "exp-1" });
  const g2 = run({ display_name: "train", version: 2, group: "exp-1" });
  const u1 = run({ display_name: "train", version: 1, group: null });
  const h1 = run({ display_name: "train", version: 1, group: "exp-2" });
  assert.deepEqual(disambiguateRunLabels([g1.id, g2.id, u1.id, h1.id]), {
    [g1.id]: "train v1 · exp-1",
    [g2.id]: "train v2",
    [u1.id]: "train v1",
    [h1.id]: "train v1 · exp-2",
  });
});

test("runs without a version fall back to the time", () => {
  const a = run({ display_name: "train", version: 1 });
  const b = run({ display_name: "train", version: null, created_at: "2026-10-07T12:00:00Z" });
  const labels = disambiguateRunLabels([a.id, b.id]);
  assert.equal(labels[a.id], "train v1");
  assert.match(labels[b.id]!, /^train \d/);
  assert.notEqual(labels[b.id], "train v1");
});

test("unnamed runs and runs without metadata use the short id", () => {
  const a = run({ display_name: null, version: null });
  const unknown = "ffffff0000000000000000000000000000";
  const labels = disambiguateRunLabels([a.id, unknown]);
  assert.equal(labels[a.id], a.id.slice(0, 6));
  assert.equal(labels[unknown], "ffffff");
});
