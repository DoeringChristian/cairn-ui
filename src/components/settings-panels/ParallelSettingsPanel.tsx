import { SettingsSection, SettingsTabs, type FieldOption } from "../settings/palette";
import type { SettingsController } from "../../lib/card-settings";
import type { ParallelColumn } from "../../charts/ParallelChart";
import type { ParallelSettings } from "../cards-settings/parallel";
import ExprField from "./ExprField";

export interface PanelCtx {
  options: FieldOption[];
  /** Per column: why it yields nothing. */
  errors: Array<string | null>;
}

interface Props {
  ctl: SettingsController<ParallelSettings>;
  ctx?: PanelCtx;
  mode: "card" | "defaults";
}

const ROW_BTN =
  "inline-flex h-6 min-w-6 items-center justify-center rounded px-1 text-[11px] disabled:cursor-not-allowed disabled:opacity-40 touch:h-10 touch:min-w-10";

/** The parallel-coordinates card has only per-card settings: its columns. */
export default function ParallelSettingsPanel({ ctl, ctx, mode }: Props) {
  if (mode !== "card") return null;
  const cols = ctl.value.columns;
  const ro = ctl.readOnly;
  const set = (next: ParallelColumn[]) => ctl.set({ columns: next });
  const patch = (i: number, p: Partial<ParallelColumn>) => set(cols.map((c, j) => (j === i ? { ...c, ...p } : c)));
  const move = (i: number, d: number) => {
    const next = [...cols];
    const [c] = next.splice(i, 1);
    next.splice(i + d, 0, c!);
    set(next);
  };
  const toggle = (on: boolean | undefined) =>
    `${ROW_BTN} ${on ? "bg-accent/15 text-accent" : "text-fg-subtle hover:bg-bg-hover hover:text-fg"}`;

  const data = (
    <SettingsSection name="Axes">
      <ul className="flex flex-col gap-1 py-1">
        {cols.map((col, i) => {
          const error = ctx?.errors[i];
          return (
            <li
              key={`${col.src}:${i}`}
              className={`rounded border bg-bg px-2 py-1 ${error ? "border-status-failed" : "border-border-subtle"}`}
            >
              <div className="flex items-center gap-1">
                <span className="mono min-w-0 flex-1 truncate text-xs text-fg" title={col.src}>
                  {col.src}
                  {i === cols.length - 1 && <span className="ml-1 text-[10px] text-fg-subtle">(colour)</span>}
                </span>
                <button type="button" disabled={ro} aria-pressed={!!col.log} title="Log scale" className={toggle(col.log)} onClick={() => patch(i, { log: !col.log })}>
                  log
                </button>
                <button type="button" disabled={ro} aria-pressed={!!col.invert} title="Invert axis" aria-label="Invert axis" className={toggle(col.invert)} onClick={() => patch(i, { invert: !col.invert })}>
                  <i aria-hidden="true" className="fa-solid fa-arrow-down-up-across-line" />
                </button>
                <button type="button" disabled={ro || i === 0} title="Move left" aria-label="Move left" className={toggle(false)} onClick={() => move(i, -1)}>
                  <i aria-hidden="true" className="fa-solid fa-arrow-up" />
                </button>
                <button type="button" disabled={ro || i === cols.length - 1} title="Move right" aria-label="Move right" className={toggle(false)} onClick={() => move(i, 1)}>
                  <i aria-hidden="true" className="fa-solid fa-arrow-down" />
                </button>
                <button type="button" disabled={ro} title="Remove" aria-label={`Remove ${col.src}`} className={toggle(false)} onClick={() => set(cols.filter((_, j) => j !== i))}>
                  <i aria-hidden="true" className="fa-solid fa-xmark" />
                </button>
              </div>
              {error && <p className="mt-0.5 text-xs text-status-failed">{error}</p>}
            </li>
          );
        })}
      </ul>
      {cols.length > 0 && <p className="text-xs text-fg-muted">The last column colours the lines.</p>}
      <ExprField
        label="Add a column"
        adder
        options={ctx?.options ?? []}
        value={null}
        disabled={ro}
        onChange={(src) => src != null && set([...cols, { src }])}
      />
    </SettingsSection>
  );

  return <SettingsTabs tabs={{ data }} />;
}
