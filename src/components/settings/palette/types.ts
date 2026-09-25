import type { ReactNode } from "react";

/**
 * A control bound to one setting. `overridden` and `onReset` come from the
 * settings controller: ↺ shows only while the value overrides its parent
 * (workspace / section default, or the builtin), and resets it.
 */
export interface Bound<V> {
  value: V;
  onChange: (next: V) => void;
  overridden?: boolean;
  onReset?: () => void;
  /** Disabled or read-only: the value shows, nothing can change it. */
  disabled?: boolean;
}

export type RowLayout = "inline" | "stacked";

/** The row every control renders through `SettingRow`. */
export interface RowProps {
  label?: ReactNode;
  description?: ReactNode;
  /** Longer help behind an ⓘ next to the label (a tooltip; tap to show on touch). */
  info?: string;
  /** Validation message under the control; also marks the control invalid. */
  error?: string | null;
  /** Defaults per control: toggles and short pickers inline, wide inputs stacked. */
  layout?: RowLayout;
}

export type ControlProps<V> = Bound<V> & RowProps;
