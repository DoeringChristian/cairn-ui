import { useState, type KeyboardEvent } from "react";
import { parseNumberDraft, stepValue, type NumberBounds } from "./logic";

/**
 * A number box's text while it is being edited. Commits on Enter and blur;
 * text that does not parse keeps the old value and reports `error` until it
 * is fixed or Escape reverts it. ↑/↓ step by `step` (Shift ×10).
 */
export function useNumberDraft(
  value: number | null,
  onCommit: (next: number | null) => void,
  opts: NumberBounds & { nullable?: boolean; step?: number },
) {
  const { nullable = true, step = 1, ...bounds } = opts;
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (value == null ? "" : String(value));
  const parsed = draft == null ? null : parseNumberDraft(draft, bounds, nullable);
  const error = parsed && !parsed.ok ? parsed.error : null;

  const commit = () => {
    if (draft == null) return;
    const p = parseNumberDraft(draft, bounds, nullable);
    if (!p.ok) return;
    setDraft(null);
    if (p.value !== value) onCommit(p.value);
  };

  return {
    error,
    inputProps: {
      type: "text" as const,
      inputMode: "decimal" as const,
      value: shown,
      onChange: (e: { target: { value: string } }) => setDraft(e.target.value),
      onBlur: commit,
      onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter") commit();
        else if (e.key === "Escape" && draft != null) {
          e.stopPropagation();
          setDraft(null);
        } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          e.preventDefault();
          const base = parsed?.ok ? parsed.value : value;
          const next = stepValue(base ?? 0, (e.key === "ArrowUp" ? 1 : -1) * (e.shiftKey ? 10 : 1), step, bounds.min, bounds.max);
          setDraft(null);
          if (next !== value) onCommit(next);
        }
      },
    },
  };
}
