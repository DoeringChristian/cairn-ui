/**
 * The video player every surface shares: a `<video>` steered by a
 * `SharedClock` (useClockedVideo), inside a zoomable pane (ZoomSplitPane),
 * with one transport bar. The video card builds its step-swapping panes
 * from these; VideoViewer is one clip on its own clock.
 */

import { useEffect, useId, useRef, type CSSProperties, type RefObject } from "react";
import { decodeImage } from "../../lib/media/decoded-image";
import { SharedClock, driftCorrection, mediaTargetTime, type DriftOptions } from "../../lib/media/shared-clock";
import { FrameLock, videoFrameReady } from "../../lib/media/video-swap";
import ClockTransport from "../media/ClockTransport";
import { PANE_MEDIA_CLASS } from "../media/ZoomSplitPane";

/** Frames logged by the SDK carry every field; a stored file only what could be read from it. */
export interface VideoMetadata {
  fps?: number;
  num_frames?: number;
  width?: number;
  height?: number;
  filename?: string;
  preview?: string;
}

/** Containers every current browser plays in a <video>. */
const PLAYABLE = new Set(["video/mp4", "video/webm", "video/ogg"]);

/** A video the browser plays (an unknown mime is tried). */
export const isPlayable = (mime: string | null | undefined): boolean => !mime || PLAYABLE.has(mime.toLowerCase());

/** A hidden video's opacity: under half a level of 8-bit colour, yet drawn (see `visible`). */
const HIDDEN_OPACITY = 0.001;

/**
 * Steering of a shown video: tight (5 ms), so two videos on one clock (a
 * video and its reference) never straddle a frame boundary for long; small
 * drift is corrected by rate (a few percent), never by a visible seek.
 */
export const SHOWN_DRIFT: DriftOptions = { tolerance: 0.005, gain: 3 };
/**
 * Steering of a hidden video loading to be swapped in: nobody sees it, so it
 * catches up hard (large rate nudges) and is ready to swap sooner.
 */
export const HIDDEN_DRIFT: DriftOptions = { tolerance: 0.005, gain: 3, maxNudge: 0.5 };

/**
 * Keep a `<video>` on a shared clock: report its duration, then steer it
 * toward the clock's position (seek when far off, nudge the playback rate
 * when slightly off, see `driftCorrection`) every frame while the clock
 * plays, and on every clock change while it is paused. A clip shorter than
 * the clock rests on its last frame.
 */
