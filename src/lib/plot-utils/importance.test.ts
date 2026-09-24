import { test } from "node:test";
import assert from "node:assert/strict";
import {
  encodeParams,
  fitForest,
  mulberry32,
  parameterImportance,
  pearson,
  predictForest,
  ranks,
  spearman,
  type ImportanceRow,
} from "./importance.ts";

const close = (a: number | null, b: number, eps = 1e-9) => {
  assert.ok(a != null && Math.abs(a - b) < eps, `${a} != ${b}`);
};

test("pearson: perfect, inverse, constant, short", () => {
  close(pearson([1, 2, 3], [2, 4, 6]), 1);
  close(pearson([1, 2, 3], [3, 2, 1]), -1);
  assert.equal(pearson([1, 1, 1], [1, 2, 3]), null);
  assert.equal(pearson([1], [1]), null);
});

test("ranks average ties", () => {
  assert.deepEqual(ranks([10, 20, 20, 5]), [2, 3.5, 3.5, 1]);
});

test("spearman is 1 for any monotone map", () => {
  close(spearman([1, 2, 3, 4], [1, 8, 27, 1000]), 1);
  close(spearman([1, 2, 3, 4], [4, 3, 2, 1]), -1);
});

test("mulberry32 is deterministic per seed", () => {
  const a = mulberry32(42);
  const b = mulberry32(42);
  for (let i = 0; i < 5; i++) assert.equal(a(), b());
  const x = mulberry32(1)();
  assert.ok(x >= 0 && x < 1);
});

test("encodeParams: numeric, bool, one-hot, missing, constant dropped", () => {
  const rows: ImportanceRow[] = [
    { params: { lr: 0.1, opt: "adam", flag: true, same: 1 }, target: 0 },
    { params: { lr: 0.2, opt: "sgd", flag: false, same: 1 }, target: 0 },
    { params: { opt: "adam", same: 1 }, target: 0 },
  ];
  const enc = encodeParams(rows);
  assert.deepEqual(
    enc.params.map((p) => [p.key, p.kind, p.columns.length]),
    [["flag", "numeric", 1], ["lr", "numeric", 1], ["opt", "categorical", 2]],
  );
  const lrCol = enc.params.find((p) => p.key === "lr")!.columns[0]!;
  close(enc.X[2]![lrCol]!, 0.15); // mean-imputed
  const [adam, sgd] = enc.params.find((p) => p.key === "opt")!.columns;
  assert.deepEqual(enc.X.map((r) => [r[adam!], r[sgd!]]), [[1, 0], [0, 1], [1, 0]]);
});

test("forest fits a step function", () => {
  const X = Array.from({ length: 40 }, (_, i) => [i]);
  const y = X.map(([x]) => (x! < 20 ? 0 : 10));
  const f = fitForest(X, y, { trees: 20, seed: 3 });
  assert.ok(predictForest(f, [2]) < 3);
  assert.ok(predictForest(f, [37]) > 7);
});

test("parameterImportance ranks the driving param first", () => {
  const rand = mulberry32(7);
  const rows: ImportanceRow[] = [];
  for (let i = 0; i < 60; i++) {
    const lr = rand();
    const noise = rand();
    const opt = rand() < 0.5 ? "adam" : "sgd";
    rows.push({ params: { lr, noise, opt }, target: -5 * lr + (opt === "adam" ? 1 : 0) });
  }
  const out = parameterImportance(rows);
  assert.equal(out[0]!.key, "lr");
  const byKey = Object.fromEntries(out.map((p) => [p.key, p]));
  assert.ok(byKey.lr!.importance > byKey.noise!.importance);
  assert.ok(byKey.opt!.importance > byKey.noise!.importance);
  assert.ok(byKey.lr!.pearson! < -0.9);
  assert.equal(byKey.opt!.pearson, null);
  assert.equal(byKey.opt!.kind, "categorical");
});

test("parameterImportance is deterministic", () => {
  const rows: ImportanceRow[] = Array.from({ length: 12 }, (_, i) => ({
    params: { a: i, b: i % 3 },
    target: i * 2 + (i % 3),
  }));
  assert.deepEqual(parameterImportance(rows), parameterImportance(rows));
});

test("parameterImportance: too few runs or non-finite targets", () => {
  assert.deepEqual(parameterImportance([{ params: { a: 1 }, target: 1 }, { params: { a: 2 }, target: 2 }]), []);
  const rows = [
    { params: { a: 1 }, target: 1 },
    { params: { a: 2 }, target: NaN },
    { params: { a: 3 }, target: 3 },
  ];
  assert.deepEqual(parameterImportance(rows), []);
});
