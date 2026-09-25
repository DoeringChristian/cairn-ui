import { useId, useRef, useState } from "react";
import Popover from "../../ui/Popover";
import SettingRow, { INVALID } from "./SettingRow";
import FieldList, { KindBadge } from "./FieldList";
import type { ControlProps } from "./types";
import type { FieldOption } from "./logic";

type Props = ControlProps<string | null> & {
  options: readonly FieldOption[];
  /** Shown when nothing is chosen: the automatic choice, e.g. "Step". */
  placeholder?: string;
  /** Offer "None" (sets `null`). */
  clearable?: boolean;
};

/** One param, metric or expression, searched from a popover. */
export default function FieldPicker({
  value,
  onChange,
  overridden,
  onReset,
  disabled,
  options,
  placeholder = "Choose…",
  clearable = false,
  layout = "stacked",
  ...row
}: Props) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  const current = value == null ? null : options.find((o) => o.key === value);
  return (
    <SettingRow {...row} layout={layout} controlId={id} overridden={overridden} onReset={onReset} disabled={disabled}>
      <button
        id={id}
        ref={anchorRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-invalid={!!row.error}
        onClick={() => setOpen((v) => !v)}
        className={[
          "input flex items-center gap-2 py-1 text-left disabled:cursor-not-allowed touch:min-h-10",
          layout === "inline" ? "!w-44" : "",
          row.error ? INVALID : "",
        ].join(" ")}
      >
        {current && <KindBadge kind={current.kind} />}
        <span className={`mono min-w-0 flex-1 truncate ${value == null ? "text-fg-subtle" : ""}`}>
          {current?.label ?? value ?? placeholder}
        </span>
        <i aria-hidden="true" className="fa-solid fa-chevron-down text-[10px] text-fg-subtle" />
      </button>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={anchorRef}
        title={typeof row.label === "string" ? row.label : "Choose a field"}
        width={288}
        align="start"
      >
        {clearable && value != null && (
          <button
            type="button"
            onClick={() => {
              onChange(null);
              setOpen(false);
            }}
            className="block w-full border-b border-border-subtle px-3 py-1.5 text-left text-xs text-fg-muted hover:bg-bg-hover touch:min-h-10"
          >
            None
          </button>
        )}
        <FieldList
          options={options}
          selected={value}
          onPick={(o) => {
            onChange(o.key);
            setOpen(false);
          }}
        />
      </Popover>
    </SettingRow>
  );
}
