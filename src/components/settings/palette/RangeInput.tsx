import { useId } from "react";
import SettingRow, { INVALID } from "./SettingRow";
import type { ControlProps } from "./types";
import { rangeError, type RangeValue } from "./logic";
import { useNumberDraft } from "./use-number-draft";

type Props = ControlProps<RangeValue> & {
  /** Offer the log-scale toggle. */
  showLog?: boolean;
  /** Placeholders for empty bounds: the automatic extent, e.g. "0.01". */
  autoMin?: string;
  autoMax?: string;
};

/** An axis range: min and max ("auto" when empty) and a log toggle. */
export default function RangeInput({
  value,
  onChange,
  overridden,
  onReset,
  disabled,
  showLog = true,
  autoMin = "auto",
  autoMax = "auto",
  layout = "stacked",
  ...row
}: Props) {
  const id = useId();
  const lo = useNumberDraft(value.min, (min) => onChange({ ...value, min }), {});
  const hi = useNumberDraft(value.max, (max) => onChange({ ...value, max }), {});
  const error = lo.error ?? hi.error ?? rangeError(value) ?? row.error;
  const box = (invalid: boolean) =>
    `input num min-w-0 flex-1 px-2 py-1 disabled:cursor-not-allowed touch:min-h-10 ${invalid ? INVALID : ""}`;
  return (
    <SettingRow {...row} error={error} layout={layout} controlId={id} overridden={overridden} onReset={onReset} disabled={disabled}>
      <span className={`flex items-center gap-1.5 ${layout === "inline" ? "w-60" : "w-full"}`}>
        <input
          id={id}
          {...lo.inputProps}
          placeholder={autoMin}
          aria-label="Minimum"
          disabled={disabled}
          aria-invalid={!!error}
          className={box(!!error)}
        />
        <span aria-hidden="true" className="text-xs text-fg-subtle">–</span>
        <input
          {...hi.inputProps}
          placeholder={autoMax}
          aria-label="Maximum"
          disabled={disabled}
          aria-invalid={!!error}
          className={box(!!error)}
        />
        {showLog && (
          <button
            type="button"
            aria-pressed={value.log}
            disabled={disabled}
            onClick={() => onChange({ ...value, log: !value.log })}
            title="Log scale"
            className={[
              "mono h-7 shrink-0 rounded border px-2 text-xs transition-colors disabled:cursor-not-allowed touch:h-10 touch:px-3",
              value.log ? "border-accent bg-accent/10 text-accent" : "border-border bg-bg-elevated text-fg-muted hover:text-fg",
            ].join(" ")}
          >
            log
          </button>
        )}
      </span>
    </SettingRow>
  );
}
