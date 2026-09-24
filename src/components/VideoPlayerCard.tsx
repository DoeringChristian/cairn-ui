import { api } from "../api/client";
import { safeJsonParse } from "../lib/format";
import { artifactFilename } from "../lib/download";
import UnsupportedArtifact from "./UnsupportedArtifact";
import SteppedMediaCard, { type MediaView, type SteppedMediaCardProps, type SteppedMediaSettings } from "./media/SteppedMediaCard";
import Toggle from "./settings/Toggle";
import Select from "./settings/Select";

/** Frames logged by the SDK carry every field; a stored file only what could be read from it. */
interface VideoMetadata {
  fps?: number;
  num_frames?: number;
  width?: number;
  height?: number;
  filename?: string;
  preview?: string;
}

/** Containers every current browser plays in a <video>. */
const PLAYABLE = new Set(["video/mp4", "video/webm", "video/ogg"]);

interface VideoSettings extends SteppedMediaSettings {
  autoplay: boolean;
  loop: boolean;
  muted: boolean;
  preload: "metadata" | "auto" | "none";
}

/**
 * Player and format line for one video artifact. The card's only pane grows
 * with the card (taller in the modal); a grid pane keeps a fixed max height.
 */
function VideoClip({ point, hash, name, settings, single, inModal }: MediaView<VideoSettings>) {
  const meta = safeJsonParse<VideoMetadata>(point.artifact_metadata);
  if (point.artifact_mime && !PLAYABLE.has(point.artifact_mime)) {
    return (
      <UnsupportedArtifact
        label={`${meta?.filename ?? point.artifact_mime} — not playable in the browser`}
        detail={`step ${point.step}`}
        previewSrc={meta?.preview}
        downloadUrl={api.artifactUrl(hash)}
        filename={meta?.filename ?? artifactFilename(name, point.step, point.artifact_mime)}
      />
    );
  }
  const video = (
    <video
      key={hash}
      controls
      autoPlay={settings.autoplay}
      loop={settings.loop}
      muted={settings.muted}
      preload={settings.preload}
      src={api.artifactUrl(hash)}
      poster={meta?.preview}
      className={`${single && inModal ? "max-h-[70vh]" : "max-h-64"} object-contain`}
    />
  );
  const facts = meta
    ? [
        meta.filename,
        meta.width && meta.height ? `${meta.width}×${meta.height}` : undefined,
        meta.num_frames ? `${meta.num_frames} frames` : undefined,
        meta.fps ? `${meta.fps} fps` : undefined,
      ].filter(Boolean)
    : [];
  const info = facts.length > 0 && (
    <div className="mono mt-2 text-xs text-fg-subtle">{facts.join(" · ")}</div>
  );
  if (single) {
    return (
      <>
        <div className="flex justify-center rounded bg-bg p-2 flex-1 min-h-0">{video}</div>
        {info}
      </>
    );
  }
  return (
    <div className="flex flex-col rounded bg-bg p-2">
      <div className="flex justify-center">{video}</div>
      {info}
    </div>
  );
}

export default function VideoPlayerCard(props: SteppedMediaCardProps) {
  return (
    <SteppedMediaCard<VideoSettings>
      {...props}
      kind="video"
      noun="video"
      defaultMime="video/mp4"
      defaultHeight={350}
      defaults={{ autoplay: false, loop: false, muted: false, preload: "metadata" }}
      nearest={false}
      settingsPanel={(settings, updateSettings) => (
        <>
          <Toggle
            label="Autoplay"
            checked={settings.autoplay}
            onChange={(v) => updateSettings({ autoplay: v })}
          />
          <Toggle
            label="Loop"
            checked={settings.loop}
            onChange={(v) => updateSettings({ loop: v })}
          />
          <Toggle
            label="Muted"
            checked={settings.muted}
            onChange={(v) => updateSettings({ muted: v })}
          />
          <Select<VideoSettings["preload"]>
            label="Preload"
            value={settings.preload}
            onChange={(v) => updateSettings({ preload: v })}
            options={[
              { value: "metadata", label: "Metadata" },
              { value: "auto", label: "Auto (full)" },
              { value: "none", label: "None" },
            ]}
          />
        </>
      )}
      renderArtifact={(view) => <VideoClip {...view} />}
    />
  );
}
