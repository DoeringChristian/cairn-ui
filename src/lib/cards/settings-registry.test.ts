import { test } from "node:test";
import assert from "node:assert/strict";
import { CARD_TYPES } from "./card-spec.ts";
import { metaFor, SETTINGS_TABS } from "./settings-registry.ts";

test("every card type has settings metadata", () => {
  for (const type of CARD_TYPES) {
    const meta = metaFor(type);
    assert.ok(meta, type);
    assert.equal(typeof meta.builtin, "object", type);
    assert.equal(meta.builtin.version, 1, `${type}: builtin carries version 1`);
  }
});

test("cascadeKeys ⊆ keys(builtin), without duplicates or per-card keys", () => {
  const PER_CARD = ["version", "metrics", "title", "height", "colSpan", "viewport", "collapsed", "sliderStep"];
  for (const type of CARD_TYPES) {
    const { builtin, cascadeKeys } = metaFor(type);
    const keys = new Set(Object.keys(builtin));
    for (const k of cascadeKeys) {
      assert.ok(keys.has(k), `${type}: cascade key "${k}" is not in builtin`);
      assert.ok(!PER_CARD.includes(k), `${type}: "${k}" is per card and must not cascade`);
    }
    assert.equal(new Set(cascadeKeys).size, cascadeKeys.length, `${type}: duplicate cascade keys`);
  }
});

test("tabs are known and in display order", () => {
  for (const type of CARD_TYPES) {
    const { tabs } = metaFor(type);
    const idx = tabs.map((t) => SETTINGS_TABS.indexOf(t));
    assert.ok(idx.every((i) => i >= 0), `${type}: unknown tab`);
    assert.deepEqual(idx, [...idx].sort((a, b) => a - b), `${type}: tabs out of order`);
  }
});

test("simple cards get no tabs", () => {
  for (const type of ["text", "html", "markdown", "audio", "artifact"] as const) {
    assert.deepEqual(metaFor(type).tabs, [], type);
  }
});
