import { test } from "node:test";
import assert from "node:assert/strict";

import {
  activeTab,
  addAll,
  colormapGradient,
  fieldMatcher,
  filterFields,
  parseNumberDraft,
  parseSectionOpen,
  rangeError,
  sectionStorageKey,
  showTabBar,
  stepDecimals,
  stepValue,
  visibleTabs,
  type FieldOption,
} from "./logic.ts";

const FIELDS: FieldOption[] = [
  { key: "m:train/loss", kind: "metric", label: "train/loss" },
  { key: "p:lr", kind: "param", label: "lr" },
  { key: "m:val/loss", kind: "metric", label: "val/loss" },
  { key: "m:val/acc", kind: "metric", label: "val/acc" },
  { key: "e:gap", kind: "expr", label: "gap" },
  { key: "p:optimizer.lr_decay", kind: "param", label: "optimizer.lr_decay" },
];

test("plain search is a case-insensitive substring of label or key", () => {
  assert.deepEqual(filterFields(FIELDS, "LOSS", false).matches.map((o) => o.label), ["train/loss", "val/loss"]);
  assert.deepEqual(filterFields(FIELDS, "m:val", false).matches.map((o) => o.label), ["val/loss", "val/acc"]);
  // Regex metacharacters are literal in plain mode.
  assert.equal(filterFields(FIELDS, "val.*", false).matches.length, 0);
});

test("regex search matches label or key, case-insensitive", () => {
  assert.deepEqual(filterFields(FIELDS, "^val/", true).matches.map((o) => o.label), ["val/loss", "val/acc"]);
  assert.deepEqual(filterFields(FIELDS, "LOSS$", true).matches.map((o) => o.label), ["train/loss", "val/loss"]);
  assert.deepEqual(filterFields(FIELDS, "^p:", true).matches.map((o) => o.label), ["lr", "optimizer.lr_decay"]);
});

test("an invalid regex matches nothing and reports its error", () => {
  const r = filterFields(FIELDS, "val/(", true);
  assert.equal(r.matches.length, 0);
  assert.ok(r.error);
  assert.equal(fieldMatcher("(", false).error, null);
});

test("an empty query matches everything, grouped param · metric · expr", () => {
  const r = filterFields(FIELDS, "  ", true);
  assert.deepEqual(r.groups.map((g) => g.kind), ["param", "metric", "expr"]);
  assert.deepEqual(r.matches.map((o) => o.key), [
    "p:lr", "p:optimizer.lr_decay", "m:train/loss", "m:val/loss", "m:val/acc", "e:gap",
  ]);
});

test("excluded keys are left out and empty groups dropped", () => {
  const r = filterFields(FIELDS, "", false, new Set(["e:gap"]));
  assert.deepEqual(r.groups.map((g) => g.kind), ["param", "metric"]);
});

test("addAll appends new matches in order, without duplicates", () => {
  const matches = filterFields(FIELDS, "loss", false).matches;
  assert.deepEqual(addAll(["m:val/loss", "p:lr"], matches), ["m:val/loss", "p:lr", "m:train/loss"]);
});

test("tabs: fixed order, empty tabs hidden, bar only with two or more", () => {
  assert.deepEqual(visibleTabs({ display: true, data: true }), ["data", "display"]);
  assert.deepEqual(visibleTabs({ expressions: true, grouping: false }), ["expressions"]);
  assert.deepEqual(visibleTabs({}), []);
  assert.equal(showTabBar(["data", "display"]), true);
  assert.equal(showTabBar(["display"]), false);
  assert.equal(showTabBar([]), false);
});

test("activeTab falls back to the first visible tab", () => {
  assert.equal(activeTab("display", ["data", "display"]), "display");
  assert.equal(activeTab("grouping", ["data", "display"]), "data");
  assert.equal(activeTab(null, ["display"]), "display");
  assert.equal(activeTab("data", []), null);
});

test("section open state round-trips through its stored flag", () => {
  assert.equal(sectionStorageKey("Axes"), "cairn:settings-section:Axes");
  assert.equal(parseSectionOpen("1", false), true);
  assert.equal(parseSectionOpen("0", true), false);
  assert.equal(parseSectionOpen(null, true), true);
  assert.equal(parseSectionOpen("garbage", false), false);
});

test("parseNumberDraft: auto, bounds, integers, junk", () => {
  assert.deepEqual(parseNumberDraft(""), { ok: true, value: null });
  assert.equal(parseNumberDraft("", {}, false).ok, false);
  assert.deepEqual(parseNumberDraft(" 1e-3 "), { ok: true, value: 0.001 });
  assert.deepEqual(parseNumberDraft(".5"), { ok: true, value: 0.5 });
  assert.equal(parseNumberDraft("abc").ok, false);
  assert.equal(parseNumberDraft("Infinity").ok, false);
  assert.equal(parseNumberDraft("1.5", { integer: true }).ok, false);
  assert.equal(parseNumberDraft("-1", { min: 0 }).ok, false);
  assert.equal(parseNumberDraft("11", { max: 10 }).ok, false);
  assert.deepEqual(parseNumberDraft("10", { min: 0, max: 10 }), { ok: true, value: 10 });
});

test("stepValue rounds to the step's precision and clamps", () => {
  assert.equal(stepDecimals(0.05), 2);
  assert.equal(stepDecimals(1e-7), 7);
  assert.equal(stepDecimals(2), 0);
  assert.equal(stepValue(0.1, 2, 0.1), 0.3);
  assert.equal(stepValue(0.95, 1, 0.1, 0, 1), 1);
  assert.equal(stepValue(0, -1, 1, 0), 0);
});

test("rangeError: ordering and log positivity", () => {
  assert.equal(rangeError({ min: null, max: null, log: true }), null);
  assert.equal(rangeError({ min: 0, max: 1, log: false }), null);
  assert.ok(rangeError({ min: 1, max: 1, log: false }));
  assert.ok(rangeError({ min: 0, max: 1, log: true }));
  assert.ok(rangeError({ min: null, max: -1, log: true }));
});

test("colormapGradient covers both stop lists and plotly names", () => {
  assert.match(colormapGradient("magma"), /^linear-gradient\(to right, rgb\(0,0,4\) 0\.0%, .* 100\.0%\)$/);
  assert.match(colormapGradient("viridis"), /#440154 0\.0%.*#fde725 100\.0%/);
  assert.match(colormapGradient("greys"), /#000000 0\.0%, #ffffff 100\.0%/);
});
