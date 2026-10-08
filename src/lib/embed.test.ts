import { test } from "node:test";
import assert from "node:assert/strict";
import { embedFilter, embedTabPath, runPagePath } from "./embed.ts";

test("embed tab: the run tabs by name, the default and unknown ones to the bare run path", () => {
  assert.equal(embedTabPath("overview"), "overview");
  assert.equal(embedTabPath("Logs"), "logs");
  assert.equal(embedTabPath("artifacts"), "artifacts");
  assert.equal(embedTabPath("workspace"), null);
  assert.equal(embedTabPath(null), null);
  assert.equal(embedTabPath("nope"), null);
});

test("embed filter: an expression is the tree's one leaf; JSON is a filter tree; nothing usable is null", () => {
  assert.deepEqual(embedFilter('run.group == "exp-44"'), {
    kind: "group",
    op: "and",
    children: [{ kind: "expr", expr: 'run.group == "exp-44"' }],
  });
  const tree = { kind: "group", op: "or", children: [{ kind: "chip", field: "group", op: "exact", arg: "exp-44" }] };
  assert.deepEqual(embedFilter(JSON.stringify(tree)), tree);
  assert.equal(embedFilter(null), null);
  assert.equal(embedFilter("  "), null);
  assert.equal(embedFilter("{not json"), null);
  assert.equal(embedFilter('{"kind": "chip"}'), null);
});

test("open in cairn: the run page, its tab", () => {
  assert.equal(runPagePath("p q", "abc"), "/p/p%20q/r/abc");
  assert.equal(runPagePath("p", "abc", "overview"), "/p/p/r/abc/overview");
  assert.equal(runPagePath("p", "abc", "."), "/p/p/r/abc");
});
