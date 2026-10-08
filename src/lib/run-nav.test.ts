import { test } from "node:test";
import assert from "node:assert/strict";
import { cameFromWorkspace, FROM_WORKSPACE, restoredToggles, workspacePath } from "./run-nav.ts";

test("only the workspace's history state shows the back link", () => {
  assert.equal(cameFromWorkspace(FROM_WORKSPACE), true);
  assert.equal(cameFromWorkspace({ from: "workspace", x: 1 }), true);
  assert.equal(cameFromWorkspace(null), false);
  assert.equal(cameFromWorkspace(undefined), false);
  assert.equal(cameFromWorkspace("workspace"), false);
  assert.equal(cameFromWorkspace({ from: "runs" }), false);
});

test("workspace path", () => {
  assert.equal(workspacePath("demo"), "/p/demo/workspace");
});

test("toggled groups come back only under the same group-by", () => {
  const key = JSON.stringify([{ source: "group" }]);
  assert.deepEqual([...restoredToggles({ groupBy: key, toggled: ["0=a/", "0=b/", 3] }, key)], ["0=a/", "0=b/"]);
  assert.equal(restoredToggles({ groupBy: "[]", toggled: ["0=a/"] }, key).size, 0);
  assert.equal(restoredToggles(null, key).size, 0);
  assert.equal(restoredToggles({ groupBy: key, toggled: "x" }, key).size, 0);
});
