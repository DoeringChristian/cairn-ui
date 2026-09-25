import { useId } from "react";
import SettingRow, { INVALID } from "./SettingRow";
import RangeTrack from "./RangeTrack";
import type { ControlProps } from "./types";
import { useNumberDraft } from "./use-number-draft";

type Props = ControlProps<number> & {
  min: number;
  max: number;
  step?: number;
};

/** A slider plus a box for the exact value (smoothing weight, opacity). */
export default function SliderInput({
  value,
  onChange,
  overridden,
  onReset,
  disabled,
  min,
  max,
  step,
  layout = "stacked",
  ...row
}: Props) {
  const id = useId();
  const draft = useNumberDraft(value, (v) => v != null && onChange(v), { min, max, step, nullable: false });
  const error = draft.error ?? row.error;
  return (
    <SettingRow {...row} error={error} layout={layout} controlId={id} overridden={overridden} onReset={onReset} disabled={disabled}>
      <span className={`flex items-center gap-2 ${layout === "inline" ? "w-52" : "w-full"}`}>
        <RangeTrack
          value={value}
          onChange={onChange}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          invalid={!!error}
          label={typeof row.label === "string" ? row.label : undefined}
        />
        <input
          id={id}
          {...draft.inputProps}
          disabled={disabled}
          aria-invalid={!!error}
          className={`input num w-16 shrink-0 px-2 py-1 text-right disabled:cursor-not-allowed touch:min-h-10 ${error ? INVALID : ""}`}
        />
      </span>
    </SettingRow>
  );
}
