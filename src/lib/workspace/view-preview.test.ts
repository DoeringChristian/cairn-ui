import { test } from "node:test";
import assert from "node:assert/strict";
import { EMPTY_WORKSPACE, ops, type Panel } from "./doc.ts";
import type { MetricInfo } from "./layout.ts";
import { cardSpan, cardTypeIcon, packRows, viewPreview } from "./view-preview.ts";

const M = (name: string, object_type = "scalar"): MetricInfo => ({ name, object_type, count: 5, runIds: ["r1"] });
const P = (id: string, name: string, type: Panel["type"] = "scalar", settings: Record<string, unknown> = {}): Panel => ({
  id,
  type,
  selector: { names: [name] },
  settings,
});
const geometry = (rows: ReturnType<typeof packRows>) => rows.map((r) => r.map((b) => `${b.x}+${b.w}`).join(" "));

test("a card's span on the 12 columns: its own width, else its type's default; other stored widths are ignored", () => {
  assert.equal(cardSpan({ type: "scalar", settings: {} }), 6);
  assert.equal(cardSpan({ type: "tile", settings: {} }), 3);
  assert.equal(cardSpan({ type: "run-compare", settings: {} }), 12);
  assert.equal(cardSpan({ type: "scalar", settings: { width: "1/3" } }), 4);
  assert.equal(cardSpan({ type: "scalar", settings: { width: "full" } }), 12);
  assert.equal(cardSpan({ type: "scalar", settings: { width: "2/3" } }), 6);
  assert.equal(cardSpan({ type: "scalars", settings: { colSpan: 2 } }), 12);
});

test("boxes wrap like the grid: a box that does not fit the rest of a row starts the next", () => {
  const c = (w: number, i: number) => ({ id: `p${i}`, type: "scalar" as const, w });
  assert.deepEqual(geometry(packRows([6, 6, 6].map(c))), ["0+6 6+6", "0+6"]);
  assert.deepEqual(geometry(packRows([3, 3, 3, 3, 4, 4, 4, 12].map(c))), ["0+3 3+3 6+3 9+3", "0+4 4+4 8+4", "0+12"]);
  assert.deepEqual(geometry(packRows([4, 6, 4].map(c))), ["0+4 4+6", "0+4"]);
  assert.deepEqual(packRows([]), []);
});

test("each box carries its card type's icon (the viewer kind's where the type shows one)", () => {
  assert.equal(cardTypeIcon("image"), "fa-image");
  assert.equal(cardTypeIcon("scalar"), "fa-chart-line");
  assert.equal(cardTypeIcon("video"), "fa-film");
  const [row] = packRows([{ id: "a", type: "image", w: 2 }]);
  assert.equal(row![0]!.icon, "fa-image");
});

test("the preview resolves the view for the viewed run: automatic panels while unlisted metrics are on", () => {
  const metrics = [M("loss"), M("acc"), M("samples", "image")];
  const on = viewPreview(EMPTY_WORKSPACE, metrics);
  assert.deepEqual(on.sections.map((s) => s.name), ["Charts", "Media"]);
  assert.equal(on.cards, 3);
  assert.deepEqual(geometry(on.sections[0]!.rows), ["0+6 6+6"]);

  // Listed only: just the panels the layout lists.
  const listed = ops.seq(ops.addPanels("Losses", [P("p1", "loss", "scalar", { width: "full" })]), ops.setAutoPanels(false))(EMPTY_WORKSPACE);
  const off = viewPreview(listed, metrics);
  assert.deepEqual(off.sections.map((s) => s.name), ["Losses"]);
  assert.equal(off.cards, 1);
  assert.deepEqual(geometry(off.sections[0]!.rows), ["0+12"]);
});

test("a collapsed section shows only its rule; hidden panels and hide patterns are left out", () => {
  const doc = ops.seq(
    ops.addPanels("A", [P("p1", "loss"), P("p2", "acc")]),
    ops.setSectionCollapsed("A", true),
    ops.addPanels("B", [P("p3", "x"), P("p4", "y"), P("p5", "z")]),
    ops.setPanelHidden("p4", true),
    ops.addHidePattern("^z$"),
    ops.setAutoPanels(false),
  )(EMPTY_WORKSPACE);
  const pv = viewPreview(doc, [M("loss"), M("acc"), M("x"), M("y"), M("z")]);
  assert.deepEqual(pv.sections.map((s) => [s.name, s.collapsed, s.rows.length]), [["A", true, 0], ["B", false, 1]]);
  assert.deepEqual(pv.sections[1]!.rows[0]!.map((b) => b.id), ["p3"]);
  assert.equal(pv.cards, 3);
});
