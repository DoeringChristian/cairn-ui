import { safeJsonParse } from "../lib/format";
import { pointCaption } from "../lib/caption";
import { hashSource } from "../lib/viewers/source";
import SteppedMediaCard, { type SteppedMediaCardProps } from "./media/SteppedMediaCard";
import type { AudioSettings } from "./cards-settings/audio";
import AudioSettingsPanel from "./settings-panels/AudioSettingsPanel";
import AudioViewer from "./viewers/AudioViewer";

export default function AudioPlayerCard(props: SteppedMediaCardProps) {
  return (
    <SteppedMediaCard<AudioSettings>
      {...props}
      captionOverlay
      kind="audio"
      noun="audio"
      defaultMime="audio/wav"
      nearest
      settingsPanel={(ctl, ctx) => <AudioSettingsPanel ctl={ctl} ctx={ctx} mode="card" />}
      renderArtifact={({ point, hash, settings }) => (
        <AudioViewer
          source={hashSource(hash, {
            mime: point.artifact_mime,
            size: point.artifact_size,
            objectType: "audio",
            meta: safeJsonParse<Record<string, unknown>>(point.artifact_metadata),
          })}
          caption={pointCaption(point.metadata)}
          autoplay={settings.autoplay}
        />
      )}
    />
  );
}
