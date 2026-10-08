import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_RUN_STATE, parseRunState, setEyes } from "./state.ts";

test("parseRunState: the toolbar and the eyes; what does not parse takes its default", () => {
  assert.equal(parseRunState(null), DEFAULT_RUN_STATE);
  assert.equal(parseRunState([1]), DEFAULT_RUN_STATE);
  const s = parseRunState({
    status: "failed",
    search: "train",
    groupBy: [{ source: "param", key: "lr" }, { source: "bogus" }],
    latestOnly: true,
    eyes: { "r:a": false, "g:group:exp": true, bad: 1 },
    // Gone with version picks: ignored.
    groups: { exp: { picks: {} } },
    hiddenNames: { exp: ["n:train"] },
  });
  assert.deepEqual(s, {
    status: "failed",
    search: "train",
    filter: DEFAULT_RUN_STATE.filter,
    groupBy: [{ source: "param", key: "lr" }],
    latestOnly: true,
    eyes: { "r:a": false, "g:group:exp": true },
  });
  const bad = parseRunState({ status: "nope", search: 3, groupBy: "x", latestOnly: "yes", eyes: [] });
  assert.deepEqual(bad, DEFAULT_RUN_STATE);
});

test("setEyes: set several, or back to their default", () => {
  const s = setEyes(DEFAULT_RUN_STATE, ["r:a", "r:b"], false);
  assert.deepEqual(s.eyes, { "r:a": false, "r:b": false });
  assert.deepEqual(setEyes(s, ["r:a"], null).eyes, { "r:b": false });
  assert.equal(setEyes(s, [], true), s);
});
