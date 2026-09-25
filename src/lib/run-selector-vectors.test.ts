/**
 * `resolveRunSelectorFromRuns` against the vectors it shares with its Python
 * port (cairn `cairn/server/report_scope.py`, which resolves a share link's
 * run scope on the server): docs/schemas/run-selector-vectors.json.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveRunSelectorFromRuns, type RunSelector } from "./run-selector.ts";
import type { Run } from "../api/types.ts";

const doc = JSON.parse(
  readFileSync(new URL("../../docs/schemas/run-selector-vectors.json", import.meta.url), "utf8"),
) as { runs: Run[]; cases: Array<{ name: string; selector: RunSelector; expected: string[] }> };

test("run-selector-vectors.json has cases for both modes and static", () => {
  const kinds = new Set(doc.cases.map((c) => (c.selector.kind === "query" ? c.selector.mode : "static")));
  assert.deepEqual([...kinds].sort(), ["latest-n", "newest-per-name", "static"]);
});

test("run-selector-vectors.json: every case matches", () => {
  for (const c of doc.cases) {
    assert.deepEqual(resolveRunSelectorFromRuns(c.selector, doc.runs), c.expected, c.name);
  }
});
