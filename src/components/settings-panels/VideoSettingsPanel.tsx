import type { SettingsController } from "../../lib/card-settings";
import type { VideoSettings } from "../cards-settings/video";
import type { SteppedMediaPanelCtx } from "../media/SteppedMediaCard";
import { Select, SettingsSection, SettingsTabs, Switch } from "../settings/palette";
import { LayoutSection, SliderSection, bind, type PanelSurface } from "./media-panel-kit";

const PRELOAD_OPTIONS = [
  { value: "metadata", label: "Metadata" },
  { value: "auto", label: "Auto (full)" },
  { value: "none", label: "None" },
] as const;

export default function VideoSettingsPanel({
  ctl,
  ctx,
  mode,
}: {
  ctl: SettingsController<VideoSettings>;
  ctx?: SteppedMediaPanelCtx;
  mode: PanelSurface;
}) {
  const data = <SliderSection ctl={ctl} ctx={ctx} />;
  const display = (
    <>
      <LayoutSection ctl={ctl} modes ctx={ctx} mode={mode} paneKeys={ctx?.paneKeys} />
      <SettingsSection name="Playback">
        <Switch
          {...bind(ctl, "syncPlayback")}
          label="Synced playback"
          description="Several videos play, pause and seek together on one transport bar."
        />
        <Switch {...bind(ctl, "autoplay")} label="Autoplay" />
        <Switch {...bind(ctl, "loop")} label="Loop" />
        <Switch {...bind(ctl, "muted")} label="Muted" />
        <Select<VideoSettings["preload"]> {...bind(ctl, "preload")} options={PRELOAD_OPTIONS} label="Preload" />
      </SettingsSection>
    </>
  );
  return <SettingsTabs tabs={{ data, display }} />;
}
