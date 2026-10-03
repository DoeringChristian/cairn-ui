import { useQuery } from "@tanstack/react-query";
import { audioPeaks, channelLabel, wavFormat } from "../../lib/viewers/audio-peaks";
import type { ViewerSource } from "../../lib/viewers/source";

/** What the SDK records with a logged `cairn.Audio` (a file decoded here may lack the rate). */
interface AudioMeta {
  sample_rate?: number;
  duration: number;
  channels: number;
  peaks: number[];
}

/** Files above this are not decoded for a waveform (the player still streams them). */
const DECODE_CAP = 32 * 1024 * 1024;

/**
 * Peaks and format of a file logged without them (a plain `.wav` in an
 * artifact): decoded once in the browser, cached by hash.
 */
function useDecodedAudio(source: ViewerSource, enabled: boolean) {
  return useQuery({
    queryKey: ["audio-peaks", source.hash],
    enabled,
    staleTime: Infinity,
    retry: false,
    queryFn: async (): Promise<AudioMeta> => {
      const res = await fetch(source.url);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const bytes = await res.arrayBuffer();
      // Decoding resamples to the context's rate: the file's own rate is in its header.
      const wav = wavFormat(bytes);
      const ctx = new OfflineAudioContext(1, 1, 44_100);
      const buf = await ctx.decodeAudioData(bytes);
      const channels = Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i));
      return {
        sample_rate: wav?.sampleRate,
        duration: Math.round(buf.duration * 100) / 100,
        channels: buf.numberOfChannels,
        peaks: audioPeaks(channels, 200),
      };
    },
  });
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
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="h-12 w-full fill-accent" aria-hidden="true">
      {peaks.map((p, i) => {
        const h = Math.max(0, Math.min(1, p)) * mid;
        const x = i * slot + (slot - barW) / 2;
        return <rect key={i} x={x} y={mid - h} width={barW} height={h * 2} />;
      })}
    </svg>
  );
}

/**
 * One audio clip: its waveform, the player and a format line (the audio
 * card's pane). The waveform is the SDK's logged peaks, or decoded here for
 * a file logged without them. `compact`: the player alone (a table cell).
 */
export default function AudioViewer({
  source,
  caption,
  autoplay = false,
  compact = false,
}: {
  source: ViewerSource;
  caption?: string | null;
  autoplay?: boolean;
  compact?: boolean;
}) {
  const logged = source.meta as Partial<AudioMeta> | null;
  const hasPeaks = !!logged?.peaks?.length;
  const decoded = useDecodedAudio(source, !compact && !hasPeaks && (source.size ?? 0) <= DECODE_CAP);
  if (compact) {
    return <audio className="h-8 w-full max-w-[16rem]" controls preload="none" src={source.url} data-viewer="audio" />;
  }
  const meta = hasPeaks ? (logged as AudioMeta) : decoded.data ?? null;
  const format = meta
    ? [meta.sample_rate ? `${meta.sample_rate} Hz` : null, `${meta.duration}s`, channelLabel(meta.channels)].filter(Boolean).join(" · ")
    : null;
  return (
    <div className="rounded bg-bg p-2" data-viewer="audio">
      {caption && <div className="mb-1 truncate text-xs text-fg" title={caption}>{caption}</div>}
      {meta?.peaks && meta.peaks.length > 0 ? <Waveform peaks={meta.peaks} /> : <div className="h-12" />}
      <audio key={source.hash} controls autoPlay={autoplay} src={source.url} className="mt-2 w-full" />
      {format && <div className="mono mt-1 truncate text-xs text-fg-subtle" title={format}>{format}</div>}
    </div>
  );
}
