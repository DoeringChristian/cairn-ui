import { useEffect, useState } from "react";

interface Props {
  /** The committed query (an expression over the table's columns; see lib/table/pipeline.ts). */
  value: string;
  onChange: (query: string) => void;
  /** The query's error, from the pipeline. */
  error?: string | null;
  /** Rows shown / rows before the query. */
  shown: number;
  total: number;
  /** Column names, offered as completions. */
  columns?: readonly string[];
  disabled?: boolean;
}

/**
 * The row filter above a table: a boolean expression such as
 * `score > 0.5 and label == 'cat'`. Commits on Enter or blur; Escape
 * reverts the draft.
 */
export default function QueryBar({ value, onChange, error, shown, total, columns = [], disabled }: Props) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft !== value) onChange(draft.trim());
  };
  const dirty = draft.trim() !== value;
  return (
    <div className="mb-2">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <i
            aria-hidden="true"
            className="fa-solid fa-filter pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-fg-subtle"
          />
          <input
            className={`input mono w-full py-1 pl-6 text-xs ${error ? "!border-status-failed" : ""}`}
            type="text"
            spellCheck={false}
            placeholder={columns.length > 0 ? `Query, e.g. ${exampleQuery(columns)}` : "Query rows…"}
            aria-label="Row query"
            aria-invalid={!!error}
            value={draft}
            disabled={disabled}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              else if (e.key === "Escape" && dirty) {
                e.stopPropagation();
                setDraft(value);
              }
            }}
          />
        </div>
        {value && (
          <button
            type="button"
            className="shrink-0 text-xs text-fg-muted hover:text-fg"
            aria-label="Clear query"
            title="Clear query"
            onClick={() => onChange("")}
          >
            <i className="fa-solid fa-xmark" aria-hidden="true" />
          </button>
        )}
        <span className="mono shrink-0 text-xs text-fg-subtle">
          {shown}
          {shown !== total ? `/${total}` : ""} rows
        </span>
      </div>
      {error && <div className="mono mt-1 truncate text-[11px] text-status-failed" title={error}>{error}</div>}
    </div>
  );
}

/** A placeholder query using a real column name. */
function exampleQuery(columns: readonly string[]): string {
  const c = columns[0]!;
  const name = /^[A-Za-z_][A-Za-z0-9_.]*$/.test(c) ? c : `\`${c}\``;
  return `${name} != null`;
}
