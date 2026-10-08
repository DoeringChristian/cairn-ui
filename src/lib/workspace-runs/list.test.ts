import { test } from "node:test";
import assert from "node:assert/strict";
import { makeRun } from "../runs-table/test-run.ts";
import type { GroupGraph } from "./graph.ts";
import { buildList, runsForCards, runsUnder, showOnly, toggleNodeEye, toggleRunEye, type ListedRun } from "./list.ts";
import {
  DEFAULT_RUN_STATE,
  parseRunState,
  setEye,
  setGroupPicks,
  toggleGroupEye,
  toggleNameEye,
  type RunState,
} from "./state.ts";
import { DEFAULT_VISIBLE, visibleKeys } from "./visibility.ts";

let clock = 0;
function run(id: string, name: string | null, version: number | null, group: string | null, extra: Partial<ListedRun> = {}): ListedRun {
  clock += 1;
  return makeRun(id, {
    display_name: name,
    group,
    version,
    created_at: `2026-01-01T00:${String(Math.floor(clock / 60)).padStart(2, "0")}:${String(clock % 60).padStart(2, "0")}Z`,
    ...extra,
  });
}
const edges = (group: string, list: Array<[string, string]>): GroupGraph => ({
  group,
  runs: [],
  edges: list.map(([from, to]) => ({ from, to, via: "artifact" as const })),
});

// exp-42 (oldest), exp-43, exp-44 with prepare → train → eval, ungrouped baseline (newest).
function project() {
  clock = 0;
  const runs = [
    run("a-t1", "train", 1, "exp-42"),
    run("a-e1", "eval", 1, "exp-42"),
    run("b-t1", "train", 1, "exp-43"),
    run("b-e1", "eval", 1, "exp-43"),
    run("c-e1", "eval", 1, "exp-44"),
    run("c-p1", "prepare", 1, "exp-44"),
    run("c-t1", "train", 1, "exp-44"),
    run("c-p2", "prepare", 2, "exp-44"),
    run("c-t2", "train", 2, "exp-44"),
    run("u-b1", "baseline", 1, null),
    run("u-b2", "baseline", 2, null),
  ];
  const graphs = new Map<string, GroupGraph>([
    ["exp-42", edges("exp-42", [["a-t1", "a-e1"]])],
    ["exp-43", edges("exp-43", [["b-t1", "b-e1"]])],
    ["exp-44", edges("exp-44", [["c-p1", "c-t1"], ["c-t1", "c-e1"], ["c-p2", "c-t2"]])],
  ]);
  return { runs, graphs };
}

test("list: groups by newest run, names upstream → downstream, ungrouped last", () => {
  const { runs, graphs } = project();
  const list = buildList(runs, DEFAULT_RUN_STATE, graphs);
  assert.deepEqual(list.groups.map((g) => g.group), ["exp-44", "exp-43", "exp-42"]);
  const exp44 = list.groups[0]!;
  // eval's first run is older than prepare's, but it is downstream.
  assert.deepEqual(exp44.names.map((n) => n.label), ["prepare", "train", "eval"]);
  assert.deepEqual(exp44.names.map((n) => n.pick), ["c-p2", "c-t2", null]);
  // A row per run: the picked run's name and version; eval is "not run yet".
  assert.deepEqual(exp44.names.map((n) => n.run && `${n.run.display_name} v${n.run.version}`), ["prepare v2", "train v2", null]);
  assert.deepEqual(exp44.names[1]!.used, ["prepare v2"]);
  assert.deepEqual(exp44.names[0]!.versions.map((v) => v.label), ["v2", "v1"]);
  assert.deepEqual(list.ungrouped.map((u) => [u.label, u.pick]), [["baseline", "u-b2"]]);
  // Groups shown: the three groups and the (none) block.
  assert.deepEqual([list.mode, list.visible, list.listed, list.unit], ["group", 4, 4, "groups"]);
  assert.equal(list.ungroupedEye, "on");
});

test("list: versions that do not fit carry a note", () => {
  const { runs, graphs } = project();
  const train = buildList(runs, DEFAULT_RUN_STATE, graphs).groups[0]!.names[1]!;
  assert.deepEqual(
    train.versions.map((v) => [v.label, v.fits, v.note]),
    [
      ["v2", true, null],
      ["v1", false, "on prepare v1"],
    ],
  );
});

test("list: custom picks and the ungrouped pick", () => {
  const { runs, graphs } = project();
  let s = setGroupPicks(DEFAULT_RUN_STATE, "exp-44", { "n:train": "c-t1" });
  s = { ...s, ungrouped: { "n:baseline": "u-b1" } };
  const list = buildList(runs, s, graphs);
  assert.equal(list.groups[0]!.custom, true);
  assert.deepEqual(list.groups[0]!.names.map((n) => n.pick), ["c-p1", "c-t1", "c-e1"]);
  assert.equal(list.ungrouped[0]!.pick, "u-b1");
  assert.equal(list.ungrouped[0]!.run.version, 1);
});

