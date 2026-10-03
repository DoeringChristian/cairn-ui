import { useState } from "react";
import { errorText } from "../../api/client";

/**
 * A row of chips (aliases or tags) with remove buttons and an inline "+ add"
 * field. `validate` runs before submitting (the server checks again: its
 * error is shown verbatim). Read-only when `editable` is false.
 */
export default function ChipEditor({
  label,
  values,
  editable,
  onAdd,
  onRemove,
  isRemovable = () => true,
  validate,
  pending = false,
  error,
  chipClass = "border-border bg-bg text-fg-muted",
  testId,
  placeholder,
}: {
  label: string;
  values: readonly string[];
  editable: boolean;
  onAdd: (v: string) => void;
  onRemove: (v: string) => void;
  isRemovable?: (v: string) => boolean;
  validate?: (v: string) => string | null;
  pending?: boolean;
  error?: unknown;
  chipClass?: string;
  testId?: string;
  placeholder?: string;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const submit = () => {
    const v = draft.trim();
    if (!v) {
      setAdding(false);
      return;
    }
    const err = validate?.(v) ?? null;
    if (err) {
      setLocalError(err);
      return;
    }
    setLocalError(null);
    onAdd(v);
    setDraft("");
    setAdding(false);
  };
  const shown = localError ?? (error ? errorText(error) : null);
  return (
    <div className="flex flex-col gap-1" data-testid={testId}>
      <div className="flex flex-wrap items-center gap-1">
        {values.length === 0 && !adding && <span className="text-xs text-fg-subtle">none</span>}
        {values.map((v) => (
          <span
            key={v}
            className={`mono inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] ${chipClass}`}
          >
            {v}
            {editable && isRemovable(v) && (
              <button
                type="button"
                className="leading-none text-fg-subtle hover:text-status-failed"
                aria-label={`remove ${label} ${v}`}
                disabled={pending}
                onClick={() => onRemove(v)}
              >
                {"×"}
              </button>
            )}
          </span>
        ))}
        {editable &&
          (adding ? (
            <form
              className="inline-flex items-center gap-1"
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
            >
              <input
                autoFocus
                className="input w-32 px-1.5 py-0.5 text-xs md:text-xs"
                value={draft}
                placeholder={placeholder ?? label}
                aria-label={`new ${label}`}
                onChange={(e) => {
                  setDraft(e.target.value);
                  setLocalError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setAdding(false);
                    setDraft("");
                    setLocalError(null);
                  }
                }}
              />
              <button type="submit" className="btn px-2 py-0.5 text-xs" disabled={pending}>
                Add
              </button>
            </form>
          ) : (
            <button
              type="button"
              className="rounded border border-dashed border-border px-1.5 py-0.5 text-[11px] text-fg-muted hover:border-accent hover:text-fg"
              onClick={() => setAdding(true)}
              aria-label={`add ${label}`}
            >
              + {label}
            </button>
          ))}
      </div>
      {shown && <span className="text-xs text-status-failed" role="alert">{shown}</span>}
    </div>
  );
}
