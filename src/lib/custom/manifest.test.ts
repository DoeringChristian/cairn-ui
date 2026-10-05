/** Manifest parsing/validation and `accepts` matching. Run: `npm run test:unit`. */
import assert from "node:assert/strict";
import test from "node:test";

import {
  acceptMatches, acceptScore, accepts, normalizePath, parseManifest, settingDefaults, settingValues, storedViewerSettings,
  validateSettingsPatch, viewerSettingKey,
} from "./manifest.ts";

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
  const m = ok({ name: "a", accepts: ["x"], imports: { d3: "./vendor/d3.js", "three/addons/": "./vendor/three-addons/" } });
  assert.deepEqual(m.imports, { d3: "vendor/d3.js", "three/addons/": "vendor/three-addons/" });
  assert.match(errs({ name: "a", accepts: ["x"], imports: { lib: "/vendor/lib.js" } }), /"\.\/" path/);
  assert.match(errs({ name: "a", accepts: ["x"], imports: { "./x": "./x.js" } }), /bare specifiers/);
  assert.match(errs({ name: "a", accepts: ["x"], imports: { "https://x": "./x.js" } }), /bare specifiers/);
  assert.match(errs({ name: "a", accepts: ["x"], imports: { d3: "https://cdn.example/d3.js" } }), /no network/);
  assert.match(errs({ name: "a", accepts: ["x"], imports: { d3: "./x/../../d3.js" } }), /leaves the viewer folder/);
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
  assert.deepEqual(settingDefaults(m.settings), { exposure: 1, n: 0, mode: "a", grid: true, cmap: "turbo", label: "" });
  assert.deepEqual(m.settings[2]!.options, [{ value: "a", label: "a" }, { value: "b", label: "B" }]);
  assert.equal(m.settings[5]!.label, "Label");
  assert.equal(m.settings[0]!.label, "exposure");
});

