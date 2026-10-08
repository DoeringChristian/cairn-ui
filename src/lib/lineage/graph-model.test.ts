import { test } from "node:test";
import assert from "node:assert/strict";
import type { LineageEdge, LineageGraph, LineageRunNode, LineageVersionNode } from "../../api/types.ts";
import {
  clusterGraph,
  emptyModel,
  filterGraph,
  hiddenNeighbours,
  lineagePath,
  mergeGraphs,
  artifactTypes,
  foldingGroup,
} from "./graph-model.ts";
import { layoutGraph } from "./layout.ts";

const ver = (id: string, name: string, type = "model", full = { in: 1, out: 0 }): LineageVersionNode => ({
  kind: "artifact_version", id, label: `${name}:v1`, type, name, family_id: `f-${name}`, project_id: "p",
  version: 1, ref: `${name}:v1`, qualified_ref: `p/${name}:v1`, aliases: [], tags: [], step: null,
  created_at: "", file_count: 1, size: 1, degree: { in: 0, out: 0 }, full_degree: full, group_key: null,
});
const run = (id: string, full = { in: 1, out: 1 }): LineageRunNode => ({
  kind: "run", id, label: id, name: id, status: "completed", tags: [], group: null, job_type: null,
  project_id: "p", created_at: null, archived: false, deleted: false, degree: { in: 0, out: 0 },
  full_degree: full, group_key: null,
});
const produced = (r: string, v: string): LineageEdge => ({ source: r, target: v, kind: "produced" });
const consumed = (v: string, r: string, role = "input"): LineageEdge => ({ source: v, target: r, kind: "consumed", role });

/** data -> train1..train12 -> ckpt1..ckpt12; prep -> data; ckpt3 -> eval -> report. */
function bigGraph(): LineageGraph {
  const trains = Array.from({ length: 12 }, (_, i) => `t${i + 1}`);
  const nodes = [
    run("prep", { in: 0, out: 1 }),
    ver("data", "data", "dataset", { in: 1, out: 12 }),
    ...trains.map((t) => run(t)),
    ...trains.map((t) => ver(`c-${t}`, "ckpt", "model", { in: 1, out: t === "t3" ? 1 : 0 })),
    run("eval", { in: 1, out: 1 }),
    ver("report", "report", "report", { in: 1, out: 0 }),
  ];
  const edges = [
    produced("prep", "data"),
    ...trains.map((t) => consumed("data", t, "dataset")),
    ...trains.map((t) => produced(t, `c-${t}`)),
    consumed("c-t3", "eval"),
    produced("eval", "report"),
  ];
  return {
    nodes, edges,
    groups: [
      { group_key: "runs", member_kind: "run", members: trains },
      { group_key: "ckpts", member_kind: "artifact_version", members: trains.map((t) => `c-${t}`) },
    ],
  };
}

test("mergeGraphs unions nodes and edges without duplicates", () => {
  const a: LineageGraph = { nodes: [run("r1"), ver("v1", "x")], edges: [produced("r1", "v1")], groups: [] };
  const b: LineageGraph = { nodes: [ver("v1", "x"), run("r2")], edges: [produced("r1", "v1"), consumed("v1", "r2")], groups: [] };
  const m = mergeGraphs(mergeGraphs(emptyModel(), a), b);
  assert.deepEqual([...m.nodes.keys()].sort(), ["r1", "r2", "v1"]);
  assert.equal(m.edges.length, 2);
});

test("mergeGraphs: the newest grouping of a node wins; groups under 2 members are dropped", () => {
  const a: LineageGraph = { nodes: [run("a"), run("b"), run("c")], edges: [], groups: [{ group_key: "g1", member_kind: "run", members: ["a", "b", "c"] }] };
  const b: LineageGraph = { nodes: [run("b"), run("c"), run("d")], edges: [], groups: [{ group_key: "g2", member_kind: "run", members: ["b", "c", "d"] }] };
  const m = mergeGraphs(mergeGraphs(emptyModel(), a), b);
  assert.deepEqual(m.groups, [{ group_key: "g2", member_kind: "run", members: ["b", "c", "d"] }]);
});

test("mergeGraphs skips edges that end at server-side group nodes", () => {
  const g: LineageGraph = { nodes: [run("r")], edges: [{ source: "group:k", target: "r", kind: "consumed", role: "input", count: 3 }], groups: [] };
  assert.equal(mergeGraphs(emptyModel(), g).edges.length, 0);
});

test("clusterGraph folds sibling sets over the threshold, merging their edges", () => {
  const m = mergeGraphs(emptyModel(), bigGraph());
  const view = clusterGraph(m, { threshold: 5, expanded: new Set(), pinned: new Set() });
  const groups = view.nodes.filter((n) => n.kind === "group");
  assert.equal(groups.length, 2);
  const runs = groups.find((g) => g.kind === "group" && g.member_kind === "run")!;
  assert.equal(runs.kind === "group" && runs.count, 12);
  assert.equal(runs.label, "12 runs");
  const ckpts = groups.find((g) => g.kind === "group" && g.member_kind === "artifact_version")!;
  assert.equal(ckpts.label, "12 ckpt versions");
  // data -> group (12 member edges), group -> group (12), group -> eval (1).
  const e = (s: string, t: string) => view.edges.find((x) => x.source === s && x.target === t);
  assert.equal(e("data", runs.id)!.count, 12);
  assert.equal(e(runs.id, ckpts.id)!.count, 12);
  assert.equal(e(ckpts.id, "eval")!.count, 1);
  assert.equal(foldingGroup(view, "t4")!.id, runs.id);
});

