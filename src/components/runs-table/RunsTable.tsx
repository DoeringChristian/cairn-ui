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
import type { RunGroupNode, TableRow } from "../../lib/runs-table/group";
import { runRowName } from "../../lib/runs-table/model";
import {
  CHECK_W,
  GROUP_CELL_CLASS,
  GroupHeader,
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
    }
  | {
      kind: "eye";
      runEye: (run: Run) => boolean;
      groupEye: (node: RunGroupNode) => Eye;
      onRun: (run: Run) => void;
      onGroup: (node: RunGroupNode) => void;
    };

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
  /** After the Name cell's version. */
  nameExtras: (run: Run) => ReactNode;
}

interface Props {
  projectId: string;
  rows: TableRow[];
  collapsed: ReadonlySet<string>;
  onToggleGroup: (id: string) => void;
  /** Grouped: a run's name is not prefixed with its group (`runRowName`). */
  grouped: boolean;
  /** The newest run of a name with several runs: highlighted. */
  latestByName: ReadonlySet<string>;
  /** A run's dot; null: hollow. */
  colorOf: (run: Run) => string | null | undefined;
  /** Dimmed. */
  hidden: (run: Run) => boolean;
  lead: RunsTableLead;
  /** Omitted: the Name column only. */
  columns?: RunsTableColumns;
}

const EYE_GLYPH: Record<Eye, string> = { on: "◉", off: "○", mixed: "◐" };

function EyeButton({ eye, label, onClick }: { eye: Eye; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className={`run-controls inline-flex h-5 w-5 items-center justify-center rounded text-sm leading-none hover:bg-bg-hover touch:h-9 touch:w-9 ${
        eye === "off" ? "text-fg-subtle" : "text-fg"
      }`}
      onClick={onClick}
      aria-pressed={eye !== "off"}
      aria-label={`${eye === "off" ? "Show" : "Hide"} ${label}`}
      title={eye === "off" ? "Show" : "Hide"}
    >
      {EYE_GLYPH[eye]}
    </button>
  );
}

const leadStyle = (extra?: CSSProperties): CSSProperties => ({ left: 0, width: CHECK_W, minWidth: CHECK_W, maxWidth: CHECK_W, ...extra });

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
}: Props) {
  const frozen = columns?.frozen ?? ["name"];
  const scroll = columns?.scroll ?? [];
  const widthOf = (col: string) => columns?.widthOf(col);
  const frozenLeft = (i: number) => {
    let left = CHECK_W;
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

  const nameCell = (r: Run, depth: number) => (
    <RunNameCell
      name={runRowName(r, grouped)}
      to={`/p/${projectId}/r/${r.id}`}
      color={colorOf(r)}
      depth={depth}
      version={r.version != null ? <RunVersion version={r.version} /> : null}
    >
      {columns?.nameExtras(r)}
    </RunNameCell>
  );

  const runLabel = (r: Run) => r.display_name ?? r.id;

  const leadCell = (r: Run) => {
    const highlight = latestByName.has(r.id) ? { boxShadow: "inset 2px 0 0 rgb(var(--color-accent-rgb))" } : undefined;
    return (
      <td className={`frozen ${RUN_CELL_CLASS}`} style={leadStyle(highlight)}>
        {lead.kind === "check" ? (
          <input
            type="checkbox"
            aria-label={`select run ${runLabel(r)}`}
            checked={lead.selected.has(r.id)}
            onChange={(e) => lead.onToggle(r.id, (e.nativeEvent as MouseEvent).shiftKey ?? false)}
          />
        ) : (
          <EyeButton eye={lead.runEye(r) ? "on" : "off"} label={runLabel(r)} onClick={() => lead.onRun(r)} />
        )}
      </td>
    );
  };

  const runRow = (r: Run, key: string, depth: number) => {
    const isSelected = lead.kind === "check" && lead.selected.has(r.id);
    const rowClass = [RUN_ROW_CLASS, isSelected ? "is-selected bg-accent/5" : "", hidden(r) ? "is-hidden-run" : ""].join(" ");
    return (
      <tr key={key} className={rowClass}>
        {leadCell(r)}
        {frozen.map((col, i) => (
          <td key={col} {...frozenProps(i, `px-3 py-2 ${isNumericColumn(col) ? "mono num" : ""}`)}>
            {col === "name" ? nameCell(r, depth) : <div className="truncate">{columns!.cell(r, col)}</div>}
          </td>
        ))}
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
    const header = (
      <div style={{ paddingLeft: node.depth * 12 }}>
        <GroupHeader
          by={node.by}
          label={node.label}
          count={node.runs.length}
          collapsed={collapsed.has(node.id)}
          onToggle={() => onToggleGroup(node.id)}
        />
      </div>
    );
    return (
      <tr key={node.id} className="is-group" data-group={node.label ?? ""}>
        {lead.kind === "check" ? (
          <td
            colSpan={1 + frozen.length}
            className={`frozen ${columns ? "frozen-edge" : ""} ${GROUP_CELL_CLASS}`}
            style={{ left: 0, ...(columns ? { width: frozenTotal, minWidth: frozenTotal, maxWidth: frozenTotal } : {}) }}
          >
            {header}
          </td>
        ) : (
          <>
            <td className={`frozen ${GROUP_CELL_CLASS}`} style={leadStyle()}>
              <EyeButton eye={lead.groupEye(node)} label={node.label ?? "(none)"} onClick={() => lead.onGroup(node)} />
            </td>
            <td colSpan={frozen.length} className={`frozen ${columns ? "frozen-edge" : ""} ${GROUP_CELL_CLASS}`} style={{ left: CHECK_W }}>
              {header}
            </td>
          </>
        )}
        {scroll.length > 0 && <td colSpan={scroll.length} className="border-t border-border-subtle bg-bg-elevated" />}
        {columns && <td className="border-t border-border-subtle bg-bg-elevated" aria-hidden="true" />}
      </tr>
    );
  };

  return (
    <table className={RUNS_TABLE_CLASS}>
      <thead className={RUNS_THEAD_CLASS}>
        <tr>
          <th className={`frozen ${RUNS_TH_CLASS}`} style={leadStyle()}>
            {lead.kind === "check" ? (
              <input
                type="checkbox"
                aria-label="select all visible rows"
                checked={lead.all === "all"}
                ref={(el) => {
                  if (el) el.indeterminate = lead.all === "some";
                }}
                onChange={lead.onToggleAll}
              />
            ) : (
              <i className="fa-solid fa-eye text-[10px]" aria-label="Shown" />
            )}
          </th>
          {columns ? (
            [...frozen, ...scroll].map((col) => {
              const fi = frozen.indexOf(col);
              return columns.header(col, fi >= 0 ? frozenProps(fi) : null, fi >= 0 ? undefined : scrollCellStyle(col));
            })
          ) : (
            <th className={`${frozenProps(0).className} ${RUNS_TH_CLASS}`} style={frozenProps(0).style}>
              Name
            </th>
          )}
          {/* Filler: takes the table's spare width, so sized columns keep their widths. */}
          {columns && <th aria-hidden="true" />}
        </tr>
      </thead>
      <tbody>{rows.map((row) => (row.kind === "group" ? groupRow(row.node) : runRow(row.run, row.key, row.depth)))}</tbody>
    </table>
  );
}
