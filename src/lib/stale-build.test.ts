import { test } from "node:test";
import assert from "node:assert/strict";
import { currentBuildId, isStaleChunkError, reloadOnceForStaleBuild } from "./stale-build.ts";

test("missing chunks are recognized in every browser's wording; other errors are not", () => {
  for (const m of [
    "Failed to fetch dynamically imported module: http://x/assets/MarkdownCard-abc.js",
    "error loading dynamically imported module: http://x/assets/a.js",
    "Importing a module script failed.",
    "Unable to preload CSS for /assets/x.css",
  ]) {
    assert.equal(isStaleChunkError(new TypeError(m)), true, m);
  }
  assert.equal(isStaleChunkError(new Error("Something went wrong with axis scaling")), false);
  assert.equal(isStaleChunkError(null), false);
});

test("the build id is the entry script's hashed name", () => {
  const doc = { querySelector: (s: string) => (s.includes("/assets/") ? { getAttribute: () => "/assets/index-AbC.js" } : null) } as unknown as Document;
  assert.equal(currentBuildId(doc), "/assets/index-AbC.js");
  assert.equal(currentBuildId({ querySelector: () => null } as unknown as Document), "dev");
});

test("reload once per build: a second failure of the same build shows the error", () => {
  const mem = new Map<string, string>();
  const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
  let reloads = 0;
  assert.equal(reloadOnceForStaleBuild("b1", store, () => reloads++), true);
  assert.equal(reloadOnceForStaleBuild("b1", store, () => reloads++), false);
  assert.equal(reloads, 1);
  // A newer build gets its own one reload.
  assert.equal(reloadOnceForStaleBuild("b2", store, () => reloads++), true);
  assert.equal(reloads, 2);
});
