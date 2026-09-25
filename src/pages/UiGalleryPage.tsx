import { useEffect, useState, type ReactNode } from "react";
import {
  CheckList,
  ColormapSelect,
  FieldMultiPicker,
  FieldPicker,
  NumberInput,
  RangeInput,
  Segmented,
  Select,
  SettingsAction,
  SettingsSection,
  SettingsTabs,
  Slider,
  SliderInput,
  Stepper,
  Switch,
  TextInput,
  type Bound,
  type FieldOption,
  type RangeValue,
} from "../components/settings/palette";
import { HeaderBadge, HeaderLabel, HeaderToggle } from "../components/card-header";
import CardHeader from "../components/CardHeader";
import type { Colormap } from "../charts/colormaps";

/**
 * `/_ui`: every settings-palette control in each state (default, overridden,
 * disabled / read-only, error), plus the header controls and a full panel.
 * "Touch" applies the `touch:` variant without a coarse pointer.
 */

const FIELDS: FieldOption[] = [
  { key: "p:lr", kind: "param", label: "lr" },
  { key: "p:batch_size", kind: "param", label: "batch_size" },
  { key: "p:optimizer.name", kind: "param", label: "optimizer.name" },
  { key: "m:train/loss", kind: "metric", label: "train/loss" },
  { key: "m:train/acc", kind: "metric", label: "train/acc" },
  { key: "m:val/loss", kind: "metric", label: "val/loss" },
  { key: "m:val/acc", kind: "metric", label: "val/acc" },
  { key: "m:lr_schedule", kind: "metric", label: "lr_schedule" },
  { key: "e:gap", kind: "expr", label: "gap = val/loss - train/loss" },
];

const RUNS = [
  { key: "r1", label: "brisk-otter-12", color: "#0969da" },
  { key: "r2", label: "calm-heron-7", color: "#cf222e" },
  { key: "r3", label: "quiet-lynx-3", color: "#1a7f37" },
  { key: "r4", label: "bold-finch-21", color: "#8250df" },
];

type StateName = "default" | "overridden" | "disabled" | "error";
const STATES: StateName[] = ["default", "overridden", "disabled", "error"];

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** A value bound like a card setting: overridden while it differs from `builtin`. */
function useDemoBound<V>(builtin: V, initial: V, disabled: boolean): Bound<V> {
  const [value, setValue] = useState<V>(initial);
  return {
    value,
    onChange: setValue,
    overridden: !same(value, builtin),
    onReset: () => setValue(builtin),
    disabled,
  };
}

interface DemoProps<V> {
  name: string;
  note?: string;
  builtin: V;
  /** The value the "overridden" column starts from. */
  override: V;
  error: string;
  render: (bound: Bound<V>, error: string | undefined) => ReactNode;
}

function Cell<V>({ state, builtin, override, error, render }: DemoProps<V> & { state: StateName }) {
  const bound = useDemoBound(builtin, state === "overridden" ? override : builtin, state === "disabled");
  return (
    <div className="min-w-0 rounded-md border border-border-subtle bg-bg p-3">
      <div className="mb-1 text-[10px] uppercase tracking-wide text-fg-subtle">{state}</div>
      {render(bound, state === "error" ? error : undefined)}
    </div>
  );
}

function Demo<V>(props: DemoProps<V>) {
  return (
    <section className="rounded-lg border border-border bg-bg-elevated p-3">
      <h2 className="mono text-sm font-semibold">{props.name}</h2>
      {props.note && <p className="mb-2 text-xs text-fg-muted">{props.note}</p>}
      <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {STATES.map((s) => (
          <Cell key={s} {...props} state={s} />
        ))}
      </div>
    </section>
  );
}

