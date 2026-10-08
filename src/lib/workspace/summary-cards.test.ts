import { test } from "node:test";
import assert from "node:assert/strict";
import { EMPTY_WORKSPACE, ops, type Panel } from "./doc.ts";
import { cardCatalogue } from "./card-builder.ts";
import { claimedName, deriveLayout, materializeOp, withoutEmptyPanels, type MetricInfo } from "./layout.ts";
import { isSingleStepScalar, summaryMetrics, type RunSummaryPresence } from "./summary-cards.ts";

const M = (name: string, count = 5, object_type = "scalar", runIds = ["r1"]): MetricInfo => ({ name, object_type, count, runIds });
const shape = (secs: ReturnType<typeof deriveLayout>) =>
  secs.map((s) => `${s.name}${s.inDoc ? "" : "*"}:${s.panels.map((p) => p.panel.id).join(",")}`);
const has = (runId: string, over: Partial<RunSummaryPresence> = {}): RunSummaryPresence => ({
  runId, summaryKeys: 0, configKeys: 0, tags: 0, notes: false, ...over,
});

test("single-step: a scalar with at most one point in every run; not media, not longer series", () => {
  assert.equal(isSingleStepScalar(M("eval/mse", 1)), true);
  assert.equal(isSingleStepScalar(M("loss", 2)), false);
  assert.equal(isSingleStepScalar(M("img", 1, "image")), false);
});

test("pseudo-series: @scalars for runs with a single-step scalar or summary values, @config for config/tags/notes", () => {
  const metrics = [M("eval/mse", 1, "scalar", ["a"]), M("loss", 40, "scalar", ["a", "b", "c"])];
  const out = summaryMetrics(metrics, [has("a"), has("b", { summaryKeys: 1 }), has("c", { notes: true }), has("d")]);
  assert.deepEqual(out.map((m) => [m.name, m.object_type, m.runIds]), [
    ["@scalars", "scalars", ["a", "b"]],
    ["@config", "config", ["c"]],
  ]);
  assert.deepEqual(summaryMetrics(metrics.slice(1), [has("a")]), []);
});

const METRICS = [M("loss", 40), M("eval/mse", 1), M("prepare.rows", 1), M("samples", 1, "image")];
const PSEUDO = summaryMetrics(METRICS, [has("r1", { configKeys: 2 })]);
const ALL = [...METRICS, ...PSEUDO];

test("the Summary section leads; single-step metrics get no automatic card, so Charts has only longer series", () => {
  assert.deepEqual(shape(deriveLayout(EMPTY_WORKSPACE, ALL)), [
    "Summary*:auto:@scalars,auto:@config",
    "Charts*:auto:loss",
    "Media*:auto:samples",
  ]);
  // It leads even when the document has sections.
  const doc = ops.addPanels("Mine", [{ id: "p", type: "scalar", selector: { names: ["loss"] }, settings: {} }])(EMPTY_WORKSPACE);
  assert.deepEqual(shape(deriveLayout(doc, ALL)), ["Summary*:auto:@scalars,auto:@config", "Mine:p", "Media*:auto:samples"]);
});

test("a manually added single-value card still shows a single-step metric", () => {
  const doc = ops.addPanels("Charts", [{ id: "v", type: "scalar", selector: { names: ["eval/mse"] }, settings: {} }])(EMPTY_WORKSPACE);
  assert.deepEqual(shape(deriveLayout(doc, ALL))[1], "Charts:v,auto:loss");
});

test("touching a Summary card writes it into a Summary section at the top; removing it keeps it away", () => {
  const doc0 = ops.addPanels("Mine", [{ id: "p", type: "scalar", selector: { names: ["loss"] }, settings: {} }])(EMPTY_WORKSPACE);
  const doc = materializeOp(deriveLayout(doc0, ALL), "auto:@config")(doc0);
  assert.deepEqual(doc.sections.map((s) => s.name), ["Summary", "Mine"]);
  assert.deepEqual(shape(deriveLayout(doc, ALL)).slice(0, 2), ["Summary:auto:@scalars,auto:@config", "Mine:p"]);
  const panel = doc.sections[0]!.panels[0]!;
  // Even once its data is edited away (empty selector), removing it records its pseudo-series.
  assert.equal(claimedName({ ...panel, selector: { names: [] } }), "@config");
  const gone = ops.removePanel(panel.id, claimedName(panel))(doc);
  assert.deepEqual(gone.removed, ["@config"]);
  assert.deepEqual(shape(deriveLayout(gone, ALL))[0], "Summary:auto:@scalars");
  const removedEntry = cardCatalogue(gone, ALL).find((e) => e.status === "removed")!;
  assert.equal(removedEntry.panel.type, "config");
  assert.equal(removedEntry.section, "Summary");
});

test("run page: a Summary card shows only while the run has data for it", () => {
  const manual: Panel = { id: "m", type: "scalars", selector: { names: [] }, settings: {} };
  const doc = ops.addPanels("Extra", [manual, { id: "rc", type: "run-compare", selector: { names: [] }, settings: {} }])(EMPTY_WORKSPACE);
  const noConfig = [...METRICS, ...summaryMetrics(METRICS.filter((m) => m.name !== "eval/mse" && m.name !== "prepare.rows"), [has("r1", { configKeys: 1 })])];
  const secs = withoutEmptyPanels(deriveLayout(doc, noConfig));
  assert.deepEqual(shape(secs), ["Summary*:auto:@config", "Extra:rc", "Charts*:auto:loss", "Media*:auto:samples"]);
  // With single-step scalars the manual Scalars card shows too.
  assert.deepEqual(shape(withoutEmptyPanels(deriveLayout(doc, ALL)))[1], "Extra:m,rc");
});
