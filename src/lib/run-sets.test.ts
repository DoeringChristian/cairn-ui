/**
 * `resolveRunSet` against the vectors it shares with cairn's Python port
 * (`cairn/server/run_sets.py`, which scopes share links):
 * docs/schemas/run-set-vectors.json (scripts/gen-run-set-vectors.ts).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Run } from "../api/types.ts";
import { parseRunSet, resolveRunSet, resolveRunSets, runSetColors, runSetOfIds, unionOfSets, type RunSet } from "./run-sets.ts";

const doc = JSON.parse(readFileSync(new URL("../../docs/schemas/run-set-vectors.json", import.meta.url), "utf8")) as {
  pools: Record<string, Run[]>;
  cases: Array<{ name: string; pool: string; set: RunSet; expected: string[] }>;
};

test("run-set-vectors.json: every case matches", () => {
  assert.ok(doc.cases.length >= 20);
  for (const c of doc.cases) assert.deepEqual(resolveRunSet(parseRunSet(c.set)!, doc.pools[c.pool]!), c.expected, c.name);
});

test("parseRunSet: defaults for what does not parse", () => {
  assert.equal(parseRunSet("x"), null);
  const s = parseRunSet({ filter: { kind: "chip" }, groupBy: [{ source: "x" }, { source: "group" }], eyes: { "r:a": 1, "r:b": false } }, 1)!;
  assert.equal(s.name, "Run set 2");
  assert.deepEqual(s.filter, { kind: "group", op: "and", children: [] });
  assert.deepEqual(s.groupBy, [{ source: "group" }]);
  assert.deepEqual(s.sort, [{ column: "created_at", direction: "desc" }]);
  assert.deepEqual(s.eyes, { "r:b": false });
});

test("several sets: their union in set order, each set its own colour family", () => {
  const pool = doc.pools.main!;
  const r = resolveRunSets([runSetOfIds(["r01", "r02"]), runSetOfIds(["r02", "r03"])], pool);
  assert.deepEqual(r.sets, [["r02", "r01"], ["r03", "r02"]]);
  assert.deepEqual(r.runIds, ["r02", "r01", "r03"]);
  assert.deepEqual(unionOfSets([["a"], ["a", "b"]]), ["a", "b"]);
  assert.equal(runSetColors([["a", "b"]]), null);
  const colors = runSetColors(r.sets)!;
  assert.deepEqual([...colors.keys()], ["r02", "r01", "r03"]);
  for (const c of colors.values()) assert.match(c, /^#[0-9a-f]{6}$/);
  assert.notEqual(colors.get("r01"), colors.get("r03"));
});