function FullPanel() {
  const smoothing = useDemoBound(0, 0.6, false);
  const xAxis = useDemoBound<string | null>(null, null, false);
  const logY = useDemoBound(false, false, false);
  const range = useDemoBound<RangeValue>({ min: null, max: null, log: false }, { min: null, max: null, log: false }, false);
  const group = useDemoBound<"none" | "mean" | "median">("none", "mean", false);
  const lineWidth = useDemoBound(1.5, 1.5, false);
  const legend = useDemoBound(true, true, false);
  const title = useDemoBound("", "", false);
  return (
    <SettingsTabs
      tabs={{
        data: (
          <>
            <SettingsSection name="Axes">
              <FieldPicker {...xAxis} label="X axis" options={FIELDS} placeholder="Step" clearable />
              <RangeInput {...range} label="Y range" />
              <Switch {...logY} label="Log Y" />
            </SettingsSection>
            <SettingsSection name="Smoothing">
              <SliderInput {...smoothing} label="EMA weight" min={0} max={0.99} step={0.01} info="Exponential moving average; 0 turns it off." />
            </SettingsSection>
          </>
        ),
        grouping: (
          <Segmented
            {...group}
            label="Aggregate"
            options={[
              { value: "none", label: "None" },
              { value: "mean", label: "Mean" },
              { value: "median", label: "Median" },
            ]}
          />
        ),
        display: (
          <>
            <SettingsSection name="Appearance">
              <Slider {...lineWidth} label="Line width" min={0.5} max={4} step={0.5} format={(v) => `${v}px`} />
              <Switch {...legend} label="Legend" />
              <TextInput {...title} label="Title" placeholder="train/loss" mono />
            </SettingsSection>
            <SettingsAction label="Reset all settings" icon="fa-rotate-left" tone="danger" onClick={() => {}} />
          </>
        ),
        expressions: null,
      }}
    />
  );
}

function SingleTabPanel() {
  const cols = useDemoBound(4, 4, false);
  return (
    <SettingsTabs
      tabs={{
        display: (
          <SettingsSection name="Layout">
            <Stepper {...cols} label="Columns" min={1} max={12} />
          </SettingsSection>
        ),
      }}
    />
  );
}

function HeaderDemo() {
  const [sync, setSync] = useState(true);
  const [log, setLog] = useState(false);
  return (
    <div className="rounded-lg border border-border bg-bg-elevated p-3">
      <CardHeader
        title="train/loss"
        subtitle="4 runs"
        onSettings={() => {}}
        onDownload={() => {}}
        onRemove={() => {}}
        cardActions={
          <>
            <HeaderLabel title="Current step">step 1,200</HeaderLabel>
            <HeaderBadge tone="accent" title="Smoothing">EMA 0.6</HeaderBadge>
            <HeaderBadge tone="warn" title="As-of join">as-of</HeaderBadge>
            <HeaderBadge>3 hidden</HeaderBadge>
            <HeaderToggle icon="fa-link" label="Sync with section" pressed={sync} onToggle={() => setSync((v) => !v)} />
            <HeaderToggle icon="fa-chart-line" label="Log scale" pressed={log} onToggle={() => setLog((v) => !v)} />
            <HeaderToggle icon="fa-lock" label="Disabled toggle" pressed={false} onToggle={() => {}} disabled />
          </>
        }
      />
      <div className="h-16 rounded bg-bg" />
    </div>
  );
}

