/**
 * The workspace page's runs sidebar: a compact runs table. The runs table's
 * toolbar controls (regex search, Filter, Group), `3 of 4 groups shown`, then
 * the table's rows with only the Name column and an eye column in place of
 * the checkbox: group header rows (`group: exp-44` + count, collapsible) and
 * run rows (colour dot, name, version).
 *
 * The rows come from lib/workspace-runs/list.ts. Grouped by `group`, a
 * group's rows are its picked runs (latest or custom) plus `not run yet`
 * rows; a run's version badge picks another version, and the group header's
 * menu goes back to latest. Other group-by levels nest plain runs; no levels
 * list runs. Every edit is a run-state edit (`onEdit`), saved into the
 * current view; collapsing is page-local.
 */

import { useRef, useState, type ReactNode } from "react";
import { RunFilterControl, RunGroupControl, RunSearchInput } from "../RunFilterBar";
import {
  CHECK_W,
  DEPTH_INDENT,
  GROUP_CELL_CLASS,
  GroupHeader,
  RUN_CELL_CLASS,
  RUN_ROW_CLASS,
  RUNS_TABLE_CLASS,
  RUNS_THEAD_CLASS,
  RUNS_TH_CLASS,
  RunNameCell,
  RunVersion,
} from "../runs-table/RunsTableParts";
import Popover from "../ui/Popover";
import { groupColor } from "../../lib/run-color";
import { compileRunSearch } from "../../lib/runs-table/search";
import { nameLabel } from "../../lib/workspace-runs/graph";
import {
  toggleNodeEye,
  toggleRunEye,
  type Eye,
  type GroupEntry,
  type NodeEntry,
  type RunEntry,
  type SidebarList,
  type UngroupedEntry,
  type VersionOption,
} from "../../lib/workspace-runs/list";
import { pickRun } from "../../lib/workspace-runs/picks";
import {
  pickUngrouped,
  setEye,
  setFilter,
  setGroupBy,
  setGroupLatest,
  setGroupPicks,
  setSearch,
  toggleGroupEye,
  toggleNameEye,
  ungroupedKey,
  type RunState,
} from "../../lib/workspace-runs/state";
import "../../pages/runs-table.css";

export type RunStateEdit = (fn: (s: RunState) => RunState, label: string, mergeKey?: string) => void;

interface Props {
  projectId: string;
  list: SidebarList;
  state: RunState;
  /** Filterable fields and group-by param keys (the runs table's). */
  fields: string[];
  paramKeys: string[];
  /** The colours the cards draw ungrouped runs in. */
  colors: ReadonlyMap<string, string>;
  onEdit: RunStateEdit;
}

const EYE_GLYPH: Record<Eye, string> = { on: "◉", off: "○", mixed: "◐" };

const MENU_ITEM =
  "flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-bg-hover touch:min-h-10";
/** A small dropdown trigger inside a row: `v2 ▾`, `latest ▾`. */
const MENU_BTN =
  "inline-flex shrink-0 items-center gap-0.5 rounded px-0.5 text-xs text-fg-muted hover:bg-bg-hover hover:text-fg";

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

/** A dropdown menu behind a small trigger. */
function Menu({
  trigger,
  title,
  label,
  className = "",
  children,
}: {
  trigger: ReactNode;
  title: string;
  label: string;
  className?: string;
  children: (close: () => void) => ReactNode;
}) {
  const ref = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        ref={ref}
        type="button"
        className={`${MENU_BTN} ${className}`}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
      >
        {trigger}
        <span className="text-[10px]" aria-hidden="true">
          ▾
        </span>
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={ref} title={title} width={220} align="start" role="menu" bodyClassName="p-1">
        {children(() => setOpen(false))}
      </Popover>
    </>
  );
}

