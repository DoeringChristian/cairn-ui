import type { SettingsController } from "../../lib/card-settings";
import { classColor, type OverlaySummary } from "../../lib/overlays";
import type { ImageCardSettings } from "../cards-settings/image";
import {
  CheckList,
  SettingsSection,
  SettingsTabs,
  Slider,
  Switch,
} from "../settings/palette";
import {
  AppearanceSection,
  CompareSection,
  LayoutSection,
  SliderSection,
  bind,
  type MediaPanelCtx,
  type PanelSurface,
  type ReferencePanelCtx,
} from "./media-panel-kit";

export interface ImagePanelCtx extends MediaPanelCtx, ReferencePanelCtx {
  /** Overlays the shown images carry; the Overlays section lists only what exists. */
  overlays: OverlaySummary;
  paneKeys: readonly string[];
}

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
  const overlays = ctx?.overlays;
  // In the defaults editor every overlay setting shows; on a card only what its images carry.
  const hasBoxes = !card || !!overlays?.hasBoxes;
  const hasMasks = !card || !!overlays?.hasMasks;
  const hasScores = !card || !!overlays?.hasScores;
  const classes = card ? (overlays?.classes ?? []) : [];

  const data = (
    <>
      <SliderSection ctl={ctl} ctx={ctx} />
      {card && <CompareSection ctl={ctl} ctx={ctx} objectType="image" noun="image" />}
    </>
  );

  const showOverlays = hasBoxes || hasMasks;
  const display = (
    <>
      <LayoutSection ctl={ctl} modes ctx={ctx} mode={mode} paneKeys={ctx?.paneKeys}>
        <Switch {...bind(ctl, "showLabels")} label="Show pane labels" />
      </LayoutSection>
      <AppearanceSection ctl={ctl} />
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

  return <SettingsTabs tabs={{ values: data, display }} />;
}
