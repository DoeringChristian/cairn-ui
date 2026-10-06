import { useState, type ReactNode } from "react";
import FoldedText from "../FoldedText";

/**
 * The one collapsible JSON tree: an artifact's metadata, a run's config, a
 * JSON file. Objects and arrays fold (open to `openDepth`); leaves render
 * typed (strings quoted, numbers tabular). `renderKeyActions` adds controls
 * after a top-level key (the Metadata tab's edit button).
 */
export default function JsonTree({
  value,
  openDepth = 2,
  renderKeyActions,
  emptyText = "Empty.",
}: {
  value: unknown;
  openDepth?: number;
  renderKeyActions?: (key: string) => ReactNode;
  /** Shown for an empty object or list. */
  emptyText?: string;
}) {
  if (typeof value !== "object" || value === null) {
    return (
      <div className="mono text-[12.5px] leading-6" data-viewer="json">
        <Leaf value={value} />
      </div>
    );
  }
  const entries = Object.entries(value);
  if (entries.length === 0) return <p className="text-sm text-fg-subtle">{emptyText}</p>;
  return (
    <ul className="mono text-[12.5px] leading-6" role="tree" data-viewer="json">
      {entries.map(([k, v]) => (
        <Node key={k} name={k} value={v} depth={0} openDepth={openDepth} actions={renderKeyActions?.(k)} />
      ))}
    </ul>
  );
}

function Node({
  name,
  value,
  depth,
  openDepth,
  actions,
}: {
  name: string;
  value: unknown;
  depth: number;
  openDepth: number;
  actions?: ReactNode;
}) {
  const [open, setOpen] = useState(depth < openDepth);
  const isObj = typeof value === "object" && value !== null;
  const entries = isObj ? Object.entries(value as Record<string, unknown>) : [];
  const pad = { paddingLeft: `${depth * 16}px` };
  if (!isObj || entries.length === 0) {
    return (
      <li role="treeitem" className="group flex items-baseline gap-2 rounded hover:bg-bg-hover" style={pad}>
        <span className="w-3 shrink-0" />
        <span className="text-fg-muted">{name}:</span>
        <Leaf value={value} />
        {actions}
      </li>
    );
  }
  const summary = Array.isArray(value) ? `[${entries.length}]` : `{${entries.length}}`;
  return (
    <li role="treeitem" aria-expanded={open}>
      <div className="group flex items-baseline gap-2 rounded hover:bg-bg-hover" style={pad}>
        <button
          type="button"
          className="w-3 shrink-0 text-fg-subtle"
          onClick={() => setOpen((o) => !o)}
          aria-label={open ? `collapse ${name}` : `expand ${name}`}
        >
          <i className={`fa-solid ${open ? "fa-caret-down" : "fa-caret-right"}`} aria-hidden="true" />
        </button>
        <button type="button" className="text-fg-muted" onClick={() => setOpen((o) => !o)}>
          {name}:
        </button>
        <span className="text-fg-subtle">{summary}</span>
        {actions}
      </div>
      {open && (
        <ul role="group">
          {entries.map(([k, v]) => (
            <Node key={k} name={k} value={v} depth={depth + 1} openDepth={openDepth} />
          ))}
        </ul>
      )}
    </li>
  );
}

function Leaf({ value }: { value: unknown }) {
  if (typeof value === "string") return <FoldedText className="text-[#0a3069]">"{value}"</FoldedText>;
  if (typeof value === "number") return <span className="num text-[#0550ae]">{String(value)}</span>;
  if (typeof value === "boolean") return <span className="text-[#8250df]">{String(value)}</span>;
  if (value === null) return <span className="text-fg-subtle">null</span>;
  if (Array.isArray(value)) return <span className="text-fg-subtle">[]</span>;
  if (typeof value === "object") return <span className="text-fg-subtle">{"{}"}</span>;
  return <span>{String(value)}</span>;
}
