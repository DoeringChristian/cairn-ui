/**
 * The workspace page's runs sidebar: search, Group by, `showing N of M`,
 * and the listed entries (lib/workspace-runs/list.ts) — groups with their
 * name rows and version pickers, the ungrouped block, or (Group by none) a
 * flat list of runs. Every edit is a run-state edit (`onEdit`), saved into
 * the current view; collapsing is page-local.
 */

import { useState } from "react";
import { groupColor } from "../../lib/run-color";
import type { Eye, GroupEntry, NameRow, RunEntry, SidebarList, UngroupedEntry, VersionOption } from "../../lib/workspace-runs/list";
import { pickRun } from "../../lib/workspace-runs/picks";
import {
  pickUngrouped,
  setEye,
  setGroupBy,
  setGroupLatest,
  setGroupPicks,
  setSearch,
  toggleGroupEye,
  toggleNameEye,
  ungroupedKey,
  type GroupBy,
  type RunState,
} from "../../lib/workspace-runs/state";

export type RunStateEdit = (fn: (s: RunState) => RunState, label: string, mergeKey?: string) => void;

interface Props {
  list: SidebarList;
  search: string;
  groupBy: GroupBy;
  onEdit: RunStateEdit;
}

const ROW = "flex min-h-7 items-center gap-1.5 rounded px-1 text-sm hover:bg-bg-hover touch:min-h-10";
const ICON_BTN =
  "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-fg-muted hover:text-fg touch:h-10 touch:w-10";
const PICKER = "input !w-auto max-w-[9rem] shrink-0 px-1 py-0 text-xs md:text-xs";

const EYE_GLYPH: Record<Eye, string> = { on: "◉", off: "○", mixed: "◐" };

function EyeButton({ eye, label, onClick }: { eye: Eye; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className={`${ICON_BTN} ${eye === "off" ? "text-fg-subtle" : "text-fg"}`}
      onClick={onClick}
      aria-pressed={eye !== "off"}
      aria-label={`${eye === "off" ? "Show" : "Hide"} ${label}`}
      title={eye === "off" ? "Show" : "Hide"}
    >
      {EYE_GLYPH[eye]}
    </button>
  );
}

function Caret({ open, onClick, label }: { open: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      className={ICON_BTN}
      onClick={onClick}
      aria-expanded={open}
      aria-label={`${open ? "Collapse" : "Expand"} ${label}`}
    >
      {open ? "▾" : "▸"}
    </button>
  );
}

function VersionPicker({
  versions,
  pick,
  label,
  onPick,
}: {
  versions: VersionOption[];
  pick: string | null;
  label: string;
  onPick: (runId: string) => void;
}) {
  return (
    <select
      className={`${PICKER} ${pick == null ? "text-fg-subtle" : ""}`}
      value={pick ?? ""}
      onChange={(e) => e.target.value && onPick(e.target.value)}
      aria-label={`${label} version`}
    >
      {pick == null && (
        <option value="" disabled>
          not run yet
        </option>
      )}
      {versions.map((v) => (
        <option key={v.runId} value={v.runId} className={v.fits ? "" : "text-fg-subtle"}>
          {v.label}
          {v.note ? ` · ${v.note}` : ""}
        </option>
      ))}
    </select>
  );
}

export default function RunsSidebar({ list, search, groupBy, onEdit }: Props) {
  // Page-local: the newest group and the ungrouped block start open.
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const isOpen = (key: string, def: boolean) => open[key] ?? def;
  const toggle = (key: string, def: boolean) => setOpen((o) => ({ ...o, [key]: !(o[key] ?? def) }));

  return (
    <div className="flex flex-col gap-2" data-testid="runs-sidebar">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Runs</h2>
      <input
        type="search"
        className="input w-full py-1 text-xs"
        placeholder="search runs…"
        value={search}
        onChange={(e) => {
          const v = e.target.value;
          onEdit((s) => setSearch(s, v), "Search runs", "search");
        }}
        aria-label="Search runs"
      />
      <div className="flex items-center gap-2 text-xs text-fg-muted">
        <label className="inline-flex items-center gap-1 whitespace-nowrap">
          Group by:
          <select
            className="input !w-auto px-1 py-0 text-xs md:text-xs"
            value={groupBy}
            onChange={(e) => {
              const v = e.target.value as GroupBy;
              onEdit((s) => setGroupBy(s, v), `Group by ${v}`);
            }}
          >
            <option value="group">group</option>
            <option value="none">none</option>
          </select>
        </label>
        <span className="ml-auto" data-testid="runs-showing">
          showing {list.visible} of {list.listed}
        </span>
      </div>
      <div className="border-t border-border" />
      {list.listed === 0 && <p className="text-xs text-fg-subtle">No runs.</p>}
      <ul className="flex flex-col">
        {list.groupBy === "none"
          ? list.runs.map((e) => <FlatRow key={e.key} entry={e} onEdit={onEdit} />)
          : list.groups.map((g, i) => (
              <GroupBlock
                key={g.key}
                entry={g}
                open={isOpen(g.key, i === 0)}
                onToggleOpen={() => toggle(g.key, i === 0)}
                onEdit={onEdit}
              />
            ))}
        {list.groupBy === "group" && list.ungrouped.length > 0 && (
          <UngroupedBlock
            entries={list.ungrouped}
            open={isOpen("ungrouped", true)}
            onToggleOpen={() => toggle("ungrouped", true)}
            onEdit={onEdit}
          />
        )}
      </ul>
    </div>
  );
}

