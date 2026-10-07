import { test } from "node:test";
import assert from "node:assert/strict";
import { allSummarySeries, isSummarySeries, seriesRuns, type CatalogueEntry } from "./summary-series.ts";
import { mergeRunMetrics } from "../workspace/metrics.ts";
import { deriveLayout } from "../workspace/layout.ts";
import { EMPTY_WORKSPACE } from "../workspace/doc.ts";
import { seriesCatalogue } from "../workspace/card-builder.ts";

const catalogues: Record<string, CatalogueEntry[]> = {
  a: [{ name: "loss" }, { name: "showcase.fig", summary: true }, { name: "showcase.samples", summary: true }],
  b: [{ name: "showcase.fig", summary: true }, { name: "preview" }],
  c: [{ name: "showcase.fig" }], // tracked under the same name in another run
};
const of = (runId: string) => catalogues[runId];

test("isSummarySeries reads the catalogue flag", () => {
  assert.equal(isSummarySeries(catalogues.a, "showcase.fig"), true);
  assert.equal(isSummarySeries(catalogues.a, "loss"), false);
  assert.equal(isSummarySeries(catalogues.a, "missing"), false);
  assert.equal(isSummarySeries(undefined, "showcase.fig"), false);
});

test("the slider is hidden only when every series is a summary media value", () => {
  // One run, and a comparison: one pane per run.
  assert.equal(allSummarySeries(of, [{ runId: "a", name: "showcase.fig" }]), true);
  assert.equal(allSummarySeries(of, [{ runId: "a", name: "showcase.fig" }, { runId: "b", name: "showcase.fig" }]), true);
  // A tracked series anywhere keeps the slider.
  assert.equal(allSummarySeries(of, [{ runId: "a", name: "showcase.fig" }, { runId: "c", name: "showcase.fig" }]), false);
  assert.equal(allSummarySeries(of, [{ runId: "b", name: "preview" }]), false);
  // Not known yet, or nothing shown: unchanged behaviour.
  assert.equal(allSummarySeries(of, [{ runId: "zzz", name: "showcase.fig" }]), false);
  assert.equal(allSummarySeries(of, []), false);
});

test("seriesRuns lists each run once", () => {
  assert.deepEqual(seriesRuns([{ runId: "a", name: "x" }, { runId: "b", name: "x" }, { runId: "a", name: "y" }]), ["a", "b"]);
});

test("summary media series reach the card system like logged keys", () => {
  // `/api/runs/{id}/sequences` of two runs (the server's shape).
  const cat = (runId: string) => ({
    runId,
    artifactNames: [],
    sequences: [
      { name: "train.loss", object_type: "scalar", min_step: 0, max_step: 49, count: 50 },
      { name: "showcase.loss_landscape", object_type: "figure", min_step: 0, max_step: 0, count: 1, summary: true },
      { name: "showcase.samples", object_type: "image", min_step: 0, max_step: 0, count: 1, summary: true },
    ],
  });
  const metrics = mergeRunMetrics([cat("a"), cat("b")]);
  const land = metrics.find((m) => m.name === "showcase.loss_landscape");
  assert.deepEqual(land?.runIds, ["a", "b"]); // a comparison: one pane per run
  const panels = deriveLayout(EMPTY_WORKSPACE, metrics).flatMap((s) => s.panels.map((p) => `${p.panel.id}:${p.panel.type}`));
  assert.ok(panels.includes("auto:showcase.loss_landscape:figure"));
  assert.ok(panels.includes("auto:showcase.samples:image"));
  const picker = seriesCatalogue(metrics, new Map()).flatMap((g) => g.items.map((i) => i.name));
  assert.ok(picker.includes("showcase.samples") && picker.includes("showcase.loss_landscape"));
});
