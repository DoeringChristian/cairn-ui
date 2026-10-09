import { test } from "node:test";
import assert from "node:assert/strict";
import type { Run } from "../api/types.ts";
import { disambiguateRunLabels, setRunMetadata, shortRunLabel } from "./run-label.ts";
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

test("runs spanning groups: grouped runs read group · name v<n>", () => {
  const g1 = run({ display_name: "train", version: 1, group: "exp-1" });
  const g2 = run({ display_name: "train", version: 2, group: "exp-1" });
  const u1 = run({ display_name: "train", version: 1, group: null });
  const h1 = run({ display_name: "train", version: 1, group: "exp-2" });
  assert.deepEqual(disambiguateRunLabels([g1.id, g2.id, u1.id, h1.id]), {
    [g1.id]: "exp-1 · train v1",
    [g2.id]: "exp-1 · train v2",
    [u1.id]: "train",
    [h1.id]: "exp-2 · train v1",
  });
  const e = run({ display_name: "eval", version: 2, group: "exp-2" });
  const b = run({ display_name: "baseline", version: 1, group: null });
  assert.deepEqual(disambiguateRunLabels([e.id, b.id]), { [e.id]: "exp-2 · eval v2", [b.id]: "baseline" });
  // One group only: the plain rules.
  assert.deepEqual(disambiguateRunLabels([g1.id, g2.id]), { [g1.id]: "train v1", [g2.id]: "train v2" });
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

test("collisions are per series: the same name in two groups never collides", () => {
  // Spanning groups, unversioned grouped runs read `group · name` instead of colliding on the name.
  const a = run({ display_name: "train", version: null, group: "exp-1" });
  const b = run({ display_name: "train", version: null, group: "exp-2" });
  assert.deepEqual(disambiguateRunLabels([a.id, b.id]), { [a.id]: "exp-1 · train", [b.id]: "exp-2 · train" });
  // An ungrouped `train` is its own series next to a grouped one.
  const u = run({ display_name: "train", version: 1, group: null });
  const g = run({ display_name: "train", version: 1, group: "exp-1" });
  assert.deepEqual(disambiguateRunLabels([u.id, g.id]), { [u.id]: "train", [g.id]: "exp-1 · train v1" });
});

test("the same name under two job types in one group shows the job type", () => {
  const ft = run({ display_name: "ft", version: 1, group: "exp-44", job_type: "finetune" });
  const ev = run({ display_name: "ft", version: 1, group: "exp-44", job_type: "eval" });
  const tr = run({ display_name: "train", version: 1, group: "exp-44", job_type: "train" });
  assert.deepEqual(disambiguateRunLabels([ft.id, ev.id, tr.id]), {
    [ft.id]: "finetune · ft",
    [ev.id]: "eval · ft",
    [tr.id]: "train",
  });
  // A re-run of one of them: the version after the job type.
  const ft2 = run({ display_name: "ft", version: 2, group: "exp-44", job_type: "finetune" });
  assert.deepEqual(disambiguateRunLabels([ft.id, ft2.id, ev.id]), {
    [ft.id]: "finetune · ft v1",
    [ft2.id]: "finetune · ft v2",
    [ev.id]: "eval · ft",
  });
  // A run without a job type keeps the bare name next to a typed one.
  const bare = run({ display_name: "ft", version: 1, group: "exp-44" });
  assert.deepEqual(disambiguateRunLabels([bare.id, ev.id]), { [bare.id]: "ft", [ev.id]: "eval · ft" });
});

test("the group shows first; the job type only where the name collides within a group", () => {
  const a = run({ display_name: "ft", version: 1, group: "exp-1", job_type: "finetune" });
  const b = run({ display_name: "ft", version: 1, group: "exp-2", job_type: "eval" });
  assert.deepEqual(disambiguateRunLabels([a.id, b.id]), { [a.id]: "exp-1 · ft v1", [b.id]: "exp-2 · ft v1" });
  const c = run({ display_name: "ft", version: 1, group: "exp-2", job_type: "finetune" });
  assert.deepEqual(disambiguateRunLabels([a.id, b.id, c.id]), {
    [a.id]: "exp-1 · ft v1",
    [b.id]: "exp-2 · eval · ft v1",
    [c.id]: "exp-2 · finetune · ft v1",
  });
});

test("shortRunLabel against the same siblings is memoized, and follows metadata changes", () => {
  const a = run({ display_name: "probe", version: 1 });
  const b = run({ display_name: "probe", version: 2 });
  const siblings = [a.id, b.id];
  assert.equal(shortRunLabel(a.id, siblings), "probe v1");
  assert.equal(shortRunLabel(b.id, siblings), "probe v2");
  // A rename bumps the metadata version: the cached labels are recomputed.
  setRunMetadata([{ ...b, display_name: "other" }]);
  assert.equal(shortRunLabel(a.id, siblings), "probe");
  assert.equal(shortRunLabel(b.id, siblings), "other");
  // A run outside the siblings is labelled against them plus itself.
  const c = run({ display_name: "probe", version: 3 });
  assert.equal(shortRunLabel(c.id, siblings), "probe v3");
});
