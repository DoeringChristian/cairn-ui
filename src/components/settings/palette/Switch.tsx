import { useId } from "react";
import SettingRow from "./SettingRow";
import type { ControlProps } from "./types";

/** An on/off setting: a switch at the row's right edge. */
export default function Switch({
  value,
  onChange,
  overridden,
  onReset,
  disabled,
  layout = "inline",
  ...row
}: ControlProps<boolean>) {
  const id = useId();
  return (
    <SettingRow {...row} layout={layout} controlId={id} overridden={overridden} onReset={onReset} disabled={disabled}>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={value}
        disabled={disabled}
        onClick={() => onChange(!value)}
        className="group/sw inline-flex shrink-0 items-center rounded-full focus-visible:outline-none disabled:cursor-not-allowed touch:min-h-10 touch:px-1"
      >
        <span
          aria-hidden="true"
          className={[
            "relative h-5 w-9 rounded-full border transition-colors group-focus-visible/sw:ring-2 group-focus-visible/sw:ring-accent",
            value ? "border-accent bg-accent" : "border-border bg-bg",
            row.error ? "!border-status-failed" : "",
          ].join(" ")}
        >
          <span
            className={[
              "absolute left-0.5 top-0.5 h-3.5 w-3.5 rounded-full transition-transform",
              value ? "translate-x-4 bg-bg-elevated" : "bg-fg-muted",
            ].join(" ")}
          />
        </span>
      </button>
    </SettingRow>
  );
}
