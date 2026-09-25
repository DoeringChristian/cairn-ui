import { useId } from "react";
import SettingRow from "./SettingRow";
import RangeTrack from "./RangeTrack";
import type { ControlProps } from "./types";

type Props = ControlProps<number> & {
  min: number;
  max: number;
  step?: number;
  /** The readout right of the label, e.g. `(v) => v.toFixed(2)`. */
  format?: (v: number) => string;
};

/** A bounded number picked by dragging; the value reads out next to the label. */
export default function Slider({
  value,
  onChange,
  overridden,
  onReset,
  disabled,
  min,
  max,
  step,
  format,
  layout = "stacked",
  ...row
}: Props) {
  const id = useId();
  return (
    <SettingRow
      {...row}
      layout={layout}
      controlId={id}
      hint={format ? format(value) : String(value)}
      overridden={overridden}
      onReset={onReset}
      disabled={disabled}
    >
      <span className={layout === "inline" ? "block w-40" : "block"}>
        <RangeTrack id={id} value={value} onChange={onChange} min={min} max={max} step={step} disabled={disabled} invalid={!!row.error} />
      </span>
    </SettingRow>
  );
}
