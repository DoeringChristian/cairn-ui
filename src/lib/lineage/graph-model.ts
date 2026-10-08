/**
 * The lineage viewer's graph model, pure:
 *
 * 1. `mergeGraphs` unions the API graphs fetched so far (the initial one plus
 *    every one-hop expansion).
 * 2. `clusterGraph` folds sibling sets (the API's `groups`) larger than a
 *    threshold into group nodes, unless the user expanded them; pinned nodes
 *    (the centre, the selection) always stay individual.
 * 3. `filterGraph` hides node kinds / artifact types, bridging edges through
 *    hidden nodes so what stays visible stays connected.
 * 4. `lineagePath` gives the ancestors and descendants of a node (highlight).
 * 5. `hiddenNeighbours` says how much more there is to expand from a node.
 */

import type {
  LineageEdge,
  LineageGraph,
  LineageGroupNode,
  LineageNode,
  LineageRunNode,
  LineageVersionNode,
} from "../../api/types.ts";

export type RawNode = LineageVersionNode | LineageRunNode;

export interface GroupInfo {
  group_key: string;
  member_kind: "run" | "artifact_version";
  members: string[];
}

/** The merged, unclustered graph. */
export interface ModelGraph {
  nodes: Map<string, RawNode>;
  edges: LineageEdge[];
  groups: GroupInfo[];
}

/** A view group node: the API's group shape plus the artifact type of version groups. */
export interface ViewGroupNode extends LineageGroupNode {
  /** The members' artifact type (version groups), for the type filter. */
  type?: string;
}

export type ViewNode = RawNode | ViewGroupNode;

export interface ViewEdge {
  id: string;
  source: string;
  target: string;
  /** `bridged`: stands for a path through hidden nodes. */
  kind: LineageEdge["kind"] | "bridged";
  role?: string;
  /** How many underlying edges this one stands for. */
  count: number;
}

export interface ViewGraph {
  nodes: ViewNode[];
  edges: ViewEdge[];
}

export const emptyModel = (): ModelGraph => ({ nodes: new Map(), edges: [], groups: [] });

const edgeKey = (e: { source: string; target: string; kind: string; role?: string }) =>
  `${e.source}->${e.target}:${e.kind}:${e.role ?? ""}`;

/**
 * `model` plus the API graph `g`: nodes by id (`g`'s data wins, it is newer),
 * edges deduplicated, and sibling groups re-derived: a node belongs to the
 * group the most recent graph that grouped it put it in; a group keeps the
 * members still assigned to it and is dropped below two.
 */
export function mergeGraphs(model: ModelGraph, g: LineageGraph): ModelGraph {
  const nodes = new Map(model.nodes);
  for (const n of g.nodes) if (n.kind !== "group") nodes.set(n.id, n);
  const seen = new Set(model.edges.map(edgeKey));
  const edges = [...model.edges];
  for (const e of g.edges) {
    // A clustered response's edges may end at a group node: skip those, the
    // member edges are what the model keeps.
    if (e.source.startsWith("group:") || e.target.startsWith("group:")) continue;
    const k = edgeKey(e);
    if (!seen.has(k)) {
      seen.add(k);
      const { count: _count, ...rest } = e;
      edges.push(rest);
    }
  }
  const memberOf = new Map<string, string>();
  const kinds = new Map<string, GroupInfo["member_kind"]>();
  const order: string[] = [];
  for (const grp of [...model.groups, ...g.groups]) {
    if (!kinds.has(grp.group_key)) order.push(grp.group_key);
    kinds.set(grp.group_key, grp.member_kind);
    for (const m of grp.members) memberOf.set(m, grp.group_key);
  }
  const members = new Map<string, string[]>(order.map((k) => [k, []]));
  for (const [m, k] of memberOf) if (nodes.has(m)) members.get(k)!.push(m);
  const groups: GroupInfo[] = order
    .filter((k) => members.get(k)!.length >= 2)
    .map((k) => ({ group_key: k, member_kind: kinds.get(k)!, members: members.get(k)! }));
  return { nodes, edges, groups };
}

