import { useId } from "react";
import SettingRow, { INVALID } from "./SettingRow";
import type { ControlProps } from "./types";

type Props = ControlProps<string> & {
  /** The value used while the box is empty ("auto"), shown as the placeholder. */
  placeholder?: string;
  /** Monospace, for templates and names. */
  mono?: boolean;
  maxLength?: number;
};

/** Free text; empty means the automatic value the placeholder shows. */
export default function TextInput({
  value,
  onChange,
  overridden,
  onReset,
  disabled,
  placeholder,
  mono,
  maxLength,
  layout = "stacked",
  ...row
}: Props) {
  const id = useId();
  return (
    <SettingRow {...row} layout={layout} controlId={id} overridden={overridden} onReset={onReset} disabled={disabled}>
      <input
        id={id}
        type="text"
        value={value}
        placeholder={placeholder}
        maxLength={maxLength}
        disabled={disabled}
        aria-invalid={!!row.error}
        onChange={(e) => onChange(e.target.value)}
        className={[
          "input py-1 disabled:cursor-not-allowed touch:min-h-10",
          mono ? "mono" : "",
          layout === "inline" ? "!w-44" : "",
          row.error ? INVALID : "",
        ].join(" ")}
      />
    </SettingRow>
  );
}
