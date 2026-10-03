/**
 * Left-to-right layered layout of the lineage view (dagre). Positions are
 * top-left corners, as React Flow wants them. Dragged positions are the
 * caller's: `layoutGraph` always returns the automatic layout.
 */

import dagre from "@dagrejs/dagre";
import type { ViewGraph, ViewNode } from "./graph-model.ts";

export const NODE_WIDTH = 236;

/** Card heights per node kind (the card components render to these). */
export function nodeHeight(n: ViewNode): number {
  if (n.kind === "group") return 62;
  if (n.kind === "run") return 76;
  return 84;
}

export interface Positioned {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function layoutGraph(view: ViewGraph): Map<string, Positioned> {
  const g = new dagre.graphlib.Graph({ multigraph: true });
  g.setGraph({ rankdir: "LR", nodesep: 28, ranksep: 96, marginx: 16, marginy: 16 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of view.nodes) g.setNode(n.id, { width: NODE_WIDTH, height: nodeHeight(n) });
  for (const e of view.edges) {
    if (g.hasNode(e.source) && g.hasNode(e.target)) g.setEdge(e.source, e.target, {}, e.id);
  }
  dagre.layout(g);
  const out = new Map<string, Positioned>();
  for (const n of view.nodes) {
    const p = g.node(n.id) as { x: number; y: number; width: number; height: number };
    out.set(n.id, { x: p.x - p.width / 2, y: p.y - p.height / 2, width: p.width, height: p.height });
  }
  return out;
}
