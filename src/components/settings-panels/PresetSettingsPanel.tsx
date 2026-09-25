import type { SettingsController } from "../../lib/card-settings";
import type { Normalize } from "../../lib/plot-utils/preset";
import type { PresetSettings } from "../cards-settings/preset";
import { Select, SettingsSection, SettingsTabs } from "../settings/palette";
import { LayoutSection, SliderSection, bind, type MediaPanelCtx, type PanelSurface } from "./media-panel-kit";

export interface PresetPanelCtx extends MediaPanelCtx {
  /** The logged preset is a confusion matrix (curves have no cell settings). */
  confusion: boolean;
}

const NORMALIZE_OPTIONS = [
  { value: "none", label: "Counts" },
  { value: "true", label: "Normalized by true label (rows)" },
  { value: "pred", label: "Normalized by predicted label (columns)" },
] as const satisfies ReadonlyArray<{ value: Normalize; label: string }>;

export default function PresetSettingsPanel({
  ctl,
  ctx,
  mode,
}: {
  ctl: SettingsController<PresetSettings>;
  ctx?: PresetPanelCtx;
  mode: PanelSurface;
}) {
  const confusion = mode === "defaults" || !!ctx?.confusion;
  const data = <SliderSection ctl={ctl} ctx={ctx} />;
  const display = (
    <>
      {/* Curves overlay every run in one plot; only confusion matrices lay out panes. */}
      {confusion && <LayoutSection ctl={ctl} ctx={ctx} mode={mode} />}
      {confusion && (
        <SettingsSection name="Appearance">
          <Select<Normalize> {...bind(ctl, "normalize")} options={NORMALIZE_OPTIONS} label="Cells" layout="stacked" />
        </SettingsSection>
      )}
    </>
  );
  return <SettingsTabs tabs={{ data, display: confusion ? display : null }} />;
}
