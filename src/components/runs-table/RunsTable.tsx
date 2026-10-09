/**
 * The runs table itself (`<table>`: header, group header rows, run rows),
 * rendered by the Runs page with every column and a checkbox column, and by
 * the workspace sidebar with the Name column only and an eye column. The
 * rows come from `useRunsTable`; the frozen left block (lead column, Name,
 * pinned columns) is sticky (pages/runs-table.css, under a `.runs-table`
 * wrapper).
 */

import type { CSSProperties, ReactNode } from "react";
import type { Run } from "../../api/types";
import { isNumericColumn } from "../../lib/runs-table/columns";
import { aggregates, groupLineLabel, type RunGroupNode, type TableRow } from "../../lib/runs-table/group";
import { groupSelection, runRowName } from "../../lib/runs-table/model";
import {
  CHECK_W,
  DEPTH_INDENT,
  GROUP_CELL_CLASS,
  GroupHeader,
  groupWorkspacePath,
  type GroupNameAction,
  RUN_CELL_CLASS,
  RUN_ROW_CLASS,
  RUNS_TABLE_CLASS,
  RUNS_THEAD_CLASS,
  RUNS_TH_CLASS,
  RunNameCell,
  RunVersion,
} from "./RunsTableParts";

export type Eye = "on" | "off" | "mixed";

/** The leading column: checkboxes (bulk selection) or eyes (what the workspace's cards draw). */
export type RunsTableLead =
  | {
      kind: "check";
      selected: ReadonlySet<string>;
      onToggle: (id: string, shiftKey: boolean) => void;
      /** The header checkbox. */
      all: "all" | "some" | "none";
      onToggleAll: () => void;
      /** A group header's checkbox: selects (or clears) every run beneath it. */
      onToggleGroup: (node: RunGroupNode) => void;
    }
  | {
      kind: "eye";
      runEye: (run: Run) => boolean;
      groupEye: (node: RunGroupNode) => Eye;
      onRun: (run: Run) => void;
      onGroup: (node: RunGroupNode) => void;
      /** The header eye: every listed run. */
      all: Eye;
      onAll: () => void;
    };

/** The workspace's hover highlight: which rows are lit, and the row hovered. */
export interface RunsTableHover {
  runHot: (run: Run) => boolean;
  groupHot: (node: RunGroupNode) => boolean;
  onRun: (run: Run | null) => void;
  onGroup: (node: RunGroupNode | null) => void;
}

export interface FrozenProps {
  className: string;
  style: CSSProperties;
}

/** Every column (the Runs page): Name and the pinned columns frozen, the rest scrolling. */
export interface RunsTableColumns {
  /** `name` first, then the pinned columns. */
  frozen: string[];
  scroll: string[];
  widthOf: (col: string) => number | undefined;
  /** A column's `<th>` (`frozen`: its sticky props; `style`: a scrolling column's width). */
  header: (col: string, frozen: FrozenProps | null, style: CSSProperties | undefined) => ReactNode;
  /** A cell's content, Name excepted. */
  cell: (run: Run, col: string) => ReactNode;
}

interface Props {
  projectId: string;
  rows: TableRow[];
  collapsed: ReadonlySet<string>;
  onToggleGroup: (id: string) => void;
  /** A run's name is not prefixed with its group (`runRowName`): grouped, or every listed run in one group. */
  grouped: boolean;
  /** The newest run of a series with several runs: highlighted. */
  latestByName: ReadonlySet<string>;
  /** A run's dot (its own line: not grouped, or under a `(none)`; runs averaged into a group line have none); null: hollow. */
  colorOf: (run: Run) => string | null | undefined;
  /** The innermost groups' dots: their chart lines' colours (lib/run-color.ts `groupLineColors`). */
  groupColors: ReadonlyMap<string, string>;
  /** An innermost group drawn in no chart (its dot hollow). */
  groupHidden?: (node: RunGroupNode) => boolean;
  /** The eye header's `15 listed`. */
  listed?: number;
  /** Dimmed. */
  hidden: (run: Run) => boolean;
  lead: RunsTableLead;
  /** Omitted: the Name column only. */
  columns?: RunsTableColumns;
  /** After the Name cell's version. */
  nameExtras?: (run: Run) => ReactNode;
  hover?: RunsTableHover;
  /** The run links' history state (the workspace sidebar: lib/run-nav.ts `FROM_WORKSPACE`). */
  runLinkState?: unknown;
  /** A run group's name in a group header (`group` levels); default: a link to the workspace filtered to it. */
  groupName?: (group: string) => GroupNameAction;
}

const EYE_GLYPH: Record<Eye, string> = { on: "◉", off: "○", mixed: "◐" };

