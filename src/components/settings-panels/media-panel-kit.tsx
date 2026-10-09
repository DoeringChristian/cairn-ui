/**
 * Pieces every media settings panel shares: binding a palette control to a
 * settings key, the slider section (key + follow the section) and the pane
 * layout section (mode, columns, max runs, compare slots), and for zoomable
 * split panes (images, videos) the reference and rendering sections.
 */

import type { ReactNode } from "react";
import type { SettingsController } from "../../lib/card-settings";
import { clampSlots, normalizeSlots, type Columns, type PanelMode } from "../../lib/media/panel-layout";
import {
  primaryIndex,
  relinkSlots,
  type GalleryContent,
  type IndexMode,
  type LinkMode,
  type MediaAxis,
} from "../../lib/media/media-plan";
import { STEP_KEY } from "../../lib/media/slider-key";
import type { PixelRendering } from "../../lib/media/split-geometry";
import type { MediaColumnsSettings, MediaCompareSettings, MediaLayoutSettings, MediaSliderSettings } from "../cards-settings/media";
import { ExternalBaselinePicker } from "../card-kit/ExternalBaselinePicker";
import {
  FieldPicker,
  Segmented,
  Select,
  SettingRow,
  SettingsSection,
  RangeInput,
  Slider,
  Stepper,
  Switch,
  type Bound,
  type FieldOption,
} from "../settings/palette";

/** A palette control's `Bound` props for one settings key. */
export function bind<T extends object, K extends keyof T & string>(
  ctl: SettingsController<T>,
  key: K,
  opts?: { mergeKey?: boolean },
): Bound<T[K]> {
  return {
    value: ctl.value[key],
    onChange: (v) => ctl.set({ [key]: v } as unknown as Partial<T>, opts?.mergeKey ? { mergeKey: key } : undefined),
    overridden: ctl.isOverridden(key),
    onReset: () => ctl.reset(key),
    // Read-only viewers explore too (session layer); only locked defaults disable.
    disabled: ctl.locked,
  };
}

/** Runtime info the media panels use (absent in the defaults editor). */
export interface MediaPanelCtx {
  /** Scalar metrics of the card's runs, offered as slider keys. */
  scalarMetrics?: readonly string[];
  /** The card holds more than one series (run); multi-pane settings show. */
  multi?: boolean;
  /** Following a section slider right now (the card's own key is then unused). */
  following?: boolean;
  /** The card's points are lists (gallery points): the Index shows. */
  lists?: boolean;
  /** Items of the widest list at the slider's value. */
  listCount?: number;
  /** The slider's value (compare slots freeze at it when a variable goes individual). */
  sliderValue?: number;
}

export type PanelSurface = "card" | "defaults";

/** The slider: its key and whether it follows the section. Values tab. */
export function SliderSection<T extends MediaSliderSettings>({
  ctl,
  ctx,
  children,
}: {
  ctl: SettingsController<T>;
  ctx?: MediaPanelCtx;
  /** More Axes settings after the slider's. */
  children?: ReactNode;
}) {
  const c = ctl as unknown as SettingsController<MediaSliderSettings>;
  const options: FieldOption[] = (ctx?.scalarMetrics ?? [])
    .filter((m) => m !== STEP_KEY)
    .map((m) => ({ key: m, kind: "metric", label: m }));
  const key = bind(c, "sliderKey");
  // The current key stays choosable even when this run doesn't log it.
  if (key.value !== STEP_KEY && !options.some((o) => o.key === key.value)) {
    options.unshift({ key: key.value, kind: "metric", label: key.value });
  }
  return (
    <SettingsSection name="Axes">
      <FieldPicker
        {...key}
        value={key.value === STEP_KEY ? null : key.value}
        onChange={(v) => key.onChange(v ?? STEP_KEY)}
        options={options}
        clearable
        placeholder="Step"
        label="Slider key"
        info="Slide over steps, or over a scalar metric such as epoch: each run shows the media it logged while the metric held the value (its last value at or before each step)."
        description={ctx?.following ? "The section's slider sets the key while this card follows it." : undefined}
      />
      <Switch
        {...bind(c, "followSection")}
        label="Follow section slider"
        description="Where the section has a media slider, it drives this card."
      />
      {ctx?.lists && <IndexControls ctl={ctl as unknown as SettingsController<MediaLayoutSettings>} />}
      {children}
    </SettingsSection>
  );
}

