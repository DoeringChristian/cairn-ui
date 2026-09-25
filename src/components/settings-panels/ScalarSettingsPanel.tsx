import { useEffect, useRef, useState, type ReactNode } from "react";
import type { SetOptions, SettingsController } from "../../lib/card-settings";
import {
  FieldMultiPicker,
  FieldPicker,
  NumberInput,
  RangeInput,
  Segmented,
  Select,
  SettingRow,
  SettingsAction,
  SettingsSection,
  SettingsTabs,
  SliderInput,
  Stepper,
  Switch,
  TextInput,
  type Bound,
  type FieldOption,
} from "../settings/palette";
import type {
  DerivedSeries,
  LineDash,
  ScalarSettings,
  SeriesStyle,
} from "../cards-settings/scalar";
import { SMOOTHING_KINDS, formatSmoothing, type SmoothingKind } from "../../lib/plot-utils/smooth";
import type { AggKind, BandKind } from "../../lib/plot-utils/aggregate";
import type { StackMode } from "../../lib/plot-utils/stack";
import { compileSeriesExpr, compileTemplate, metricRef, type Compiled } from "../../charts/scalar-data";

/** What the card knows at runtime; absent in the defaults editor. */
export interface ScalarPanelCtx {
  /** Scalar metrics the card's runs log (their names). */
  metricNames: string[];
  /** The metrics the card draws (names; every run draws each). */
  chosen: string[];
  onChosenChange: (names: string[]) => void;
  paramKeys: string[];
  multipleRuns: boolean;
  /** The drawn lines, for per-series styles. */
  lines: Array<{ key: string; label: string; color: string }>;
}

interface Props {
  ctl: SettingsController<ScalarSettings>;
  ctx?: ScalarPanelCtx;
  mode: "card" | "defaults";
}

type Ctl = SettingsController<ScalarSettings>;

function bind<K extends keyof ScalarSettings & string>(ctl: Ctl, k: K, opts?: SetOptions): Bound<ScalarSettings[K]> {
  return {
    value: ctl.value[k],
    onChange: (v) => ctl.set({ [k]: v } as Partial<ScalarSettings>, opts),
    overridden: ctl.isOverridden(k),
    onReset: () => ctl.reset(k),
    disabled: ctl.readOnly,
  };
}

/** One field of an object-valued setting (`legend.show`); ↺ resets the whole object. */
function bindField<K extends "legend" | "tooltip" | "axisTitles", F extends keyof ScalarSettings[K] & string>(
  ctl: Ctl,
  k: K,
  f: F,
  opts?: SetOptions,
): Bound<ScalarSettings[K][F]> {
  const obj = ctl.value[k];
  return {
    value: obj[f],
    onChange: (v) => ctl.set({ [k]: { ...obj, [f]: v } } as Partial<ScalarSettings>, opts),
    overridden: ctl.isOverridden(k),
    onReset: () => ctl.reset(k),
    disabled: ctl.readOnly,
  };
}

const AXIS_OPTIONS: FieldOption[] = [
  { key: "step", kind: "expr", label: "Step" },
  { key: "wall_time", kind: "expr", label: "Wall time" },
  { key: "relative_time", kind: "expr", label: "Relative time (s)" },
];

/** The source with its error span underlined (an empty span at the end shows a caret). */
function ErrorSpan({ src, span }: { src: string; span: { start: number; end: number } }) {
  const start = Math.min(span.start, src.length);
  const end = Math.max(start, Math.min(span.end, src.length));
  return (
    <code className="mono mt-1 block whitespace-pre-wrap break-all rounded bg-bg-hover px-1.5 py-0.5 text-[11px] text-fg-muted">
      {src.slice(0, start)}
      <span className="rounded-sm bg-status-failed/20 text-status-failed underline decoration-wavy">
        {end > start ? src.slice(start, end) : "▁"}
      </span>
      {src.slice(end)}
    </code>
  );
}