test("clusterGraph: expanded groups and pinned nodes stay individual", () => {
  const m = mergeGraphs(emptyModel(), bigGraph());
  const expanded = clusterGraph(m, { threshold: 5, expanded: new Set(["runs"]), pinned: new Set() });
  assert.equal(expanded.nodes.filter((n) => n.kind === "run").length, 14);
  const pinned = clusterGraph(m, { threshold: 5, expanded: new Set(), pinned: new Set(["c-t3"]) });
  const g = pinned.nodes.find((n) => n.kind === "group" && n.member_kind === "artifact_version")!;
  assert.equal(g.kind === "group" && g.count, 11);
  assert.ok(pinned.nodes.some((n) => n.id === "c-t3"));
  // Under the threshold: nothing folds.
  const none = clusterGraph(m, { threshold: 12, expanded: new Set(), pinned: new Set() });
  assert.equal(none.nodes.filter((n) => n.kind === "group").length, 0);
});

test("filterGraph bridges edges through hidden runs", () => {
  const m = mergeGraphs(emptyModel(), bigGraph());
  const view = clusterGraph(m, { threshold: 100, expanded: new Set(), pinned: new Set() });
  const noRuns = filterGraph(view, { hiddenKinds: new Set(["run"]), hiddenTypes: new Set() });
  assert.ok(noRuns.nodes.every((n) => n.kind !== "run"));
  const has = (s: string, t: string) => noRuns.edges.some((e) => e.source === s && e.target === t && e.kind === "bridged");
  assert.ok(has("data", "c-t1"));
  assert.ok(has("c-t3", "report"));
  // Hiding a type: models gone, report reachable from data through hidden runs AND hidden ckpt.
  const noModels = filterGraph(view, { hiddenKinds: new Set(["run"]), hiddenTypes: new Set(["model"]) });
  assert.ok(noModels.edges.some((e) => e.source === "data" && e.target === "report"));
  // Pinned nodes are never hidden.
  const pinned = filterGraph(view, { hiddenKinds: new Set(["run"]), hiddenTypes: new Set(), pinned: new Set(["eval"]) });
  assert.ok(pinned.nodes.some((n) => n.id === "eval"));
  assert.deepEqual(artifactTypes(m), ["dataset", "model", "report"]);
});

test("filterGraph hides group nodes by their members' kind and type", () => {
  const m = mergeGraphs(emptyModel(), bigGraph());
  const view = clusterGraph(m, { threshold: 5, expanded: new Set(), pinned: new Set() });
  const out = filterGraph(view, { hiddenKinds: new Set(), hiddenTypes: new Set(["model"]) });
  assert.ok(!out.nodes.some((n) => n.kind === "group" && n.member_kind === "artifact_version"));
  assert.ok(out.nodes.some((n) => n.kind === "group" && n.member_kind === "run"));
});

test("lineagePath finds ancestors, descendants and the edges between", () => {
  const m = mergeGraphs(emptyModel(), bigGraph());
  const view = clusterGraph(m, { threshold: 100, expanded: new Set(), pinned: new Set() });
  const p = lineagePath(view.edges, "c-t3");
  assert.deepEqual([...p.ancestors].sort(), ["data", "prep", "t3"]);
  assert.deepEqual([...p.descendants].sort(), ["eval", "report"]);
  assert.equal(p.edges.size, 5);
  assert.ok(!p.ancestors.has("t4"));
});

test("hiddenNeighbours compares full_degree with the edges held", () => {
  const m = mergeGraphs(emptyModel(), {
    nodes: [ver("data", "data", "dataset", { in: 1, out: 12 }), run("t1")],
    edges: [consumed("data", "t1")],
    groups: [],
  });
  assert.deepEqual(hiddenNeighbours(m, "data"), { up: 1, down: 11 });
  assert.deepEqual(hiddenNeighbours(m, "t1"), { up: 0, down: 1 });
  assert.deepEqual(hiddenNeighbours(m, "missing"), { up: 0, down: 0 });
});

test("layoutGraph lays out left to right", () => {
  const m = mergeGraphs(emptyModel(), bigGraph());
  const view = clusterGraph(m, { threshold: 5, expanded: new Set(), pinned: new Set() });
  const pos = layoutGraph(view);
  assert.equal(pos.size, view.nodes.length);
  for (const e of view.edges) assert.ok(pos.get(e.source)!.x < pos.get(e.target)!.x, `${e.source} -> ${e.target}`);
});

test("clusterGraph: a folded run set is labelled with its job type", () => {
  const g = bigGraph();
  g.nodes = g.nodes.map((n) => (n.kind === "run" && /^t\d+$/.test(n.id) ? { ...n, job_type: "finetune" } : n));
  const view = clusterGraph(mergeGraphs(emptyModel(), g), { threshold: 5, expanded: new Set(), pinned: new Set() });
  const runs = view.nodes.find((n) => n.kind === "group" && n.member_kind === "run")!;
  assert.equal(runs.kind === "group" && runs.label, "12 finetune runs");
});