const INDEX_OPTIONS = [
  { value: "all", label: "All" },
  { value: "one", label: "One" },
  { value: "range", label: "Range" },
  { value: "first", label: "First N" },
] as const satisfies ReadonlyArray<{ value: IndexMode; label: string }>;

/** Which items of each logged list the card shows. Cards with lists only (the indices are the card's). */
function IndexControls({ ctl }: { ctl: SettingsController<MediaLayoutSettings> }) {
  const m = ctl.value.indexMode;
  return (
    <>
      <Segmented<IndexMode>
        {...bind(ctl, "indexMode")}
        options={INDEX_OPTIONS}
        layout="stacked"
        label="Index"
        info="Which items of each logged list to show (0-based): all of them, one (step through it with ‹ › over the media), a range, or the first N."
      />
      {m === "one" && <Stepper {...bind(ctl, "indexOne")} min={0} label="One" />}
      {m === "range" && (
        <RangeInput
          value={{ min: ctl.value.indexFrom, max: ctl.value.indexTo, log: false }}
          onChange={(r) => ctl.set({ indexFrom: Math.max(0, Math.round(r.min ?? 0)), indexTo: Math.max(0, Math.round(r.max ?? r.min ?? 0)) })}
          overridden={ctl.isOverridden("indexFrom") || ctl.isOverridden("indexTo")}
          onReset={() => { ctl.reset("indexFrom"); ctl.reset("indexTo"); }}
          disabled={ctl.locked}
          showLog={false}
          autoMin="0"
          autoMax="0"
          label="Range"
        />
      )}
      {m === "first" && <Stepper {...bind(ctl, "indexFirst")} min={1} label="First N" />}
    </>
  );
}

const MODE_OPTIONS = [
  { value: "gallery", label: "Gallery", icon: "fa-table-cells-large" },
  { value: "grid", label: "Grid", icon: "fa-table-cells" },
  { value: "compare", label: "Compare", icon: "fa-table-columns" },
] as const satisfies ReadonlyArray<{ value: PanelMode; label: string; icon: string }>;

const COLUMN_OPTIONS = [
  { value: "auto", label: "Auto" },
  ...[1, 2, 3, 4, 5, 6, 8].map((n) => ({ value: String(n), label: String(n) })),
];

const CONTENT_OPTIONS = [
  { value: "index", label: "Index" },
  { value: "step", label: "Step" },
  { value: "run", label: "Run" },
] as const satisfies ReadonlyArray<{ value: GalleryContent; label: string }>;

const AXIS_LABEL: Record<MediaAxis, string> = { step: "Step", index: "Index", run: "Run" };

const LINK_OPTIONS = [
  { value: "linked", label: "Linked" },
  { value: "individual", label: "Individual" },
] as const satisfies ReadonlyArray<{ value: LinkMode; label: string }>;

/**
 * Pane layout: mode (when the card has modes) and its options — gallery
 * columns and column content, grid axes, steps and rows, compare slots and
 * links — then the media limit and max runs. Display tab. `children` go at
 * the end of the section.
 */