/** A name's versions, newest first; ones that do not fit the group's picks muted with why. */
function VersionMenu({
  trigger,
  name,
  versions,
  pick,
  onPick,
}: {
  trigger: ReactNode;
  name: string;
  versions: VersionOption[];
  pick: string | null;
  onPick: (runId: string) => void;
}) {
  return (
    <Menu trigger={trigger} title={`${name} versions`} label={`${name} version`}>
      {(close) =>
        versions.map((v) => (
          <button
            key={v.runId}
            type="button"
            role="menuitemradio"
            aria-checked={v.runId === pick}
            className={`${MENU_ITEM} ${v.fits ? "text-fg" : "text-fg-subtle"} ${v.runId === pick ? "font-semibold" : ""}`}
            onClick={() => {
              close();
              if (v.runId !== pick) onPick(v.runId);
            }}
          >
            <span className="mono num">{v.label}</span>
            {v.note && <span className="min-w-0 truncate">· {v.note}</span>}
          </button>
        ))
      }
    </Menu>
  );
}

export default function RunsSidebar({ projectId, list, state, fields, paramKeys, colors, onEdit }: Props) {
  // Page-local: the first group and the (none) block start open.
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const isOpen = (key: string, def: boolean) => open[key] ?? def;
  const toggle = (key: string, def: boolean) => setOpen((o) => ({ ...o, [key]: !(o[key] ?? def) }));
  const search = compileRunSearch(state.search);
  const runPath = (id: string) => `/p/${projectId}/r/${id}`;

  const rows: ReactNode[] = [];
  if (list.mode === "group") {
    list.groups.forEach((g, i) => {
      const def = i === 0;
      rows.push(
        <GroupRows key={g.key} entry={g} open={isOpen(g.key, def)} onToggle={() => toggle(g.key, def)} runPath={runPath} onEdit={onEdit} />,
      );
    });
    if (list.ungrouped.length > 0) {
      rows.push(
        <UngroupedRows
          key="ungrouped"
          entries={list.ungrouped}
          eye={list.ungroupedEye}
          open={isOpen("ungrouped", true)}
          onToggle={() => toggle("ungrouped", true)}
          colors={colors}
          runPath={runPath}
          onEdit={onEdit}
        />,
      );
    }
  } else if (list.mode === "nested") {
    const walk = (n: NodeEntry, def: boolean) => {
      const o = isOpen(n.id, def);
      rows.push(
        <tr key={n.key} className="is-group" data-group={n.label ?? ""}>
          <td className={`${GROUP_CELL_CLASS} bg-bg-elevated`}>
            <EyeButton eye={n.eye} label={n.label ?? "(none)"} onClick={() => onEdit((s) => toggleNodeEye(s, n), `Toggle ${n.label ?? "(none)"}`)} />
          </td>
          <td className={`${GROUP_CELL_CLASS} bg-bg-elevated`}>
            <div style={{ paddingLeft: n.depth * DEPTH_INDENT }}>
              <GroupHeader by={n.by} label={n.label} count={n.count} collapsed={!o} onToggle={() => toggle(n.id, def)} />
            </div>
          </td>
        </tr>,
      );
      if (!o) return;
      if (n.children) n.children.forEach((c) => walk(c, true));
      for (const e of n.runs) {
        rows.push(
          <RunRow
            key={e.rowKey}
            entry={e}
            depth={n.depth + 1}
            color={e.visible ? (e.top != null ? groupColor(e.top) : colors.get(e.run.id)) : null}
            runPath={runPath}
            onEye={() => onEdit((s) => toggleRunEye(s, e), `Toggle ${e.run.display_name ?? e.run.id}`)}
          />,
        );
      }
    };
    list.nodes.forEach((n, i) => walk(n, i === 0));
  } else {
    for (const e of list.runs) {
      rows.push(
        <RunRow
          key={e.rowKey}
          entry={e}
          depth={0}
          color={e.visible ? colors.get(e.run.id) : null}
          runPath={runPath}
          onEye={() => onEdit((s) => setEye(s, e.key, !e.visible), `Toggle ${e.run.display_name ?? e.run.id}`)}
        />,
      );
    }
  }

  return (
    <div className="flex flex-col" data-testid="runs-sidebar">
      <div className="flex flex-col gap-1.5 px-3 pb-2 pt-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Runs</h2>
        <div className="flex items-center gap-1.5">
          <RunSearchInput
            className="min-w-0 flex-1"
            value={state.search}
            error={search.error}
            onChange={(v) => onEdit((s) => setSearch(s, v), "Search runs", "search")}
          />
          <RunFilterControl compact fields={fields} filter={state.filter} onChange={(f) => onEdit((s) => setFilter(s, f), "Filter runs")} />
          <RunGroupControl
            className="max-w-[9rem] shrink-0"
            paramKeys={paramKeys}
            levels={state.groupBy}
            onChange={(levels) => onEdit((s) => setGroupBy(s, levels), "Group runs")}
          />
        </div>
        <p className="text-xs text-fg-muted" data-testid="runs-showing">
          {list.visible} of {list.listed} {list.unit} shown
        </p>
      </div>
      {list.listed === 0 ? (
        <p className="px-3 pb-3 text-xs text-fg-subtle">No runs match the filters.</p>
      ) : (
        <table className={`runs-table ${RUNS_TABLE_CLASS} table-fixed`}>
          <thead className={RUNS_THEAD_CLASS}>
            <tr>
              <th className={`${RUNS_TH_CLASS} sticky top-0 z-10 border-y border-border bg-bg-elevated`} style={{ width: CHECK_W }}>
                <i className="fa-solid fa-eye text-[10px]" aria-label="Shown" />
              </th>
              <th className={`${RUNS_TH_CLASS} sticky top-0 z-10 border-y border-border bg-bg-elevated`}>Name</th>
            </tr>
          </thead>
          <tbody>{rows}</tbody>
        </table>
      )}
    </div>
  );
}

