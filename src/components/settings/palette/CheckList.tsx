import { useId } from "react";
import SettingRow from "./SettingRow";
import type { ControlProps } from "./types";

export interface CheckItem {
  key: string;
  label: string;
  /** Swatch colour (a run's or series' colour). */
  color?: string;
  description?: string;
}

type Props = ControlProps<string[]> & {
  items: ReadonlyArray<CheckItem>;
  /** Show "All · None" above the list. */
  bulk?: boolean;
};

/** Several on/off items (runs, series, channels), each with an optional colour swatch. */
export default function CheckList({
  value,
  onChange,
  overridden,
  onReset,
  disabled,
  items,
  bulk = true,
  layout = "stacked",
  ...row
}: Props) {
  const id = useId();
  const checked = new Set(value);
  const toggle = (key: string) =>
    onChange(checked.has(key) ? value.filter((k) => k !== key) : items.filter((i) => checked.has(i.key) || i.key === key).map((i) => i.key));
  const link = "text-xs text-fg-muted hover:text-accent disabled:cursor-not-allowed touch:min-h-8";
  return (
    <SettingRow {...row} layout={layout} controlId={id} overridden={overridden} onReset={onReset} disabled={disabled}>
      <div
        id={id}
        role="group"
        className={`rounded border bg-bg ${row.error ? "border-status-failed" : "border-border"} ${layout === "inline" ? "w-52" : ""}`}
      >
        {bulk && items.length > 1 && (
          <div className="flex items-center gap-2 border-b border-border-subtle px-2 py-1">
            <span className="flex-1 text-xs text-fg-subtle">
              {value.length}/{items.length}
            </span>
            <button type="button" disabled={disabled} className={link} onClick={() => onChange(items.map((i) => i.key))}>
              All
            </button>
            <span className="text-xs text-fg-subtle">·</span>
            <button type="button" disabled={disabled} className={link} onClick={() => onChange([])}>
              None
            </button>
          </div>
        )}
        <div className="max-h-48 overflow-y-auto py-0.5">
          {items.map((item) => {
            const on = checked.has(item.key);
            return (
              <button
                key={item.key}
                type="button"
                role="checkbox"
                aria-checked={on}
                disabled={disabled}
                onClick={() => toggle(item.key)}
                title={item.description}
                className="flex w-full items-center gap-2 px-2 py-1 text-left text-sm hover:bg-bg-hover disabled:cursor-not-allowed touch:min-h-10"
              >
                <span
                  aria-hidden="true"
                  className={[
                    "inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border text-[9px]",
                    on ? "border-accent bg-accent text-white" : "border-border bg-bg-elevated text-transparent",
                  ].join(" ")}
                >
                  <i className="fa-solid fa-check" />
                </span>
                {item.color && (
                  <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: item.color }} />
                )}
                <span className={`mono min-w-0 flex-1 truncate text-xs ${on ? "text-fg" : "text-fg-muted"}`}>{item.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </SettingRow>
  );
}
