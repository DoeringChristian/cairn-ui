import { useEffect, useRef, useState } from "react";
import type { Comparison } from "../../lib/comparisons";
import { formatRelative } from "../../lib/format";

interface SidebarProps {
  comparisons: Comparison[];
  selectedId: string;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onSmartCreate: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}

export default function Sidebar({
  comparisons,
  selectedId,
  onSelect,
  onCreate,
  onSmartCreate,
  onRename,
  onDelete,
}: SidebarProps) {
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const lastCheckedIdx = useRef<number | null>(null);
  const toggleCheck = (id: string, index: number, shiftKey: boolean) => {
    if (shiftKey && lastCheckedIdx.current !== null) {
      const lo = Math.min(lastCheckedIdx.current, index);
      const hi = Math.max(lastCheckedIdx.current, index);
      setChecked((prev) => {
        const next = new Set(prev);
        for (let i = lo; i <= hi; i++) next.add(comparisons[i]!.id);
        return next;
      });
    } else {
      setChecked((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
      });
    }
    lastCheckedIdx.current = index;
  };
  const bulkDelete = () => {
    if (!confirm(`Delete ${checked.size} comparison(s)?`)) return;
    for (const id of checked) onDelete(id);
    setChecked(new Set());
  };

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
          Comparisons
        </h2>
        <div className="flex items-center gap-1">
          {checked.size > 0 && (
            <button
              type="button"
              onClick={bulkDelete}
              className="inline-flex h-6 items-center justify-center rounded border border-status-failed/40 bg-status-failed/10 px-1.5 text-[10px] text-status-failed hover:bg-status-failed/20"
              title={`Delete ${checked.size} selected`}
            >
              Delete {checked.size}
            </button>
          )}
          <button
            type="button"
            onClick={onSmartCreate}
            className="inline-flex h-6 items-center justify-center rounded border border-border bg-bg px-1.5 text-[10px] text-fg-muted hover:border-accent hover:text-fg"
            aria-label="Smart comparison"
            title="Create from parameters"
          >
            {"\u2728"}
          </button>
          <button
            type="button"
            onClick={onCreate}
            className="inline-flex h-6 w-6 items-center justify-center rounded border border-border bg-bg text-sm text-fg-muted hover:border-accent hover:text-fg"
            aria-label="New comparison"
            title="New empty comparison"
          >
            {"\u002B"}
          </button>
        </div>
      </div>
      {comparisons.length === 0 ? (
        <p className="text-xs text-fg-subtle">
          No comparisons yet. Click + or ✨ to create one.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {comparisons.map((c, idx) => (
            <SidebarRow
              key={c.id}
              comparison={c}
              selected={c.id === selectedId}
              checked={checked.has(c.id)}
              onToggleCheck={(shiftKey: boolean) => toggleCheck(c.id, idx, shiftKey)}
              onSelect={() => onSelect(c.id)}
              onRename={(name) => onRename(c.id, name)}
              onDelete={() => onDelete(c.id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

interface SidebarRowProps {
  comparison: Comparison;
  selected: boolean;
  checked: boolean;
  onToggleCheck: (shiftKey: boolean) => void;
  onSelect: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}

function SidebarRow({
  comparison,
  selected,
  checked,
  onToggleCheck,
  onSelect,
  onRename,
  onDelete,
}: SidebarRowProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comparison.name);

  useEffect(() => {
    if (!editing) setDraft(comparison.name);
  }, [comparison.name, editing]);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== comparison.name) onRename(trimmed);
    setEditing(false);
  };

  return (
    <li
      className={`group flex items-center gap-1 rounded border px-2 py-1.5 text-sm ${
        selected
          ? "border-accent/60 bg-accent/5"
          : "border-border-subtle bg-bg hover:border-border"
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        onClick={(e) => { e.stopPropagation(); onToggleCheck(e.shiftKey); }}
        readOnly
        className="shrink-0"
      />
      {editing ? (
        <input
          autoFocus
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              setEditing(false);
              setDraft(comparison.name);
            }
          }}
          className="input flex-1 text-xs"
        />
      ) : (
        <button
          type="button"
          onClick={onSelect}
          onDoubleClick={() => setEditing(true)}
          className="min-w-0 flex-1 text-left"
          title="Double-click to rename"
        >
          <div
            className={`truncate ${
              selected ? "font-semibold text-fg" : "text-fg-muted"
            }`}
          >
            {comparison.name}
          </div>
          <div className="text-[10px] text-fg-subtle">
            {comparison.cards.length} card
            {comparison.cards.length === 1 ? "" : "s"} ·{" "}
            {formatRelative(comparison.createdAt)}
          </div>
        </button>
      )}
      <button
        type="button"
        aria-label={`Delete "${comparison.name}"`}
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-fg-subtle opacity-0 group-hover:opacity-100 hover:text-status-failed transition-opacity"
        title="Delete"
      >
        {"\u00D7"}
      </button>
    </li>
  );
}

