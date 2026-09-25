import { useEffect, useState } from "react";
import type { DerivedColumn } from "../../lib/table/pipeline";
import { SettingsAction } from "../settings/palette";

interface Props {
  value: DerivedColumn[];
  onChange: (next: DerivedColumn[]) => void;
  /** Per column, the pipeline's error (index-aligned with `value`). */
  errors?: ReadonlyArray<string | null>;
  /** Existing column names, listed as a hint. */
  columns?: readonly string[];
  disabled?: boolean;
}

/** One derived column: name + expression, committed on blur / Enter. */
function Row({
  col,
  error,
  disabled,
  onCommit,
  onRemove,
}: {
  col: DerivedColumn;
  error?: string | null;
  disabled?: boolean;
  onCommit: (c: DerivedColumn) => void;
  onRemove: () => void;
}) {
  const [name, setName] = useState(col.name);
  const [expr, setExpr] = useState(col.expr);
  useEffect(() => setName(col.name), [col.name]);
  useEffect(() => setExpr(col.expr), [col.expr]);
  const commit = () => {
    if (name !== col.name || expr !== col.expr) onCommit({ name: name.trim(), expr });
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") commit();
  };
  return (
    <div className="rounded border border-border-subtle p-1.5">
      <div className="flex items-center gap-1.5">
        <input
          className="input mono w-28 shrink-0 py-1 text-xs"
          type="text"
          aria-label="Column name"
          placeholder="name"
          spellCheck={false}
          value={name}
          disabled={disabled}
          onChange={(e) => setName(e.target.value)}
          onBlur={commit}
          onKeyDown={onKeyDown}
        />
        <span className="text-xs text-fg-subtle">=</span>
        <input
          className={`input mono min-w-0 flex-1 py-1 text-xs ${error ? "!border-status-failed" : ""}`}
          type="text"
          aria-label="Expression"
          aria-invalid={!!error}
          placeholder="score * 100"
          spellCheck={false}
          value={expr}
          disabled={disabled}
          onChange={(e) => setExpr(e.target.value)}
          onBlur={commit}
          onKeyDown={onKeyDown}
        />
        <button
          type="button"
          className="shrink-0 px-1 text-xs text-fg-muted hover:text-status-failed disabled:cursor-not-allowed"
          aria-label="Remove column"
          title="Remove column"
          disabled={disabled}
          onClick={onRemove}
        >
          <i className="fa-solid fa-xmark" aria-hidden="true" />
        </button>
      </div>
      {error && <div className="mono mt-1 text-[11px] text-status-failed">{error}</div>}
    </div>
  );
}

/**
 * Derived table columns: each is `name = expression` over the row's columns
 * (bare names or `config.<col>`; quote others in backticks), evaluated in
 * order so later columns can use earlier ones.
 */
export default function DerivedColumnsEditor({ value, onChange, errors, columns = [], disabled }: Props) {
  const nextName = () => {
    const taken = new Set([...columns, ...value.map((c) => c.name)]);
    let i = value.length + 1;
    while (taken.has(`col${i}`)) i++;
    return `col${i}`;
  };
  return (
    <div className="flex flex-col gap-1.5 py-1">
      {value.map((col, i) => (
        <Row
          key={i}
          col={col}
          error={errors?.[i]}
          disabled={disabled}
          onCommit={(c) => onChange(value.map((x, j) => (j === i ? c : x)))}
          onRemove={() => onChange(value.filter((_, j) => j !== i))}
        />
      ))}
      <SettingsAction
        label="Add column"
        icon="fa-plus"
        disabled={disabled}
        onClick={() => onChange([...value, { name: nextName(), expr: "" }])}
      />
      <p className="text-xs text-fg-muted">
        Columns by name (<code className="mono">score</code>, <code className="mono">config.score</code>, or{" "}
        <code className="mono">`pred/label`</code>); e.g. <code className="mono">label == pred</code>,{" "}
        <code className="mono">clip(score * 100, 0, 100)</code>.
      </p>
      {columns.length > 0 && (
        <p className="mono break-words text-[11px] text-fg-subtle">{columns.join(" · ")}</p>
      )}
    </div>
  );
}
