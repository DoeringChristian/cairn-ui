import { test } from "node:test";
import assert from "node:assert/strict";
import { collapseRelations, commandLine, configRows, filterRows, relationItems, summaryRows } from "./run-overview.ts";
import { rulesOf } from "./metric-rules.ts";

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
    rulesOf({ logged: { "eval/mse": "min" }, overrides: {}, rules: {} }),
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

test("relation items: runs (name vN, short id unnamed) then artifacts, other projects prefixed and marked", () => {
  const items = relationItems(
    "p",
    [
      { id: "aaaaaaaa11", display_name: "pretrain", version: 2, project_id: "p" },
      { id: "bbbbbbbb22", display_name: null, version: null, project_id: "q" },
    ],
    [
      { id: "v1", project_id: "p", name: "data-exp-44", version: 1, ref: "data-exp-44:v1" },
      { id: "v2", project_id: "other-proj", name: "model", version: 3, ref: "model:v3" },
    ],
  );
  assert.deepEqual(items, [
    { key: "r:aaaaaaaa11", label: "pretrain v2", href: "/p/p/r/aaaaaaaa11", otherProject: false },
    { key: "r:bbbbbbbb22", label: "bbbbbb", href: "/p/q/r/bbbbbbbb22", otherProject: false },
    { key: "a:v1", label: "data-exp-44:v1", href: "/p/p/artifacts/data-exp-44/v1", otherProject: false },
    { key: "a:v2", label: "other-proj/model:v3", href: "/p/other-proj/artifacts/model/v3", otherProject: true },
  ]);
});

test("collapse relations: +N more past the limit, never +1 more, all when expanded", () => {
  const xs = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  assert.deepEqual(collapseRelations(xs, false, 6), { items: [1, 2, 3, 4, 5, 6], more: 3 });
  assert.deepEqual(collapseRelations(xs.slice(0, 7), false, 6), { items: xs.slice(0, 7), more: 0 });
  assert.deepEqual(collapseRelations(xs, true, 6), { items: xs, more: 0 });
});
