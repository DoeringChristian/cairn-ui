/**
 * The lineage viewer (wandb-style): run and artifact-version cards laid out
 * left to right (dagre), joined by right-angled arrows, with pan/zoom, a
 * minimap, draggable nodes, a details panel, one-hop expansion from any node,
 * foldable sibling groups, path highlighting and filters.
 *
 * Loaded lazily (React Flow is its own chunk). Dragged positions live only in
 * this component: every visit starts from the automatic layout, and "Reset
 * layout" returns to it.
 */

import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
  type Edge,
  type NodeChange,
} from "@xyflow/react";
import { useLineageGraph, type LineageCenter } from "./use-lineage-graph";
import { errorText } from "../../api/client";
import {
  artifactTypes,
  clusterGraph,
  filterGraph,
  groupNodeId,
  hiddenNeighbours,
  lineagePath,
  type ViewEdge,
  type ViewNode,
} from "../../lib/lineage/graph-model";
import { layoutGraph, nodeHeight } from "../../lib/lineage/layout";
import { typeColor } from "../../lib/artifacts/type-style";
import LineagePanel, { type PanelActions } from "./LineagePanel";
import { NODE_TYPES, RUN_COLOR, type LineageFlowNode } from "./nodes";

/** Sibling sets larger than this fold into one group node. */
export const CLUSTER_THRESHOLD = 5;
/** Hops loaded around the centre on open. */
export const INITIAL_DEPTH = 2;
/** Automatic fits of a centred graph never zoom out past this (labels stay readable; pan for the rest). */
const FIT_MIN_ZOOM = 0.6;
/** The details panel's width (LineagePanel: w-[340px] + margins). */
const PANEL_WIDTH = 340;

export default function LineageView(props: {
  projectId: string;
  /** Centre on a version or run; omitted: the whole project. */
  center?: LineageCenter | null;
  /** Project view: only this artifact's versions (and their runs). */
  familyId?: string | null;
}) {
  return (
    <ReactFlowProvider>
      <LineageCanvas {...props} />
    </ReactFlowProvider>
  );
}

