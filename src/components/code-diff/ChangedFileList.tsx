import { useState } from "react";
import type { FileStatus, MergedFile } from "../../lib/source-diff";

const STATUS: Record<FileStatus, { letter: string; cls: string; title: string }> = {
  modified: { letter: "M", cls: "text-yellow-400", title: "Modified" },
  added: { letter: "A", cls: "text-green-400", title: "Added" },
  removed: { letter: "D", cls: "text-red-400", title: "Deleted" },
  unchanged: { letter: " ", cls: "text-fg-subtle", title: "Unchanged" },
};

export function StatusIcon({ status }: { status: FileStatus }) {
  const { letter, cls, title } = STATUS[status];
  return (
    <span className={`inline-block w-3 shrink-0 text-center text-[10px] font-bold ${cls}`} title={title}>
      {letter}
    </span>
  );
}

interface Props {
  files: MergedFile[];
  /** How many files the two trees have in all (for the header). */
  total: number;
  selected: string | null;
  onSelect: (path: string) => void;
  /** Shown when `files` is empty. */
  empty?: string;
  /** Adds a search box that finds any of these files (e.g. unchanged ones `files` leaves out). */
  searchFiles?: MergedFile[];
}

/** The files to pick from, each with its M/A/D status. */
export default function ChangedFileList({ files, total, selected, onSelect, empty = "Sources are identical.", searchFiles }: Props) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const changed = (searchFiles ?? files).filter((f) => f.status !== "unchanged").length;
  const shown = searchFiles && q ? searchFiles.filter((f) => f.path.toLowerCase().includes(q)) : files;
  return (
    <div className="flex min-h-0 flex-col">
      <div className="mb-2 text-xs uppercase tracking-wide text-fg-muted">
        {changed} changed file{changed === 1 ? "" : "s"} / {total} total
      </div>
      {searchFiles && (
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find a file…"
          aria-label="Find a file"
          className="input mono mb-2 py-0.5 text-xs"
        />
      )}
      {shown.length === 0 ? (
        <p className="text-xs text-fg-subtle">{q ? "No matching files." : empty}</p>
      ) : (
        <ul className="min-h-0 space-y-0.5 overflow-auto text-sm">
          {shown.map((f) => (
            <li key={f.path}>
              <button
                type="button"
                onClick={() => onSelect(f.path)}
                className={`mono flex w-full items-center gap-1.5 truncate rounded px-2 py-0.5 text-left hover:bg-bg-hover ${
                  selected === f.path ? "bg-bg-hover text-fg" : "text-fg-muted"
                }`}
                title={f.path}
                aria-current={selected === f.path}
              >
                <StatusIcon status={f.status} />
                <span className="truncate">{f.path}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
