import { useEffect, useId, useMemo, useRef, type RefObject } from "react";
import { api } from "../api/client";
import { safeJsonParse } from "../lib/format";
import { pointCaption } from "../lib/caption";
import { artifactFilename } from "../lib/download";
import UnsupportedArtifact from "./UnsupportedArtifact";
import SteppedMediaCard, { type MediaView, type SteppedMediaCardProps } from "./media/SteppedMediaCard";
import type { VideoSettings } from "./cards-settings/video";
import { SharedClock, driftCorrection, mediaTargetTime } from "../lib/media/shared-clock";
import { useMediaSyncContext } from "./card-kit/media-sync";
import ClockTransport from "./media/ClockTransport";
import VideoSettingsPanel from "./settings-panels/VideoSettingsPanel";

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

/**
 * Keep a `<video>` on a shared clock: report its duration, then steer it
 * toward the clock's position (seek when far off, nudge the playback rate
 * when slightly off, see `driftCorrection`) every frame while the clock
 * plays, and on every clock change while it is paused. A clip shorter than
 * the clock rests on its last frame.
 */
export function useClockedVideo(ref: RefObject<HTMLVideoElement | null>, clock: SharedClock | null, source: string) {
  const id = useId();
  useEffect(() => {
    const el = ref.current;
    if (!el || !clock) return;
    const duration = () => (Number.isFinite(el.duration) && el.duration > 0 ? el.duration : null);
    const onMeta = () => clock.setDuration(id, duration());
    el.addEventListener("loadedmetadata", onMeta);
    onMeta();
    let frame = 0;
    const steer = () => {
      const d = duration();
      const target = mediaTargetTime(clock.position(), d);
      const running = clock.playing && (d == null || target < d);
      const action = driftCorrection(el.currentTime, target, running, clock.rate);
      if (action.kind === "seek" && el.readyState >= 1) el.currentTime = action.to;
      if (Math.abs(el.playbackRate - action.rate) > 1e-3) el.playbackRate = action.rate;
      if (running && el.paused) el.play().catch(() => {});
      if (!running && !el.paused) el.pause();
    };
    const loop = () => {
      steer();
      frame = clock.playing ? requestAnimationFrame(loop) : 0;
    };
    const onClock = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      loop();
    };
    const unsubscribe = clock.subscribe(onClock);
    onClock();
    return () => {
      unsubscribe();
      if (frame) cancelAnimationFrame(frame);
      el.removeEventListener("loadedmetadata", onMeta);
      clock.setDuration(id, null);
    };
  }, [ref, clock, id, source]);
}

/**
 * Player and format line for one video artifact. The card's only pane grows
 * with the card (taller in the modal); a grid pane keeps a fixed max height.
 */
function VideoClip({
  point,
  hash,
  name,
  settings,
  single,
  inModal,
  clock,
}: MediaView<VideoSettings> & { clock: SharedClock | null }) {
  const meta = safeJsonParse<VideoMetadata>(point.artifact_metadata);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  useClockedVideo(videoRef, clock, hash);
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
      ref={videoRef}
      // On a shared clock the transport bar drives playback.
      controls={!clock}
      autoPlay={!clock && settings.autoplay}
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
  const caption = pointCaption(point.metadata);
  const info = (caption || facts.length > 0) && (
    <div className="mt-2 text-xs">
      {caption && <div className="truncate text-fg" title={caption}>{caption}</div>}
      {facts.length > 0 && <div className="mono text-fg-subtle">{facts.join(" · ")}</div>}
    </div>
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
  // Panes of this card play together on `local`; a card following the
  // section's media sync uses the section's clock instead.
  const local = useMemo(() => new SharedClock(), []);
  useEffect(() => () => local.pause(), [local]);
  const section = useMediaSyncContext();
  const clockFor = (settings: VideoSettings, paneCount: number, following: boolean): SharedClock | null => {
    if (following && section) return section.clock;
    return settings.syncPlayback && paneCount > 1 ? local : null;
  };
  return (
    <SteppedMediaCard<VideoSettings>
      {...props}
      kind="video"
      noun="video"
      defaultMime="video/mp4"
      defaultHeight={350}
      nearest={false}
      settingsPanel={(ctl, ctx) => <VideoSettingsPanel ctl={ctl} ctx={ctx} mode="card" />}
      renderArtifact={(view) => <VideoClip {...view} clock={clockFor(view.settings, view.paneCount, view.following)} />}
      footer={({ settings, paneCount, following }) => {
        const clock = clockFor(settings, paneCount, following);
        return clock ? <LoopedTransport clock={clock} loop={settings.loop} /> : null;
      }}
    />
  );
}

/** The card's transport bar; the clock loops when the card's videos do. */
function LoopedTransport({ clock, loop }: { clock: SharedClock; loop: boolean }) {
  useEffect(() => clock.setLoop(loop), [clock, loop]);
  return <ClockTransport clock={clock} className="mt-2" />;
}
