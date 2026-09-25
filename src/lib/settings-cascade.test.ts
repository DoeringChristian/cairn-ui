import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isOverridden,
  jsonEqual,
  parentValue,
  removeOverride,
  resolveSettings,
  setOverride,
  type SettingsLayers,
} from "./settings-cascade.ts";

interface S {
  version: 1;
  smoothing: number;
  yScale: "linear" | "log";
  title?: string;
  metrics: string[];
  tooltip: { showWallTime: boolean };
}

const builtin: S = { version: 1, smoothing: 0, yScale: "linear", metrics: [], tooltip: { showWallTime: true } };
const CASCADE = ["smoothing", "yScale", "tooltip"] as const;

test("builtin alone resolves to builtin", () => {
  assert.deepEqual(resolveSettings({ builtin }, CASCADE), builtin);
});

test("cascade keys: card > instance > section > workspace > builtin", () => {
  const layers: SettingsLayers<S> = {
    builtin,
    workspace: { smoothing: 0.1, yScale: "log" },
    section: { smoothing: 0.2 },
  };
  let v = resolveSettings(layers, CASCADE);
  assert.equal(v.smoothing, 0.2);
  assert.equal(v.yScale, "log");
  v = resolveSettings({ ...layers, instance: { smoothing: 0.3 } }, CASCADE);
  assert.equal(v.smoothing, 0.3);
  v = resolveSettings({ ...layers, instance: { smoothing: 0.3 }, card: { smoothing: 0.4 } }, CASCADE);
  assert.equal(v.smoothing, 0.4);
});

test("non-cascade keys ignore workspace and section", () => {
  const layers: SettingsLayers<S> = {
    builtin,
    workspace: { title: "ws", metrics: ["w"] },
    section: { title: "sec" },
    instance: { metrics: ["seed"] },
  };
  const v = resolveSettings(layers, CASCADE);
  assert.equal(v.title, undefined);
  assert.deepEqual(v.metrics, ["seed"]);
  assert.equal(resolveSettings({ ...layers, card: { title: "mine" } }, CASCADE).title, "mine");
});

test("undefined in a layer does not shadow lower layers", () => {
  const v = resolveSettings<S>({ builtin, workspace: { smoothing: 0.5 }, card: { smoothing: undefined } }, CASCADE);
  assert.equal(v.smoothing, 0.5);
});

test("keys outside builtin still resolve from the card", () => {
  const v = resolveSettings<S & { extra?: number }>({ builtin, card: { extra: 3 } }, CASCADE);
  assert.equal(v.extra, 3);
});

test("parentValue skips the card layer", () => {
  const layers: SettingsLayers<S> = { builtin, workspace: { smoothing: 0.1 }, card: { smoothing: 0.9 } };
  assert.equal(parentValue(layers, "smoothing", CASCADE), 0.1);
  assert.equal(parentValue(layers, "title", CASCADE), undefined);
  assert.deepEqual(parentValue({ builtin, workspace: { metrics: ["x"] } }, "metrics", CASCADE), []);
});

test("cascadeKeys accepts a Set", () => {
  const v = resolveSettings<S>({ builtin, workspace: { smoothing: 0.1 } }, new Set(["smoothing"]));
  assert.equal(v.smoothing, 0.1);
});

test("setOverride stores differing values and drops ones equal to the parent", () => {
  const parent = (k: string) => parentValue<S>({ builtin, workspace: { smoothing: 0.1 } }, k, CASCADE);
  let card = setOverride<S>({}, { smoothing: 0.5, yScale: "log" }, parent);
  assert.deepEqual(card, { smoothing: 0.5, yScale: "log" });
  card = setOverride<S>(card, { smoothing: 0.1 }, parent);
  assert.deepEqual(card, { yScale: "log" });
  card = setOverride<S>(card, { tooltip: { showWallTime: true } }, parent);
  assert.deepEqual(card, { yScale: "log" }, "deep-equal objects are dropped");
  card = setOverride<S>(card, { yScale: undefined }, parent);
  assert.deepEqual(card, {}, "undefined removes");
});

test("setOverride and removeOverride never mutate their input", () => {
  const card: Partial<S> = { smoothing: 0.5 };
  setOverride<S>(card, { smoothing: 0 }, () => 0);
  removeOverride<S>(card, "smoothing");
  assert.deepEqual(card, { smoothing: 0.5 });
  assert.deepEqual(removeOverride<S>(card, "smoothing"), {});
});

test("isOverridden", () => {
  assert.equal(isOverridden({ smoothing: 0 }, "smoothing"), true);
  assert.equal(isOverridden({ smoothing: undefined }, "smoothing"), false);
  assert.equal(isOverridden({}, "smoothing"), false);
  assert.equal(isOverridden(null, "smoothing"), false);
});

test("jsonEqual", () => {
  assert.ok(jsonEqual({ a: [1, { b: null }] }, { a: [1, { b: null }] }));
  assert.ok(jsonEqual({ a: 1, u: undefined }, { a: 1 }));
  assert.ok(!jsonEqual([1, 2], [2, 1]));
  assert.ok(!jsonEqual({ a: 1 }, [1]));
  assert.ok(!jsonEqual(null, {}));
});
