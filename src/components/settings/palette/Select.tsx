import { useId } from "react";
import SettingRow, { INVALID } from "./SettingRow";
import type { ControlProps } from "./types";

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  disabled?: boolean;
}

type Props<T extends string> = ControlProps<T> & {
  options: ReadonlyArray<SelectOption<T>>;
};

/** Longest option label (in characters) that fits the inline width. */
const INLINE_MAX_CHARS = 18;

/** One choice from a short list (a native select, styled like `.input`). */
export default function Select<T extends string>({
  value,
  onChange,
  overridden,
  onReset,
  disabled,
  options,
  layout = "inline",
  ...row
}: Props<T>) {
  const id = useId();
  // An inline select is 10rem wide; options that would be cut off stack it
  // under its label instead, at full width.
  const eff = layout === "inline" && options.some((o) => o.label.length > INLINE_MAX_CHARS) ? "stacked" : layout;
  return (
    <SettingRow {...row} layout={eff} controlId={id} overridden={overridden} onReset={onReset} disabled={disabled}>
      <span className={`relative ${eff === "inline" ? "w-40" : "block w-full"}`}>
        <select
          id={id}
          value={value}
          disabled={disabled}
          aria-invalid={!!row.error}
          onChange={(e) => onChange(e.target.value as T)}
          className={`input appearance-none truncate py-1 pr-7 disabled:cursor-not-allowed touch:min-h-10 ${row.error ? INVALID : ""}`}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </option>
          ))}
        </select>
        <i
          aria-hidden="true"
          className="fa-solid fa-chevron-down pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-fg-subtle"
        />
      </span>
    </SettingRow>
  );
}
