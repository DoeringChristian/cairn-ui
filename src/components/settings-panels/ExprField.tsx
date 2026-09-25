import { useId, useRef, useState } from "react";
import Popover from "../ui/Popover";
import { SettingRow, type ControlProps, type FieldOption } from "../settings/palette";
import { INVALID } from "../settings/palette/SettingRow";
import FieldList from "../settings/palette/FieldList";
import { validateScalarExpr } from "../../lib/scalar-exprs";

type Props = ControlProps<string | null> & {
  /** One-click picks: params, metrics reduced by their rule, summary keys. */
  options: readonly FieldOption[];
  placeholder?: string;
  /** Offer ×, which sets `null`. */
  clearable?: boolean;
  /** "Add" mode: each valid commit is handed to `onChange` and the box empties. */
  adder?: boolean;
  /** Why a typed expression is refused, or null (default: a scalar expression). */
  validate?: (src: string) => string | null;
};

/**
 * A scalar expression: pick a param or metric from the list (one click), or
 * type any expression (`max(val.acc) - min(val.acc)`). Typed text commits on
 * Enter or blur once it parses and is a scalar; until then the error shows
 * and the setting keeps its value. Escape reverts.
 */
export default function ExprField({
  value,
  onChange,
  overridden,
  onReset,
  disabled,
  options,
  placeholder = "Pick a field or type an expression",
  clearable = false,
  adder = false,
  validate = validateScalarExpr,
  layout = "stacked",
  ...row
}: Props) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const shown = draft ?? (adder ? "" : (value ?? ""));
  const error = draft != null && draft.trim() !== "" ? validate(draft.trim()) : null;

  const commit = () => {
    if (draft == null) return;
    const src = draft.trim();
    if (src === "") {
      setDraft(null);
      if (!adder && clearable && value != null) onChange(null);
      return;
    }
    if (validate(src)) return;
    setDraft(null);
    if (adder || src !== value) onChange(src);
  };

  return (
    <SettingRow
      {...row}
      error={error ?? row.error}
      layout={layout}
      controlId={id}
      overridden={overridden}
      onReset={onReset}
      disabled={disabled}
    >
      <div
        ref={anchorRef}
        className={`flex items-center gap-1 ${layout === "inline" ? "w-56" : "w-full"}`}
      >
        <input
          id={id}
          type="text"
          value={shown}
          disabled={disabled}
          placeholder={placeholder}
          spellCheck={false}
          autoComplete="off"
          aria-invalid={!!error}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape" && draft != null) {
              e.preventDefault();
              e.stopPropagation();
              setDraft(null);
            }
          }}
          className={`input mono min-w-0 flex-1 py-1 text-xs disabled:cursor-not-allowed touch:min-h-10 ${error ? INVALID : ""}`}
        />
        <button
          type="button"
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          title="Pick a param or metric"
          aria-label="Pick a param or metric"
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded border border-border bg-bg-elevated text-xs text-fg-muted hover:text-fg disabled:cursor-not-allowed touch:h-10 touch:w-10"
        >
          <i aria-hidden="true" className="fa-solid fa-list" />
        </button>
        {clearable && !adder && value != null && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              setDraft(null);
              onChange(null);
            }}
            title="Clear"
            aria-label="Clear"
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-xs text-fg-subtle hover:bg-bg-hover hover:text-fg disabled:hidden touch:h-10 touch:w-10"
          >
            <i aria-hidden="true" className="fa-solid fa-xmark" />
          </button>
        )}
      </div>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={anchorRef}
        title={typeof row.label === "string" ? row.label : "Choose a field"}
        width={288}
        align="start"
      >
        <FieldList
          options={options}
          selected={adder ? null : value}
          onPick={(o) => {
            setDraft(null);
            setOpen(false);
            onChange(o.key);
          }}
        />
      </Popover>
    </SettingRow>
  );
}
