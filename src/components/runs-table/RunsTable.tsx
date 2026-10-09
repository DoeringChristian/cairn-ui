/**
 * The runs table itself (`<table>`: header, group header rows, run rows),
 * rendered by the Runs page with every column and a leading column of
 * checkboxes and the workspace's eyes, and by the workspace sidebar with
 * the Name column only and eyes. The
 * rows come from `useRunsTable`; the frozen left block (lead column, Name,
 * pinned columns) is sticky (pages/runs-table.css, under a `.runs-table`
 * wrapper).
 *
 * Big tables are windowed (lib/runs-table/window.ts): past `ROW_WINDOW_MIN`
 * rows only those near the viewport are rendered, and past
 * `COL_WINDOW_MIN` scrolling columns (the Runs page) only those near the
 * horizontal viewport, spacers standing in for the rest. A windowed
 * table's scrolling columns keep the widths the whole table would give
 * them: a hidden copy of the table with only each column's longest cells
 * (`ColumnMeasure`) is laid out by the browser and its widths are set on
 * the real one. Smaller tables render exactly as before.
 */

import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { Run } from "../../api/types";
import { isNumericColumn } from "../../lib/runs-table/columns";
import { aggregates, groupLineLabel, type RunGroupNode, type TableRow } from "../../lib/runs-table/group";
import { groupSelection, runRowName } from "../../lib/runs-table/model";
import { COL_OVERSCAN, COL_WINDOW_MIN, longest, ROW_OVERSCAN, ROW_WINDOW_MIN } from "../../lib/runs-table/window";
import { ROW_INDEX_ATTR, useColumnWindow, useRowWindow } from "./use-window";
import Popover from "../ui/Popover";
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

/** The workspace's eyes (what its cards draw): per run, per group row, and every listed run. */
export interface RunsTableEyes {
  runEye: (run: Run) => boolean;
  groupEye: (node: RunGroupNode) => Eye;
  onRun: (run: Run) => void;
  onGroup: (node: RunGroupNode) => void;
  /** The header eye: every listed run. */
  all: Eye;
  onAll: () => void;
  /** The header eye's ▾ menu: "Show all" / "Hide all" (every listed run). */
  onSetAll: (on: boolean) => void;
  /** The header eye's ▾ menu: "Show latest only" (lib/workspace-runs/visibility.ts `showLatestOnly`). */
  onShowLatest: () => void;
}

/**
 * The leading column: checkboxes (bulk selection), with the eyes beside
 * them (the Runs page), or eyes only (the sidebar: in the Name cell,
 * indented with the name).
 */
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
      /** The workspace's eyes, after each checkbox. */
      eyes?: RunsTableEyes;
    }
  | ({ kind: "eye" } & RunsTableEyes);

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
  /**
   * A windowed table's column widths: a cell's text length (its longest
   * cells are measured), over `measureRuns` (the listed runs: unchanged by
   * a sort); `measureKey` changes with anything that widens a header (the
   * sort arrows, labels).
   */
  textLength: (run: Run, col: string) => number;
  measureRuns: readonly Run[];
  measureKey: string;
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
  /** The innermost groups' dots: their chart lines' colours (the page's colours: lib/run-color.ts `assignPageColors`). */
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
/** The eye's share of the leading column (beside the checkbox). */
const EYE_W = 24;
const LEAD_CELL = "flex items-center gap-1.5";