export interface ClusterOptions {
  /** Fold sibling sets with more than this many (unpinned) members. */
  threshold: number;
  /** Group keys the user expanded. */
  expanded: ReadonlySet<string>;
  /** Node ids never folded (the centre, the selection). */
  pinned: ReadonlySet<string>;
}

export const groupNodeId = (key: string) => `group:${key}`;

/** The model with large sibling sets folded into group nodes. */
export function clusterGraph(model: ModelGraph, opts: ClusterOptions): ViewGraph {
  const memberOf = new Map<string, string>();
  const groupNodes: ViewGroupNode[] = [];
  for (const g of model.groups) {
    if (opts.expanded.has(g.group_key)) continue;
    const members = g.members.filter((m) => !opts.pinned.has(m) && model.nodes.has(m));
    if (members.length <= opts.threshold || members.length < 2) continue;
    const id = groupNodeId(g.group_key);
    for (const m of members) memberOf.set(m, id);
    const first = model.nodes.get(members[0]!)!;
    // A run set is one job type (the server's sibling key): "12 finetune runs".
    const what =
      first.kind === "artifact_version" ? `${first.name} versions` : first.job_type ? `${first.job_type} runs` : "runs";
    groupNodes.push({
      kind: "group",
      id,
      group_key: g.group_key,
      member_kind: g.member_kind,
      count: members.length,
      members,
      label: `${members.length} ${what}`,
      ...(first.kind === "artifact_version" ? { type: first.type } : {}),
    });
  }
  const nodes: ViewNode[] = [...model.nodes.values()].filter((n) => !memberOf.has(n.id));
  // Group nodes sit where their first member was, for a stable order.
  nodes.push(...groupNodes);
  const merged = new Map<string, ViewEdge>();
  for (const e of model.edges) {
    const source = memberOf.get(e.source) ?? e.source;
    const target = memberOf.get(e.target) ?? e.target;
    const k = edgeKey({ source, target, kind: e.kind, role: e.role });
    const hit = merged.get(k);
    if (hit) hit.count += 1;
    else merged.set(k, { id: k, source, target, kind: e.kind, role: e.role, count: 1 });
  }
  return { nodes, edges: [...merged.values()] };
}

export interface FilterOptions {
  /** Hide every node of these kinds (`run`, `artifact_version`); group nodes follow their members' kind. */
  hiddenKinds: ReadonlySet<"run" | "artifact_version">;
  /** Hide versions (and version groups) of these artifact types. */
  hiddenTypes: ReadonlySet<string>;
  /** Never hidden (the centre). */
  pinned?: ReadonlySet<string>;
}

export function isHidden(n: ViewNode, opts: FilterOptions): boolean {
  if (opts.pinned?.has(n.id)) return false;
  const kind = n.kind === "group" ? n.member_kind : n.kind;
  if (opts.hiddenKinds.has(kind)) return true;
  const type = n.kind === "group" ? n.type : n.kind === "artifact_version" ? n.type : undefined;
  return type !== undefined && opts.hiddenTypes.has(type);
}

/**
 * The view without hidden nodes. A path `a -> (hidden)* -> b` between two
 * visible nodes becomes one `bridged` edge `a -> b` (unless a direct edge
 * already joins them), so hiding runs leaves `dataset -> checkpoint`.
 */