function EyeButton({ eye, label, onClick }: { eye: Eye; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className={`run-controls run-eye inline-flex h-5 w-4 items-center justify-center rounded text-sm leading-none hover:bg-bg-hover touch:h-9 touch:w-9 ${
        eye === "off" ? "text-fg-subtle" : "text-fg"
      }`}
      onClick={onClick}
      aria-pressed={eye !== "off"}
      aria-label={`${eye === "on" ? "Hide" : "Show"} ${label}`}
      title={eye === "on" ? "Hide" : "Show"}
    >
      {EYE_GLYPH[eye]}
    </button>
  );
}

function GroupCheckbox({ state, label, onChange }: { state: "all" | "some" | "none"; label: string; onChange: () => void }) {
  return (
    <input
      type="checkbox"
      aria-label={`select every run of ${label}`}
      checked={state === "all"}
      ref={(el) => {
        if (el) el.indeterminate = state === "some";
      }}
      onChange={onChange}
    />
  );
}

export default function RunsTable({
  projectId,
  rows,
  collapsed,
  onToggleGroup,
  grouped,
  latestByName,
  colorOf,
  hidden,
  lead,
  columns,
  nameExtras,
  hover,
  groupName = (g) => ({ to: groupWorkspacePath(projectId, g) }),
  groupColors,
  groupHidden,
  listed,
  runLinkState,
}: Props) {
  // Checkboxes have their own column; eyes sit in the Name cell, before the dot (or the group's caret),
  // so they indent with the name. Only the header's eye-all stays left of "Name".
  const leadCol = lead.kind === "check";
  const leadW = leadCol ? CHECK_W : 0;
  const leadStyle = (extra?: CSSProperties): CSSProperties => ({ left: 0, width: leadW, minWidth: leadW, maxWidth: leadW, ...extra });
  const frozen = columns?.frozen ?? ["name"];
  const scroll = columns?.scroll ?? [];
  const widthOf = (col: string) => columns?.widthOf(col);
  const frozenLeft = (i: number) => {
    let left = leadW;
    for (let j = 0; j < i; j++) left += widthOf(frozen[j]!) ?? 0;
    return left;
  };
  const frozenTotal = frozenLeft(frozen.length);
  const lastFrozen = frozen.length - 1;
  // The block's edge shadow only where columns scroll past it.
  const edge = (i: number) => (columns && i === lastFrozen ? "frozen-edge" : "");
  const frozenProps = (i: number, extra = ""): FrozenProps => {
    const w = widthOf(frozen[i]!);
    return {
      className: `frozen ${edge(i)} ${extra}`,
      style: { left: frozenLeft(i), ...(w === undefined ? {} : { width: w, minWidth: w, maxWidth: w }) },
    };
  };
  /** A resized scrolling column: fixed width, overflow ellipsized. */
  const scrollCellStyle = (col: string): CSSProperties | undefined => {
    const w = widthOf(col);
    return w === undefined ? undefined : { width: w, minWidth: w, maxWidth: w, overflow: "hidden", textOverflow: "ellipsis" };
  };

  const nameCell = (r: Run, depth: number, own: boolean) => (
    <RunNameCell
      before={
        lead.kind === "eye" ? <EyeButton eye={lead.runEye(r) ? "on" : "off"} label={runLabel(r)} onClick={() => lead.onRun(r)} /> : null
      }
      name={runRowName(r, grouped)}
      to={`/p/${projectId}/r/${r.id}`}
      linkState={runLinkState}
      color={own ? colorOf(r) : false}
      depth={depth}
      version={r.version != null ? <RunVersion version={r.version} /> : null}
    >
      {nameExtras?.(r)}
    </RunNameCell>
  );

  const runLabel = (r: Run) => r.display_name ?? r.id;

  /** The newest run of a series with several runs: an accent edge on the row's first cell. */
  const highlightOf = (r: Run): CSSProperties | undefined =>
    latestByName.has(r.id) ? { boxShadow: "inset 2px 0 0 rgb(var(--color-accent-rgb))" } : undefined;

  const leadCell = (r: Run) =>
    lead.kind === "check" ? (
      <td className={`frozen ${RUN_CELL_CLASS}`} style={leadStyle(highlightOf(r))}>
        <input
          type="checkbox"
          aria-label={`select run ${runLabel(r)}`}
          checked={lead.selected.has(r.id)}
          onChange={(e) => lead.onToggle(r.id, (e.nativeEvent as MouseEvent).shiftKey ?? false)}
        />
      </td>
    ) : null;

  const runRow = (r: Run, key: string, depth: number, own: boolean) => {
    const isSelected = lead.kind === "check" && lead.selected.has(r.id);
    const rowClass = [
      RUN_ROW_CLASS,
      isSelected ? "is-selected bg-accent/5" : "",
      hidden(r) ? "is-hidden-run" : "",
      hover?.runHot(r) ? "is-hot" : "",
    ].join(" ");
    return (
      <tr
        key={key}
        className={rowClass}
        data-run-id={r.id}
        onMouseEnter={hover ? () => hover.onRun(r) : undefined}
        onMouseLeave={hover ? () => hover.onRun(null) : undefined}
      >
        {leadCell(r)}
        {frozen.map((col, i) => {
          const fp = frozenProps(i, `px-3 py-2 ${isNumericColumn(col) ? "mono num" : ""}`);
          const style = !leadCol && i === 0 ? { ...fp.style, ...highlightOf(r) } : fp.style;
          return (
            <td key={col} className={fp.className} style={style}>
              {col === "name" ? nameCell(r, depth, own) : <div className="truncate">{columns!.cell(r, col)}</div>}
            </td>
          );
        })}
        {scroll.map((col) => (
          <td key={col} className={`px-3 py-2 ${isNumericColumn(col) ? "mono num" : ""}`} style={scrollCellStyle(col)}>
            {columns!.cell(r, col)}
          </td>
        ))}
        {columns && <td aria-hidden="true" />}
      </tr>
    );
  };

  const groupRow = (node: RunGroupNode) => {
    const eye =
      lead.kind === "eye" ? <EyeButton eye={lead.groupEye(node)} label={node.label ?? "(none)"} onClick={() => lead.onGroup(node)} /> : null;
    const header = (
      <div className={eye ? "flex min-w-0 items-center gap-1.5" : undefined} style={{ paddingLeft: node.depth * DEPTH_INDENT }}>
        {eye}
        <GroupHeader
          node={node}
          color={aggregates(node) && !groupHidden?.(node) ? (groupColors.get(groupLineLabel(node.path)) ?? null) : null}
          collapsed={collapsed.has(node.id)}
          onToggle={() => onToggleGroup(node.id)}
          name={node.by.source === "group" && node.label != null ? groupName(node.label) : null}
        />
      </div>
    );
    return (
      <tr
        key={node.id}
        className={`is-group ${hover?.groupHot(node) ? "is-hot" : ""}`}
        data-group={node.label ?? ""}
        onMouseEnter={hover ? () => hover.onGroup(node) : undefined}
        onMouseLeave={hover ? () => hover.onGroup(null) : undefined}
      >
        {lead.kind === "check" && (
          <td className={`frozen ${GROUP_CELL_CLASS}`} style={leadStyle()}>
            <GroupCheckbox
              state={groupSelection(node.runs, lead.selected)}
              label={node.label ?? "(none)"}
              onChange={() => lead.onToggleGroup(node)}
            />
          </td>
        )}
        <td
          colSpan={frozen.length}
          className={`frozen ${columns ? "frozen-edge" : ""} ${GROUP_CELL_CLASS}`}
          style={{ left: leadW, ...(columns ? { width: frozenTotal - leadW, minWidth: frozenTotal - leadW, maxWidth: frozenTotal - leadW } : {}) }}
        >
          {header}
        </td>
        {scroll.length > 0 && <td colSpan={scroll.length} className="border-t border-border-subtle bg-bg-elevated" />}
        {columns && <td className="border-t border-border-subtle bg-bg-elevated" aria-hidden="true" />}
      </tr>
    );
  };

  return (
    // Name only: fixed layout, so long names truncate instead of widening the table.
    <table className={`${RUNS_TABLE_CLASS} ${columns ? "" : "table-fixed"}`}>
      <thead className={RUNS_THEAD_CLASS}>
        <tr>
          {lead.kind === "check" && (
            <th className={`frozen ${RUNS_TH_CLASS}`} style={leadStyle()}>
              <input
                type="checkbox"
                aria-label="select all visible rows"
                checked={lead.all === "all"}
                ref={(el) => {
                  if (el) el.indeterminate = lead.all === "some";
                }}
                onChange={lead.onToggleAll}
              />
            </th>
          )}
          {columns ? (
            [...frozen, ...scroll].map((col) => {
              const fi = frozen.indexOf(col);
              return columns.header(col, fi >= 0 ? frozenProps(fi) : null, fi >= 0 ? undefined : scrollCellStyle(col));
            })
          ) : (
            <th className={`${frozenProps(0).className} ${RUNS_TH_CLASS}`} style={frozenProps(0).style}>
              {lead.kind === "eye" ? (
                <span className="flex items-center gap-1.5">
                  <EyeButton eye={lead.all} label="every listed run" onClick={lead.onAll} />
                  Name
                  {listed !== undefined && <span className="ml-1 normal-case tracking-normal text-fg-subtle">{listed} listed</span>}
                </span>
              ) : (
                "Name"
              )}
            </th>
          )}
          {/* Filler: takes the table's spare width, so sized columns keep their widths. */}
          {columns && <th aria-hidden="true" />}
        </tr>
      </thead>
      <tbody>{rows.map((row) => (row.kind === "group" ? groupRow(row.node) : runRow(row.run, row.key, row.depth, row.own)))}</tbody>
    </table>
  );
}
