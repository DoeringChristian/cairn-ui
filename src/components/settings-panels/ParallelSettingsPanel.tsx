import { FieldPicker, Segmented, Select, SettingsAction, SettingsSection, SettingsTabs, type FieldOption } from "../settings/palette";
import { KindBadge } from "../settings/palette/FieldList";
import { bind, type SettingsController } from "../../lib/card-settings";
import { axesWithMetric, type ParallelAxis } from "../../lib/parallel-coords";
import type { ParallelColor, ParallelSettings } from "../cards-settings/parallel";

export interface PanelCtx {
  /** The runs' metrics (final values). */
  metrics: string[];
  /** The runs' config keys. */
  configKeys: string[];
  /** The metric shown (the chosen one, else the default). */
  metric: string | null;
  /** The axes shown (the card's list, else the defaults). */
  axes: ParallelAxis[];
}

interface Props {
  ctl: SettingsController<ParallelSettings>;
  ctx?: PanelCtx;
  mode: "card" | "defaults";
}

const ROW_BTN =
  "inline-flex h-6 min-w-6 items-center justify-center rounded px-1 text-[11px] disabled:cursor-not-allowed disabled:opacity-40 touch:h-10 touch:min-w-10";

const optionKey = (a: Pick<ParallelAxis, "kind" | "key">) => `${a.kind}:${a.key}`;

/** The metric, the axes (add, remove, reorder, log scale) and the line colour. */
export default function ParallelSettingsPanel({ ctl, ctx, mode }: Props) {
  if (mode !== "card" || !ctx) return null;
  const s = ctl.value;
  const ro = ctl.locked;
  const axes = ctx.axes;
  // Any edit turns the shown axes (defaults included) into the card's own list.
  const set = (next: ParallelAxis[]) => ctl.set({ axes: next });
  const patch = (i: number, p: Partial<ParallelAxis>) => set(axes.map((a, j) => (j === i ? { ...a, ...p } : a)));
  const move = (i: number, d: number) => {
    const next = [...axes];
    const [a] = next.splice(i, 1);
    next.splice(i + d, 0, a!);
    set(next);
  };
  const toggle = (on: boolean | undefined) =>
    `${ROW_BTN} ${on ? "bg-accent/15 text-accent" : "text-fg-subtle hover:bg-bg-hover hover:text-fg"}`;

  const shown = new Set(axes.map(optionKey));
  const options: FieldOption[] = [
    ...ctx.configKeys.map((k) => ({ key: `config:${k}`, kind: "param" as const, label: k })),
    ...ctx.metrics.map((k) => ({ key: `metric:${k}`, kind: "metric" as const, label: k })),
  ].filter((o) => !shown.has(o.key));

  const values = (
    <>
      <SettingsSection name="Series">
        <Select<string>
          label="Metric"
          info="Its final value per run (the project's summary rule); the last axis by default."
          value={ctx.metric ?? ""}
          options={ctx.metrics.length ? ctx.metrics.map((m) => ({ value: m, label: m })) : [{ value: "", label: "No metric", disabled: true }]}
          onChange={(m) => m && ctl.set({ metric: m, axes: axesWithMetric(s.axes, ctx.metric, m) })}
          overridden={ctl.isOverridden("metric")}
          onReset={() => ctl.reset("metric")}
          disabled={ro}
        />
      </SettingsSection>
      <SettingsSection name="Axes">
        <ul className="flex flex-col gap-1 py-1" data-testid="parallel-axes">
          {axes.map((a, i) => (
            <li key={`${optionKey(a)}:${i}`} className="rounded border border-border-subtle bg-bg px-2 py-1">
              <div className="flex items-center gap-1">
                <KindBadge kind={a.kind === "config" ? "param" : "metric"} />
                <span className="mono min-w-0 flex-1 truncate text-xs text-fg" title={a.key}>
                  {a.key}
                </span>
                <button type="button" disabled={ro} aria-pressed={!!a.log} title="Log scale (numeric axes)" className={toggle(a.log)} onClick={() => patch(i, { log: !a.log })}>
                  log
                </button>
                <button type="button" disabled={ro || i === 0} title="Move left" aria-label={`Move ${a.key} left`} className={toggle(false)} onClick={() => move(i, -1)}>
                  <i aria-hidden="true" className="fa-solid fa-arrow-up" />
                </button>
                <button type="button" disabled={ro || i === axes.length - 1} title="Move right" aria-label={`Move ${a.key} right`} className={toggle(false)} onClick={() => move(i, 1)}>
                  <i aria-hidden="true" className="fa-solid fa-arrow-down" />
                </button>
                <button type="button" disabled={ro} title="Remove" aria-label={`Remove ${a.key}`} className={toggle(false)} onClick={() => set(axes.filter((_, j) => j !== i))}>
                  <i aria-hidden="true" className="fa-solid fa-xmark" />
                </button>
              </div>
            </li>
          ))}
        </ul>
        <FieldPicker
          label="Add an axis"
          placeholder="Config key or metric…"
          options={options}
          value={null}
          disabled={ro}
          onChange={(key) => {
            const o = key == null ? null : options.find((x) => x.key === key);
            if (o) set([...axes, { kind: o.kind === "param" ? "config" : "metric", key: o.label }]);
          }}
        />
        {s.axes != null && (
          <SettingsAction
            label="Default axes"
            description="The config keys that vary across the runs, then the metric."
            icon="fa-rotate-left"
            disabled={ro}
            onClick={() => ctl.set({ axes: null })}
          />
        )}
      </SettingsSection>
    </>
  );

  const display = (
    <SettingsSection name="Appearance">
      <Segmented<ParallelColor>
        label="Line colour"
        layout="stacked"
        options={[
          { value: "gradient", label: "Gradient by last axis" },
          { value: "runs", label: "Run colours" },
        ]}
        {...bind(ctl, "color")}
      />
    </SettingsSection>
  );

  return <SettingsTabs tabs={{ values, display }} />;
}
