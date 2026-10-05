/** Manifest parsing/validation and `accepts` matching. Run: `npm run test:unit`. */
import assert from "node:assert/strict";
import test from "node:test";

import { acceptMatches, acceptScore, accepts, normalizePath, parseManifest, settingDefaults, settingValues } from "./manifest.ts";

const ok = (raw: unknown) => {
  const r = parseManifest(raw);
  if (!r.ok) assert.fail(r.errors.join("; "));
  return r.manifest;
};
const errs = (raw: unknown) => {
  const r = parseManifest(raw);
  assert.equal(r.ok, false);
  return r.ok ? [] : r.errors.join("\n");
};

test("a minimal manifest gets its defaults", () => {
  const m = ok({ name: "vmf", accepts: ["custom:guiding/vmf"] });
  assert.deepEqual(m, {
    name: "vmf", title: "vmf", accepts: ["custom:guiding/vmf"], inputs: "single", webgl: false, view: false,
    entry: "index.js", imports: {}, settings: [],
  });
});

test("a JSON string parses; unknown fields are ignored", () => {
  const m = ok(JSON.stringify({ name: "a", accepts: ["volume"], futureField: { x: 1 }, inputs: "compare", webgl: true, view: true, entry: "./src/main.js" }));
  assert.equal(m.inputs, "compare");
  assert.equal(m.entry, "src/main.js");
  assert.equal("futureField" in m, false);
});

test("bad shapes name the field", () => {
  assert.match(errs("{"), /not JSON/);
  assert.match(errs([]), /must be an object/);
  assert.match(errs({ accepts: ["x"] }), /"name" is required/);
  assert.match(errs({ name: "Bad Name", accepts: ["x"] }), /"name" must match/);
  assert.match(errs({ name: "a", accepts: [] }), /"accepts"/);
  assert.match(errs({ name: "a", accepts: ["x"], inputs: "three" }), /"inputs"/);
  assert.match(errs({ name: "a", accepts: ["x"], webgl: "yes" }), /"webgl"/);
  assert.match(errs({ name: "a", accepts: ["x"], entry: "../escape.js" }), /"entry"/);
});

test("imports: vendored files and folder prefixes, inside the folder only", () => {
  const m = ok({ name: "a", accepts: ["x"], imports: { d3: "./vendor/d3.js", "three/addons/": "./vendor/three-addons/", lib: "/vendor/lib.js" } });
  assert.deepEqual(m.imports, { d3: "vendor/d3.js", "three/addons/": "vendor/three-addons/", lib: "vendor/lib.js" });
  assert.match(errs({ name: "a", accepts: ["x"], imports: { d3: "https://cdn.example/d3.js" } }), /no network/);
  assert.match(errs({ name: "a", accepts: ["x"], imports: { d3: "../d3.js" } }), /leaves the viewer folder/);
  assert.match(errs({ name: "a", accepts: ["x"], imports: { "x/": "./vendor/x.js" } }), /ends both sides/);
  assert.match(errs({ name: "a", accepts: ["x"], imports: { "cairn:three": "./three.js" } }), /provided by cairn/);
});

test("settings: the palette vocabulary with defaults", () => {
  const m = ok({
    name: "a", accepts: ["x"], settings: [
      { key: "exposure", type: "slider", min: 0, max: 4, default: 1 },
      { key: "n", type: "number" },
      { key: "mode", type: "select", options: ["a", { value: "b", label: "B" }] },
      { key: "grid", type: "switch", default: true },
      { key: "cmap", type: "colormap" },
      { key: "label", type: "text", label: "Label" },
    ],
  });
  assert.deepEqual(settingDefaults(m.settings), { exposure: 1, n: 0, mode: "a", grid: true, cmap: "viridis", label: "" });
  assert.deepEqual(m.settings[2]!.options, [{ value: "a", label: "a" }, { value: "b", label: "B" }]);
  assert.equal(m.settings[5]!.label, "Label");
  assert.equal(m.settings[0]!.label, "exposure");
});

test("settings errors", () => {
  assert.match(errs({ name: "a", accepts: ["x"], settings: [{ key: "e", type: "slider", max: 1 }] }), /needs "min" and "max"/);
  assert.match(errs({ name: "a", accepts: ["x"], settings: [{ key: "e", type: "knob" }] }), /"type" must be one of/);
  assert.match(errs({ name: "a", accepts: ["x"], settings: [{ key: "panelMode", type: "text" }] }), /is a card setting/);
  assert.match(errs({ name: "a", accepts: ["x"], settings: [{ key: "a", type: "text" }, { key: "a", type: "text" }] }), /duplicate key/);
  assert.match(errs({ name: "a", accepts: ["x"], settings: [{ key: "m", type: "select", options: ["a"], default: "z" }] }), /not one of the options/);
  assert.match(errs({ name: "a", accepts: ["x"], settings: [{ key: "m", type: "switch", default: 1 }] }), /true or false/);
});

test("settingValues keeps stored values that still fit", () => {
  const m = ok({ name: "a", accepts: ["x"], settings: [
    { key: "e", type: "slider", min: 0, max: 4, default: 1 },
    { key: "m", type: "select", options: ["a", "b"] },
    { key: "g", type: "switch" },
  ] });
  assert.deepEqual(settingValues(m.settings, { e: 2, m: "gone", g: "true", stale: 5 }), { e: 2, m: "a", g: false });
  assert.deepEqual(settingValues(m.settings, undefined), { e: 1, m: "a", g: false });
});

test("normalizePath", () => {
  assert.equal(normalizePath("./a/./b/../c.js"), "a/c.js");
  assert.equal(normalizePath("/x.js"), "x.js");
  assert.equal(normalizePath("../x.js"), null);
});

test("accepts: kinds with globs, built-in types", () => {
  const vmf = { object_type: "custom", kind: "guiding/vmf" };
  assert.ok(acceptMatches("custom:guiding/vmf", vmf));
  assert.ok(acceptMatches("custom:guiding/*", vmf));
  assert.ok(!acceptMatches("custom:*", vmf), "* stays within a segment");
  assert.ok(acceptMatches("custom:**", vmf));
  assert.ok(acceptMatches("custom", vmf), "a bare type takes every kind");
  assert.ok(!acceptMatches("custom:guiding/vmfx", vmf));
  assert.ok(!acceptMatches("custom:guiding.vmf", { object_type: "custom", kind: "guidingxvmf" }), "dots are literal");
  assert.ok(acceptMatches("volume", { object_type: "volume" }));
  assert.ok(!acceptMatches("volume", vmf));
  assert.ok(!acceptMatches("custom:x", { object_type: "custom" }), "no kind, no kind match");
  assert.ok(accepts({ accepts: ["volume", "custom:field/*"] }, { object_type: "custom", kind: "field/2d" }));
});

test("acceptScore prefers the most specific pattern", () => {
  const s = { object_type: "custom", kind: "guiding/vmf" };
  const exact = acceptScore({ accepts: ["custom:guiding/vmf"] }, s);
  const glob = acceptScore({ accepts: ["custom:guiding/*"] }, s);
  const any = acceptScore({ accepts: ["custom:**"] }, s);
  const bare = acceptScore({ accepts: ["custom"] }, s);
  assert.ok(exact > glob && glob > any && any > bare && bare >= 0);
  assert.equal(acceptScore({ accepts: ["volume"] }, s), -1);
});
