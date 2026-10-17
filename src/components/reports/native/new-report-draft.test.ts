import { test } from "node:test";
import assert from "node:assert/strict";
import { createDraftRequest, NEW_REPORT_SOURCE } from "./new-report-draft.ts";

test("effect replay shares one creation with a generated slug and unnamed source", async () => {
  const calls: unknown[][] = [];
  const create = createDraftRequest(async (...args) => { calls.push(args); return {id: "workspace"}; }, () => "abc-def");
  const first = create("project");
  assert.equal(create("project"), first);
  assert.deepEqual(await first, {id: "workspace"});
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], ["project", "new-report-abcdef", {"report.qmd": NEW_REPORT_SOURCE}]);
  assert.match(NEW_REPORT_SOURCE, /title: NewReport/);
  assert.ok(!NEW_REPORT_SOURCE.includes("Write your"));
});

test("failed creation can retry and different projects are independent", async () => {
  let attempts = 0;
  const create = createDraftRequest(async () => {
    if (++attempts === 1) throw new Error("Offline");
    return attempts;
  }, () => "unique");
  await assert.rejects(create("first"), /Offline/);
  assert.equal(await create("first"), 2);
  assert.equal(await create("second"), 3);
});