test("list: the runs table's regex search and filter, archived runs left out", () => {
  const { runs, graphs } = project();
  runs[0] = { ...runs[0]!, archived: true };
  const list = buildList(runs, { ...DEFAULT_RUN_STATE, search: "^(train|eval)\\b" }, graphs);
  assert.deepEqual(
    list.groups.map((g) => [g.group, g.names.map((n) => n.label)]),
    [["exp-44", ["train", "eval"]], ["exp-43", ["train", "eval"]], ["exp-42", ["eval"]]],
  );
  assert.equal(list.ungrouped.length, 0);
  const filtered = buildList(
    runs,
    { ...DEFAULT_RUN_STATE, filter: { kind: "group", op: "and", children: [{ kind: "chip", field: "group", op: "exact", arg: "exp-43" }] } },
    graphs,
  );
  assert.deepEqual(filtered.groups.map((g) => g.group), ["exp-43"]);
});

test("list: no group-by levels lists every run, newest first", () => {
  const { runs, graphs } = project();
  const list = buildList(runs, { ...DEFAULT_RUN_STATE, groupBy: [] }, graphs);
  assert.equal(list.mode, "flat");
  assert.equal(list.runs.length, 11);
  assert.equal(list.runs[0]!.run.id, "u-b2");
  assert.equal(list.groups.length + list.ungrouped.length + list.nodes.length, 0);
  // The 10 newest are visible.
  assert.deepEqual([list.visible, list.listed, list.unit], [10, 11, "runs"]);
  assert.equal(list.runs.at(-1)!.visible, false);
});

test("visibility: the newest entries by default, explicit eyes override", () => {
  const entries = Array.from({ length: DEFAULT_VISIBLE + 2 }, (_, i) => ({ key: `g:${i}`, newest: `2026-01-${String(i + 1).padStart(2, "0")}` }));
  const def = visibleKeys(entries, {});
  assert.equal(def.size, DEFAULT_VISIBLE);
  assert.equal(def.has("g:0"), false);
  assert.equal(def.has("g:11"), true);
  const over = visibleKeys(entries, { "g:0": true, "g:11": false });
  assert.equal(over.has("g:0"), true);
  assert.equal(over.has("g:11"), false);
});

test("eyes: group eye mixed by name eyes; toggles", () => {
  const { runs, graphs } = project();
  let s: RunState = toggleNameEye(DEFAULT_RUN_STATE, "exp-44", "n:prepare", true);
  let g = buildList(runs, s, graphs).groups[0]!;
  assert.equal(g.eye, "mixed");
  s = toggleGroupEye(s, "exp-44", "mixed", g.names.map((n) => n.key));
  g = buildList(runs, s, graphs).groups[0]!;
  assert.equal(g.eye, "on");
  s = toggleGroupEye(s, "exp-44", "on", []);
  g = buildList(runs, s, graphs).groups[0]!;
  assert.deepEqual([g.visible, g.eye], [false, "off"]);
  // A name eye turned on in a hidden group shows the group.
  s = toggleNameEye(s, "exp-44", "n:train", false);
  assert.equal(buildList(runs, s, graphs).groups[0]!.visible, true);
});

test("cards: picked eye-on runs of visible groups plus visible ungrouped picks", () => {
  const { runs, graphs } = project();
  let s = setEye(DEFAULT_RUN_STATE, "g:exp-42", false);
  s = toggleNameEye(s, "exp-44", "n:prepare", true);
  const cards = runsForCards(buildList(runs, s, graphs));
  assert.deepEqual(cards.runIds, ["c-t2", "b-t1", "b-e1", "u-b2"]);
  assert.deepEqual([...cards.groupOf], [["c-t2", "exp-44"], ["b-t1", "exp-43"], ["b-e1", "exp-43"]]);
});

test("cards: no group-by levels draws every visible run, ungrouped", () => {
  const { runs, graphs } = project();
  const s = setEye({ ...DEFAULT_RUN_STATE, groupBy: [] }, "r:u-b2", false);
  const cards = runsForCards(buildList(runs, s, graphs));
  assert.equal(cards.runIds.length, 9);
  assert.equal(cards.runIds.includes("u-b2"), false);
  assert.equal(cards.groupOf.size, 0);
});

test("run state: parse keeps valid fields and drops the rest", () => {
  assert.deepEqual(parseRunState(null), DEFAULT_RUN_STATE);
  assert.deepEqual(
    parseRunState({
      search: "exp",
      filter: { kind: "group", op: "or", children: [{ kind: "expr", expr: "config.lr > 1" }, { kind: "bogus" }] },
      groupBy: [{ source: "tag" }, { source: "param", key: "lr" }, { source: "param" }, "group"],
      eyes: { "g:a": false, "g:b": "yes" },
      hiddenNames: { a: ["n:x", "n:x", 3], b: [] },
      groups: { a: { picks: { "n:t": "r1", "n:e": null, "n:z": 5 } }, b: "latest", c: 7 },
      ungrouped: { "n:base": "r9", "n:bad": 1 },
    }),
    {
      search: "exp",
      filter: { kind: "group", op: "or", children: [{ kind: "expr", expr: "config.lr > 1" }] },
      groupBy: [{ source: "tag" }, { source: "param", key: "lr" }],
      eyes: { "g:a": false },
      hiddenNames: { a: ["n:x"] },
      groups: { a: { picks: { "n:t": "r1", "n:e": null } } },
      ungrouped: { "n:base": "r9" },
    },
  );
  // Old or malformed values: defaults (no migration).
  assert.deepEqual(parseRunState({ groupBy: "none" }).groupBy, [{ source: "group" }]);
  assert.deepEqual(parseRunState({ groupBy: [] }).groupBy, []);
  assert.deepEqual(parseRunState({ filter: "x" }).filter, DEFAULT_RUN_STATE.filter);
});

