import { useId } from "react";
import { Select as PrismSelect } from "../../../prism/Select";
import SettingRow from "./SettingRow";
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
        <PrismSelect buttonId={id} label={typeof row.label === "string" ? row.label : "Setting value"} value={value} disabled={disabled} onChange={next => onChange(next as T)} options={[...options]}/>

      </span>
    </SettingRow>
  );
}
