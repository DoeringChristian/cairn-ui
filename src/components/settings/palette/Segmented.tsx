import { useId } from "react";
import SettingRow from "./SettingRow";
import type { ControlProps } from "./types";

export interface SegmentedOption<T extends string> {
  value: T;
  /** Text; with `icon` too, it becomes the tooltip / accessible name when `iconOnly`. */
  label: string;
  /** Font Awesome class, e.g. "fa-chart-line". */
  icon?: string;
}

type Props<T extends string> = ControlProps<T> & {
  options: ReadonlyArray<SegmentedOption<T>>;
  /** Show only the icons (labels become tooltips). */
  iconOnly?: boolean;
};

/** A small exclusive toggle group (2–5 options). */
export default function Segmented<T extends string>({
  value,
  onChange,
  overridden,
  onReset,
  disabled,
  options,
  iconOnly = false,
  layout = "inline",
  ...row
}: Props<T>) {
  const id = useId();
  return (
    <SettingRow {...row} layout={layout} controlId={id} overridden={overridden} onReset={onReset} disabled={disabled}>
      <div
        id={id}
        role="radiogroup"
        aria-invalid={!!row.error}
        className={[
          "inline-flex rounded border bg-bg p-0.5",
          row.error ? "border-status-failed" : "border-border",
          layout === "stacked" ? "flex w-full" : "",
        ].join(" ")}
      >
        {options.map((o) => {
          const on = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={iconOnly ? o.label : undefined}
              title={iconOnly ? o.label : undefined}
              disabled={disabled}
              onClick={() => onChange(o.value)}
              className={[
                "inline-flex min-h-6 items-center justify-center gap-1.5 rounded-sm px-2 text-xs transition-colors disabled:cursor-not-allowed touch:min-h-10 touch:px-3",
                layout === "stacked" ? "flex-1" : "",
                on ? "bg-bg-elevated text-fg shadow-sm ring-1 ring-border" : "text-fg-muted hover:text-fg",
              ].join(" ")}
            >
              {o.icon && <i className={`fa-solid ${o.icon}`} aria-hidden="true" />}
              {!iconOnly && <span>{o.label}</span>}
            </button>
          );
        })}
      </div>
    </SettingRow>
  );
}
