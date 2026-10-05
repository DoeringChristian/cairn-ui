/** Every manifest setting gets one place in the card's settings. Run: `npm run test:unit`. */
import assert from "node:assert/strict";
import test from "node:test";

import { parseManifest, SETTING_SECTIONS, SETTING_TABS } from "./manifest.ts";
import { initialTab, placeSettings } from "./placement.ts";

const manifest = (settings: unknown[]) => {
  const r = parseManifest({ name: "v", accepts: ["x"], settings });
  if (!r.ok) assert.fail(r.errors.join("; "));
  return r.manifest;
};

test("every setting is placed exactly once, in its tab and section", () => {
  // A setting in every tab × section, plus ones without tab / section.
  const settings: unknown[] = [];
  for (const tab of SETTING_TABS) for (const section of SETTING_SECTIONS) settings.push({ key: `${tab}_${section}`, type: "switch", tab, section });
  settings.push({ key: "noTab", type: "switch", section: "Overlays" });
  settings.push({ key: "noSection", type: "switch", tab: "data" });
  settings.push({ key: "neither", type: "slider", min: 0, max: 1 });
  const m = manifest(settings);
  const p = placeSettings(m);
  const placed = Object.entries(p).flatMap(([tab, sections]) => sections.flatMap((s) => s.keys.map((k) => `${tab}/${s.section}/${k}`)));
  assert.equal(placed.length, m.settings.length);
  assert.equal(new Set(placed.map((x) => x.split("/")[2])).size, m.settings.length);
  for (const s of m.settings) assert.ok(placed.includes(`${s.tab}/${s.section}/${s.key}`), s.key);
  assert.ok(placed.includes("display/Overlays/noTab"));
  assert.ok(placed.includes("data/Appearance/noSection"));
  assert.ok(placed.includes("display/Appearance/neither"));
});

test("sections the card renders merge; others are added in manifest order", () => {
  const m = manifest([
    { key: "wire", type: "switch", section: "Overlays" },
    { key: "exposure", type: "slider", min: 0, max: 4 },
    { key: "lobes", type: "number", tab: "data", section: "Series" },
    { key: "cols", type: "number", section: "Layout" },
    { key: "pointSize", type: "number" },
  ]);
  const p = placeSettings(m);
  assert.deepEqual(p.display, [
    { section: "Overlays", keys: ["wire"], merged: false },
    { section: "Appearance", keys: ["exposure", "pointSize"], merged: false },
    { section: "Layout", keys: ["cols"], merged: true },
  ]);
  assert.deepEqual(p.data, [{ section: "Series", keys: ["lobes"], merged: true }]);
});

test("the settings open where the viewer's settings are", () => {
  assert.equal(initialTab(placeSettings(manifest([{ key: "a", type: "switch" }]))), "display");
  assert.equal(initialTab(placeSettings(manifest([{ key: "a", type: "switch", tab: "data" }]))), "data");
  assert.equal(initialTab(placeSettings(manifest([]))), "data");
});
