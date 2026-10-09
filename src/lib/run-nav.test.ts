import { test } from "node:test";
import assert from "node:assert/strict";
import { cameFromWorkspace, FROM_WORKSPACE, workspacePath } from "./run-nav.ts";

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

