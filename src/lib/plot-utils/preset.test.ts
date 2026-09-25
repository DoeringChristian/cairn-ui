import { test } from "node:test";
import assert from "node:assert/strict";
import { confusionTrace, curveTraces, normalizeCounts } from "./preset.ts";
import { seriesColor } from "./types.ts";

test("normalizeCounts by row and column, empty ones null", () => {
  const c = [[1, 3], [0, 0]];
  assert.deepEqual(normalizeCounts(c, "none"), c);
  assert.deepEqual(normalizeCounts(c, "true"), [[0.25, 0.75], [null, null]]);
  assert.deepEqual(normalizeCounts(c, "pred"), [[1, 1], [0, 0]]);
});

test("confusion heatmap shows counts or fractions", () => {
  const data = { labels: ["a", "b"], counts: [[1, 3], [0, 0]] };
  assert.deepEqual(confusionTrace(data, "none").text, [["1", "3"], ["0", "0"]]);
  const t = confusionTrace(data, "true");
  assert.deepEqual(t.text, [["0.25", "0.75"], ["n/a", "n/a"]]);
  assert.equal(t.zmax, 0.75);
});

const curves = [
  { label: "cat", x: [0, 1], y: [0, 1], auc: 0.5 },
  { label: "dog", x: [0, 1], y: [0, 1], auc: null },
];

test("one run: a color per class, AUC in the legend, ROC gets a chance line", () => {
  const traces = curveTraces("roc_curve", [{ label: "r1", curves }]);
  assert.equal(traces.length, 3);
  assert.equal(traces[0]!.name, "cat (AUC=0.500)");
  assert.equal(traces[1]!.name, "dog (AUC=n/a)");
  assert.notEqual((traces[0]!.line as { color: string }).color, (traces[1]!.line as { color: string }).color);
  assert.equal(traces[2]!.name, "chance");
});

test("several runs: color per run, dash per class", () => {
  const traces = curveTraces("pr_curve", [{ label: "r1", curves }, { label: "r2", curves }]);
  assert.equal(traces.length, 4);
  assert.equal(traces[3]!.name, "r2 · dog (AP=n/a)");
  const line = (i: number) => traces[i]!.line as { color: string; dash: string };
  assert.equal(line(0).color, seriesColor(0));
  assert.equal(line(1).color, seriesColor(0));
  assert.equal(line(2).color, seriesColor(1));
  assert.notEqual(line(0).dash, line(1).dash);
  assert.equal(line(0).dash, line(2).dash);
});

test("several runs take their run colour when given", () => {
  const traces = curveTraces("pr_curve", [
    { label: "r1", curves, color: "#111111" },
    { label: "r2", curves },
  ]);
  const colors = traces.map((t) => (t.line as { color: string }).color);
  assert.equal(colors[0], "#111111");
  assert.equal(colors[1], "#111111");
  assert.equal(colors[2], seriesColor(1));
});
