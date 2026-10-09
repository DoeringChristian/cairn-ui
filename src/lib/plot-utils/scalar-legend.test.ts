import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AUTO_FONT_BREAK_PX,
  legendFontPx,
  parseSeriesLabel,
  renderSeriesLabel,
  showPointMarkers,
} from "./scalar-legend.ts";

test("legend font size: fixed sizes, auto by chart width", () => {
  assert.equal(legendFontPx("small", 900), 10);
  assert.equal(legendFontPx("medium", 100), 12);
  assert.equal(legendFontPx("large", 100), 14);
  assert.equal(legendFontPx("auto", AUTO_FONT_BREAK_PX - 1), 10);
  assert.equal(legendFontPx("auto", AUTO_FONT_BREAK_PX), 12);
  assert.equal(legendFontPx("auto", 0), 10); // not measured yet
});

test("series label: wandb's default template, hover section only while hovering", () => {
  const parts = parseSeriesLabel("[[ ${x}: ${y} ]] p-a train/loss");
  assert.deepEqual(parts, [
    { hover: true, src: " ${x}: ${y} ", start: 2 },
    { hover: false, src: " p-a train/loss", start: 16 },
  ]);
  assert.equal(renderSeriesLabel(parts), "p-a train/loss");
  assert.equal(renderSeriesLabel(parts, { hover: { x: "12", y: "0.5" } }), "12: 0.5 p-a train/loss");
});

test("series label: plain parts go through the run template; unclosed [[ is text", () => {
  const parts = parseSeriesLabel("${run.group} [[(${ y })]] lr");
  const text = (src: string) => src.replace("${run.group}", "g1");
  assert.equal(renderSeriesLabel(parts, { text }), "g1 lr");
  assert.equal(renderSeriesLabel(parts, { text, hover: { x: "3", y: "7" } }), "g1 (7) lr");
  assert.deepEqual(parseSeriesLabel("a [[ b"), [{ hover: false, src: "a [[ b", start: 0 }]);
  assert.deepEqual(parseSeriesLabel(""), []);
});

test("point markers: lines of one or two points, never an empty or longer line", () => {
  assert.equal(showPointMarkers([null, 1, null]), true);
  assert.equal(showPointMarkers([1, null, 2]), true);
  assert.equal(showPointMarkers([1, 2, 3]), false);
  assert.equal(showPointMarkers([null, null]), false);
  assert.equal(showPointMarkers([NaN, 1]), true);
});