export function useClockedVideo(
  ref: RefObject<HTMLVideoElement | null>,
  clock: SharedClock | null,
  source: string,
  drift?: DriftOptions,
) {
  const driftRef = useRef(drift);
  driftRef.current = drift;
  const id = useId();
  useEffect(() => {
    const el = ref.current;
    if (!el || !clock) return;
    const duration = () => (Number.isFinite(el.duration) && el.duration > 0 ? el.duration : null);
    let frame = 0;
    const steer = () => {
      const d = duration();
      const target = mediaTargetTime(clock.position(), d);
      const running = clock.playing && (d == null || target < d);
      const action = driftCorrection(el.currentTime, target, running, clock.rate, driftRef.current);
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
    // Once it can seek, a video mounted while the clock sits mid-clip goes
    // straight to the clock's frame.
    const onMeta = () => {
      clock.setDuration(id, duration());
      if (!frame) steer();
    };
    el.addEventListener("loadedmetadata", onMeta);
    if (duration() != null) clock.setDuration(id, duration());
    const unsubscribe = clock.subscribe(onClock);
    onClock();
    return () => {
      unsubscribe();
      if (frame) cancelAnimationFrame(frame);
      el.removeEventListener("loadedmetadata", onMeta);
    };
  }, [ref, clock, id, source]);
  // The duration outlives a source change (the next clip reports its own once
  // loaded): dropping it in between would hide a section's transport bar for
  // a moment and shift the whole section on every step.
  useEffect(() => {
    if (!clock) return;
    return () => clock.setDuration(id, null);
  }, [clock, id]);
}

/** The card's shown videos and the lock that keeps them on one frame (see FrameLock). */
export class CardFrameLock {
  readonly lock = new FrameLock();
  readonly videos = new Map<string, { el: HTMLVideoElement; clock: SharedClock }>();
}

const clockKeys = new WeakMap<SharedClock, string>();
let clockCount = 0;
const clockKey = (clock: SharedClock): string => {
  let key = clockKeys.get(clock);
  if (!key) clockKeys.set(clock, (key = String(++clockCount)));
  return key;
};

/**
 * A shown video takes part in the card's frame lock: every frame it presents
 * is reported, and when the lock finds videos of one clock a frame apart for
 * long, all of them seek to the clock together.
 */
function useFrameLock(ref: RefObject<HTMLVideoElement | null>, frameLock: CardFrameLock | null, clock: SharedClock) {
  const id = useId();
  useEffect(() => {
    const el = ref.current;
    if (!el || !frameLock || typeof el.requestVideoFrameCallback !== "function") return;
    frameLock.videos.set(id, { el, clock });
    const key = clockKey(clock);
    let handle = 0;
    const onFrame = (_now: number, md: VideoFrameCallbackMetadata) => {
      const playing = clock.playing && !el.paused && !el.seeking;
      const resync = frameLock.lock.presented(id, key, md.mediaTime, md.expectedDisplayTime / 1000, playing);
      for (const other of resync ?? []) {
        const v = frameLock.videos.get(other);
        if (!v || v.el.readyState < 1) continue;
        const d = Number.isFinite(v.el.duration) && v.el.duration > 0 ? v.el.duration : null;
        v.el.currentTime = mediaTargetTime(v.clock.position(), d);
      }
      handle = el.requestVideoFrameCallback(onFrame);
    };
    handle = el.requestVideoFrameCallback(onFrame);
    // A seek or a pause starts the comparison anew.
    const unsubscribe = clock.subscribe(() => frameLock.lock.remove(id));
    return () => {
      el.cancelVideoFrameCallback(handle);
      unsubscribe();
      frameLock.videos.delete(id);
      frameLock.lock.remove(id);
    };
  }, [ref, frameLock, clock, id]);
}

/** How a clocked video plays (the video card's settings of the same names). */
export interface VideoPlayback {
  loop: boolean;
  muted: boolean;
  preload: "metadata" | "auto" | "none";
}

interface ClockedVideoProps {
  hash: string;
  /** Where the bytes load from. */
  src: string;
  /** A still shown before the first frame (the SDK's `metadata.preview`). */
  poster?: string;
  clock: SharedClock;
  settings: VideoPlayback;
  /**
   * Shown, or mounted hidden while it loads to replace the shown one. A
   * hidden video sits ON TOP of the shown one at an opacity that rounds to
   * nothing on screen: the compositor still draws it (it skips a fully
   * transparent layer, and culls one hidden under an opaque video), so its
   * frame is on the GPU before the swap, and the swap never blanks.
   */
  visible: boolean;
  /** Never audible (the reference of a split view). */
  silent?: boolean;
  imageRendering: CSSProperties["imageRendering"];
  /**
   * Hidden only: whether it holds the clock's frame (see `videoFrameReady`),
   * on every change; `false` once more when it goes away.
   */
  onReadyChange?: (hash: string, ready: boolean) => void;
  onSize?: (hash: string, size: { w: number; h: number }) => void;
  /** The card's frame lock: a shown video takes part (see CardFrameLock). */
  frameLock: CardFrameLock;
}

/** One `<video>` on the clock; hidden, it reports when it can be swapped in. */
export function ClockedVideo({ hash, src, poster, clock, settings, visible, silent, imageRendering, onReadyChange, onSize, frameLock }: ClockedVideoProps) {
  const ref = useRef<HTMLVideoElement | null>(null);
  useFrameLock(ref, visible ? frameLock : null, clock);
  useClockedVideo(ref, clock, hash, visible ? SHOWN_DRIFT : HIDDEN_DRIFT);
  const report = useRef(onReadyChange);
  report.current = onReadyChange;
  const tracking = !!onReadyChange;
  useEffect(() => {
    const el = ref.current;
    if (!el || !tracking) return;
    let last: boolean | null = null;
    const set = (ready: boolean) => {
      if (ready === last) return;
      last = ready;
      report.current?.(hash, ready);
    };
    if (settings.preload === "none") {
      // The stream never loads ahead: swap in once the poster can paint.
      const ctrl = new AbortController();
      set(false);
      (poster ? decodeImage(poster, ctrl.signal) : Promise.resolve()).then(() => set(true), () => set(true));
      return () => {
        ctrl.abort();
        report.current?.(hash, false);
      };
    }
    // The frame the compositor last got (see videoFrameReady's `presentedTime`).
    const frameCallbacks = typeof el.requestVideoFrameCallback === "function";
    let presented: number | null = null;
    let handle = 0;
    const check = () => set(videoFrameReady(el, clock.position(), clock.playing, frameCallbacks ? { presentedTime: presented } : {}));
    const onFrame = (_now: number, md: VideoFrameCallbackMetadata) => {
      presented = md.mediaTime;
      check();
      handle = el.requestVideoFrameCallback(onFrame);
    };
    if (frameCallbacks) handle = el.requestVideoFrameCallback(onFrame);
    const events = ["loadeddata", "canplay", "seeking", "seeked", "timeupdate"] as const;
    for (const e of events) el.addEventListener(e, check);
    const unsubscribe = clock.subscribe(check);
    check();
    return () => {
      for (const e of events) el.removeEventListener(e, check);
      unsubscribe();
      if (frameCallbacks) el.cancelVideoFrameCallback(handle);
      report.current?.(hash, false);
    };
  }, [tracking, clock, hash, poster, settings.preload]);
  return (
    <video
      ref={ref}
      // The shared clock drives playback (the transport bar below the panes).
      loop={settings.loop}
      muted={settings.muted || silent || !visible}
      playsInline
      // A hidden video about to be swapped in loads its data.
      preload={visible ? settings.preload : settings.preload === "none" ? "none" : "auto"}
      src={src}
      poster={poster}
      onLoadedMetadata={(e) => {
        const el = e.currentTarget;
        if (el.videoWidth > 0) onSize?.(hash, { w: el.videoWidth, h: el.videoHeight });
      }}
      className={PANE_MEDIA_CLASS}
      // Stacked by z-index, never by DOM order: moving a media element in
      // the DOM pauses it.
      style={{ imageRendering, zIndex: visible ? 1 : 2, opacity: visible ? 1 : HIDDEN_OPACITY }}
      data-video-hash={hash}
      data-video-visible={visible ? "1" : "0"}
    />
  );
}

/** A clip's caption and facts (file, size, frames, fps) under the player. */
export function VideoFacts({ meta, caption }: { meta: VideoMetadata | null; caption?: string | null }) {
  const facts = meta
    ? [
        meta.filename,
        meta.width && meta.height ? `${meta.width}×${meta.height}` : undefined,
        meta.num_frames ? `${meta.num_frames} frames` : undefined,
        meta.fps ? `${meta.fps} fps` : undefined,
      ].filter(Boolean)
    : [];
  if (!caption && facts.length === 0) return null;
  return (
    <div className="mt-2 text-xs">
      {caption && <div className="truncate text-fg" title={caption}>{caption}</div>}
      {facts.length > 0 && <div className="mono truncate text-fg-subtle" title={facts.join(" · ")}>{facts.join(" · ")}</div>}
    </div>
  );
}

/** A transport whose clock loops as `loop` says; the bar's toggle reports changes (the owner keeps the state). */
export function LoopedTransport({ clock, loop, onLoopChange, autoplay, className = "mt-2" }: {
  clock: SharedClock;
  loop: boolean;
  onLoopChange: (loop: boolean) => void;
  autoplay: boolean;
  className?: string;
}) {
  useEffect(() => clock.setLoop(loop), [clock, loop]);
  useEffect(() => {
    if (autoplay) clock.play();
    // Autoplay starts the clock once, when it appears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <ClockTransport clock={clock} className={className} onLoopChange={onLoopChange} />;
}
