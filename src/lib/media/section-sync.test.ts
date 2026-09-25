import { test } from "node:test";
import assert from "node:assert/strict";
import { SectionSyncStore, parsePersisted, type PersistedSectionSync } from "./section-sync.ts";
import { resolveAtValue, sliderIndex, sliderTrack } from "./slider-key.ts";

function memory(initial: PersistedSectionSync | null = null) {
  let saved = initial;
  return { load: () => saved, save: (s: PersistedSectionSync) => { saved = s; }, get: () => saved };
}

test("the bar's values are the union of every registered card's values", () => {
  const store = new SectionSyncStore();
  let events = 0;
  store.subscribe(() => events++);
  store.register("image", [10, 20, 30]);
  store.register("video", [15, 30]);
  assert.deepEqual(store.getSnapshot().values, [10, 15, 20, 30]);
  const snap = store.getSnapshot();
  store.register("video", [15, 30]); // same values: no change, same snapshot
  assert.equal(store.getSnapshot(), snap);
  store.unregister("image");
  assert.deepEqual(store.getSnapshot().values, [15, 30]);
  assert.equal(store.size, 1);
  assert.equal(events, 3);
});

test("value and key persist per scope; a key change drops the value", () => {
  const storage = memory();
  const store = new SectionSyncStore(storage);
  assert.deepEqual(store.getSnapshot(), { value: null, key: "step", values: [] });
  store.setValue(20);
  assert.deepEqual(storage.get(), { value: 20, key: "step" });
  store.setKey("epoch");
  assert.deepEqual(storage.get(), { value: null, key: "epoch" });
  const again = new SectionSyncStore(storage);
  assert.equal(again.getSnapshot().key, "epoch");
});

test("persisted payloads are validated", () => {
  assert.equal(parsePersisted(null), null);
  assert.deepEqual(parsePersisted({ value: "x", key: 3 }), { value: null, key: "step" });
  assert.deepEqual(parsePersisted({ value: 4, key: "epoch" }), { value: 4, key: "epoch" });
});

test("end to end: two cards follow one section value, each at its own step", () => {
  // Card A logs images every 100 steps, card B every 50; both follow "epoch".
  const epochA = [{ step: 0, scalar_value: 0 }, { step: 200, scalar_value: 1 }];
  const epochB = [{ step: 0, scalar_value: 0 }, { step: 100, scalar_value: 1 }];
  const a = sliderTrack([100, 200, 300], "epoch", epochA);
  const b = sliderTrack([50, 100, 150], "epoch", epochB);
  const store = new SectionSyncStore();
  store.setKey("epoch");
  store.register("a", a.map((p) => p.value));
  store.register("b", b.map((p) => p.value));
  const { values } = store.getSnapshot();
  assert.deepEqual(values, [0, 1]);
  // The bar moves to its second position.
  store.setValue(values[sliderIndex(values, 1)]!);
  const v = store.getSnapshot().value!;
  assert.equal(resolveAtValue(a, v), 300);
  assert.equal(resolveAtValue(b, v), 150);
});
