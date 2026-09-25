import type { SettingsController } from "../../lib/card-settings";
import type { AudioSettings } from "../cards-settings/audio";
import type { SteppedMediaPanelCtx } from "../media/SteppedMediaCard";
import { SettingsSection, Switch } from "../settings/palette";
import { LayoutSection, SliderSection, bind, type PanelSurface } from "./media-panel-kit";

/** Audio is a simple card: its sections without tabs. */
export default function AudioSettingsPanel({
  ctl,
  ctx,
  mode,
}: {
  ctl: SettingsController<AudioSettings>;
  ctx?: SteppedMediaPanelCtx;
  mode: PanelSurface;
}) {
  return (
    <>
      <SliderSection ctl={ctl} ctx={ctx} />
      <LayoutSection ctl={ctl} modes ctx={ctx} mode={mode} paneKeys={ctx?.paneKeys} />
      <SettingsSection name="Playback">
        <Switch {...bind(ctl, "autoplay")} label="Autoplay" description="Play the clip automatically when the card loads" />
      </SettingsSection>
    </>
  );
}
