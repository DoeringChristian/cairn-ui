import { test } from "node:test";
import assert from "node:assert/strict";
import { commandLine, configRows, filterRows, summaryRows } from "./run-overview.ts";

const P = (key: string, value: string) => ({ key, value, value_type: "x" });

test("config rows: dotted keys, JSON-decoded values, A–Z", () => {
  const rows = configRows([P("noise", "0.5"), P("model.depth", "4"), P("optimizer", '"adam"'), P("raw", "not json")]);
  assert.deepEqual(rows, [
    { key: "model.depth", value: 4 },
    { key: "noise", value: 0.5 },
    { key: "optimizer", value: "adam" },
    { key: "raw", value: "not json" },
  ]);
});

test("summary rows: metric values with their source, then the summary's other keys; system series left out", () => {
  const media = { $media: { hash: "h", object_type: "figure", mime_type: "image/png" } };
  const rows = summaryRows(
    { "train/loss": 0.04, "eval/mse": 0.25, best: 0.69, "system.cpu": 3 },
    { best: 0.69, note: "converged", plots: { fig: media } },
    [P("best", "0.69"), P("note", '"converged"')],
    [{ name: "eval/mse", summary: "min", x: null }],
  );
  assert.deepEqual(
    rows.map((r) => [r.key, r.value === media ? "media" : r.value, r.source, r.media ? r.media.object_type : null]),
    [
      ["best", 0.69, "summary", null],
      ["eval/mse", 0.25, "min", null],
      ["note", "converged", "summary", null],
      ["plots.fig", "media", "summary", "figure"],
      ["train/loss", 0.04, "last", null],
    ],
  );
});

test("search filters keys, case-insensitive", () => {
  const rows = [{ key: "train/Loss" }, { key: "eval/mse" }];
  assert.deepEqual(filterRows(rows, " loss "), [{ key: "train/Loss" }]);
  assert.equal(filterRows(rows, "").length, 2);
});

test("command line: a Python script runs under python; odd arguments are quoted", () => {
  assert.equal(commandLine(["train.py", "--lr", "3e-4"]), "python train.py --lr 3e-4");
  assert.equal(commandLine(["/bin/tool", "a b"]), "/bin/tool 'a b'");
  assert.equal(commandLine([]), "");
});
