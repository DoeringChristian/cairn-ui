import { test } from "node:test";
import assert from "node:assert/strict";
import { layoutCards } from "./layout-cards.ts";
import type { RenderedPanel } from "./layout.ts";

const panel = (id: string, type: RenderedPanel["panel"]["type"], metrics: Array<{ name: string; runIds: string[] }>, label = id): RenderedPanel => ({
  panel: { id, type, selector: { names: metrics.map((m) => m.name) }, settings: {} },
  auto: false,
  section: "Charts",
  metrics: metrics.map((m) => ({ ...m, object_type: "scalar", count: 10 })),
  label,
});

test("layout panels as cards: per-metric cards over the runs logging them, multi-run cards over every run", () => {
  const cards = layoutCards(
    [
      panel("a", "scalar", [{ name: "loss", runIds: ["r1", "r3"] }]),
      panel("b", "scalar", [{ name: "acc", runIds: ["r9"] }]),
      panel("c", "bar", [], "Bar"),
    ],
    ["r1", "r2", "r3"],
    (id) => (id === "a" ? { smoothing: 0.5 } : {}),
  );
  assert.deepEqual(cards, [
    { card: { id: "a", type: "scalar", series: [{ runId: "r1", name: "loss" }, { runId: "r3", name: "loss" }] }, settings: { smoothing: 0.5 } },
    { card: { id: "c", type: "bar", series: ["r1", "r2", "r3"].map((runId) => ({ runId, name: "Bar" })) }, settings: {} },
  ]);
});