export function EyeButton({ eye, label, onClick }: { eye: Eye; label: string; onClick: () => void }) {
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

const EYE_MENU_ITEM = "min-h-[32px] w-full rounded px-2 text-left text-xs text-fg hover:bg-bg-hover touch:min-h-10";

/**
 * The header eye (every listed run: click toggles them all) with a ▾ beside
 * it opening `Show all` · `Hide all` · `Show latest only`.
 */
export function AllEyesControl({ eyes }: { eyes: RunsTableEyes }) {
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const pick = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };
  return (
    <span className="inline-flex items-center">
      <EyeButton eye={eyes.all} label="every listed run" onClick={eyes.onAll} />
      <button
        ref={btnRef}
        type="button"
        className="run-controls inline-flex h-5 w-3.5 items-center justify-center rounded text-[11px] leading-none text-fg-muted hover:bg-bg-hover hover:text-fg touch:h-9 touch:w-6"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Eye options"
        title="Show or hide runs"
      >
        ▾
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={btnRef} title="Eyes" width={180} align="start" role="menu" bodyClassName="flex flex-col p-1">
        <button type="button" role="menuitem" className={EYE_MENU_ITEM} onClick={pick(() => eyes.onSetAll(true))}>
          Show all
        </button>
        <button type="button" role="menuitem" className={EYE_MENU_ITEM} onClick={pick(() => eyes.onSetAll(false))}>
          Hide all
        </button>
        <button
          type="button"
          role="menuitem"
          className={EYE_MENU_ITEM}
          onClick={pick(eyes.onShowLatest)}
          title="Show the latest version of every run series and hide the older ones"
        >
          Show latest only
        </button>
      </Popover>
    </span>
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
  const leadEyes = lead.kind === "check" ? (lead.eyes ?? null) : null;
  const leadW = leadCol ? CHECK_W + (leadEyes ? EYE_W : 0) : 0;
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

  // Windowing (big tables only).
  const tableRef = useRef<HTMLTableElement>(null);
  const windowRows = rows.length > ROW_WINDOW_MIN;
  const windowCols = !!columns && scroll.length > COL_WINDOW_MIN;
  const measured = !!columns && (windowRows || windowCols);
  const auto = useMeasuredWidths(measured ? columns : undefined, {
    tableRef,
    lead: lead.kind === "check" ? leadW : null,
    frozen,
    frozenProps,
    scroll,
    scrollCellStyle,
  });
  /** A windowed table's scrolling column: its set width, else the measured one. */
  const scrollStyle = (col: string): CSSProperties | undefined => {
    if (!measured || widthOf(col) !== undefined) return scrollCellStyle(col);
    const w = auto.get(col) ?? AUTO_WIDTH_FALLBACK;
    return { width: w, minWidth: w, maxWidth: w };
  };
  const scrollKey = scroll.join("\n");
  const scrollWidths = useMemo(
    () => (measured ? scroll.map((col) => widthOf(col) ?? auto.get(col) ?? AUTO_WIDTH_FALLBACK) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [measured, scrollKey, auto, columns?.widthOf],
  );
  const scroller = useCallback(() => tableRef.current?.parentElement ?? null, []);
  const cols = useColumnWindow({ widths: scrollWidths, scroller, frozen: frozenTotal, enabled: windowCols, overscan: COL_OVERSCAN });
  const shownScroll = windowCols ? scroll.slice(cols.start, cols.end) : scroll;
  const spacerTh = (w: number) => <th aria-hidden="true" style={{ width: w, minWidth: w, maxWidth: w, padding: 0 }} />;
  const spacerTd = (w: number) => <td aria-hidden="true" style={{ width: w, minWidth: w, maxWidth: w, padding: 0 }} />;
  const colsBefore = windowCols && cols.before > 0 ? cols.before : 0;
  const colsAfter = windowCols && cols.after > 0 ? cols.after : 0;
  const scrollSpan = shownScroll.length + (colsBefore ? 1 : 0) + (colsAfter ? 1 : 0);
  const rowKeys = useMemo(() => rows.map((r) => (r.kind === "group" ? `g:${r.node.id}` : `r:${r.key}`)), [rows]);
  const rowWin = useRowWindow({
    keys: rowKeys,
    kindOf: (i) => rows[i]?.kind ?? "run",
    estimate: (kind) => (kind === "group" ? GROUP_ROW_ESTIMATE : RUN_ROW_ESTIMATE),
    enabled: windowRows,
    overscan: ROW_OVERSCAN,
  });
  const allCols = (lead.kind === "check" ? 1 : 0) + frozen.length + scrollSpan + (columns ? 1 : 0);
  const spacerRow = (h: number) => (
    <tr aria-hidden="true">
      <td colSpan={allCols} style={{ height: h, padding: 0 }} />
    </tr>
  );

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
        <span className={LEAD_CELL}>
          <input
            type="checkbox"
            aria-label={`select run ${runLabel(r)}`}
            checked={lead.selected.has(r.id)}
            onChange={(e) => lead.onToggle(r.id, (e.nativeEvent as MouseEvent).shiftKey ?? false)}
          />
          {leadEyes && <EyeButton eye={leadEyes.runEye(r) ? "on" : "off"} label={runLabel(r)} onClick={() => leadEyes.onRun(r)} />}
        </span>
      </td>
    ) : null;

  const runRow = (r: Run, key: string, depth: number, own: boolean, index: number | undefined) => {
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
        {...(index === undefined ? {} : { [ROW_INDEX_ATTR]: index })}
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
        {colsBefore > 0 && spacerTd(colsBefore)}
        {shownScroll.map((col) => (
          <td key={col} className={`px-3 py-2 ${isNumericColumn(col) ? "mono num" : ""}`} style={scrollStyle(col)}>
            {columns!.cell(r, col)}
          </td>
        ))}
        {colsAfter > 0 && spacerTd(colsAfter)}
        {columns && <td aria-hidden="true" />}
      </tr>
    );
  };

  const groupRow = (node: RunGroupNode, index: number | undefined) => {
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
        {...(index === undefined ? {} : { [ROW_INDEX_ATTR]: index })}
        onMouseEnter={hover ? () => hover.onGroup(node) : undefined}
        onMouseLeave={hover ? () => hover.onGroup(null) : undefined}
      >
        {lead.kind === "check" && (
          <td className={`frozen ${GROUP_CELL_CLASS}`} style={leadStyle()}>
            <span className={LEAD_CELL}>
              <GroupCheckbox
                state={groupSelection(node.runs, lead.selected)}
                label={node.label ?? "(none)"}
                onChange={() => lead.onToggleGroup(node)}
              />
              {leadEyes && <EyeButton eye={leadEyes.groupEye(node)} label={node.label ?? "(none)"} onClick={() => leadEyes.onGroup(node)} />}
            </span>
          </td>
        )}
        <td
          colSpan={frozen.length}
          className={`frozen ${columns ? "frozen-edge" : ""} ${GROUP_CELL_CLASS}`}
          style={{ left: leadW, ...(columns ? { width: frozenTotal - leadW, minWidth: frozenTotal - leadW, maxWidth: frozenTotal - leadW } : {}) }}
        >
          {header}
        </td>
        {scroll.length > 0 && <td colSpan={scrollSpan} className="border-t border-border-subtle bg-bg-elevated" />}
        {columns && <td className="border-t border-border-subtle bg-bg-elevated" aria-hidden="true" />}
      </tr>
    );
  };

  const shownRows = windowRows ? rows.slice(rowWin.start, rowWin.end) : rows;
  const table = (
    // Name only: fixed layout, so long names truncate instead of widening the table.
    <table ref={tableRef} className={`${RUNS_TABLE_CLASS} ${columns ? "" : "table-fixed"}`}>
      <thead className={RUNS_THEAD_CLASS}>
        <tr>
          {lead.kind === "check" && (
            <th className={`frozen ${RUNS_TH_CLASS}`} style={leadStyle()}>
              <span className={LEAD_CELL}>
                <input
                  type="checkbox"
                  aria-label="select all visible rows"
                  checked={lead.all === "all"}
                  ref={(el) => {
                    if (el) el.indeterminate = lead.all === "some";
                  }}
                  onChange={lead.onToggleAll}
                />
                {leadEyes && <AllEyesControl eyes={leadEyes} />}
              </span>
            </th>
          )}
          {columns ? (
            <>
              {frozen.map((col, fi) => columns.header(col, frozenProps(fi), undefined))}
              {colsBefore > 0 && spacerTh(colsBefore)}
              {shownScroll.map((col) => columns.header(col, null, scrollStyle(col)))}
              {colsAfter > 0 && spacerTh(colsAfter)}
            </>
          ) : (
            <th className={`${frozenProps(0).className} ${RUNS_TH_CLASS}`} style={frozenProps(0).style}>
              {lead.kind === "eye" ? (
                <span className="flex items-center gap-1.5">
                  <AllEyesControl eyes={lead} />
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
      <tbody ref={rowWin.ref}>
        {windowRows && rowWin.before > 0 && spacerRow(rowWin.before)}
        {shownRows.map((row, i) => {
          const index = windowRows ? rowWin.start + i : undefined;
          return row.kind === "group" ? groupRow(row.node, index) : runRow(row.run, row.key, row.depth, row.own, index);
        })}
        {windowRows && rowWin.after > 0 && spacerRow(rowWin.after)}
      </tbody>
    </table>
  );
  return measured ? (
    <>
      {auto.measure}
      {table}
    </>
  ) : (
    table
  );
}

/** A windowed column's width before it is measured (never painted: measured before paint). */
const AUTO_WIDTH_FALLBACK = 120;
/** Row heights before any is measured (text-sm rows, px). */
const RUN_ROW_ESTIMATE = 37;
const GROUP_ROW_ESTIMATE = 33;

/**
 * The widths the browser gives a windowed table's scrolling columns that
 * have no set width: a hidden copy of the table (same width, same frozen
 * block, every header) with, per column, only its longest cells
 * (`WIDTH_CANDIDATES`) is laid out, and its header cells' widths read.
 * Re-measured when the columns, the runs, a header or the table's width
 * change.
 */
function useMeasuredWidths(
  columns: RunsTableColumns | undefined,
  {
    tableRef,
    lead,
    frozen,
    frozenProps,
    scroll,
    scrollCellStyle,
  }: {
    tableRef: React.RefObject<HTMLTableElement | null>;
    /** The lead column's width (checkboxes); null: none. */
    lead: number | null;
    frozen: string[];
    frozenProps: (i: number) => FrozenProps;
    scroll: string[];
    scrollCellStyle: (col: string) => CSSProperties | undefined;
  },
): { get: (col: string) => number | undefined; measure: ReactNode } {
  const [widths, setWidths] = useState<ReadonlyMap<string, number>>(new Map());
  const scrollKey = scroll.join("\n");
  const candidates = useMemo(() => {
    if (!columns) return null;
    const out = new Map<string, Run[]>();
    for (const col of scroll) out.set(col, longest(columns.measureRuns, (r) => columns.textLength(r, col)));
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columns?.measureRuns, columns?.textLength, scrollKey, !!columns]);
  const sizeKey = columns ? [...frozen, ...scroll].map((c) => columns.widthOf(c) ?? "").join(",") : "";
  const host = useRef<HTMLDivElement>(null);
  const measure = useMemo(
    () =>
      columns && candidates ? (
        <ColumnMeasure
          hostRef={host}
          columns={columns}
          lead={lead}
          frozen={frozen}
          frozenProps={frozenProps}
          scroll={scroll}
          scrollCellStyle={scrollCellStyle}
          candidates={candidates}
        />
      ) : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [candidates, lead, frozen.join("\n"), scrollKey, sizeKey, columns?.measureKey],
  );
  const read = useCallback(() => {
    const row = host.current?.querySelector("thead tr");
    if (!row) return;
    const first = (lead === null ? 0 : 1) + frozen.length;
    const next = new Map<string, number>();
    scroll.forEach((col, j) => {
      const th = row.children[first + j];
      if (th) next.set(col, th.getBoundingClientRect().width);
    });
    setWidths((prev) => (prev.size === next.size && [...next].every(([c, w]) => prev.get(c) === w) ? prev : next));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead, frozen.join("\n"), scrollKey]);
  useLayoutEffect(() => {
    if (measure) read();
  }, [measure, read]);
  // The table's width changes how spare width is shared out; fonts change text widths.
  useLayoutEffect(() => {
    const scroller = tableRef.current?.parentElement;
    if (!measure || !scroller) return;
    let width = scroller.clientWidth;
    const ro = new ResizeObserver(() => {
      if (scroller.clientWidth !== width) {
        width = scroller.clientWidth;
        read();
      }
    });
    ro.observe(scroller);
    let live = true;
    void document.fonts?.ready.then(() => live && read());
    return () => {
      live = false;
      ro.disconnect();
    };
  }, [!!measure, read, tableRef]);
  const get = useCallback((col: string) => widths.get(col), [widths]);
  return { get, measure };
}

/** The hidden copy `useMeasuredWidths` reads (inert, invisible, no height). */
const ColumnMeasure = memo(function ColumnMeasure({
  hostRef,
  columns,
  lead,
  frozen,
  frozenProps,
  scroll,
  scrollCellStyle,
  candidates,
}: {
  hostRef: React.MutableRefObject<HTMLDivElement | null>;
  columns: RunsTableColumns;
  lead: number | null;
  frozen: string[];
  frozenProps: (i: number) => FrozenProps;
  scroll: string[];
  scrollCellStyle: (col: string) => CSSProperties | undefined;
  candidates: ReadonlyMap<string, Run[]>;
}) {
  const depth = Math.max(0, ...[...candidates.values()].map((c) => c.length));
  const leadStyle = lead === null ? undefined : { width: lead, minWidth: lead, maxWidth: lead };
  return (
    <div aria-hidden="true" style={{ position: "relative", height: 0, overflow: "hidden" }}>
      <div
        ref={(el) => {
          hostRef.current = el;
          el?.setAttribute("inert", "");
        }}
        style={{ position: "absolute", top: 0, left: 0, right: 0, visibility: "hidden", pointerEvents: "none" }}
      >
        <table className={RUNS_TABLE_CLASS}>
          <thead className={RUNS_THEAD_CLASS}>
            <tr>
              {leadStyle && <th className={RUNS_TH_CLASS} style={leadStyle} />}
              {frozen.map((col, i) => columns.header(col, frozenProps(i), undefined))}
              {scroll.map((col) => columns.header(col, null, scrollCellStyle(col)))}
              <th />
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: depth }, (_, k) => (
              <tr key={k}>
                {leadStyle && <td style={leadStyle} />}
                {frozen.map((col, i) => (
                  <td key={col} style={frozenProps(i).style} />
                ))}
                {scroll.map((col) => {
                  const run = candidates.get(col)?.[k];
                  return (
                    <td key={col} className={`px-3 py-2 ${isNumericColumn(col) ? "mono num" : ""}`} style={scrollCellStyle(col)}>
                      {run ? columns.cell(run, col) : null}
                    </td>
                  );
                })}
                <td />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
});