test("settings errors", () => {
  assert.match(errs({ name: "a", accepts: ["x"], settings: [{ key: "e", type: "slider", max: 1 }] }), /needs "min" and "max"/);
  assert.match(errs({ name: "a", accepts: ["x"], settings: [{ key: "e", type: "knob" }] }), /"type" must be one of/);
  assert.match(errs({ name: "a", accepts: ["x"], settings: [{ key: "viewer_version", type: "text" }] }), /is a card setting/);
  assert.match(errs({ name: "a", accepts: ["x"], settings: [{ key: "c", type: "colormap", options: [1] }] }), /colormap names/);
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

test("accepts: custom data as custom:<kind>, globs, built-in types", () => {
  const vmf = { object_type: "custom", kind: "guiding/vmf" };
  assert.ok(acceptMatches("custom:guiding/vmf", vmf));
  assert.ok(acceptMatches("custom:guiding/*", vmf));
  assert.ok(acceptMatches("custom:guiding/*", { object_type: "custom", kind: "guiding/a/b" }), "* crosses /");
  assert.ok(acceptMatches("custom:*", vmf));
  assert.ok(acceptMatches("custom:guiding/vm?", vmf));
  assert.ok(!acceptMatches("custom:guiding/v?", vmf));
  assert.ok(!acceptMatches("custom", vmf), "custom data is matched as custom:<kind>");
  assert.ok(!acceptMatches("custom:guiding/vmfx", vmf));
  assert.ok(!acceptMatches("custom:guiding.vmf", { object_type: "custom", kind: "guidingxvmf" }), "dots are literal");
  assert.ok(acceptMatches("volume", { object_type: "volume" }));
  assert.ok(!acceptMatches("volume", vmf));
  assert.ok(!acceptMatches("custom:*", { object_type: "volume" }));
  assert.ok(accepts({ accepts: ["volume", "custom:field/*"] }, { object_type: "custom", kind: "field/2d" }));
});

test("acceptScore prefers the most specific pattern", () => {
  const s = { object_type: "custom", kind: "guiding/vmf" };
  const exact = acceptScore({ accepts: ["custom:guiding/vmf"] }, s);
  const glob = acceptScore({ accepts: ["custom:guiding/*"] }, s);
  const any = acceptScore({ accepts: ["custom:*"] }, s);
  assert.ok(exact > glob && glob > any && any >= 0);
  assert.equal(acceptScore({ accepts: ["volume"] }, s), -1);
  assert.equal(acceptScore({ accepts: ["volume", "custom:*", "custom:guiding/vmf"] }, s), exact);
});

test("a normalized listing (nulls for none, extra fields) parses", () => {
  const m = ok({
    name: "v", title: "V", entry: "index.js", accepts: ["custom:*"], inputs: "single", webgl: true, view: false,
    settings: [{ key: "c", type: "colormap", label: "c", default: "turbo", options: null }], imports: {}, description: null,
    dev: false, version_id: "abc", version: 3, error: null,
  });
  assert.equal(m.description, undefined);
  assert.equal(m.settings[0]!.options, undefined);
});

test("settings placement, help and icon", () => {
  const m = ok({ name: "a", accepts: ["x"], icon: "globe", settings: [
    { key: "lobes", type: "number", tab: "data", section: "Series", help: "How many lobes." },
    { key: "e", type: "slider", min: 0, max: 1 },
  ] });
  assert.equal(m.icon, "globe");
  assert.deepEqual([m.settings[0]!.tab, m.settings[0]!.section, m.settings[0]!.help], ["data", "Series", "How many lobes."]);
  assert.deepEqual([m.settings[1]!.tab, m.settings[1]!.section, m.settings[1]!.help], ["display", "Appearance", undefined]);
  assert.match(errs({ name: "a", accepts: ["x"], icon: "skull" }), /"icon" must be one of/);
  assert.match(errs({ name: "a", accepts: ["x"], settings: [{ key: "a", type: "text", tab: "advanced" }] }), /"tab" must be one of/);
  assert.match(errs({ name: "a", accepts: ["x"], settings: [{ key: "a", type: "text", section: "Misc" }] }), /"section" must be one of/);
  assert.match(errs({ name: "a", accepts: ["x"], settings: [{ key: "a", type: "text", help: 1 }] }), /"help" must be a string/);
});

test("viewer settings are stored flat per viewer", () => {
  assert.equal(viewerSettingKey("vmf-sphere", "exposure"), "vs:vmf-sphere:exposure");
  const card = { title: "x", "vs:vmf-sphere:exposure": 2, "vs:vmf-sphere:wire": false, "vs:other:exposure": 9, "vs:vmf-sphere:gone": undefined };
  assert.deepEqual(storedViewerSettings(card, "vmf-sphere"), { exposure: 2, wire: false });
  assert.deepEqual(storedViewerSettings(card, "vmf"), {}, "a name prefix is not the viewer");
});

test("validateSettingsPatch: unknown keys and wrong types rejected, numbers clamped", () => {
  const m = ok({ name: "a", accepts: ["x"], settings: [
    { key: "e", type: "slider", min: 0, max: 4, default: 1 },
    { key: "m", type: "select", options: ["a", "b"] },
    { key: "g", type: "switch" },
    { key: "c", type: "colormap", options: ["turbo", "magma"] },
    { key: "t", type: "text" },
  ] });
  const r = validateSettingsPatch(m.settings, { e: 9, m: "b", g: true, c: "viridis", t: "x".repeat(2000), nope: 1, wire: "yes" });
  assert.deepEqual(r.accepted, { e: 4, m: "b", g: true, t: "x".repeat(1000) });
  assert.deepEqual(r.rejected, [`c: "viridis" is not an option`, "nope: not a setting of this viewer", "wire: not a setting of this viewer"]);
  assert.deepEqual(validateSettingsPatch(m.settings, { e: "2", m: "z", g: 1 }).rejected, ["e: expected a number", `m: "z" is not an option`, "g: expected a boolean"]);
  assert.deepEqual(validateSettingsPatch(m.settings, { e: NaN }).rejected, ["e: expected a number"]);
});
