import { test } from "node:test";
import assert from "node:assert/strict";
import { extensionOf, isTextKind, kindIcon, npzSceneKind, tableFormat, viewerKind } from "./kind.ts";
import { csvToTable, csvValue, isPlotlyFigure, jsonlToTable, parseCsv, prettyJson, recordsToTable } from "./table-source.ts";
import { audioPeaks, channelLabel } from "./audio-peaks.ts";

const k = (path: string, mime: string | null = null, object_type: string | null = null, digest: string | null | undefined = "h") =>
  viewerKind({ path, mime, object_type, digest });

test("viewerKind: the logged cairn type wins", () => {
  assert.equal(k("a.bin", null, "image"), "image");
  assert.equal(k("clip.bin", "application/octet-stream", "video"), "video");
  assert.equal(k("t.json", "application/json", "table"), "table");
  assert.equal(k("f.png", "image/png", "figure"), "figure");
  assert.equal(k("x.npz", null, "pointcloud"), "pointcloud");
  assert.equal(k("x.npz", null, "mesh"), "mesh");
  assert.equal(k("x.npy", null, "tensor"), "tensor");
  assert.equal(k("m.pkl", "application/octet-stream", "pickle"), "pickle");
  // A type without a viewer of its own falls through to mime / extension.
  assert.equal(k("h.npy", null, "histogram"), "tensor");
});

test("viewerKind: mime, then extension", () => {
  assert.equal(k("a.bin", null, null, null), "reference");
  assert.equal(k("x.png"), "image");
  assert.equal(k("x", "image/jpeg"), "image");
  assert.equal(k("render.exr"), "image");
  assert.equal(k("clip.mp4"), "video");
  assert.equal(k("clip.webm"), "video");
  assert.equal(k("x", "video/mp4"), "video");
  assert.equal(k("a.wav"), "audio");
  assert.equal(k("x", "audio/mpeg"), "audio");
  assert.equal(k("README.md"), "markdown");
  assert.equal(k("report.html"), "html");
  assert.equal(k("c.json"), "json");
  assert.equal(k("t.csv"), "table");
  assert.equal(k("t.tsv"), "table");
  assert.equal(k("t.jsonl"), "table");
  assert.equal(k("x", "text/csv"), "table");
  assert.equal(k("w.npy"), "tensor");
  assert.equal(k("w.npz"), "arrays");
  assert.equal(k("run.log"), "text");
  assert.equal(k("train.py"), "text");
  assert.equal(k("x", "text/plain; charset=utf-8"), "text");
  assert.equal(k("w.bin", "application/octet-stream"), "binary");
  assert.equal(k("model.ply"), "binary");
  // Stored content (no digest given) is never a reference.
  assert.equal(viewerKind({ path: "x.png" }), "image");
});

test("tableFormat, extensionOf, isTextKind, kindIcon", () => {
  assert.equal(tableFormat({ object_type: "table", path: "t.json" }), "cairn");
  assert.equal(tableFormat({ path: "a.csv" }), "csv");
  assert.equal(tableFormat({ path: "a.tsv" }), "tsv");
  assert.equal(tableFormat({ path: "a.jsonl" }), "jsonl");
  assert.equal(tableFormat({ path: "x", mime: "text/tab-separated-values" }), "tsv");
  assert.equal(extensionOf("dir.v2/archive.tar.GZ"), "gz");
  assert.equal(extensionOf(".bashrc"), "");
  assert.equal(extensionOf(null), "");
  assert.equal(isTextKind("table"), true);
  assert.equal(isTextKind("image"), false);
  assert.equal(kindIcon("video"), "fa-film");
  assert.equal(kindIcon("binary"), "fa-file");
});

test("parseCsv: quotes, escapes, newlines in fields, CRLF, row cap", () => {
  const { rows, truncated } = parseCsv('a,b\r\n"x, y","he said ""hi"""\n"multi\nline",2\n');
  assert.deepEqual(rows, [["a", "b"], ["x, y", 'he said "hi"'], ["multi\nline", "2"]]);
  assert.equal(truncated, false);
  const capped = parseCsv("1\n2\n3\n4\n", { maxRows: 2 });
  assert.deepEqual(capped.rows, [["1"], ["2"]]);
  assert.equal(capped.truncated, true);
  assert.deepEqual(parseCsv("a\tb\n1\t2", { delimiter: "\t" }).rows, [["a", "b"], ["1", "2"]]);
  assert.equal(prettyJson('{"a":1}'), '{\n  "a": 1\n}');
  assert.equal(prettyJson("{"), null);
});

