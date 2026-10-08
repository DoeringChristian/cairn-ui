import { test } from "node:test";
import assert from "node:assert/strict";
import { compileRunSearch, matchesRunSearch } from "./search.ts";
import { makeRun } from "./test-run.ts";

test("search: case-insensitive regex over name, id, status and tags", () => {
  const r = makeRun("abc123", { display_name: "Train", tags: JSON.stringify(["gpu"]) });
  assert.equal(matchesRunSearch(r, compileRunSearch("^train")), true);
  assert.equal(matchesRunSearch(r, compileRunSearch("GPU")), true);
  assert.equal(matchesRunSearch(r, compileRunSearch("completed")), true);
  assert.equal(matchesRunSearch(r, compileRunSearch("eval")), false);
  assert.equal(matchesRunSearch(r, compileRunSearch("  ")), true);
});

test("search: an invalid regex matches everything and says so", () => {
  const s = compileRunSearch("(");
  assert.equal(s.error, "invalid regex");
  assert.equal(matchesRunSearch(makeRun("x"), s), true);
});
