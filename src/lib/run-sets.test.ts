/**
 * `resolveRunSet` against the vectors it shares with cairn's Python port
 * (`cairn/server/run_sets.py`, which scopes share links):
 * docs/schemas/run-set-vectors.json (scripts/gen-run-set-vectors.ts).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Run } from "../api/types.ts";
import {
  addRunSet,
  canRemoveRunSet,
  defaultRunSet,
  insertRunSetFromWorkspace,
  parseRunSet,
  removeRunSet,
  renameRunSet,
  resolveRunSet,
  resolveRunSetLines,
  resolveRunSets,
  runSetsGrouping,
  runSetColors,
  runSetFamilyColor,
  runSetFilter,
  runSetOfIds,
  unionOfSets,
  type RunSet,
} from "./run-sets.ts";

const doc = JSON.parse(readFileSync(new URL("../../docs/schemas/run-set-vectors.json", import.meta.url), "utf8")) as {
  pools: Record<string, Run[]>;
  cases: Array<{ name: string; pool: string; set: RunSet; expected: string[]; expectedGroupOf: Record<string, string> }>;
};

test("run-set-vectors.json: every case matches", () => {
  assert.ok(doc.cases.length >= 20);
  for (const c of doc.cases) assert.deepEqual(resolveRunSet(parseRunSet(c.set)!, doc.pools[c.pool]!), c.expected, c.name);
  for (const c of doc.cases) assert.deepEqual(resolveRunSetLines(parseRunSet(c.set)!, doc.pools[c.pool]!).groupOf, c.expectedGroupOf, c.name);
});

test("runSetsGrouping: an ungrouped set gives no grouping (a line per run)", () => {
  const pool = doc.pools.main!;
  const set = runSetOfIds(["r01", "r02", "r08"]);
  assert.equal(runSetsGrouping([set], [resolveRunSetLines(set, pool)]), null);
});

test("runSetsGrouping: one grouped set, each run its innermost group line", () => {
  const pool = doc.pools.main!;
  const set = { ...runSetOfIds(["r01", "r02", "r08", "r09", "r11"]), groupBy: [{ source: "group" as const }] };
  const g = runSetsGrouping([set], [resolveRunSetLines(set, pool)])!;
  assert.deepEqual(Object.fromEntries(g), { r01: "group: exp-44", r02: "group: exp-44", r08: "group: seeds", r09: "group: seeds" });
  // r11 has no group: under (none), its own line.
  assert.equal(g.has("r11"), false);
});

test("runSetsGrouping: several sets keep their groups apart; a run takes its first set's line", () => {
  const pool = doc.pools.main!;
  const a = { ...runSetOfIds(["r08", "r09"], "Seeds"), groupBy: [{ source: "group" as const }] };
  const b = { ...runSetOfIds(["r09", "r10"], "More"), groupBy: [{ source: "group" as const }] };
  const plain = runSetOfIds(["r01"], "Plain");
  const g = runSetsGrouping([a, b, plain], [a, b, plain].map((s) => resolveRunSetLines(s, pool)))!;
  assert.deepEqual(Object.fromEntries(g), { r09: "Seeds › group: seeds", r08: "Seeds › group: seeds", r10: "More › group: seeds" });
  // Sets sharing a name are told apart by their position.
  const twin = { ...b, name: "Seeds" };
  const t = runSetsGrouping([a, twin], [a, twin].map((s) => resolveRunSetLines(s, pool)))!;
  assert.equal(t.get("r08"), "Seeds (1) › group: seeds");
  assert.equal(t.get("r10"), "Seeds (2) › group: seeds");
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

test("set ops: add, rename, remove (never the last), insert from the workspace", () => {
  let sets = addRunSet([]);
  assert.deepEqual(sets.map((s) => s.name), ["Run set 1"]);
  assert.deepEqual(sets[0], defaultRunSet("Run set 1"));
  sets = addRunSet(sets);
  assert.deepEqual(sets.map((s) => s.name), ["Run set 1", "Run set 2"]);
  sets = renameRunSet(sets, 1, "lr sweep");
  sets = addRunSet(sets);
  assert.deepEqual(sets.map((s) => s.name), ["Run set 1", "lr sweep", "Run set 3"]);
  // A name already taken gets a number.
  assert.equal(addRunSet([defaultRunSet("Run set 2"), defaultRunSet("x")])[2]!.name, "Run set 3");
  assert.equal(addRunSet([defaultRunSet("Run set 2")])[1]!.name, "Run set 2 2");

  sets = removeRunSet(sets, 0);
  assert.deepEqual(sets.map((s) => s.name), ["lr sweep", "Run set 3"]);
  assert.equal(canRemoveRunSet(sets), true);
  sets = removeRunSet(sets, 1);
  assert.equal(canRemoveRunSet(sets), false);
  assert.deepEqual(removeRunSet(sets, 0), sets, "the last set stays");
  assert.deepEqual(removeRunSet(sets, 5), sets);

  const state = {
    status: "running",
    search: "eager",
    filter: { kind: "group" as const, op: "and" as const, children: [{ kind: "expr" as const, expr: "config.lr > 0.001" }], latestOnly: true },
    groupBy: [{ source: "group" as const }],
    sort: [{ column: "name", direction: "asc" as const }],
    eyes: { "r:a": false },
  };
  const ins = insertRunSetFromWorkspace(sets, state, "Default");
  assert.equal(ins.length, 2);
  // The filter's "Latest versions only" is the set's own latestOnly, beside the tree.
  assert.deepEqual(ins[1], { name: "Default", filter: { kind: "group", op: "and", children: state.filter.children }, groupBy: state.groupBy, latestOnly: true, sort: state.sort, eyes: { "r:a": false } });
  // A copy: the workspace's later edits do not reach it.
  state.eyes["r:a"] = true;
  state.filter.children.push({ kind: "expr", expr: "x" });
  assert.deepEqual(ins[1]!.eyes, { "r:a": false });
  assert.equal(ins[1]!.filter.children.length, 1);
  assert.equal(insertRunSetFromWorkspace(ins, state, "Default")[2]!.name, "Default 2");
  assert.equal(insertRunSetFromWorkspace([], state, "")[0]!.name, "Workspace");
});

test("each set's dot is its colour family's middle shade", () => {
  assert.match(runSetFamilyColor(0), /^#[0-9a-f]{6}$/);
  assert.notEqual(runSetFamilyColor(0), runSetFamilyColor(1));
  assert.equal(runSetFamilyColor(8), runSetFamilyColor(0));
});

test("runSetFilter: the set's latestOnly as its editor's \"Latest versions only\"", () => {
  const set = defaultRunSet("s");
  assert.equal(runSetFilter(set), set.filter);
  assert.deepEqual(runSetFilter({ ...set, latestOnly: true }), { ...set.filter, latestOnly: true });
});