/**
 * A text setting checked as it is typed: the draft shows its parse / type
 * error with the offending span, and is saved once it compiles and typing
 * pauses (an empty template is valid).
 */
function CheckedText({
  bound,
  label,
  compile,
  placeholder,
  description,
}: {
  bound: Bound<string>;
  label: ReactNode;
  compile: (src: string) => Compiled<unknown>;
  placeholder?: string;
  description?: ReactNode;
}) {
  const { value, onChange, overridden, onReset, disabled } = bound;
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const error = compile(draft).error;
  // Save a valid draft once typing pauses (not every valid prefix: `s`, `st`, …).
  const commit = useRef(onChange);
  commit.current = onChange;
  useEffect(() => {
    if (draft === value || compile(draft).error) return;
    const t = setTimeout(() => commit.current(draft), 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, value]);
  return (
    <TextInput
      label={label}
      value={draft}
      mono
      placeholder={placeholder}
      disabled={disabled}
      overridden={overridden}
      onReset={onReset}
      error={error?.message ?? null}
      description={error ? <ErrorSpan src={draft} span={error.span} /> : description}
      onChange={setDraft}
    />
  );
}

/** Series expressions (x, derived): empty is not a series. */
const compileExpr = (src: string) =>
  src.trim() ? compileSeriesExpr(src) : { value: null, error: { message: "Required", span: { start: 0, end: 0 } } };

const DASH_OPTIONS = [
  { value: "solid" as const, label: "Solid" },
  { value: "dashed" as const, label: "Dashed" },
  { value: "dotted" as const, label: "Dotted" },
];

/** Colour, width and dash of one line. */
function StyleControls({
  style,
  fallbackColor,
  onChange,
  disabled,
}: {
  style: SeriesStyle;
  fallbackColor: string;
  onChange: (next: SeriesStyle) => void;
  disabled?: boolean;
}) {
  return (
    <span className="flex flex-wrap items-center gap-2">
      <input
        type="color"
        aria-label="Colour"
        value={style.color ?? toHex(fallbackColor)}
        disabled={disabled}
        onChange={(e) => onChange({ ...style, color: e.target.value })}
        className="h-7 w-9 shrink-0 cursor-pointer rounded border border-border bg-bg-elevated p-0.5 disabled:cursor-not-allowed touch:h-10"
      />
      <Stepper
        value={style.width ?? 1.5}
        onChange={(width) => onChange({ ...style, width })}
        min={0.5}
        max={6}
        step={0.5}
        integer={false}
        disabled={disabled}
      />
      <Segmented<LineDash>
        value={style.dash ?? "solid"}
        onChange={(dash) => onChange({ ...style, dash })}
        options={DASH_OPTIONS}
        disabled={disabled}
      />
    </span>
  );
}

/** `<input type=color>` needs #rrggbb. */
function toHex(c: string): string {
  return /^#[0-9a-f]{6}$/i.test(c) ? c : "#888888";
}

function DerivedRow({
  d,
  index,
  onChange,
  onRemove,
  disabled,
}: {
  d: DerivedSeries;
  index: number;
  onChange: (next: DerivedSeries) => void;
  onRemove: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="border-b border-border-subtle py-1 last:border-b-0">
      <CheckedText
        label={`Series ${index + 1}`}
        bound={{ value: d.src, onChange: (src) => onChange({ ...d, src }), disabled }}
        compile={compileExpr}
        placeholder="loss / step"
      />
      <TextInput
        label="Label"
        value={d.label ?? ""}
        placeholder={d.src || "the expression"}
        onChange={(label) => onChange({ ...d, label: label || undefined })}
        disabled={disabled}
      />
      <SettingRow label="Style" layout="stacked" disabled={disabled}>
        <StyleControls
          style={d.style ?? {}}
          fallbackColor="#888888"
          onChange={(style) => onChange({ ...d, style })}
          disabled={disabled}
        />
      </SettingRow>
      <SettingsAction label="Remove" icon="fa-trash" tone="danger" onClick={onRemove} disabled={disabled} />
    </div>
  );
}

/**
 * The scalar card's settings: Data · Grouping · Display · Expressions. In
 * `defaults` mode (workspace / section defaults) only the cascading keys show:
 * no series, ranges, titles, per-series styles or derived series.
 */
export default function ScalarSettingsPanel({ ctl, ctx, mode }: Props) {
  const s = ctl.value;
  const card = mode === "card";
  const ro = ctl.readOnly;
  const kind = SMOOTHING_KINDS[s.smoothingKind];

  const metricOptions: FieldOption[] = (ctx?.metricNames ?? []).map((n) => ({ key: n, kind: "metric", label: n }));
  const xOptions: FieldOption[] = [
    ...AXIS_OPTIONS,
    ...(ctx?.metricNames ?? []).map((n): FieldOption => ({ key: metricRef(n), kind: "metric", label: n })),
  ];

  const data = (
    <>
      {card && ctx && (
        <SettingsSection name="Series">
          <FieldMultiPicker
            label="Metrics"
            value={ctx.chosen}
            onChange={ctx.onChosenChange}
            options={metricOptions}
            addLabel="Add metric"
            description={ctx.multipleRuns ? "Each metric draws one line per run." : undefined}
            disabled={ro}
          />
        </SettingsSection>
      )}
      <SettingsSection name="Axes">
        <FieldPicker
          {...bind(ctl, "x")}
          value={s.x}
          onChange={(v) => ctl.set({ x: v ?? "step" })}
          label="X axis"
          options={xOptions}
          placeholder="Step"
          description="Any expression works too (Expressions tab)."
        />
        {card ? (
          <>
            <RangeInput
              label="X range"
              value={{ min: s.viewport.xMin ?? s.xRange[0], max: s.viewport.xMax ?? s.xRange[1], log: s.xScale === "log" }}
              onChange={(r) =>
                ctl.set({
                  xRange: [r.min, r.max],
                  xScale: r.log ? "log" : "linear",
                  viewport: { ...s.viewport, xMin: null, xMax: null },
                })
              }
              overridden={ctl.isOverridden("xRange") || ctl.isOverridden("xScale")}
              onReset={() => {
                ctl.reset("xRange");
                ctl.reset("xScale");
              }}
              disabled={ro}
            />
            <RangeInput
              label="Y range"
              value={{ min: s.viewport.yMin ?? s.yRange[0], max: s.viewport.yMax ?? s.yRange[1], log: s.yScale === "log" }}
              onChange={(r) =>
                ctl.set({
                  yRange: [r.min, r.max],
                  yScale: r.log ? "log" : "linear",
                  viewport: { ...s.viewport, yMin: null, yMax: null },
                })
              }
              overridden={ctl.isOverridden("yRange") || ctl.isOverridden("yScale")}
              onReset={() => {
                ctl.reset("yRange");
                ctl.reset("yScale");
              }}
              disabled={ro}
            />
          </>
        ) : (
          <>
            <Switch
              {...bind(ctl, "xScale")}
              value={s.xScale === "log"}
              onChange={(v) => ctl.set({ xScale: v ? "log" : "linear" })}
              label="Log x"
            />
            <Switch
              {...bind(ctl, "yScale")}
              value={s.yScale === "log"}
              onChange={(v) => ctl.set({ yScale: v ? "log" : "linear" })}
              label="Log y"
            />
          </>
        )}
      </SettingsSection>
      <SettingsSection name="Smoothing">
        <Select<SmoothingKind>
          {...bind(ctl, "smoothingKind")}
          // Values don't carry across kinds (a 0.6 EMA weight is not a
          // 0.6-point window); keep "off" off, otherwise start at the kind's default.
          onChange={(k) =>
            ctl.set({ smoothingKind: k, smoothing: s.smoothing > 0 ? SMOOTHING_KINDS[k].defaultValue : 0 })
          }
          label="Kind"
          options={(Object.keys(SMOOTHING_KINDS) as SmoothingKind[]).map((k) => ({
            value: k,
            label: SMOOTHING_KINDS[k].label,
          }))}
        />
        <SliderInput
          {...bind(ctl, "smoothing", { mergeKey: "smoothing" })}
          label={kind.short}
          min={kind.min}
          max={kind.max}
          step={kind.step}
          description={`${kind.description}; 0 is off (now ${formatSmoothing(s.smoothingKind, s.smoothing)})`}
        />
      </SettingsSection>
      <SettingsSection name="Outliers">
        <SliderInput
          {...bind(ctl, "outlierPct", { mergeKey: "outlierPct" })}
          value={s.outlierPct[0]}
          onChange={(v) => ctl.set({ outlierPct: [v, s.outlierPct[1]] }, { mergeKey: "outlierPct" })}
          label="Low percentile"
          min={0}
          max={100}
          step={0.5}
        />
        <SliderInput
          {...bind(ctl, "outlierPct", { mergeKey: "outlierPct" })}
          value={s.outlierPct[1]}
          onChange={(v) => ctl.set({ outlierPct: [s.outlierPct[0], v] }, { mergeKey: "outlierPct" })}
          label="High percentile"
          min={0}
          max={100}
          step={0.5}
          description="[0, 100] keeps every point."
        />
      </SettingsSection>
      <SettingsSection name="Layout">
        <NumberInput
          {...bind(ctl, "maxRuns")}
          label="Max runs"
          min={1}
          integer
          placeholder="all"
          description="Draw at most this many runs (pinned runs first)."
        />
      </SettingsSection>
    </>
  );

  const showGrouping = !card || ctx?.multipleRuns;
  const paramKeys = ctx?.paramKeys ?? [];
  const grouping = showGrouping && (
    <>
      <Select<"none" | "group" | "job_type" | "param">
        {...bind(ctl, "groupBy")}
        value={s.groupBy?.source ?? "none"}
        onChange={(v) =>
          ctl.set({
            groupBy: v === "none" ? null : { source: v, key: s.groupBy?.key || (paramKeys[0] ?? "") },
          })
        }
        label="Group runs by"
        options={[
          { value: "none", label: "None" },
          { value: "group", label: "Group" },
          { value: "job_type", label: "Job type" },
          { value: "param", label: "Param", disabled: card && paramKeys.length === 0 },
        ]}
        description="Runs sharing a value draw as one line with a band; runs without one stay single lines."
      />
      {s.groupBy?.source === "param" && (
        <FieldPicker
          {...bind(ctl, "groupBy")}
          value={s.groupBy.key || null}
          onChange={(key) => ctl.set({ groupBy: { source: "param", key: key ?? "" } })}
          label="Param"
          options={paramKeys.map((k) => ({ key: k, kind: "param" as const, label: k }))}
        />
      )}
      {s.groupBy && (
        <>
          <Segmented<AggKind>
            {...bind(ctl, "agg")}
            label="Line"
            options={[
              { value: "mean", label: "Mean" },
              { value: "median", label: "Median" },
              { value: "min", label: "Min" },
              { value: "max", label: "Max" },
            ]}
          />
          <Select<BandKind>
            {...bind(ctl, "band")}
            label="Band"
            options={[
              { value: "std", label: "± std" },
              { value: "sem", label: "± std. error" },
              { value: "minmax", label: "Min – max" },
            ]}
          />
          <Switch {...bind(ctl, "hideMembers")} label="Hide member runs" />
        </>
      )}
      <Switch
        {...bind(ctl, "latestPerGroup")}
        label="Latest run per group"
        description="Keep only the newest run of each group."
      />
    </>
  );

  const display = (
    <>
      <SettingsSection name="Appearance">
        <Select
          {...bind(ctl, "lineType")}
          label="Line type"
          options={[
            { value: "linear" as const, label: "Linear" },
            { value: "monotone" as const, label: "Monotone (smooth)" },
            { value: "step" as const, label: "Step" },
            { value: "stepBefore" as const, label: "Step before" },
            { value: "stepAfter" as const, label: "Step after" },
          ]}
        />
        <Segmented<StackMode>
          {...bind(ctl, "stack")}
          label="Stack"
          options={[
            { value: "none", label: "None" },
            { value: "stacked", label: "Stacked" },
            { value: "percent", label: "100 %" },
          ]}
        />
        <Switch
          {...bind(ctl, "showOriginal")}
          label="Show original"
          description="The faded raw line under a smoothed one."
        />
        <Switch
          {...bind(ctl, "fullFidelity")}
          label="Full fidelity"
          description="Min/max per pixel, recomputed on zoom, drawn as a band."
        />
        {card && (
          <>
            <TextInput {...bindField(ctl, "axisTitles", "x")} label="X axis title" placeholder="none" />
            <TextInput {...bindField(ctl, "axisTitles", "y")} label="Y axis title" placeholder="none" />
          </>
        )}
      </SettingsSection>
      <SettingsSection name="Overlays">
        <Switch {...bindField(ctl, "legend", "show")} label="Legend" />
        <Segmented
          {...bindField(ctl, "legend", "position")}
          label="Legend position"
          options={[
            { value: "bottom" as const, label: "Bottom" },
            { value: "top" as const, label: "Top" },
            { value: "right" as const, label: "Right" },
          ]}
        />
        <CheckedText
          label="Legend template"
          bound={bindField(ctl, "legend", "template")}
          compile={compileTemplate}
          placeholder="${run.name} lr=${config.lr}"
          description="Per run; empty is the automatic label."
        />
        <CheckedText
          label="Tooltip template"
          bound={bindField(ctl, "tooltip", "template")}
          compile={compileTemplate}
          placeholder="${run.name}"
        />
        <Switch {...bindField(ctl, "tooltip", "showWallTime")} label="Tooltip: wall time" />
      </SettingsSection>
      {card && ctx && ctx.lines.length > 0 && (
        <SettingsSection name="Series">
          {ctx.lines.map((l) => {
            const own = s.styles[l.key];
            const setStyle = (next: SeriesStyle | null) => {
              const styles = { ...s.styles };
              if (next) styles[l.key] = next;
              else delete styles[l.key];
              ctl.set({ styles }, { mergeKey: `style:${l.key}` });
            };
            return (
              <SettingRow
                key={l.key}
                label={<span className="mono text-xs">{l.label}</span>}
                layout="stacked"
                overridden={own != null}
                onReset={() => setStyle(null)}
                disabled={ro}
              >
                <StyleControls style={own ?? {}} fallbackColor={l.color} onChange={setStyle} disabled={ro} />
              </SettingRow>
            );
          })}
        </SettingsSection>
      )}
    </>
  );

  const derived = s.derived;
  const setDerived = (next: DerivedSeries[]) => ctl.set({ derived: next }, { mergeKey: "derived" });
  const expressions = (
    <>
      <CheckedText
        label="X expression"
        bound={bind(ctl, "x")}
        compile={compileExpr}
        placeholder="step"
        description={
          <>
            Over each line&apos;s steps: <code className="mono">step * 32</code>,{" "}
            <code className="mono">epoch</code>, <code className="mono">relative_time / 60</code>.
          </>
        }
      />
      {card && (
        <>
          {derived.map((d, i) => (
            <DerivedRow
              key={i}
              d={d}
              index={i}
              disabled={ro}
              onChange={(next) => setDerived(derived.map((x, j) => (j === i ? next : x)))}
              onRemove={() => setDerived(derived.filter((_, j) => j !== i))}
            />
          ))}
          <SettingsAction
            label="Add derived series"
            icon="fa-plus"
            disabled={ro}
            onClick={() => setDerived([...derived, { src: ctx?.chosen[0] ? `${metricRef(ctx.chosen[0])} * 1` : "step" }])}
            description="Drawn for every run; series of different steps join as of each step."
          />
        </>
      )}
    </>
  );

  return <SettingsTabs tabs={{ data, grouping, display, expressions }} />;
}