export function LayoutSection<T extends MediaColumnsSettings>({
  ctl,
  modes,
  ctx,
  mode,
  paneKeys,
  children,
}: {
  ctl: SettingsController<T>;
  /** The card has gallery / grid / compare. */
  modes?: boolean;
  ctx?: MediaPanelCtx;
  mode: PanelSurface;
  /** Current panes, for the compare slot count (card mode). */
  paneKeys?: readonly string[];
  children?: ReactNode;
}) {
  const c = ctl as unknown as SettingsController<MediaColumnsSettings>;
  const m = ctl as unknown as SettingsController<MediaLayoutSettings>;
  const cols = bind(c, "columns");
  const panelMode = modes ? m.value.panelMode : "gallery";
  const showMulti = mode === "defaults" || ctx?.multi !== false || panelMode === "compare";
  // The index is a variable only for lists (every option shows in the defaults editor).
  const lists = mode === "defaults" || !!ctx?.lists;
  const axisOptions = (other: MediaAxis) =>
    (["step", "index", "run"] as const)
      .filter((a) => lists || a !== "index")
      .map((a) => ({ value: a, label: AXIS_LABEL[a], disabled: a === other }));
  const link = (key: "compareRun" | "compareStep" | "compareIndex", label: string, variable?: "step" | "index") => {
    const b = bind(m, key);
    return (
      <Segmented<LinkMode>
        {...b}
        onChange={(v) => {
          if (!variable || mode !== "card") return b.onChange(v);
          const slots = normalizeSlots(m.value.compareSlots, paneKeys ?? []);
          m.set({
            [key]: v,
            compareSlots: relinkSlots(slots, variable, v, {
              value: ctx?.sliderValue ?? 0,
              index: primaryIndex(m.value, ctx?.listCount ?? 0),
            }),
          } as Partial<MediaLayoutSettings>);
        }}
        options={LINK_OPTIONS}
        label={label}
      />
    );
  };
  return (
    <SettingsSection name="Layout">
      {modes && (
        <Segmented<PanelMode>
          {...bind(m, "panelMode")}
          options={MODE_OPTIONS}
          layout="stacked"
          label="Mode"
          info="Gallery: tiles at the slider's value (or over steps). Grid: two of step, index and run as columns and rows. Compare: 2–4 slots; run, step and index each linked or picked per slot."
        />
      )}
      {(modes ? panelMode === "gallery" : showMulti) && (
        <Select<string>
          {...cols}
          value={String(cols.value)}
          onChange={(v) => cols.onChange((v === "auto" ? "auto" : Number(v)) as Columns)}
          options={COLUMN_OPTIONS}
          label="Columns"
        />
      )}
      {modes && panelMode === "gallery" && (
        <Segmented<GalleryContent>
          {...bind(m, "galleryContent")}
          options={CONTENT_OPTIONS}
          label="Column content"
          info="What one tile is. Index: each list item at the slider's value. Step: the steps (sampled like the grid's columns), for the first selected item. Run: each run, with its selected items."
        />
      )}
      {modes && panelMode === "grid" && (
        <>
          <Select<MediaAxis>
            {...bind(m, "gridX")}
            options={axisOptions(m.value.gridY)}
            label="X-axis"
          />
          <Select<MediaAxis>
            {...bind(m, "gridY")}
            options={axisOptions(m.value.gridX)}
            label="Y-axis"
          />
          <Select<string>
            {...cols}
            value={String(cols.value)}
            onChange={(v) => cols.onChange((v === "auto" ? "auto" : Number(v)) as Columns)}
            options={COLUMN_OPTIONS}
            label="Grid columns"
            description="Steps sampled along a step X-axis."
          />
          {mode === "card" && (
            <RangeInput
              value={{ min: m.value.gridStepFrom, max: m.value.gridStepTo, log: false }}
              onChange={(r) => m.set({ gridStepFrom: r.min, gridStepTo: r.max })}
              overridden={m.isOverridden("gridStepFrom") || m.isOverridden("gridStepTo")}
              onReset={() => { m.reset("gridStepFrom"); m.reset("gridStepTo"); }}
              disabled={m.locked}
              showLog={false}
              autoMin="first"
              autoMax="last"
              label="Steps"
              description="Limits the step axis (in slider-key values)."
            />
          )}
          <Stepper {...bind(m, "gridRows")} min={1} max={500} label="Rows" />
        </>
      )}
      {modes && mode === "card" && panelMode === "compare" && (
        <Stepper
          value={m.value.compareSlots?.length || 2}
          onChange={(n) => m.set({ compareSlots: normalizeSlots(m.value.compareSlots, paneKeys ?? [], clampSlots(n)) })}
          min={2}
          max={4}
          label="Slots"
        />
      )}
      {modes && panelMode === "compare" && (
        <>
          {link("compareRun", "Run")}
          {link("compareStep", "Step", "step")}
          {lists && link("compareIndex", "Index", "index")}
        </>
      )}
      {modes && panelMode === "compare" && (
        <Select<string>
          {...cols}
          value={String(cols.value)}
          onChange={(v) => cols.onChange((v === "auto" ? "auto" : Number(v)) as Columns)}
          options={COLUMN_OPTIONS}
          label="Columns"
        />
      )}
      {modes && (
      <Segmented<"all" | "limit">
        value={m.value.limitMedia ? "limit" : "all"}
        onChange={(v) => m.set({ limitMedia: v === "limit" } as Partial<MediaLayoutSettings>)}
        overridden={m.isOverridden("limitMedia")}
        onReset={() => m.reset("limitMedia")}
        disabled={m.locked}
        options={[{ value: "all", label: "Show all" }, { value: "limit", label: "Limit" }]}
        label="Media limit"
      />
      )}
      {modes && m.value.limitMedia && <Stepper {...bind(m, "mediaLimit")} min={1} max={1000} label="Limit" description="Tiles at most." />}
      {showMulti && (
        <Stepper {...bind(c, "maxRuns")} min={0} max={50} label="Max runs" description="Show only the first N runs; 0 shows all." />
      )}
      {children}
    </SettingsSection>
  );
}

