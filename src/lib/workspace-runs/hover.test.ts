import { test } from "node:test";
import assert from "node:assert/strict";
import { lineMatches, RunHoverStore, sameTarget, targetOfLine, targetOfRun } from "./hover.ts";

test("targets: a run row targets its group's line when grouped, else its own", () => {
  const groupOf = new Map([["a", "exp-44"]]);
  assert.deepEqual(targetOfRun("a", groupOf), { group: "exp-44" });
  assert.deepEqual(targetOfRun("b", groupOf), { runId: "b" });
  assert.deepEqual(targetOfRun("a", null), { runId: "a" });
  assert.deepEqual(targetOfLine({ runId: "a", group: "exp-44" }), { group: "exp-44" });
  assert.deepEqual(targetOfLine({ runId: "a" }), { runId: "a" });
  assert.equal(targetOfLine({}), null);
});

test("lineMatches: a group target matches the group's lines, a run target the run's", () => {
  assert.equal(lineMatches({ group: "g" }, { group: "g" }), true);
  assert.equal(lineMatches({ runId: "a", group: "g" }, { runId: "a" }), true);
  assert.equal(lineMatches({ runId: "a" }, { group: "g" }), false);
  assert.equal(lineMatches({ runId: "b" }, { runId: "a" }), false);
});

test("RunHoverStore: notifies on a change only", () => {
  const s = new RunHoverStore();
  let n = 0;
  const off = s.subscribe(() => n++);
  s.set({ runId: "a" });
  s.set({ runId: "a" });
  assert.equal(n, 1);
  assert.equal(sameTarget(s.get(), { runId: "a" }), true);
  s.set(null);
  assert.equal(n, 2);
  off();
  s.set({ group: "g" });
  assert.equal(n, 2);
});
