import { useId, useMemo, useRef, useState } from "react";
import Popover from "../../ui/Popover";
import SettingRow from "./SettingRow";
import FieldList, { KindBadge } from "./FieldList";
import type { ControlProps } from "./types";
import { addAll, type FieldOption } from "./logic";

type Props = ControlProps<string[]> & {
  options: readonly FieldOption[];
  /** The add button's label. */
  addLabel?: string;
};

/**
 * Several params / metrics / expressions as removable chips. The picker
 * searches by substring, or by regex with the `.*` toggle ("Add all N
 * matches"). Chosen keys missing from `options` still show, dimmed.
 */
export default function FieldMultiPicker({
  value,
  onChange,
  overridden,
  onReset,
  disabled,
  options,
  addLabel = "Add",
  layout = "stacked",
  ...row
}: Props) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  const byKey = useMemo(() => new Map(options.map((o) => [o.key, o])), [options]);
  const chosen = useMemo(() => new Set(value), [value]);
  return (
    <SettingRow {...row} layout={layout} controlId={id} overridden={overridden} onReset={onReset} disabled={disabled}>
      <div
        className={[
          "flex min-h-8 flex-wrap items-center gap-1 rounded border bg-bg p-1",
          row.error ? "border-status-failed" : "border-border",
          layout === "inline" ? "w-56" : "",
        ].join(" ")}
      >
        {value.map((key) => {
          const o = byKey.get(key);
          return (
            <span
              key={key}
              title={o ? undefined : "Not found in the current runs"}
              className={[
                "inline-flex max-w-full items-center gap-1 rounded border border-border bg-bg-elevated py-0.5 pl-1 pr-0.5 text-xs touch:py-0",
                o ? "text-fg" : "text-fg-subtle line-through decoration-fg-subtle/50",
              ].join(" ")}
            >
              {o && <KindBadge kind={o.kind} />}
              <span className="mono min-w-0 truncate">{o?.label ?? key}</span>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onChange(value.filter((k) => k !== key))}
                aria-label={`Remove ${o?.label ?? key}`}
                className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-fg-subtle hover:bg-bg-hover hover:text-fg disabled:hidden touch:h-8 touch:w-8"
              >
                <i aria-hidden="true" className="fa-solid fa-xmark text-[10px]" />
              </button>
            </span>
          );
        })}
        <button
          id={id}
          ref={anchorRef}
          type="button"
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="inline-flex h-6 items-center gap-1 rounded px-1.5 text-xs text-fg-muted hover:bg-bg-hover hover:text-fg disabled:hidden touch:h-10 touch:px-3"
        >
          <i aria-hidden="true" className="fa-solid fa-plus text-[10px]" />
          {value.length === 0 && <span>{addLabel}</span>}
        </button>
      </div>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={anchorRef}
        title={typeof row.label === "string" ? row.label : "Add fields"}
        width={288}
        align="start"
      >
        <FieldList
          options={options}
          exclude={chosen}
          regexToggle
          onPick={(o) => onChange([...value, o.key])}
          onPickAll={(matches) => {
            onChange(addAll(value, matches));
            setOpen(false);
          }}
        />
      </Popover>
    </SettingRow>
  );
}
