import { test } from "node:test";
import assert from "node:assert/strict";
import { GIT_DIFF_ARTIFACT, isInternalName } from "./internal-names.ts";
import { buildMetricIndex } from "./reports/metric-index.ts";

test("only the _cairn/ prefix is internal", () => {
  assert.equal(isInternalName("_cairn/git.diff"), true);
  assert.equal(isInternalName(GIT_DIFF_ARTIFACT), true);
  assert.equal(isInternalName("_cairn/"), true);
  assert.equal(isInternalName("git.diff"), false);
  assert.equal(isInternalName("_cairn"), false);
  assert.equal(isInternalName("cairn/x"), false);
  assert.equal(isInternalName("train/_cairn/x"), false);
  assert.equal(isInternalName("_Cairn/x"), false);
});

test("the metric index leaves internal names out", () => {
  const seq = (name: string, object_type = "scalar") =>
    ({ name, object_type, min_step: 0, max_step: 1, count: 2 }) as any;
  const idx = buildMetricIndex([
    { runId: "a", sequences: [seq("loss"), seq("_cairn/git.diff", "artifact")] },
  ]);
  assert.deepEqual([...idx.keys()], ["loss::scalar"]);
});