/** Runtime info the reference picker needs (a card, not the defaults editor). */
export interface ReferencePanelCtx {
  runId: string;
  metricName: string;
  /** Union of logged steps (the reference step's range). */
  globalSteps: readonly number[];
  currentStep: number;
}

/**
 * The reference every pane splits against: another tag of the card's kind,
 * resolved in each pane's own run, following the slider or pinned to a
 * step. Values tab; cards only (nothing to pick from in the defaults editor).
 */
export function CompareSection<T extends MediaCompareSettings>({
  ctl,
  ctx,
  objectType,
  noun,
}: {
  ctl: SettingsController<T>;
  ctx: ReferencePanelCtx;
  /** The `object_type` reference tags must have. */
  objectType: string;
  /** "image", "video". */
  noun: string;
}) {
  const c = ctl as unknown as SettingsController<MediaCompareSettings>;
  const s = c.value;
  const reference = s.reference;
  return (
    <SettingsSection name="Compare">
      <SettingRow
        layout="stacked"
        label="Reference tag"
        description={`Each pane splits its ${noun} against this tag from its own run.`}
      >
        {reference && (
          <div className="mb-2 flex items-center gap-1 rounded border border-accent/40 bg-accent/5 px-2 py-1 text-xs text-fg-muted">
            <span className="mono min-w-0 flex-1 truncate">{reference.name}</span>
            <button
              type="button"
              onClick={() => c.set({ reference: undefined, referenceStep: undefined })}
              className="shrink-0 text-fg-subtle hover:text-fg"
              aria-label="Remove reference"
            >
              ×
            </button>
          </div>
        )}
        <ExternalBaselinePicker
          runId={ctx.runId}
          objectType={objectType}
          currentMetricName={ctx.metricName}
          selected={reference?.name}
          onSelect={(name) => c.set({ reference: { name } })}
        />
      </SettingRow>
      {reference && (
        <Switch
          value={s.referenceStep != null}
          onChange={(pinned) => c.set({ referenceStep: pinned ? ctx.currentStep : undefined })}
          overridden={c.isOverridden("referenceStep")}
          onReset={() => c.reset("referenceStep")}
          label="Pin reference step"
          description="Off follows the slider; on keeps the reference fixed."
        />
      )}
      {reference && s.referenceStep != null && (
        <Slider
          value={s.referenceStep}
          onChange={(v) => c.set({ referenceStep: Math.round(v) }, { mergeKey: "referenceStep" })}
          label="Reference step"
          min={ctx.globalSteps[0] ?? 0}
          max={ctx.globalSteps[ctx.globalSteps.length - 1] ?? 1}
          step={1}
          format={(v) => Math.round(v).toString()}
        />
      )}
    </SettingsSection>
  );
}

const RENDERING_OPTIONS = [
  { value: "auto", label: "Auto" },
  { value: "smooth", label: "Smooth" },
  { value: "pixelated", label: "Pixelated" },
] as const satisfies ReadonlyArray<{ value: PixelRendering; label: string }>;

/** How upscaled pixels render in a zoomable pane. Display tab. */
export function AppearanceSection<T extends MediaCompareSettings>({ ctl }: { ctl: SettingsController<T> }) {
  const c = ctl as unknown as SettingsController<MediaCompareSettings>;
  return (
    <SettingsSection name="Appearance">
      <Segmented<PixelRendering>
        {...bind(c, "rendering")}
        options={RENDERING_OPTIONS}
        layout="stacked"
        label="Rendering"
        info="Auto switches to nearest-neighbour once a source pixel covers more than ~1.5 screen pixels. Smooth always interpolates; pixelated never does."
      />
    </SettingsSection>
  );
}
