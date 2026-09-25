import type { SettingsController } from "../../lib/card-settings";
import { classColor, type OverlaySummary } from "../../lib/overlays";
import type { ImageRendering } from "../image/ImagePane";
import type { ImageCardSettings } from "../cards-settings/image";
import { ExternalBaselinePicker } from "../card-kit/ExternalBaselinePicker";
import {
  CheckList,
  Segmented,
  SettingRow,
  SettingsSection,
  SettingsTabs,
  Slider,
  Switch,
} from "../settings/palette";
import { LayoutSection, SliderSection, bind, type MediaPanelCtx, type PanelSurface } from "./media-panel-kit";

export interface ImagePanelCtx extends MediaPanelCtx {
  runId: string;
  metricName: string;
  /** Union of logged steps (the reference step's range). */
  globalSteps: readonly number[];
  currentStep: number;
  /** Overlays the shown images carry; the Overlays section lists only what exists. */
  overlays: OverlaySummary;
  paneKeys: readonly string[];
}

const RENDERING_OPTIONS = [
  { value: "auto", label: "Auto" },
  { value: "smooth", label: "Smooth" },
  { value: "pixelated", label: "Pixelated" },
] as const satisfies ReadonlyArray<{ value: ImageRendering; label: string }>;

export default function ImageSettingsPanel({
  ctl,
  ctx,
  mode,
}: {
  ctl: SettingsController<ImageCardSettings>;
  ctx?: ImagePanelCtx;
  mode: PanelSurface;
}) {
  const s = ctl.value;
  const card = mode === "card" && ctx != null;
  const reference = s.reference;
  const overlays = ctx?.overlays;
  // In the defaults editor every overlay setting shows; on a card only what its images carry.
  const hasBoxes = !card || !!overlays?.hasBoxes;
  const hasMasks = !card || !!overlays?.hasMasks;
  const hasScores = !card || !!overlays?.hasScores;
  const classes = card ? (overlays?.classes ?? []) : [];

  const data = (
    <>
      <SliderSection ctl={ctl} ctx={ctx} />
      {card && (
        <SettingsSection name="Compare">
          <SettingRow
            layout="stacked"
            label="Reference tag"
            description="Each pane splits its image against this tag from its own run."
          >
            {reference && (
              <div className="mb-2 flex items-center gap-1 rounded border border-accent/40 bg-accent/5 px-2 py-1 text-xs text-fg-muted">
                <span className="mono min-w-0 flex-1 truncate">{reference.name}</span>
                <button
                  type="button"
                  onClick={() => ctl.set({ reference: undefined, referenceStep: undefined })}
                  className="shrink-0 text-fg-subtle hover:text-fg"
                  aria-label="Remove reference"
                >
                  ×
                </button>
              </div>
            )}
            <ExternalBaselinePicker
              runId={ctx.runId}
              objectType="image"
              currentMetricName={ctx.metricName}
              selected={reference?.name}
              onSelect={(name) => ctl.set({ reference: { name } })}
            />
          </SettingRow>
          {reference && (
            <Switch
              value={s.referenceStep != null}
              onChange={(pinned) => ctl.set({ referenceStep: pinned ? ctx.currentStep : undefined })}
              overridden={ctl.isOverridden("referenceStep")}
              onReset={() => ctl.reset("referenceStep")}
              label="Pin reference step"
              description="Off follows the slider; on keeps the reference fixed."
            />
          )}
          {reference && s.referenceStep != null && (
            <Slider
              value={s.referenceStep}
              onChange={(v) => ctl.set({ referenceStep: Math.round(v) }, { mergeKey: "referenceStep" })}
              label="Reference step"
              min={ctx.globalSteps[0] ?? 0}
              max={ctx.globalSteps[ctx.globalSteps.length - 1] ?? 1}
              step={1}
              format={(v) => Math.round(v).toString()}
            />
          )}
        </SettingsSection>
      )}
    </>
  );

  const showOverlays = hasBoxes || hasMasks;
  const display = (
    <>
      <LayoutSection ctl={ctl} modes ctx={ctx} mode={mode} paneKeys={ctx?.paneKeys}>
        <Switch {...bind(ctl, "showLabels")} label="Show pane labels" />
      </LayoutSection>
      <SettingsSection name="Appearance">
        <Segmented<ImageRendering>
          {...bind(ctl, "rendering")}
          options={RENDERING_OPTIONS}
          layout="stacked"
          label="Rendering"
          info="Auto switches to nearest-neighbour once a source pixel covers more than ~1.5 screen pixels. Smooth always interpolates; pixelated never does."
        />
      </SettingsSection>
      {showOverlays && (
        <SettingsSection name="Overlays">
          {hasBoxes && <Switch {...bind(ctl, "showBoxes")} label="Show boxes" />}
          {hasBoxes && hasScores && (
            <Slider
              {...bind(ctl, "minScore", { mergeKey: true })}
              label="Min box score"
              min={0}
              max={1}
              step={0.01}
              format={(v) => v.toFixed(2)}
              description="Boxes without a score always show."
            />
          )}
          {hasMasks && <Switch {...bind(ctl, "showMasks")} label="Show masks" />}
          {hasMasks && (
            <Slider
              {...bind(ctl, "maskOpacity", { mergeKey: true })}
              label="Mask opacity"
              min={0}
              max={1}
              step={0.05}
              format={(v) => `${Math.round(v * 100)}%`}
            />
          )}
          {classes.length > 0 && (
            <CheckList
              label="Classes"
              items={classes.map((c) => ({
                key: String(c.id),
                label: `${c.name} · ${c.id}`,
                color: classColor(c.id),
              }))}
              value={classes.filter((c) => !s.hiddenClasses.includes(c.id)).map((c) => String(c.id))}
              onChange={(visible) => {
                const shown = new Set(visible.map(Number));
                const present = new Set(classes.map((c) => c.id));
                // Classes hidden earlier but absent from the shown images stay hidden.
                const hidden = [
                  ...s.hiddenClasses.filter((id) => !present.has(id)),
                  ...classes.filter((c) => !shown.has(c.id)).map((c) => c.id),
                ];
                ctl.set({ hiddenClasses: [...new Set(hidden)].sort((a, b) => a - b) });
              }}
              overridden={ctl.isOverridden("hiddenClasses")}
              onReset={() => ctl.reset("hiddenClasses")}
            />
          )}
        </SettingsSection>
      )}
    </>
  );

  return <SettingsTabs tabs={{ data, display }} />;
}