function GroupRows({
  entry,
  open,
  onToggle,
  runPath,
  onEdit,
}: {
  entry: GroupEntry;
  open: boolean;
  onToggle: () => void;
  runPath: (id: string) => string;
  onEdit: RunStateEdit;
}) {
  const { group, graph } = entry;
  const color = groupColor(group);
  const pick = (key: string, label: string, runId: string) =>
    onEdit((s) => setGroupPicks(s, group, pickRun(graph, entry.picks, key, runId)), `Pick ${label} in ${group}`);
  return (
    <>
      <tr className="is-group" data-group={group}>
        <td className={`${GROUP_CELL_CLASS} bg-bg-elevated`}>
          <EyeButton
            eye={entry.eye}
            label={group}
            onClick={() => onEdit((s) => toggleGroupEye(s, group, entry.eye, entry.names.map((n) => n.key)), `Toggle ${group}`)}
          />
        </td>
        <td className={`${GROUP_CELL_CLASS} bg-bg-elevated`}>
          <div className="flex min-w-0 items-center gap-2">
            <div className="min-w-0 flex-1">
              <GroupHeader by={{ source: "group" }} label={group} count={entry.names.length} collapsed={!open} onToggle={onToggle} />
            </div>
            <Menu trigger={entry.custom ? "custom" : "latest"} title={`${group} runs`} label={`${group} runs`}>
              {(close) => (
                <>
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={!entry.custom}
                    className={`${MENU_ITEM} text-fg ${entry.custom ? "" : "font-semibold"}`}
                    onClick={() => {
                      close();
                      if (entry.custom) onEdit((s) => setGroupLatest(s, group), `Latest runs of ${group}`);
                    }}
                  >
                    latest
                  </button>
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={entry.custom}
                    disabled={!entry.custom}
                    className={`${MENU_ITEM} ${entry.custom ? "font-semibold text-fg" : "text-fg-subtle"}`}
                    onClick={close}
                  >
                    custom
                  </button>
                </>
              )}
            </Menu>
          </div>
        </td>
      </tr>
      {open &&
        entry.names.map((row) => {
          const versions = (
            <VersionMenu
              trigger={row.run ? <span className="mono num">{row.run.version != null ? `v${row.run.version}` : row.run.id.slice(0, 6)}</span> : "not run yet"}
              name={row.label}
              versions={row.versions}
              pick={row.pick}
              onPick={(id) => pick(row.key, row.label, id)}
            />
          );
          if (!row.run) {
            return (
              <tr key={row.key} className={RUN_ROW_CLASS}>
                <td className={RUN_CELL_CLASS} />
                <td className={RUN_CELL_CLASS}>
                  <RunNameCell name={row.label} to={null} color={null} depth={1} muted version={versions} />
                </td>
              </tr>
            );
          }
          const shown = entry.visible && row.eye;
          return (
            <tr key={row.key} className={`${RUN_ROW_CLASS} ${shown ? "" : "is-hidden-run"}`}>
              <td className={RUN_CELL_CLASS}>
                <EyeButton
                  eye={shown ? "on" : "off"}
                  label={row.label}
                  onClick={() => onEdit((s) => toggleNameEye(s, group, row.key, entry.visible), `Toggle ${row.label} in ${group}`)}
                />
              </td>
              <td className={RUN_CELL_CLASS}>
                <RunNameCell
                  name={row.run.display_name ?? nameLabel(row.run)}
                  to={runPath(row.run.id)}
                  color={shown ? color : null}
                  depth={1}
                  version={versions}
                >
                  {row.used.length > 0 && (
                    <span className="min-w-0 truncate text-xs text-fg-subtle" title={`used ${row.used.join(", ")}`}>
                      {"←"} {row.used.join(", ")}
                    </span>
                  )}
                </RunNameCell>
              </td>
            </tr>
          );
        })}
    </>
  );
}

