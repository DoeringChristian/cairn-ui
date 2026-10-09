import type { SettingsController } from "../../lib/card-settings";
import type { VolumeSettings } from "../cards-settings/volume";
import type { SteppedMediaPanelCtx } from "../media/SteppedMediaCard";
import { SettingsTabs } from "../settings/palette";
import { LayoutSection, SliderSection, type PanelSurface } from "./media-panel-kit";

export default function VolumeSettingsPanel({
  ctl,
  ctx,
  mode,
}: {
  ctl: SettingsController<VolumeSettings>;
  ctx?: SteppedMediaPanelCtx;
  mode: PanelSurface;
}) {
  return (
    <SettingsTabs
      tabs={{
        values: <SliderSection ctl={ctl} ctx={ctx} />,
        display: <LayoutSection ctl={ctl} modes ctx={ctx} mode={mode} paneKeys={ctx?.paneKeys} />,
      }}
    />
  );
}
