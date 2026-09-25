import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EMPTY_COLUMNS,
  availableColumns,
  cellValue,
  columnLabel,
  compileScalarExpr,
  computeColumns,
  layoutColumns,
  moveColumn,
  setBetter,
  setHidden,
  togglePinned,
  type ColumnsState,
} from "./columns.ts";
import { makeRun, stats } from "./test-run.ts";

const runs = [
  makeRun("a", { values: { "val.loss": 0.3, acc: 0.9 }, params: { lr: 0.1 }, stats: stats({ "val.loss": [0.2, 0.5, "min"] }) }),
  makeRun("b", { values: { acc: 0.8 }, params: { lr: 0.01, opt: "sgd" } }),
];

test("availableColumns: built-ins, metric union, param union, computed", () => {
  assert.deepEqual(availableColumns(runs, [{ id: "c1", expr: "min(val.loss)" }]), [
    "name", "status", "created_at", "duration", "tags",
    "value:acc", "value:val.loss",
    "param:lr", "param:opt",
    "computed:c1",
  ]);
});

test("layoutColumns: name frozen, pinned join in pin order, hidden dropped, order kept", () => {
  const avail = availableColumns(runs, []);
  assert.deepEqual(layoutColumns(avail, EMPTY_COLUMNS), {
    frozen: ["name"],
    scroll: ["status", "created_at", "duration", "tags", "value:acc", "value:val.loss", "param:lr", "param:opt"],
  });
  let s: ColumnsState = togglePinned(EMPTY_COLUMNS, "param:lr");
  s = togglePinned(s, "value:acc");
  s = setHidden(s, "tags", true);
  s = setHidden(s, "name", true); // name can't be hidden
  const l = layoutColumns(avail, s);
  assert.deepEqual(l.frozen, ["name", "param:lr", "value:acc"]);
  assert.deepEqual(l.scroll, ["status", "created_at", "duration", "value:val.loss", "param:opt"]);
  // Hiding a pinned column unpins it; showing it again brings it back unpinned.
  const h = setHidden(s, "param:lr", true);
  assert.deepEqual(h.pinned, ["value:acc"]);
  assert.deepEqual(layoutColumns(avail, setHidden(h, "param:lr", false)).frozen, ["name", "value:acc"]);
  // Pinning a missing column is ignored by the layout.
  assert.deepEqual(layoutColumns(avail, togglePinned(EMPTY_COLUMNS, "value:gone")).frozen, ["name"]);
});

test("moveColumn: reorders the scrolling block; new columns land near their kin", () => {
  const avail = availableColumns(runs, []);
  const visible = layoutColumns(avail, EMPTY_COLUMNS).scroll;
  const s = moveColumn(EMPTY_COLUMNS, visible, "param:opt", "status");
  assert.deepEqual(layoutColumns(avail, s).scroll.slice(0, 2), ["param:opt", "status"]);
  const s2 = moveColumn(s, layoutColumns(avail, s).scroll, "status", null);
  assert.equal(layoutColumns(avail, s2).scroll.at(-1), "status");
  // A metric that appears later slots in after its natural predecessor.
  const more = [...avail.slice(0, 7), "value:zzz", ...avail.slice(7)];
  const scroll = layoutColumns(more, s2).scroll;
  assert.equal(scroll[scroll.indexOf("value:val.loss") + 1], "value:zzz");
  // Pinned columns reorder within the pins.
  let p = togglePinned(togglePinned(EMPTY_COLUMNS, "param:lr"), "value:acc");
  p = moveColumn(p, [], "value:acc", "param:lr");
  assert.deepEqual(p.pinned, ["value:acc", "param:lr"]);
});

test("setBetter sets and clears a per-column override", () => {
  const s = setBetter(EMPTY_COLUMNS, "value:acc", "higher");
  assert.deepEqual(s.better, { "value:acc": "higher" });
  assert.deepEqual(setBetter(s, "value:acc", null).better, {});
});

test("computed columns: scalar expressions over stats, params and values", () => {
  const computed = [
    { id: "m", expr: "min(val.loss)" },
    { id: "r", expr: "config.lr * 10" },
    { id: "s", expr: "summary.acc - 0.5" },
    { id: "bad", expr: "val.loss" },
  ];
  assert.equal(compileScalarExpr("val.loss").node, null);
  assert.match(compileScalarExpr("val.loss").error ?? "", /series/);
  assert.ok(compileScalarExpr("min(").error);
  const vals = computeColumns(runs, computed);
  assert.deepEqual(vals.get("a"), { m: 0.2, r: 1, s: 0.4 });
  // No stats for a metric → null; missing params → null arithmetic.
  assert.deepEqual(vals.get("b"), { m: null, r: 0.1, s: 0.30000000000000004 });
  assert.equal(cellValue(runs[0]!, "computed:m", vals), 0.2);
  assert.equal(columnLabel("computed:m", computed), "min(val.loss)");
  assert.equal(columnLabel("computed:m", [{ id: "m", expr: "x", name: "Best" }]), "Best");
});

test("cellValue: built-ins, metrics, params", () => {
  const r = makeRun("x", { display_name: null, tags: '["t"]', created_at: "2026-01-01T00:00:00Z", ended_at: "2026-01-01T00:00:10Z" });
  assert.equal(cellValue(r, "name"), "x");
  assert.equal(cellValue(r, "duration"), 10_000);
  assert.deepEqual(cellValue(r, "tags"), ["t"]);
  assert.equal(cellValue(runs[0]!, "value:acc"), 0.9);
  assert.equal(cellValue(runs[1]!, "param:opt"), "sgd");
  assert.equal(cellValue(runs[0]!, "param:opt"), null);
  assert.equal(columnLabel("created_at", []), "Created");
});