test("show only: the ticked runs' groups and ungrouped names, every other entry off", () => {
  const { runs, graphs } = project();
  const s = showOnly(
    { ...DEFAULT_RUN_STATE, search: "zzz", filter: { kind: "group", op: "and", children: [{ kind: "expr", expr: "false" }] } },
    runs,
    new Set(["b-e1", "u-b1"]),
  );
  assert.equal(s.search, "");
  assert.equal(s.filter.children.length, 0);
  const list = buildList(runs, s, graphs);
  assert.deepEqual(list.groups.filter((g) => g.visible).map((g) => g.group), ["exp-43"]);
  assert.deepEqual(list.ungrouped.map((u) => [u.visible, u.pick]), [[true, "u-b1"]]);
  const flat = buildList(runs, { ...s, groupBy: [] }, graphs);
  assert.deepEqual(flat.runs.filter((e) => e.visible).map((e) => e.run.id), ["u-b1", "b-e1"]);
});

// Nested: tags × params, other group-by levels.
function tagged() {
  clock = 0;
  const p = (id: string, tags: string[], lr: number, group: string | null = null) =>
    run(id, id, null, group, { tags: JSON.stringify(tags), params: { lr } });
  return [p("a", ["x"], 0.1), p("b", ["x", "y"], 0.2), p("c", ["y"], 0.1), p("d", [], 0.1, "exp-1")];
}

test("nested: the runs table's groups, runs per leaf, top-level label for the cards", () => {
  const runs = tagged();
  const s: RunState = { ...DEFAULT_RUN_STATE, groupBy: [{ source: "tag" }, { source: "param", key: "lr" }] };
  const list = buildList(runs, s, new Map());
  assert.equal(list.mode, "nested");
  // Newest run first: y (c, b), x (b, a), then no tag (d) last.
  assert.deepEqual(list.nodes.map((n) => [n.label, n.count]), [["y", 2], ["x", 2], [null, 1]]);
  const y = list.nodes[0]!;
  assert.deepEqual(y.children!.map((c) => [c.label, c.runs.map((r) => r.run.id)]), [["0.1", ["c"]], ["0.2", ["b"]]]);
  assert.deepEqual(runsUnder(y)[0]!.path, [y.key, y.children![0]!.key]);
  assert.deepEqual([list.visible, list.listed, list.unit], [3, 3, "groups"]);
  // b is under x and y: drawn once, with its first top-level group; d (no tag) stays its own line.
  const cards = runsForCards(list);
  assert.deepEqual(cards.runIds, ["c", "b", "a", "d"]);
  assert.deepEqual([...cards.groupOf], [["c", "y"], ["b", "y"], ["a", "x"]]);
});

test("nested: a run's eye leaves it out; a group's eye hides it, mixed, back on", () => {
  const runs = tagged();
  let s: RunState = { ...DEFAULT_RUN_STATE, groupBy: [{ source: "tag" }] };
  let y = buildList(runs, s, new Map()).nodes[0]!;
  assert.equal(y.eye, "on");
  s = toggleRunEye(s, y.runs[0]!);
  y = buildList(runs, s, new Map()).nodes[0]!;
  assert.deepEqual([y.eye, y.runs.map((r) => r.visible)], ["mixed", [false, true]]);
  assert.deepEqual(runsForCards(buildList(runs, s, new Map())).runIds, ["b", "a", "d"]);
  s = toggleNodeEye(s, y);
  y = buildList(runs, s, new Map()).nodes[0]!;
  assert.equal(y.eye, "on");
  s = toggleNodeEye(s, y);
  const list = buildList(runs, s, new Map());
  assert.deepEqual([list.nodes[0]!.visible, list.nodes[0]!.eye, list.visible], [false, "off", 2]);
  assert.deepEqual(runsForCards(list).runIds, ["b", "a", "d"]);
  // A run's eye turned on in a hidden group shows the group.
  s = toggleRunEye(s, list.nodes[0]!.runs[0]!);
  assert.equal(buildList(runs, s, new Map()).nodes[0]!.visible, true);
});

test("nested: group then other levels is nested too, aggregated by group", () => {
  const runs = tagged();
  const list = buildList(runs, { ...DEFAULT_RUN_STATE, groupBy: [{ source: "group" }, { source: "tag" }] }, new Map());
  assert.equal(list.mode, "nested");
  assert.deepEqual(list.nodes.map((n) => n.label), ["exp-1", null]);
  assert.deepEqual([...runsForCards(list).groupOf], [["d", "exp-1"]]);
});