export default function UiGalleryPage() {
  const [touch, setTouch] = useState(false);
  // On <html>, so popovers (portaled to <body>) follow the toggle too.
  useEffect(() => {
    document.documentElement.classList.toggle("force-touch", touch);
    return () => document.documentElement.classList.remove("force-touch");
  }, [touch]);
  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Settings palette</h1>
          <p className="text-sm text-fg-muted">Every control, in each state. ↺ appears only while a value is overridden.</p>
        </div>
        <div className="w-44">
          <Switch value={touch} onChange={setTouch} label="Touch" description="Force the touch: variant" />
        </div>
      </div>

      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-fg-muted">Panels</h2>
      <div className="mb-3 grid items-start gap-3 md:grid-cols-2">
        <div className="rounded-lg border border-border bg-bg-elevated p-3">
          <div className="mb-2 text-[10px] uppercase tracking-wide text-fg-subtle">Three tabs (Expressions empty → hidden)</div>
          <FullPanel />
        </div>
        <div className="rounded-lg border border-border bg-bg-elevated p-3">
          <div className="mb-2 text-[10px] uppercase tracking-wide text-fg-subtle">One tab → no bar</div>
          <SingleTabPanel />
        </div>
      </div>
      <div className="mb-6">
        <div className="mb-2 text-[10px] uppercase tracking-wide text-fg-subtle">Header controls</div>
        <HeaderDemo />
      </div>

      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-fg-muted">Controls</h2>
      <div className="flex flex-col gap-3">
        <Demo
          name="Switch"
          builtin={false}
          override={true}
          error="Needs a y metric"
          render={(b, error) => <Switch {...b} error={error} label="Log scale" description="Logarithmic y axis." />}
        />
        <Demo
          name="Select"
          builtin="linear"
          override="step"
          error="Unknown mode"
          render={(b, error) => (
            <Select
              {...b}
              error={error}
              label="Interpolation"
              info="How gaps between logged points are drawn."
              options={[
                { value: "linear", label: "Linear" },
                { value: "step", label: "Step" },
                { value: "none", label: "None" },
              ]}
            />
          )}
        />
        <Demo
          name="Segmented"
          builtin="line"
          override="bar"
          error="Not available for this data"
          render={(b, error) => (
            <>
              <Segmented
                {...b}
                error={error}
                label="Chart"
                iconOnly
                options={[
                  { value: "line", label: "Line", icon: "fa-chart-line" },
                  { value: "bar", label: "Bar", icon: "fa-chart-column" },
                  { value: "area", label: "Area", icon: "fa-chart-area" },
                ]}
              />
              <Segmented
                {...b}
                layout="stacked"
                label="Chart (stacked, labels)"
                options={[
                  { value: "line", label: "Line" },
                  { value: "bar", label: "Bar" },
                  { value: "area", label: "Area" },
                ]}
              />
            </>
          )}
        />
        <Demo
          name="Slider"
          builtin={0.5}
          override={0.8}
          error="Too opaque"
          render={(b, error) => <Slider {...b} error={error} label="Opacity" min={0} max={1} step={0.05} format={(v) => v.toFixed(2)} />}
        />
        <Demo
          name="SliderInput"
          builtin={0}
          override={0.6}
          error="Must be below 1"
          render={(b, error) => (
            <SliderInput {...b} error={error} label="Smoothing" description="EMA weight." min={0} max={0.99} step={0.01} />
          )}
        />
        <Demo
          name="NumberInput"
          note="Empty = auto (null). Type junk to see the parse error; ↑/↓ step."
          builtin={null as number | null}
          override={500}
          error="Must be positive"
          render={(b, error) => <NumberInput {...b} error={error} label="Max points" min={1} integer placeholder="auto" />}
        />
        <Demo
          name="Stepper"
          builtin={3}
          override={6}
          error="At most 12"
          render={(b, error) => <Stepper {...b} error={error} label="Columns" min={1} max={12} />}
        />
        <Demo
          name="RangeInput"
          builtin={{ min: null, max: null, log: false } as RangeValue}
          override={{ min: 0.01, max: 10, log: true }}
          error="Outside the data"
          render={(b, error) => <RangeInput {...b} error={error} label="Y range" autoMin="0.02" autoMax="4.3" />}
        />
        <Demo
          name="TextInput"
          note="The placeholder shows the automatic value."
          builtin=""
          override="{run} · {metric}"
          error="Unknown field {foo}"
          render={(b, error) => <TextInput {...b} error={error} label="Legend template" placeholder="{run}" mono />}
        />
        <Demo
          name="ColormapSelect"
          builtin={"turbo" as Colormap}
          override={"viridis" as Colormap}
          error="Not for diverging data"
          render={(b, error) => <ColormapSelect {...b} error={error} label="Colormap" />}
        />
        <Demo
          name="CheckList"
          builtin={RUNS.map((r) => r.key)}
          override={["r1", "r3"]}
          error="Pick at least one run"
          render={(b, error) => <CheckList {...b} error={error} label="Runs" items={RUNS} />}
        />
        <Demo
          name="FieldPicker"
          builtin={null as string | null}
          override="p:lr"
          error="Field not logged by every run"
          render={(b, error) => <FieldPicker {...b} error={error} label="X axis" options={FIELDS} placeholder="Step" clearable />}
        />
        <Demo
          name="FieldMultiPicker"
          note="The .* toggle searches by regex and offers Add all."
          builtin={["m:train/loss"]}
          override={["m:train/loss", "m:val/loss", "m:gone"]}
          error="Too many series"
          render={(b, error) => <FieldMultiPicker {...b} error={error} label="Y metrics" options={FIELDS} />}
        />
        <Demo
          name="SettingsAction"
          builtin={0}
          override={0}
          error=""
          render={(b) => (
            <>
              <SettingsAction label="Edit expressions…" icon="fa-square-root-variable" onClick={() => {}} disabled={b.disabled} />
              <SettingsAction label="Reset all" icon="fa-rotate-left" tone="danger" onClick={() => {}} disabled={b.disabled} description="Back to the section defaults." />
            </>
          )}
        />
      </div>
    </div>
  );
}
