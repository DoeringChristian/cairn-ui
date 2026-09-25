import { useId } from "react";
import SettingRow, { INVALID } from "./SettingRow";
import type { ControlProps } from "./types";
import { stepValue } from "./logic";
import { useNumberDraft } from "./use-number-draft";

type Props = ControlProps<number> & {
  min?: number;
  max?: number;
  step?: number;
  integer?: boolean;
};

const STEP_BTN =
  "inline-flex w-7 shrink-0 items-center justify-center text-xs text-fg-muted hover:bg-bg-hover hover:text-fg disabled:cursor-not-allowed disabled:opacity-40 touch:w-10";

/** A small number with −/+ buttons (columns, counts). */
export default function Stepper({
  value,
  onChange,
  overridden,
  onReset,
  disabled,
  min,
  max,
  step = 1,
  integer = true,
  layout = "inline",
  ...row
}: Props) {
  const id = useId();
  const draft = useNumberDraft(value, (v) => v != null && onChange(v), { min, max, step, integer, nullable: false });
  const error = draft.error ?? row.error;
  const bump = (d: number) => onChange(stepValue(value, d, step, min, max));
  return (
    <SettingRow {...row} error={error} layout={layout} controlId={id} overridden={overridden} onReset={onReset} disabled={disabled}>
      <span
        className={[
          "inline-flex h-7 overflow-hidden rounded border bg-bg-elevated touch:h-10",
          error ? "border-status-failed" : "border-border",
        ].join(" ")}
      >
        <button
          type="button"
          className={`${STEP_BTN} border-r border-border`}
          disabled={disabled || (min != null && value <= min)}
          onClick={() => bump(-1)}
          aria-label="Decrease"
        >
          <i className="fa-solid fa-minus" aria-hidden="true" />
        </button>
        <input
          id={id}
          {...draft.inputProps}
          disabled={disabled}
          aria-invalid={!!error}
          className={`num w-12 bg-transparent text-center text-sm text-fg focus:outline-none disabled:cursor-not-allowed ${error ? INVALID : ""}`}
        />
        <button
          type="button"
          className={`${STEP_BTN} border-l border-border`}
          disabled={disabled || (max != null && value >= max)}
          onClick={() => bump(1)}
          aria-label="Increase"
        >
          <i className="fa-solid fa-plus" aria-hidden="true" />
        </button>
      </span>
    </SettingRow>
  );
}