function LineageCanvas({
  projectId,
  center,
  familyId,
}: {
  projectId: string;
  center?: LineageCenter | null;
  familyId?: string | null;
}) {
  const { model, isLoading, error, expanding, expand } = useLineageGraph(projectId, { center, familyId, depth: INITIAL_DEPTH });

  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [hiddenKinds, setHiddenKinds] = useState<Set<"run" | "artifact_version">>(new Set());
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const pinned = useMemo(() => {
    const s = new Set<string>();
    if (center) s.add(center.id);
    if (selectedId && model.nodes.has(selectedId)) s.add(selectedId);
    return s;
  }, [center, selectedId, model]);

  const view = useMemo(() => {
    const clustered = clusterGraph(model, { threshold: CLUSTER_THRESHOLD, expanded: expandedGroups, pinned });
    return filterGraph(clustered, { hiddenKinds, hiddenTypes, pinned: center ? new Set([center.id]) : undefined });
  }, [model, expandedGroups, pinned, hiddenKinds, hiddenTypes, center]);

  const layout = useMemo(() => layoutGraph(view), [view]);
  const types = useMemo(() => artifactTypes(model), [model]);
  const path = useMemo(
    () => (selectedId && view.nodes.some((n) => n.id === selectedId) ? lineagePath(view.edges, selectedId) : null),
    [view, selectedId],
  );

  // Dragged positions: this visit only.
  const dragged = useRef(new Map<string, { x: number; y: number }>());
  const { fitView, getZoom, setCenter, getViewport, setViewport } = useReactFlow();
  const wrapper = useRef<HTMLDivElement>(null);

  /** Select a node; when the details panel would cover it, pan it into view. */
  const selectNode = useCallback(
    (id: string, el: Element | null) => {
      setSelectedId(id);
      const box = wrapper.current?.getBoundingClientRect();
      const r = el?.closest(".react-flow__node")?.getBoundingClientRect();
      if (!box || !r) return;
      const panelLeft = box.right - PANEL_WIDTH - 24;
      if (r.right > panelLeft) {
        const v = getViewport();
        void setViewport({ ...v, x: v.x - (r.right - panelLeft) - 24 }, { duration: 200 });
      }
    },
    [getViewport, setViewport],
  );

  const expandGroup = useCallback((key: string) => {
    setExpandedGroups((s) => new Set(s).add(key));
    setSelectedId((sel) => (sel === groupNodeId(key) ? null : sel));
  }, []);
  const collapseGroup = useCallback(
    (key: string) =>
      setExpandedGroups((s) => {
        const n = new Set(s);
        n.delete(key);
        return n;
      }),
    [],
  );

  const hidden = useCallback((id: string) => hiddenNeighbours(model, id), [model]);

  const buildNodes = useCallback((): LineageFlowNode[] => {
    const onPath = (id: string) => !path || id === selectedId || path.ancestors.has(id) || path.descendants.has(id);
    return view.nodes.map((n) => {
      const p = dragged.current.get(n.id) ?? layout.get(n.id) ?? { x: 0, y: 0 };
      const common = {
        dim: !onPath(n.id),
        selected: n.id === selectedId,
        center: n.id === center?.id,
        hidden: n.kind === "group" ? { up: 0, down: 0 } : hidden(n.id),
        onExpand: expand,
        onExpandGroup: expandGroup,
        height: nodeHeight(n),
      };
      const position = { x: p.x, y: p.y };
      if (n.kind === "run") return { id: n.id, type: "run", position, data: { ...common, node: n } };
      if (n.kind === "artifact_version") return { id: n.id, type: "artifact_version", position, data: { ...common, node: n } };
      return { id: n.id, type: "group", position, data: { ...common, node: n } };
    });
  }, [view, layout, path, selectedId, center, hidden, expand, expandGroup]);

  const [nodes, setNodes, onNodesChangeBase] = useNodesState<LineageFlowNode>([]);
  useEffect(() => setNodes(buildNodes()), [buildNodes, setNodes]);
  const onNodesChange = useCallback(
    (changes: NodeChange<LineageFlowNode>[]) => {
      for (const c of changes) {
        if (c.type === "position" && c.position && c.dragging) dragged.current.set(c.id, c.position);
      }
      onNodesChangeBase(changes);
    },
    [onNodesChangeBase],
  );

  const edges: Edge[] = useMemo(
    () => view.edges.map((e) => flowEdge(e, path ? path.edges.has(e.id) : null)),
    [view, path],
  );

  // Fit the graph; when it is too wide to fit readably, keep the centre node in view.
  const autoFit = useCallback(() => {
    // A centred graph never zooms out past FIT_MIN_ZOOM (the centre stays
    // readable); the project graph fits whole.
    void fitView({ padding: 0.12, duration: 250, maxZoom: 1.1, minZoom: center ? FIT_MIN_ZOOM : 0.1 }).then(() => {
      if (!center || getZoom() > FIT_MIN_ZOOM + 1e-3) return;
      const p = dragged.current.get(center.id) ?? layout.get(center.id);
      const n = view.nodes.find((x) => x.id === center.id);
      if (p && n) void setCenter(p.x + 118, p.y + nodeHeight(n) / 2, { zoom: getZoom(), duration: 200 });
    });
  }, [fitView, getZoom, setCenter, center, layout, view]);

  // Fit once the first graph is laid out, and whenever expansions add nodes.
  const nodeCount = view.nodes.length;
  const autoFitRef = useRef(autoFit);
  autoFitRef.current = autoFit;
  useEffect(() => {
    if (nodeCount === 0) return;
    const t = setTimeout(() => autoFitRef.current(), 30);
    return () => clearTimeout(t);
  }, [nodeCount]);

  const resetLayout = () => {
    dragged.current.clear();
    setNodes(buildNodes());
    setTimeout(() => autoFitRef.current(), 30);
  };

  const selected: ViewNode | null = useMemo(
    () => view.nodes.find((n) => n.id === selectedId) ?? null,
    [view, selectedId],
  );

  const groupOf = useCallback(
    (id: string) => {
      const g = model.groups.find((x) => x.members.includes(id));
      return g && expandedGroups.has(g.group_key) ? g.group_key : null;
    },
    [model, expandedGroups],
  );
  const actions: PanelActions = {
    onExpand: expand,
    onExpandGroup: expandGroup,
    onCollapseGroup: (key) => {
      collapseGroup(key);
      setSelectedId(null);
    },
    onSelect: setSelectedId,
    hidden,
    groupOf,
  };

  if (isLoading) return <p className="p-4 text-sm text-fg-muted">Loading lineage…</p>;
  if (error) return <p className="p-4 text-sm text-status-failed">{errorText(error)}</p>;
  if (model.nodes.size === 0)
    return (
      <div className="p-6 text-sm text-fg-muted" data-testid="lineage-empty">
        No lineage yet. Lineage appears once runs log artifacts (<code className="mono">run.log_artifact</code>) or use
        them (<code className="mono">run.use_artifact</code>).
      </div>
    );

  const toggle = <T,>(set: Set<T>, v: T): Set<T> => {
    const n = new Set(set);
    if (n.has(v)) n.delete(v);
    else n.add(v);
    return n;
  };
  const foldable = model.groups.filter((g) => g.members.length > CLUSTER_THRESHOLD);

  return (
    <div ref={wrapper} className="relative h-full w-full" data-testid="lineage-view">
      <ReactFlow<LineageFlowNode, Edge>
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        onNodesChange={onNodesChange}
        onNodeClick={(e, n) => selectNode(n.id, e.target as Element)}
        onPaneClick={() => setSelectedId(null)}
        nodesDraggable
        nodesConnectable={false}
        edgesFocusable={false}
        elementsSelectable
        minZoom={0.1}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{ type: "step" }}
      >
        <Background gap={20} size={1} color="#d0d7de" />
        <Controls showInteractive={false} position="bottom-left" />
        <MiniMap
          position="bottom-right"
          pannable
          zoomable
          nodeColor={(n) => {
            const d = (n as unknown as LineageFlowNode).data;
            if (d.node.kind === "run") return RUN_COLOR;
            if (d.node.kind === "artifact_version") return typeColor(d.node.type);
            return "#8b949e";
          }}
          style={{ marginRight: selected ? PANEL_WIDTH + 16 : undefined }}
        />
        <Panel position="top-left">
          <div className="flex max-w-[calc(100vw-2rem)] flex-wrap items-center gap-1.5 rounded-lg border border-border bg-bg/95 px-2 py-1.5 text-xs shadow-sm" data-testid="lineage-toolbar">
            <FilterChip
              active={!hiddenKinds.has("run")}
              color={RUN_COLOR}
              label="Runs"
              onClick={() => setHiddenKinds((s) => toggle(s, "run"))}
            />
            <FilterChip
              active={!hiddenKinds.has("artifact_version")}
              color="#6e7781"
              label="Artifacts"
              onClick={() => setHiddenKinds((s) => toggle(s, "artifact_version"))}
            />
            <span className="mx-0.5 h-4 w-px bg-border" />
            {types.map((t) => (
              <FilterChip
                key={t}
                active={!hiddenTypes.has(t) && !hiddenKinds.has("artifact_version")}
                color={typeColor(t)}
                label={t}
                onClick={() => setHiddenTypes((s) => toggle(s, t))}
              />
            ))}
            <span className="mx-0.5 h-4 w-px bg-border" />
            <button type="button" className="rounded px-1.5 py-0.5 text-fg-muted hover:bg-bg-hover hover:text-fg" onClick={() => fitView({ padding: 0.12, duration: 250, minZoom: 0.1 })}>
              <i className="fa-solid fa-expand" aria-hidden="true" /> Fit
            </button>
            <button type="button" className="rounded px-1.5 py-0.5 text-fg-muted hover:bg-bg-hover hover:text-fg" onClick={resetLayout}>
              <i className="fa-solid fa-rotate-left" aria-hidden="true" /> Reset layout
            </button>
            {foldable.some((g) => !expandedGroups.has(g.group_key)) && (
              <button
                type="button"
                className="rounded px-1.5 py-0.5 text-fg-muted hover:bg-bg-hover hover:text-fg"
                onClick={() => {
                  setExpandedGroups(new Set(foldable.map((g) => g.group_key)));
                  setSelectedId((sel) => (sel?.startsWith("group:") ? null : sel));
                }}
              >
                <i className="fa-solid fa-layer-group" aria-hidden="true" /> Expand groups
              </button>
            )}
            {foldable.some((g) => expandedGroups.has(g.group_key)) && (
              <button
                type="button"
                className="rounded px-1.5 py-0.5 text-fg-muted hover:bg-bg-hover hover:text-fg"
                onClick={() => setExpandedGroups(new Set())}
              >
                <i className="fa-solid fa-compress" aria-hidden="true" /> Collapse groups
              </button>
            )}
            {expanding && <span className="text-fg-subtle">loading…</span>}
          </div>
        </Panel>
      </ReactFlow>
      {selected && <LineagePanel node={selected} model={model} projectId={projectId} actions={actions} />}
    </div>
  );
}