export function filterGraph(view: ViewGraph, opts: FilterOptions): ViewGraph {
  const hidden = new Set(view.nodes.filter((n) => isHidden(n, opts)).map((n) => n.id));
  if (hidden.size === 0) return view;
  const out = new Map<string, ViewEdge[]>();
  for (const e of view.edges) {
    const list = out.get(e.source);
    if (list) list.push(e);
    else out.set(e.source, [e]);
  }
  const edges: ViewEdge[] = [];
  const direct = new Set<string>();
  for (const e of view.edges) {
    if (!hidden.has(e.source) && !hidden.has(e.target)) {
      edges.push(e);
      direct.add(`${e.source}->${e.target}`);
    }
  }
  const bridged = new Map<string, ViewEdge>();
  for (const n of view.nodes) {
    if (hidden.has(n.id)) continue;
    // Walk forward through hidden nodes only.
    const stack = (out.get(n.id) ?? []).filter((e) => hidden.has(e.target)).map((e) => e.target);
    const seen = new Set<string>(stack);
    while (stack.length) {
      const h = stack.pop()!;
      for (const e of out.get(h) ?? []) {
        if (hidden.has(e.target)) {
          if (!seen.has(e.target)) {
            seen.add(e.target);
            stack.push(e.target);
          }
        } else if (e.target !== n.id && !direct.has(`${n.id}->${e.target}`)) {
          const id = `${n.id}=>${e.target}`;
          if (!bridged.has(id)) {
            bridged.set(id, { id, source: n.id, target: e.target, kind: "bridged", count: 1 });
          }
        }
      }
    }
  }
  return { nodes: view.nodes.filter((n) => !hidden.has(n.id)), edges: [...edges, ...bridged.values()] };
}

/** Everything upstream (ancestors) and downstream (descendants) of `id`, and the edges on those paths. */
export function lineagePath(
  edges: readonly ViewEdge[],
  id: string,
): { ancestors: Set<string>; descendants: Set<string>; edges: Set<string> } {
  const ins = new Map<string, ViewEdge[]>();
  const outs = new Map<string, ViewEdge[]>();
  for (const e of edges) {
    (ins.get(e.target) ?? ins.set(e.target, []).get(e.target)!).push(e);
    (outs.get(e.source) ?? outs.set(e.source, []).get(e.source)!).push(e);
  }
  const onPath = new Set<string>();
  const walk = (start: string, next: Map<string, ViewEdge[]>, end: "source" | "target") => {
    const found = new Set<string>();
    const stack = [start];
    while (stack.length) {
      const cur = stack.pop()!;
      for (const e of next.get(cur) ?? []) {
        onPath.add(e.id);
        const other = e[end];
        if (!found.has(other) && other !== start) {
          found.add(other);
          stack.push(other);
        }
      }
    }
    return found;
  };
  const ancestors = walk(id, ins, "source");
  const descendants = walk(id, outs, "target");
  return { ancestors, descendants, edges: onPath };
}

/**
 * How many of a node's produced/consumed edges (`full_degree`) the model
 * does not hold yet: what an upstream / downstream expansion would add.
 */
export function hiddenNeighbours(model: ModelGraph, id: string): { up: number; down: number } {
  const n = model.nodes.get(id);
  if (!n || !n.full_degree) return { up: 0, down: 0 };
  let up = 0;
  let down = 0;
  for (const e of model.edges) {
    if (e.kind === "forked") continue;
    if (e.target === id) up += 1;
    if (e.source === id) down += 1;
  }
  return { up: Math.max(0, n.full_degree.in - up), down: Math.max(0, n.full_degree.out - down) };
}

/** The artifact types present in the model (for the type filter). */
export function artifactTypes(model: ModelGraph): string[] {
  const s = new Set<string>();
  for (const n of model.nodes.values()) if (n.kind === "artifact_version") s.add(n.type);
  return [...s].sort();
}

/** The group a raw node is folded into in `view`, if any. */
export function foldingGroup(view: ViewGraph, id: string): ViewGroupNode | null {
  for (const n of view.nodes) if (n.kind === "group" && n.members.includes(id)) return n;
  return null;
}

/** Type guard. */
export const isRawNode = (n: LineageNode | ViewNode): n is RawNode => n.kind !== "group";
