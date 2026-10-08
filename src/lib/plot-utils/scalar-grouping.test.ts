import { test } from "node:test";
import assert from "node:assert/strict";
import { planScalarGrouping, type ScalarGroupMode } from "./scalar-grouping.ts";
import type { WorkspaceGrouping } from "../workspace-runs/grouping-context.ts";

// Runs a1, a2 in group "A" (lr 0.1), b1 in "B" (lr 0.2), x without a group.
const runGroup: Record<string, string | null> = { a1: "A", a2: "A", b1: "B", x: null };
const lr: Record<string, string> = { a1: "lr=0.1", a2: "lr=0.2", b1: "lr=0.1", x: "lr=0.2" };
const lookups = {
  cardGroupOf: (by: { source: string }, id: string) => (by.source === "param" ? lr[id]! : runGroup[id]!),
  runGroupOf: (id: string) => runGroup[id]!,
};
const settings = (groupMode: ScalarGroupMode) => ({
  groupMode,
  groupBy: { source: "param", key: "lr" },
  agg: "median" as const,
  band: "sem" as const,
  hideMembers: false,
  latestPerGroup: true,
});
// The sidebar groups by something else entirely: a1 + b1 in "W1", a2 in "W2".
const grouped: WorkspaceGrouping = { groupOf: new Map([["a1", "W1"], ["b1", "W1"], ["a2", "W2"]]) };
const ids = ["a1", "a2", "b1", "x"];
const groupsOf = (p: ReturnType<typeof planScalarGrouping>) => (p.groupOf ? ids.map(p.groupOf) : null);

const cardOwn = (p: ReturnType<typeof planScalarGrouping>) => {
  assert.equal(p.source, "card");
  assert.deepEqual(groupsOf(p), ["lr=0.1", "lr=0.2", "lr=0.1", "lr=0.2"]);
  assert.deepEqual(
    { agg: p.agg, band: p.band, hideMembers: p.hideMembers, latest: p.latestPerGroup, palette: p.palette, n: p.countInLabel },
    { agg: "median", band: "sem", hideMembers: false, latest: true, palette: "card", n: true },
  );
  assert.deepEqual(ids.map(p.latestGroupOf), ["lr=0.1", "lr=0.2", "lr=0.1", "lr=0.2"]);
};
const perRun = (p: ReturnType<typeof planScalarGrouping>, latest: boolean) => {
  assert.equal(p.source, null);
  assert.equal(p.groupOf, null);
  assert.equal(p.latestPerGroup, latest);
};

test("workspace mode, grouped workspace: the sidebar's groups, mean + min-max, members hidden", () => {
  const p = planScalarGrouping(settings("workspace"), grouped, lookups);
  assert.equal(p.source, "workspace");
  assert.deepEqual(groupsOf(p), ["W1", "W2", "W1", null]);
  assert.deepEqual(
    { agg: p.agg, band: p.band, hideMembers: p.hideMembers, latest: p.latestPerGroup, palette: p.palette, n: p.countInLabel },
    { agg: "mean", band: "minmax", hideMembers: true, latest: false, palette: "workspace", n: false },
  );
});

test("workspace mode, workspace not grouped: one line per run", () => {
  perRun(planScalarGrouping(settings("workspace"), null, lookups), false);
});

test("workspace mode outside a workspace: the card's own grouping (as on main)", () => {
  cardOwn(planScalarGrouping(settings("workspace"), undefined, lookups));
});

test("off: one line per run in a grouped, ungrouped or no workspace; latest-per-group by the run's group", () => {
  for (const ws of [grouped, null, undefined]) {
    const p = planScalarGrouping(settings("off"), ws, lookups);
    perRun(p, true);
    assert.deepEqual(ids.map(p.latestGroupOf), ["A", "A", "B", null]);
  }
});

test("by key: the card's own grouping wins in a grouped, ungrouped or no workspace", () => {
  for (const ws of [grouped, null, undefined]) cardOwn(planScalarGrouping(settings("key"), ws, lookups));
});