test("csvToTable types columns and names them uniquely", () => {
  const t = csvToTable("step,loss,name,,name\n1,0.5,a,true,x\n2,,b,false,y\n");
  assert.deepEqual(t.columns, [
    { name: "step", type: "number" },
    { name: "loss", type: "number" },
    { name: "name", type: "string" },
    { name: "col_4", type: "bool" },
    { name: "name_2", type: "string" },
  ]);
  assert.deepEqual(t.data, [[1, 0.5, "a", true, "x"], [2, null, "b", false, "y"]]);
  assert.equal(t.truncated, false);
  assert.equal(csvValue(" 1e-3 "), 0.001);
  assert.ok(Number.isNaN(csvValue("nan") as number));
  assert.equal(csvValue("12abc"), "12abc");
  // A cut text drops its partial last line and says it is truncated.
  const cut = csvToTable("a\n1\n2\n3", { cut: true });
  assert.deepEqual(cut.data, [[1], [2]]);
  assert.equal(cut.truncated, true);
  assert.equal(csvToTable("a\n1\n2\n3\n", { maxRows: 2 }).data.length, 2);
  assert.equal(csvToTable("a\n1\n2\n3\n", { maxRows: 2 }).truncated, true);
});

test("recordsToTable / jsonlToTable", () => {
  const t = recordsToTable([{ a: 1, b: "x" }, { a: 2, c: true }])!;
  assert.deepEqual(t.columns.map((c) => c.name), ["a", "b", "c"]);
  assert.deepEqual(t.data, [[1, "x", null], [2, null, true]]);
  assert.equal(recordsToTable([1, 2]), null);
  assert.equal(recordsToTable({ a: 1 }), null);
  assert.equal(recordsToTable([]), null);
  assert.deepEqual(jsonlToTable('{"a":1}\n{"a":2}\n')!.data, [[1], [2]]);
  assert.equal(jsonlToTable("{\"a\":1}\nnot json\n"), null);
  assert.equal(jsonlToTable('{"a":1}\n{"a"', { cut: true })!.truncated, true);
});

test("isPlotlyFigure", () => {
  assert.equal(isPlotlyFigure({ data: [{ type: "scatter", x: [1], y: [2] }], layout: {} }), true);
  assert.equal(isPlotlyFigure({ data: [{ x: [1], y: [2] }] }), true);
  assert.equal(isPlotlyFigure({ data: [] }), false);
  assert.equal(isPlotlyFigure({ data: [1, 2] }), false);
  assert.equal(isPlotlyFigure({ data: [{ type: "bar" }], layout: 3 }), false);
  assert.equal(isPlotlyFigure([{ a: 1 }]), false);
});

test("audioPeaks: max |sample| per bin over every channel", () => {
  assert.deepEqual(audioPeaks([[0, 0.5, -1, 0.25]], 2), [0.5, 1]);
  assert.deepEqual(audioPeaks([[0, 0.1], [0.3, -0.2]], 2), [0.3, 0.2]);
  assert.deepEqual(audioPeaks([[0.5]], 10), [0.5]);
  assert.deepEqual(audioPeaks([], 10), []);
  assert.deepEqual(audioPeaks([[2]], 1), [1]);
  assert.equal(channelLabel(1), "mono");
  assert.equal(channelLabel(2), "stereo");
  assert.equal(channelLabel(6), "6ch");
});

test("npzSceneKind by member names", () => {
  assert.equal(npzSceneKind(["positions", "faces", "normals"]), "mesh");
  assert.equal(npzSceneKind(["points", "values_t"]), "pointcloud");
  assert.equal(npzSceneKind(["mins", "maxs", "depth"]), "boxes3d");
  assert.equal(npzSceneKind(["weights", "bias"]), null);
});
