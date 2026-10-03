import { memo, type CSSProperties } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { LineageRunNode, LineageVersionNode } from "../../api/types";
import type { ViewGroupNode } from "../../lib/lineage/graph-model";
import { NODE_WIDTH } from "../../lib/lineage/layout";
import { typeColor } from "../../lib/artifacts/type-style";
import { formatBytes } from "../../lib/format";

/** What every lineage card gets from the view. */
type CardState = {
  /** Faded: not on the selected node's path. */
  dim: boolean;
  selected: boolean;
  center: boolean;
  /** Produced/consumed edges not loaded yet, per side. */
  hidden: { up: number; down: number };
  onExpand: (id: string, direction: "upstream" | "downstream") => void;
  onExpandGroup: (key: string) => void;
};

export type RunNodeData = CardState & { node: LineageRunNode; height: number };
export type VersionNodeData = CardState & { node: LineageVersionNode; height: number };
export type GroupNodeData = CardState & { node: ViewGroupNode; height: number };

export type RunFlowNode = Node<RunNodeData, "run">;
export type VersionFlowNode = Node<VersionNodeData, "artifact_version">;
export type GroupFlowNode = Node<GroupNodeData, "group">;
export type LineageFlowNode = RunFlowNode | VersionFlowNode | GroupFlowNode;

const STATUS_COLOR: Record<string, string> = {
  running: "#bf8700",
  completed: "#1a7f37",
  failed: "#cf222e",
  killed: "#8b949e",
  stopped: "#8250df",
};
export const RUN_COLOR = "#0969da";

const handleCls = "!h-2 !w-2 !min-w-0 !border-0 !bg-fg-subtle/60";

function ExpandButton({
  side,
  count,
  onClick,
}: {
  side: "left" | "right";
  count: number;
  onClick: () => void;
}) {
  if (count <= 0) return null;
  return (
    <button
      type="button"
      className={`nodrag nopan absolute top-1/2 z-10 -translate-y-1/2 rounded-full border border-accent/60 bg-bg px-1.5 text-[10px] font-semibold leading-4 text-accent shadow-sm hover:bg-accent hover:text-white ${
        side === "left" ? "-left-3 -translate-x-full" : "-right-3 translate-x-full"
      }`}
      title={side === "left" ? `show ${count} more upstream` : `show ${count} more downstream`}
      aria-label={side === "left" ? `expand upstream (${count})` : `expand downstream (${count})`}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {side === "left" ? `+${count} ‹` : `› +${count}`}
    </button>
  );
}

function frame(d: CardState, accent: string): CSSProperties {
  return {
    width: NODE_WIDTH,
    opacity: d.dim ? 0.28 : 1,
    borderColor: d.selected ? accent : undefined,
    boxShadow: d.selected ? `0 0 0 2px ${accent}55, 0 4px 12px rgba(0,0,0,0.08)` : "0 1px 2px rgba(0,0,0,0.06)",
  };
}

function Chips({ aliases = [], tags = [], max = 3 }: { aliases?: readonly string[]; tags?: readonly string[]; max?: number }) {
  const all = [...aliases.map((a) => ({ a, alias: true })), ...tags.map((a) => ({ a, alias: false }))];
  if (all.length === 0) return null;
  const shown = all.slice(0, max);
  return (
    <div className="flex min-w-0 flex-nowrap items-center gap-1 overflow-hidden">
      {shown.map(({ a, alias }) => (
        <span
          key={`${alias}-${a}`}
          className={`mono shrink-0 truncate rounded border px-1 text-[10px] leading-4 ${
            alias ? "border-accent/40 bg-accent/5 text-accent" : "border-border bg-bg-elevated text-fg-muted"
          }`}
          style={{ maxWidth: 90 }}
        >
          {alias ? a : `#${a}`}
        </span>
      ))}
      {all.length > max && <span className="text-[10px] text-fg-subtle">+{all.length - max}</span>}
    </div>
  );
}

