import { useMemo } from "react";
import { api } from "../api/client";
import { safeJsonParse } from "../lib/format";
import { pointCaption } from "../lib/caption";
import type { SequencePoint } from "../api/types";
import SteppedMediaCard, { type SteppedMediaCardProps } from "./media/SteppedMediaCard";
import type { AudioSettings } from "./cards-settings/audio";
import Toggle from "./settings/Toggle";

interface AudioMeta {
  sample_rate: number;
  duration: number;
  channels: number;
  peaks: number[];
  num_samples: number;
}

/** Peak bars in the theme accent color. */
function Waveform({ peaks }: { peaks: number[] }) {
  const width = 320;
  const height = 48;
  const n = peaks.length;
  if (n === 0) return null;
  const slot = width / n;
  const barW = Math.max(1, slot * 0.7);
  const mid = height / 2;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="h-12 w-full fill-accent"
      aria-hidden="true"
    >
      {peaks.map((p, i) => {
        const clamped = Math.max(0, Math.min(1, p));
        const h = clamped * mid;
        const x = i * slot + (slot - barW) / 2;
        return <rect key={i} x={x} y={mid - h} width={barW} height={h * 2} />;
      })}
    </svg>
  );
}

function channelLabel(channels: number): string {
  if (channels === 1) return "mono";
  if (channels === 2) return "stereo";
  return `${channels}ch`;
}

/** Waveform, player and format line for one audio artifact. */
function AudioClip({ point, hash, autoplay }: { point: SequencePoint; hash: string; autoplay: boolean }) {
  const meta = useMemo(() => safeJsonParse<AudioMeta>(point.artifact_metadata), [point]);
  const caption = pointCaption(point.metadata);
  return (
    <div className="rounded bg-bg p-2">
      {caption && <div className="mb-1 truncate text-xs text-fg" title={caption}>{caption}</div>}
      {meta?.peaks && meta.peaks.length > 0 ? <Waveform peaks={meta.peaks} /> : <div className="h-12" />}
      <audio key={hash} controls autoPlay={autoplay} src={api.artifactUrl(hash)} className="mt-2 w-full" />
      {meta && (
        <div className="mono mt-1 text-xs text-fg-subtle">
          {`${meta.sample_rate} Hz · ${meta.duration}s · ${channelLabel(meta.channels)}`}
        </div>
      )}
    </div>
  );
}

export default function AudioPlayerCard(props: SteppedMediaCardProps) {
  return (
    <SteppedMediaCard<AudioSettings>
      {...props}
      kind="audio"
      noun="audio"
      defaultMime="audio/wav"
      nearest
      settingsPanel={(ctl) => (
        <Toggle
          label="Autoplay"
          checked={ctl.value.autoplay}
          onChange={(v) => ctl.set({ autoplay: v })}
          description="Play the clip automatically when the card loads"
        />
      )}
      renderArtifact={({ point, hash, settings }) => (
        <AudioClip point={point} hash={hash} autoplay={settings.autoplay} />
      )}
    />
  );
}
