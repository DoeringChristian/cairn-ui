import type { SettingsController } from "../../lib/card-settings";
import type { VolumeSettings } from "../cards-settings/volume";
import { SettingsTabs } from "../settings/palette";
import { LayoutSection, SliderSection, type MediaPanelCtx, type PanelSurface } from "./media-panel-kit";

export default function VolumeSettingsPanel({
  ctl,
  ctx,
  mode,
}: {
  ctl: SettingsController<VolumeSettings>;
  ctx?: MediaPanelCtx;
  mode: PanelSurface;
}) {
  return (
    <SettingsTabs
      tabs={{
        data: <SliderSection ctl={ctl} ctx={ctx} />,
        display: <LayoutSection ctl={ctl} ctx={ctx} mode={mode} />,
      }}
    />
  );
}
