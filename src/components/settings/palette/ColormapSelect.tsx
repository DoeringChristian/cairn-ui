import { useId, useRef, useState } from "react";
import Popover from "../../ui/Popover";
import SettingRow, { INVALID } from "./SettingRow";
import type { ControlProps } from "./types";
import { COLORMAP_OPTIONS, type Colormap } from "../../../charts/colormaps";
import { colormapGradient } from "./logic";

function Swatch({ name, className = "" }: { name: Colormap; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`block h-3 rounded-sm ring-1 ring-inset ring-black/10 ${className}`}
      style={{ backgroundImage: colormapGradient(name) }}
    />
  );
}

/** A colormap, picked from gradient swatches (`charts/colormaps.ts`). */
export default function ColormapSelect({
  value,
  onChange,
  overridden,
  onReset,
  disabled,
  layout = "inline",
  ...row
}: ControlProps<Colormap>) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  const current = COLORMAP_OPTIONS.find((o) => o.value === value);
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
          layout === "inline" ? "!w-40" : "",
          row.error ? INVALID : "",
        ].join(" ")}
      >
        <Swatch name={value} className="w-12 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{current?.label ?? value}</span>
        <i aria-hidden="true" className="fa-solid fa-chevron-down text-[10px] text-fg-subtle" />
      </button>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={anchorRef}
        title="Colormap"
        role="listbox"
        width="anchor"
        minWidth={200}
        align="start"
      >
        <div className="py-1">
          {COLORMAP_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              role="option"
              aria-selected={o.value === value}
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
              className={[
                "flex w-full items-center gap-3 px-3 py-1.5 text-left text-sm hover:bg-bg-hover touch:min-h-11",
                o.value === value ? "text-accent" : "text-fg",
              ].join(" ")}
            >
              <Swatch name={o.value} className="w-20 shrink-0" />
              <span className="flex-1">{o.label}</span>
              {o.value === value && <i aria-hidden="true" className="fa-solid fa-check text-xs" />}
            </button>
          ))}
        </div>
      </Popover>
    </SettingRow>
  );
}