function FilterChip({ active, color, label, onClick }: { active: boolean; color: string; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 ${active ? "border-border text-fg" : "border-dashed border-border text-fg-subtle line-through"}`}
      onClick={onClick}
    >
      <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: active ? color : "transparent", border: `1px solid ${color}` }} />
      {label}
    </button>
  );
}

const EDGE_COLOR = { produced: "#57606a", consumed: "#57606a", forked: "#8250df", bridged: "#8b949e" } as const;

/** A right-angled ("step") edge with an arrowhead; role and fold count as its label. */
function flowEdge(e: ViewEdge, onPath: boolean | null): Edge {
  const highlighted = onPath === true;
  const color = highlighted ? "#0969da" : EDGE_COLOR[e.kind];
  const parts: string[] = [];
  if (e.role && e.role !== "input") parts.push(e.role);
  if (e.kind === "forked") parts.push("fork");
  if (e.count > 1) parts.push(`×${e.count}`);
  return {
    id: e.id,
    source: e.source,
    target: e.target,
    type: "step",
    markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color },
    style: {
      stroke: color,
      strokeWidth: highlighted ? 2.25 : 1.5,
      strokeDasharray: e.kind === "bridged" || e.kind === "forked" ? "5 4" : undefined,
      opacity: onPath === false ? 0.2 : 1,
    },
    label: parts.length ? parts.join(" ") : undefined,
    labelStyle: { fontSize: 10, fill: "#57606a", fontFamily: "ui-monospace, monospace" },
    labelBgStyle: { fill: "#ffffff" },
    labelBgPadding: [3, 1],
    data: { kind: e.kind },
  };
}
