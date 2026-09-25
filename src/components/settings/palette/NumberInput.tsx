import { useId } from "react";
import SettingRow, { INVALID } from "./SettingRow";
import type { ControlProps } from "./types";
import { useNumberDraft } from "./use-number-draft";

type Props = ControlProps<number | null> & {
  min?: number;
  max?: number;
  step?: number;
  integer?: boolean;
  /** Empty box → `null`. Off: a number is required. */
  nullable?: boolean;
  /** Shown while empty: the automatic value, e.g. "auto" or "0.6". */
  placeholder?: string;
  /** Unit after the box, e.g. "px". */
  suffix?: string;
};

/** A number typed exactly; empty means "auto" (`null`). Commits on Enter / blur. */
export default function NumberInput({
  value,
  onChange,
  overridden,
  onReset,
  disabled,
  min,
  max,
  step,
  integer,
  nullable = true,
  placeholder = "auto",
  suffix,
  layout = "inline",
  ...row
}: Props) {
  const id = useId();
  const draft = useNumberDraft(value, onChange, { min, max, step, integer, nullable });
  const error = draft.error ?? row.error;
  return (
    <SettingRow
      {...row}
      error={error}
      layout={layout}
      controlId={id}
      overridden={overridden}
      onReset={onReset}
      disabled={disabled}
    >
      <span className={`flex items-center gap-1.5 ${layout === "inline" ? "w-28" : "w-full"}`}>
        <input
          id={id}
          {...draft.inputProps}
          placeholder={placeholder}
          disabled={disabled}
          aria-invalid={!!error}
          className={`input num py-1 disabled:cursor-not-allowed touch:min-h-10 ${error ? INVALID : ""}`}
        />
        {suffix && <span className="shrink-0 text-xs text-fg-muted">{suffix}</span>}
      </span>
    </SettingRow>
  );
}