function UngroupedRows({
  entries,
  eye,
  open,
  onToggle,
  colors,
  runPath,
  onEdit,
}: {
  entries: UngroupedEntry[];
  eye: Eye;
  open: boolean;
  onToggle: () => void;
  colors: ReadonlyMap<string, string>;
  runPath: (id: string) => string;
  onEdit: RunStateEdit;
}) {
  return (
    <>
      <tr className="is-group" data-group="">
        <td className={`${GROUP_CELL_CLASS} bg-bg-elevated`}>
          <EyeButton
            eye={eye}
            label="ungrouped runs"
            onClick={() => onEdit((s) => entries.reduce((acc, e) => setEye(acc, e.key, eye !== "on"), s), "Toggle ungrouped runs")}
          />
        </td>
        <td className={`${GROUP_CELL_CLASS} bg-bg-elevated`}>
          <GroupHeader by={{ source: "group" }} label={null} count={entries.length} collapsed={!open} onToggle={onToggle} />
        </td>
      </tr>
      {open &&
        entries.map((e) => (
          <tr key={e.key} className={`${RUN_ROW_CLASS} ${e.visible ? "" : "is-hidden-run"}`}>
            <td className={RUN_CELL_CLASS}>
              <EyeButton
                eye={e.visible ? "on" : "off"}
                label={e.label}
                onClick={() => onEdit((s) => setEye(s, ungroupedKey(e.name), !e.visible), `Toggle ${e.label}`)}
              />
            </td>
            <td className={RUN_CELL_CLASS}>
              <RunNameCell
                name={e.run.display_name ?? e.label}
                to={runPath(e.run.id)}
                color={e.visible ? colors.get(e.run.id) : null}
                depth={1}
                version={
                  <VersionMenu
                    trigger={<span className="mono num">{e.run.version != null ? `v${e.run.version}` : e.run.id.slice(0, 6)}</span>}
                    name={e.label}
                    versions={e.versions}
                    pick={e.pick}
                    onPick={(id) => onEdit((s) => pickUngrouped(s, e.name, id), `Pick ${e.label}`)}
                  />
                }
              />
            </td>
          </tr>
        ))}
    </>
  );
}

function RunRow({
  entry,
  depth,
  color,
  runPath,
  onEye,
}: {
  entry: RunEntry;
  depth: number;
  color: string | null | undefined;
  runPath: (id: string) => string;
  onEye: () => void;
}) {
  const r = entry.run;
  const name = r.display_name ?? r.id;
  return (
    <tr className={`${RUN_ROW_CLASS} ${entry.visible ? "" : "is-hidden-run"}`}>
      <td className={RUN_CELL_CLASS}>
        <EyeButton eye={entry.visible ? "on" : "off"} label={name} onClick={onEye} />
      </td>
      <td className={RUN_CELL_CLASS}>
        <RunNameCell
          name={name}
          to={runPath(r.id)}
          color={color}
          depth={depth}
          version={r.version != null ? <RunVersion version={r.version} /> : null}
        />
      </td>
    </tr>
  );
}
