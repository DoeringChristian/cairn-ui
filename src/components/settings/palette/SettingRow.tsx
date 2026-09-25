import { useState, type ReactNode } from "react";
import type { RowProps } from "./types";

interface Props extends RowProps {
  /** Id of the control's focusable element, so clicking the label focuses it. */
  controlId?: string;
  /** Stacked rows: a short readout right of the label (a slider's value). */
  hint?: ReactNode;
  overridden?: boolean;
  onReset?: () => void;
  disabled?: boolean;
  children: ReactNode;
}

/** Red border for a control whose row has an error. */
export const INVALID = "!border-status-failed";

/**
 * One setting: label (+ ⓘ), description, the control and ↺.
 *
 * - `inline`: label and description on the left, the control on the right.
 * - `stacked`: the label above a full-width control, description below.
 *
 * ↺ shows only while the value is overridden (and resettable).
 */
export default function SettingRow({
  label,
  description,
  info,
  error,
  layout = "inline",
  controlId,
  hint,
  overridden,
  onReset,
  disabled,
  children,
}: Props) {
  const [infoOpen, setInfoOpen] = useState(false);
  const reset = overridden && onReset && !disabled ? (
    <button
      type="button"
      onClick={onReset}
      className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-[11px] text-accent hover:bg-bg-hover touch:h-10 touch:w-10"
      aria-label="Reset to default"
      title="Reset to default"
    >
      <i className="fa-solid fa-rotate-left" aria-hidden="true" />
    </button>
  ) : null;

  const labelEl = label != null && (
    <span className="flex min-w-0 items-center gap-1">
      <label htmlFor={controlId} className="min-w-0 select-none text-sm text-fg">
        {label}
      </label>
      {info && (
        <button
          type="button"
          onClick={() => setInfoOpen((v) => !v)}
          className="inline-flex h-4 w-4 shrink-0 items-center justify-center text-[11px] text-fg-subtle hover:text-fg touch:h-8 touch:w-8"
          aria-label="More info"
          aria-expanded={infoOpen}
          title={info}
        >
          <i className="fa-solid fa-circle-info" aria-hidden="true" />
        </button>
      )}
    </span>
  );
  const notes = (
    <>
      {description && <p className="mt-0.5 text-xs text-fg-muted">{description}</p>}
      {info && infoOpen && <p className="mt-1 rounded bg-bg-hover px-2 py-1 text-xs text-fg-muted">{info}</p>}
    </>
  );
  const errorEl = error && (
    <p role="alert" className="mt-1 text-xs text-status-failed">
      {error}
    </p>
  );
  const dim = disabled ? " opacity-60" : "";

  if (layout === "stacked") {
    return (
      <div className={`py-1.5${dim}`}>
        {(labelEl || hint || reset) && (
          <div className="mb-1 flex min-h-5 items-center justify-between gap-2">
            {labelEl || <span />}
            <span className="flex items-center gap-1">
              {hint != null && <span className="num text-xs text-fg-muted">{hint}</span>}
              {reset}
            </span>
          </div>
        )}
        {children}
        {notes}
        {errorEl}
      </div>
    );
  }

  return (
    <div className={`flex items-start justify-between gap-3 py-1.5${dim}`}>
      <div className="min-w-0 flex-1 pt-0.5">
        {labelEl}
        {notes}
        {errorEl}
      </div>
      <div className="flex max-w-[65%] shrink-0 items-center gap-1">
        {reset}
        {children}
      </div>
    </div>
  );
}
