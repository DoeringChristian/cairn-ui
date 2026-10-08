/**
 * The runs table's building blocks, shared with the workspace sidebar (a
 * compact runs table): the table/header/row classes, the group header row
 * content and the Name cell (colour dot, name link, version). Rows follow
 * wandb's nested grouping: an outer group row has a hollow circle and two
 * counts (sub-groups, runs), an innermost group row the filled dot of its
 * chart line and its run count, and the runs inside groups no dot.
 */

import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { groupRowModel, type RunGroupNode } from "../../lib/runs-table/group";
import { RunSwatch } from "../RunViewControls";

/** Width of the leading checkbox (eye) column, px. */
export const CHECK_W = 40;

export const RUNS_TABLE_CLASS = "w-full border-separate border-spacing-0 text-sm";
export const RUNS_THEAD_CLASS = "bg-bg-elevated text-left text-xs uppercase tracking-wide text-fg-muted";
export const RUNS_TH_CLASS = "px-3 py-2";
/** A run row (`is-selected` / `is-hidden-run` added per row; runs-table.css). */
export const RUN_ROW_CLASS = "group/row border-t border-border-subtle hover:bg-bg-elevated";
export const RUN_CELL_CLASS = "px-3 py-2";
/** A group header row's cells (the row itself is `is-group`). */
export const GROUP_CELL_CLASS = "border-t border-border-subtle px-3 py-1.5";
/** Indent per group depth, px. */
export const DEPTH_INDENT = 12;

/**
 * The project workspace filtered to a run group (`run.group`):
 * `/p/<project>/workspace?group=<group>` (WorkspacePage applies it).
 */
export const groupWorkspacePath = (projectId: string, group: string) =>
  `/p/${projectId}/workspace?group=${encodeURIComponent(group)}`;

/** What a group header's name does: a link, or an action (the workspace sidebar filters in place). */
export type GroupNameAction = { to: string } | { onClick: () => void };

/** A hollow circle: an outer group, or a run / group drawn in no chart. */
export function HollowDot() {
  return <span aria-hidden="true" className="inline-block h-2.5 w-2.5 shrink-0 rounded-full border border-fg-subtle" />;
}

/**
 * A group header's content (wandb's): the dot (an outer group's hollow
 * circle, an innermost group's filled chart-line colour), ▾/▸, `Group:
 * exp-44`, then the counts (outer: sub-groups and runs; innermost: runs).
 * Toggles collapse; with `name` (a run group) the group's value filters the
 * workspace to it.
 */
export function GroupHeader({
  node,
  color,
  collapsed,
  onToggle,
  name: nameAction,
}: {
  node: RunGroupNode;
  /** An innermost group's dot (its chart line's colour); null: hollow. */
  color: string | null;
  collapsed: boolean;
  onToggle: () => void;
  /** What the group's value does (a link or an action); none: it toggles like the rest. */
  name?: GroupNameAction | null;
}) {
  const m = groupRowModel(node);
  const dot = m.dot === "filled" && color != null ? <RunSwatch color={color} /> : <HollowDot />;
  const chevron = <i className={`fa-solid ${collapsed ? "fa-chevron-right" : "fa-chevron-down"} w-3 text-[10px]`} aria-hidden="true" />;
  const field = <span className="shrink-0 text-fg-muted">{m.field}:</span>;
  const chips = (
    <span className="flex shrink-0 items-center gap-1">
      {m.counts.map((c, i) => (
        <span
          key={i}
          className="mono num rounded bg-bg-hover px-1.5 py-0.5 text-[10px] text-fg-muted"
          title={m.innermost || i === 1 ? `${c} run${c === 1 ? "" : "s"}` : `${c} subgroup${c === 1 ? "" : "s"}`}
        >
          {c}
        </span>
      ))}
    </span>
  );
  const valueClass = `mono min-w-0 truncate font-semibold ${m.none ? "italic text-fg-subtle" : "text-fg"}`;
  if (nameAction && !m.none) {
    const linkClass = "mono min-w-0 truncate font-semibold text-fg hover:text-accent hover:underline";
    const title = `Show only ${m.value} in the workspace`;
    return (
      <div className="flex w-full min-w-0 items-center gap-1.5 text-xs touch:min-h-[40px]">
        {dot}
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!collapsed}
          aria-label={`${collapsed ? "Expand" : "Collapse"} ${m.text}`}
          className="flex shrink-0 items-center gap-1.5 text-fg-muted hover:text-fg"
        >
          {chevron}
          {field}
        </button>
        {"to" in nameAction ? (
          <Link to={nameAction.to} className={linkClass} title={title}>
            {m.value}
          </Link>
        ) : (
          <button type="button" onClick={nameAction.onClick} className={linkClass} title={title}>
            {m.value}
          </button>
        )}
        <button type="button" onClick={onToggle} tabIndex={-1} aria-hidden="true" className="flex min-w-0 flex-1 items-center gap-1 self-stretch">
          {chips}
        </button>
      </div>
    );
  }
  return (
    <div className="flex w-full min-w-0 items-center gap-1.5 text-xs touch:min-h-[40px]">
      {dot}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-fg-muted hover:text-fg"
      >
        {chevron}
        {field}
        <span className={valueClass}>{m.value}</span>
        {chips}
      </button>
    </div>
  );
}

/** A run's version next to its name: `v2`. */
export function RunVersion({ version }: { version: number }) {
  return <span className="mono num shrink-0 text-xs text-fg-muted">v{version}</span>;
}

/**
 * The Name cell: colour dot, the name (a link to the run when `to`), the
 * version (`v2`, or a control in its place), then `children`.
 */
export function RunNameCell({
  before,
  name,
  to,
  linkState,
  color,
  depth = 0,
  version,
  muted = false,
  children,
}: {
  /** Before the dot (the workspace sidebar's eye), indented with it. */
  before?: ReactNode;
  name: string;
  /** The run page; null: plain text (no run to open). */
  to: string | null;
  /** The link's history state (the workspace sidebar's: the run page's back link). */
  linkState?: unknown;
  /** The dot's colour; null: a hollow dot; `false`: no dot (a run inside a group). */
  color: string | null | undefined | false;
  depth?: number;
  version?: ReactNode;
  muted?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="run-name relative flex min-w-0 items-center gap-1.5" style={{ paddingLeft: depth * DEPTH_INDENT }}>
      {before}
      {color === false ? null : color === null ? <HollowDot /> : <RunSwatch color={color} />}
      {to ? (
        <Link to={to} state={linkState} className="dim mono min-w-0 truncate text-accent hover:underline" title={name}>
          {name}
        </Link>
      ) : (
        <span className={`dim mono min-w-0 truncate ${muted ? "text-fg-subtle" : "text-fg"}`} title={name}>
          {name}
        </span>
      )}
      {version}
      {children}
    </div>
  );
}
