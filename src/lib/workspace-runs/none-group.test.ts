// Runs without a value are never averaged: from the workspace's grouping
// (cardRuns) to what the cards draw (the scalar card's plan + series
// grouping, the Summary cards' rows).
import { test } from "node:test";
import assert from "node:assert/strict";
import { groupRunsNested } from "../runs-table/group.ts";
import { makeRun } from "../runs-table/test-run.ts";
import { cardRuns } from "./visibility.ts";
import { unitsOf, scalarsTable, type TableRun } from "../summary-tables.ts";
import { planScalarGrouping } from "../plot-utils/scalar-grouping.ts";
import { groupSeries } from "../plot-utils/aggregate.ts";

const runs = [
  makeRun("a1", { group: "exp-44" }),
  makeRun("a2", { group: "exp-44" }),
  makeRun("v1", { display_name: "baseline-v1" }),
  makeRun("v2", { display_name: "baseline-v2" }),
];
const groups = groupRunsNested(runs, [{ source: "group" }])!;
const cards = cardRuns(runs, groups, new Set(runs.map((r) => r.id)));
const grouping = { groupOf: cards.groupOf, colorOf: new Map([["group: exp-44", "#123456"]]) };

const tableRun = (id: string, loss: number): TableRun => ({
  id, status: "completed", createdAt: "2026-01-01T00:00:00Z", endedAt: null, user: "u", host: "h",
  values: { loss }, summary: {}, config: {}, tags: [], notes: "",
});

test("Summary cards: a real group is one row (its mean), each Group: (none) run a row of its own", () => {
  const t = scalarsTable([tableRun("a1", 1), tableRun("a2", 3), tableRun("v1", 5), tableRun("v2", 7)], {
    singleStep: ["loss"], groupOf: cards.groupOf, showRunInfo: false, now: 0,
  });
  assert.deepEqual(t.rows.map((r) => [r.unit.key, r.cells["metric:loss"]]), [
    ["group:group: exp-44", 2],
    ["run:v1", 5],
    ["run:v2", 7],
  ]);
  assert.deepEqual(unitsOf(runs.map((r) => tableRun(r.id, 0)), cards.groupOf).map((u) => u.kind), ["group", "run", "run"]);
});

test("scalar card: the (none) runs are their own lines (own colour), the group one mean line", () => {
  const plan = planScalarGrouping(
    { groupMode: "workspace", groupBy: { source: "group" }, agg: "mean", band: "minmax", hideMembers: true, latestPerGroup: false } as never,
    grouping,
    { cardGroupOf: () => null, runGroupOf: () => null },
  );
  const item = (id: string, color: string) => ({
    series: { key: id, label: id, color, runId: id, points: [{ x: 0, y: 1 }] },
    metricKey: "loss", metricName: "loss", group: plan.groupOf!(id),
  });
  const { series, groups: n } = groupSeries(
    [item("a1", "#a1a1a1"), item("a2", "#a2a2a2"), item("v1", "#b1b1b1"), item("v2", "#b2b2b2")] as never,
    { band: "minmax", hideMembers: true, labelMetric: false, groupColor: (g: string) => grouping.colorOf.get(g)! } as never,
  );
  assert.equal(n, 1);
  const lines = series.filter((s) => (s.role ?? "line") === "line");
  assert.deepEqual(lines.map((s) => [s.key.includes("exp-44") ? "exp-44" : s.key, s.color]), [
    ["exp-44", "#123456"],
    ["v1", "#b1b1b1"],
    ["v2", "#b2b2b2"],
  ]);
});
