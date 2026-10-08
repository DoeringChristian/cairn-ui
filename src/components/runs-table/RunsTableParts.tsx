/**
 * The runs table's building blocks, shared with the workspace sidebar (a
 * compact runs table): the table/header/row classes, the group header row
 * content and the Name cell (colour dot, name link, version).
 */

import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { groupByLabel, type GroupBy } from "../../lib/runs-table/group";
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

/** A group header's content: ▾/▸, `group: exp-44`, the count chip. Toggles collapse. */
export function GroupHeader({
  by,
  label,
  count,
  collapsed,
  onToggle,
}: {
  by: GroupBy;
  /** The group's value; null: no value, shown `(none)`. */
  label: string | null;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={!collapsed}
      className="flex w-full min-w-0 items-center gap-2 text-left text-xs text-fg-muted hover:text-fg touch:min-h-[40px]"
    >
      <i className={`fa-solid ${collapsed ? "fa-chevron-right" : "fa-chevron-down"} w-3 text-[10px]`} aria-hidden="true" />
      <span className="mono shrink truncate text-fg-subtle">{groupByLabel(by)}:</span>
      <span className={`mono truncate font-semibold ${label == null ? "italic text-fg-subtle" : "text-fg"}`}>{label ?? "(none)"}</span>
      <span className="shrink-0 rounded bg-bg-hover px-1.5 py-0.5 text-[10px]">{count}</span>
    </button>
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
  name,
  to,
  color,
  depth = 0,
  version,
  muted = false,
  children,
}: {
  name: string;
  /** The run page; null: plain text (no run to open). */
  to: string | null;
  /** The dot's colour; null: a hollow dot. */
  color: string | null | undefined;
  depth?: number;
  version?: ReactNode;
  muted?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="relative flex min-w-0 items-center gap-1.5" style={{ paddingLeft: depth * DEPTH_INDENT }}>
      {color === null ? (
        <span aria-hidden="true" className="inline-block h-2.5 w-2.5 shrink-0 rounded-full border border-fg-subtle" />
      ) : (
        <RunSwatch color={color} />
      )}
      {to ? (
        <Link to={to} className="dim mono min-w-0 truncate text-accent hover:underline" title={name}>
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