export const RunCard = memo(function RunCard({ data }: NodeProps<RunFlowNode>) {
  const n = data.node;
  const status = n.status ?? (n.deleted ? "deleted" : "unknown");
  const sc = STATUS_COLOR[status] ?? "#8b949e";
  const sub = [n.job_type, n.group].filter(Boolean).join(" · ");
  return (
    <div
      className="relative flex overflow-visible rounded-md border border-border bg-bg"
      style={{ ...frame(data, RUN_COLOR), height: data.height }}
      data-testid="lineage-node-run"
      data-node-id={n.id}
    >
      <Handle type="target" position={Position.Left} className={handleCls} isConnectable={false} />
      <div className="w-1.5 shrink-0 rounded-l-md" style={{ backgroundColor: RUN_COLOR }} />
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 px-2.5 py-1.5">
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-fg-muted">
          <i className="fa-solid fa-play text-[8px]" style={{ color: RUN_COLOR }} aria-hidden="true" />
          run
          <span className="ml-auto inline-flex items-center gap-1 normal-case tracking-normal" style={{ color: sc }}>
            <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: sc }} />
            {status}
          </span>
        </div>
        <div className="mono truncate text-[13px] font-semibold" title={n.name ?? n.id}>
          {n.label}
          {data.center && <span className="ml-1 text-[10px] font-normal text-accent">(this)</span>}
        </div>
        {sub && <div className="truncate text-[11px] text-fg-muted">{sub}</div>}
        <Chips tags={n.tags} />
      </div>
      <Handle type="source" position={Position.Right} className={handleCls} isConnectable={false} />
      <ExpandButton side="left" count={data.hidden.up} onClick={() => data.onExpand(n.id, "upstream")} />
      <ExpandButton side="right" count={data.hidden.down} onClick={() => data.onExpand(n.id, "downstream")} />
    </div>
  );
});

export const VersionCard = memo(function VersionCard({ data }: NodeProps<VersionFlowNode>) {
  const n = data.node;
  const c = typeColor(n.type);
  return (
    <div
      className="relative flex flex-col overflow-visible rounded-sm border bg-bg"
      style={{ ...frame(data, c), height: data.height, borderColor: data.selected ? c : `${c}66` }}
      data-testid="lineage-node-version"
      data-node-id={n.id}
    >
      <Handle type="target" position={Position.Left} className={handleCls} isConnectable={false} />
      <div className="flex items-center gap-1.5 px-2.5 py-0.5 text-[10px] uppercase tracking-wide text-white" style={{ backgroundColor: c }}>
        <i className="fa-solid fa-cube text-[9px]" aria-hidden="true" />
        <span className="truncate">{n.type}</span>
        {n.step != null && <span className="mono ml-auto normal-case">step {n.step}</span>}
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 px-2.5 py-1">
        <div className="mono truncate text-[13px] font-semibold" title={n.qualified_ref}>
          {n.name}
          <span className="text-fg-muted">:v{n.version}</span>
          {data.center && <span className="ml-1 text-[10px] font-normal text-accent">(this)</span>}
        </div>
        <div className="truncate text-[11px] text-fg-muted">
          {n.file_count} file{n.file_count === 1 ? "" : "s"} · {formatBytes(n.size)}
        </div>
        <Chips aliases={n.aliases} tags={n.tags} />
      </div>
      <Handle type="source" position={Position.Right} className={handleCls} isConnectable={false} />
      <ExpandButton side="left" count={data.hidden.up} onClick={() => data.onExpand(n.id, "upstream")} />
      <ExpandButton side="right" count={data.hidden.down} onClick={() => data.onExpand(n.id, "downstream")} />
    </div>
  );
});

export const GroupCard = memo(function GroupCard({ data }: NodeProps<GroupFlowNode>) {
  const n = data.node;
  const c = n.member_kind === "run" ? RUN_COLOR : typeColor(n.type ?? "");
  return (
    <div className="relative" style={{ width: NODE_WIDTH, height: data.height, opacity: data.dim ? 0.28 : 1 }} data-testid="lineage-node-group" data-node-id={n.id}>
      {/* The stack behind: two offset sheets. */}
      <div className="absolute inset-0 translate-x-2 translate-y-2 rounded-md border border-border bg-bg-elevated" />
      <div className="absolute inset-0 translate-x-1 translate-y-1 rounded-md border border-border bg-bg-elevated" />
      <div
        className="relative flex h-full items-center gap-2 rounded-md border bg-bg px-2.5"
        style={{
          borderColor: data.selected ? c : `${c}88`,
          borderStyle: "dashed",
          boxShadow: data.selected ? `0 0 0 2px ${c}55` : undefined,
        }}
      >
        <Handle type="target" position={Position.Left} className={handleCls} isConnectable={false} />
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-xs font-bold text-white" style={{ backgroundColor: c }}>
          {n.count}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] uppercase tracking-wide text-fg-muted">{n.member_kind === "run" ? "run group" : "version group"}</div>
          <div className="mono truncate text-[13px] font-semibold">{n.label}</div>
        </div>
        <button
          type="button"
          className="nodrag nopan rounded border border-border px-1.5 py-0.5 text-[10px] text-fg-muted hover:border-accent hover:text-accent"
          onClick={(e) => {
            e.stopPropagation();
            data.onExpandGroup(n.group_key);
          }}
          aria-label={`expand group ${n.label}`}
        >
          Expand
        </button>
        <Handle type="source" position={Position.Right} className={handleCls} isConnectable={false} />
      </div>
    </div>
  );
});

export const NODE_TYPES = { run: RunCard, artifact_version: VersionCard, group: GroupCard };
