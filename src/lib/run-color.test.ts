import { test } from "node:test";
import assert from "node:assert/strict";
import { assignPageColors, assignRunColors, RUN_PALETTE, runColor } from "./run-color.ts";

const ids = Array.from({ length: 20 }, (_, i) => `run-${i}-${(i * 7919).toString(16)}`);
const t = (id: string) => ids.indexOf(id);

test("a run's colour depends only on its id", () => {
  assert.equal(runColor("abc"), runColor("abc"));
  assert.ok(RUN_PALETTE.includes(runColor("abc") as (typeof RUN_PALETTE)[number]));
});

test("the first 10 runs of a card get 10 different hues", () => {
  const m = assignRunColors(ids.slice(0, 10), t);
  const hue = (c: string) => RUN_PALETTE.indexOf(c as (typeof RUN_PALETTE)[number]) % 10;
  assert.equal(new Set([...m.values()].map(hue)).size, 10);
});

test("up to 20 runs in one card are all distinct", () => {
  const m = assignRunColors(ids, t);
  assert.equal(new Set(m.values()).size, 20);
});

test("the oldest run keeps its own colour; a clash moves the newer run", () => {
  for (let i = 1; i < ids.length; i++) {
    const m = assignRunColors([ids[i]!, ids[0]!], t);
    assert.equal(m.get(ids[0]!), runColor(ids[0]!));
    assert.notEqual(m.get(ids[i]!), m.get(ids[0]!));
  }
});

test("order of the input does not matter", () => {
  const a = assignRunColors(ids.slice(0, 8), t);
  const b = assignRunColors([...ids.slice(0, 8)].reverse(), t);
  assert.deepEqual([...a.entries()].sort(), [...b.entries()].sort());
});

// --- one page's colours (runs + innermost group lines) -----------------------

const page = (ids: readonly string[], groupOf: ReadonlyMap<string, string> = new Map()) => assignPageColors(ids, groupOf, t);

test("page: ungrouped runs and group lines never collide (one palette)", () => {
  // 4 runs averaged into 2 groups, 6 runs their own lines.
  const groupOf = new Map([
    [ids[0]!, "group: a"],
    [ids[1]!, "group: a"],
    [ids[2]!, "group: b"],
    [ids[3]!, "group: b"],
  ]);
  const p = page(ids.slice(0, 10), groupOf);
  const lineColors = [...p.groups.values(), ...ids.slice(4, 10).map((id) => p.runs.get(id)!)];
  assert.equal(lineColors.length, 8);
  assert.equal(new Set(lineColors).size, 8);
  // Runs averaged into a group are coloured after every line: still distinct from them.
  for (const id of ids.slice(0, 4)) assert.ok(!lineColors.includes(p.runs.get(id)!));
});

test("page: 20 lines of runs and groups mixed are all distinct", () => {
  const groupOf = new Map(ids.slice(0, 10).map((id, i) => [id, `g${i}`] as const));
  const extra = Array.from({ length: 10 }, (_, i) => `x-${i}`);
  const p = assignPageColors([...ids.slice(0, 10), ...extra], groupOf, (id) => (id.startsWith("x") ? 100 + Number(id.slice(2)) : t(id)));
  const lines = [...p.groups.values(), ...extra.map((id) => p.runs.get(id)!)];
  assert.equal(new Set(lines).size, 20);
});

test("page: the same inputs give the same colours (sidebar, Runs page and every card agree)", () => {
  const groupOf = new Map([[ids[5]!, "group: a"]]);
  const a = page(ids.slice(0, 9), groupOf);
  const b = page([...ids.slice(0, 9)].reverse(), groupOf);
  assert.deepEqual([...a.runs].sort(), [...b.runs].sort());
  assert.deepEqual([...a.groups].sort(), [...b.groups].sort());
});

test("page: a line keeps its colour when newer lines are hidden or shown", () => {
  const all = page(ids.slice(0, 12));
  for (let k = 1; k <= 12; k++) {
    const some = page(ids.slice(0, k));
    for (const id of ids.slice(0, k)) assert.equal(some.runs.get(id), all.runs.get(id));
  }
});

test("page: an undisplaced run keeps its id colour; a group line its label's", () => {
  const p = page([ids[0]!]);
  assert.equal(p.runs.get(ids[0]!), runColor(ids[0]!));
  const g = assignPageColors(["r"], new Map([["r", "group: solo"]]), () => 1);
  assert.equal(g.groups.get("group: solo"), runColor("group: solo"));
});

test("page: a group is placed by its oldest run", () => {
  // The group's oldest run (ids[0]) is older than the ungrouped ids[1]: the group keeps its preferred colour.
  const groupOf = new Map([[ids[0]!, "L"], [ids[2]!, "L"]]);
  const p = page([ids[0]!, ids[1]!, ids[2]!], groupOf);
  assert.equal(p.groups.get("L"), runColor("L"));
});

test("page: the first 8 lines get the 8 core hues (light, far apart), then cyan and grey, then dark shades", () => {
  const p = page(ids.slice(0, 20));
  const slot = (id: string) => RUN_PALETTE.indexOf(p.runs.get(id) as (typeof RUN_PALETTE)[number]);
  assert.deepEqual(ids.slice(0, 8).map(slot).sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(ids.slice(8, 10).map(slot).sort((a, b) => a - b), [8, 9]);
  for (const id of ids.slice(10, 20)) assert.ok(slot(id) >= 10);
});