function GroupBlock({
  entry,
  open,
  onToggleOpen,
  onEdit,
}: {
  entry: GroupEntry;
  open: boolean;
  onToggleOpen: () => void;
  onEdit: RunStateEdit;
}) {
  const { group } = entry;
  const graph = entry.graph;
  const pick = (row: NameRow, runId: string) =>
    onEdit((s) => setGroupPicks(s, group, pickRun(graph, entry.picks, row.key, runId)), `Pick ${row.label} in ${group}`);
  return (
    <li data-group={group}>
      <div className={ROW}>
        <EyeButton
          eye={entry.eye}
          label={group}
          onClick={() =>
            onEdit((s) => toggleGroupEye(s, group, entry.eye, entry.names.map((n) => n.key)), `Toggle ${group}`)
          }
        />
        <Caret open={open} onClick={onToggleOpen} label={group} />
        <span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: groupColor(group) }} aria-hidden="true" />
        <span className={`mono min-w-0 flex-1 truncate ${entry.visible ? "text-fg" : "text-fg-muted"}`} title={group}>
          {group}
        </span>
        <select
          className={PICKER}
          value={entry.custom ? "custom" : "latest"}
          onChange={(e) => e.target.value === "latest" && onEdit((s) => setGroupLatest(s, group), `Latest runs of ${group}`)}
          aria-label={`${group} runs`}
        >
          <option value="latest">latest</option>
          {entry.custom && <option value="custom">custom</option>}
        </select>
      </div>
      {open && (
        <ul className="flex flex-col">
          {entry.names.map((row) => (
            <li key={row.key} className={`${ROW} pl-7`}>
              <EyeButton
                eye={entry.visible && row.eye ? "on" : "off"}
                label={row.label}
                onClick={() => onEdit((s) => toggleNameEye(s, group, row.key, entry.visible), `Toggle ${row.label} in ${group}`)}
              />
              <span className="mono min-w-[2rem] max-w-[8rem] truncate" title={row.label}>
                {row.label}
              </span>
              <VersionPicker versions={row.versions} pick={row.pick} label={row.label} onPick={(id) => pick(row, id)} />
              {row.used.length > 0 && (
                <span className="min-w-0 truncate text-xs text-fg-subtle" title={`used ${row.used.join(", ")}`}>
                  {"←"} {row.used.join(", ")}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function UngroupedBlock({
  entries,
  open,
  onToggleOpen,
  onEdit,
}: {
  entries: UngroupedEntry[];
  open: boolean;
  onToggleOpen: () => void;
  onEdit: RunStateEdit;
}) {
  const shown = entries.filter((e) => e.visible).length;
  const eye: Eye = shown === 0 ? "off" : shown === entries.length ? "on" : "mixed";
  return (
    <li data-group="">
      <div className={ROW}>
        <EyeButton
          eye={eye}
          label="ungrouped runs"
          onClick={() =>
            onEdit((s) => entries.reduce((acc, e) => setEye(acc, e.key, eye !== "on"), s), "Toggle ungrouped runs")
          }
        />
        <Caret open={open} onClick={onToggleOpen} label="ungrouped runs" />
        <span className="min-w-0 flex-1 truncate pl-[1.125rem] text-fg-muted">ungrouped</span>
      </div>
      {open && (
        <ul className="flex flex-col">
          {entries.map((e) => (
            <li key={e.key} className={`${ROW} pl-7`}>
              <EyeButton
                eye={e.visible ? "on" : "off"}
                label={e.label}
                onClick={() => onEdit((s) => setEye(s, ungroupedKey(e.name), !e.visible), `Toggle ${e.label}`)}
              />
              <span className="mono min-w-[2rem] max-w-[8rem] truncate" title={e.label}>
                {e.label}
              </span>
              <VersionPicker
                versions={e.versions}
                pick={e.pick}
                label={e.label}
                onPick={(id) => onEdit((s) => pickUngrouped(s, e.name, id), `Pick ${e.label}`)}
              />
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function FlatRow({ entry, onEdit }: { entry: RunEntry; onEdit: RunStateEdit }) {
  const r = entry.run;
  const name = `${r.display_name ?? r.id.slice(0, 6)}${r.version != null ? ` v${r.version}` : ""}`;
  return (
    <li className={ROW}>
      <EyeButton eye={entry.visible ? "on" : "off"} label={name} onClick={() => onEdit((s) => setEye(s, entry.key, !entry.visible), `Toggle ${name}`)} />
      <span className={`mono min-w-0 truncate ${entry.visible ? "text-fg" : "text-fg-muted"}`} title={name}>
        {name}
      </span>
      {r.group != null && <span className="min-w-0 truncate text-xs text-fg-subtle">{r.group}</span>}
    </li>
  );
}
