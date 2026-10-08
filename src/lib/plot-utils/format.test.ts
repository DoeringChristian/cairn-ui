import { test } from "node:test";
import assert from "node:assert/strict";
import { axisTickLabel, decodeConfigValue, formatNum, formatValue } from "./format.ts";

test("formatNum: integers exact, other numbers to 4 significant digits", () => {
  assert.equal(formatNum(12), "12");
  assert.equal(formatNum(12345), "12345");
  assert.equal(formatNum(-7), "-7");
  assert.equal(formatNum(0.123456), "0.1235");
  assert.equal(formatNum(2.5), "2.5");
  assert.equal(formatNum(0.000123456), "0.0001235");
  assert.equal(formatNum(123456.789), "123500");
  assert.equal(formatNum(NaN), "NaN");
  assert.equal(formatNum(-Infinity), "-Infinity");
});

test("formatValue: one format for every logged value", () => {
  assert.equal(formatValue(0.000123456), "0.0001235");
  assert.equal(formatValue(3), "3");
  assert.equal(formatValue("adam"), "adam");
  assert.equal(formatValue(true), "true");
  assert.equal(formatValue([1, 2]), "[1,2]");
  assert.equal(formatValue({ a: 1 }), '{"a":1}');
  assert.equal(formatValue(undefined), "—");
  assert.equal(formatValue(null), "—");
  assert.equal(formatValue(null, { empty: "" }), "");
  assert.equal(formatValue(0.000123456, { exact: true }), "0.000123456");
});

test("decodeConfigValue", () => {
  assert.equal(decodeConfigValue('"adam"'), "adam");
  assert.equal(decodeConfigValue("0.001"), 0.001);
  assert.equal(decodeConfigValue("true"), true);
  assert.equal(decodeConfigValue("null"), null);
  assert.equal(decodeConfigValue("[1, 2]"), "[1,2]");
  assert.equal(decodeConfigValue('{"b": 1}'), '{"b":1}');
  assert.equal(decodeConfigValue("adam"), "adam");
});

test("axisTickLabel: small ticks keep their digits (uPlot's default rounded 0.0001 to 0)", () => {
  assert.deepEqual([0.0003, 0.0002, 0.0001, 0].map(axisTickLabel), ["0.0003", "0.0002", "0.0001", "0"]);
  assert.equal(axisTickLabel(0.30000000000000004), "0.3");
  assert.equal(axisTickLabel(-0), "0");
  assert.equal(axisTickLabel(1000), "1000");
  assert.equal(axisTickLabel(null), "");
});
