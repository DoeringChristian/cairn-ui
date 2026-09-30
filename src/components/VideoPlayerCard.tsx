import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type RefObject } from "react";
import { api } from "../api/client";
import { safeJsonParse } from "../lib/format";
import { pointCaption } from "../lib/caption";
import { artifactFilename } from "../lib/download";
import UnsupportedArtifact from "./UnsupportedArtifact";
import type { SequencePoint } from "../api/types";
import { decodeImage, peekDecoded } from "../lib/media/decoded-image";
import SteppedMediaCard, { type MediaView, type SteppedMediaCardProps } from "./media/SteppedMediaCard";
import type { VideoSettings } from "./cards-settings/video";
import { SharedClock, driftCorrection, mediaTargetTime, type DriftOptions } from "../lib/media/shared-clock";
import type { PaneTransform } from "../lib/media/split-geometry";
import {
  FrameLock,
  SwapBarrier,
  pairKey,
  requestPair,
  slotElements,
  videoFrameReady,
  type SwapState,
  type VideoPair,
} from "../lib/media/video-swap";
import { useMediaSyncContext } from "./card-kit/media-sync";
import ClockTransport from "./media/ClockTransport";
import ZoomSplitPane, { PANE_MEDIA_CLASS } from "./media/ZoomSplitPane";
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

/** A hidden video's opacity: under half a level of 8-bit colour, yet drawn (see `visible`). */
const HIDDEN_OPACITY = 0.001;

/** A pending swap whose videos never get ready (a broken stream) swaps anyway after this. */
const SWAP_TIMEOUT_MS = 4000;

/**
 * Steering of a shown video: tight (5 ms), so two videos on one clock (a
 * video and its reference) never straddle a frame boundary for long; small
 * drift is corrected by rate (a few percent), never by a visible seek.
 */
const SHOWN_DRIFT: DriftOptions = { tolerance: 0.005, gain: 3 };
/**
 * Steering of a hidden video loading to be swapped in: nobody sees it, so it
 * catches up hard (large rate nudges) and is ready to swap sooner.
 */
const HIDDEN_DRIFT: DriftOptions = { tolerance: 0.005, gain: 3, maxNudge: 0.5 };

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
class CardFrameLock {
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

const metaOf = (point: SequencePoint) => safeJsonParse<VideoMetadata>(point.artifact_metadata);
const posterOf = (point: SequencePoint) => metaOf(point)?.preview ?? null;

/**
 * Warm a video step: its poster decoded, so a pane showing it has a picture
 * at once. (The stream itself loads per the card's `preload` setting.)
 */
function prefetchVideo(point: SequencePoint, signal: AbortSignal): Promise<unknown> {
  const poster = posterOf(point);
  return poster ? decodeImage(poster, signal) : Promise.resolve();
}

interface ClockedVideoProps {
  point: SequencePoint;
  hash: string;
  clock: SharedClock;
  settings: VideoSettings;
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
function ClockedVideo({ point, hash, clock, settings, visible, silent, imageRendering, onReadyChange, onSize, frameLock }: ClockedVideoProps) {
  const ref = useRef<HTMLVideoElement | null>(null);
  useFrameLock(ref, visible ? frameLock : null, clock);
  useClockedVideo(ref, clock, hash, visible ? SHOWN_DRIFT : HIDDEN_DRIFT);
  const poster = metaOf(point)?.preview;
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
      src={api.artifactUrl(hash)}
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

interface PanePair extends VideoPair {
  point: SequencePoint;
  refPoint: SequencePoint | null;
}

interface VideoClipProps extends MediaView<VideoSettings> {
  /** The card's (or section's) clock; null: this pane plays on its own, with its own transport. */
  clock: SharedClock | null;
  barrier: SwapBarrier;
  frameLock: CardFrameLock;
  split: number;
  onSplitChange: (split: number, final: boolean) => void;
  transform: PaneTransform;
  onTransformChange: (t: PaneTransform) => void;
}

const playable = (p: SequencePoint | null) => !!p && (!p.artifact_mime || PLAYABLE.has(p.artifact_mime));

/**
 * One video pane: the player in a zoomable pane (see ZoomSplitPane), split
 * against the reference when the card compares, and a format line. Both
 * videos follow one clock, so they never drift apart.
 *
 * A step change mounts the new video (and reference) hidden behind the shown
 * ones and swaps once each holds the clock's frame, together with the card's
 * other panes (see lib/media/video-swap.ts): stepping never blanks the pane,
 * flashes a poster, or shows a video beside another step's reference.
 */
function VideoClip(props: VideoClipProps) {
  const { settings, single, inModal, name, barrier } = props;
  const own = useMemo(() => new SharedClock(), []);
  useEffect(() => () => own.pause(), [own]);
  useEffect(() => {
    if (!props.clock) own.setLoop(settings.loop);
  }, [own, props.clock, settings.loop]);
  useEffect(() => {
    if (!props.clock && settings.autoplay) own.play();
    // Autoplay starts a pane once, when it appears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const clock = props.clock ?? own;

  const refHash = props.reference && playable(props.reference) ? props.reference.artifact_hash ?? null : null;
  const want: PanePair = { fg: props.hash, ref: refHash, point: props.point, refPoint: refHash ? props.reference : null };
  const [swap, setSwap] = useState<SwapState<PanePair>>({ shown: want, pending: null });
  const next = requestPair(swap, want);
  if (next !== swap) setSwap(next);
  const { shown, pending } = next;
  const pendingKey = pending ? pairKey(pending) : null;

  // Which hidden videos hold the clock's frame; the pending pair swaps in
  // (with the card's other panes, at the barrier) once all of its do.
  const id = useId();
  const readyHashes = useRef(new Set<string>());
  const evaluate = useRef(() => {});
  evaluate.current = () => {
    if (!pending) return;
    const need = [pending.fg, pending.ref].filter((h): h is string => !!h && h !== shown.fg && h !== shown.ref);
    if (need.every((h) => readyHashes.current.has(h))) barrier.ready(id);
    else barrier.wait(id);
  };
  const onReadyChange = useCallback((hash: string, ready: boolean) => {
    if (ready) readyHashes.current.add(hash);
    else readyHashes.current.delete(hash);
    evaluate.current();
  }, []);

  useEffect(() => {
    if (!pendingKey) {
      barrier.done(id);
      return;
    }
    barrier.wait(id);
    evaluate.current();
    const timer = setTimeout(() => barrier.ready(id), SWAP_TIMEOUT_MS);
    const swapIfOpen = () => {
      if (!barrier.open || !barrier.isWaiting(id)) return;
      barrier.done(id);
      setSwap((s) => (s.pending && pairKey(s.pending) === pendingKey ? { shown: s.pending, pending: null } : s));
    };
    const unsubscribe = barrier.subscribe(swapIfOpen);
    swapIfOpen();
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [pendingKey, barrier, id]);
  useEffect(() => () => barrier.done(id), [barrier, id]);

  const point = shown.point;
  const meta = metaOf(point);
  const [loadedSize, setLoadedSize] = useState<{ hash: string; w: number; h: number } | null>(null);
  const contentSize = meta?.width && meta.height
    ? { w: meta.width, h: meta.height }
    : loadedSize?.hash === shown.fg ? loadedSize : null;
  const onSize = useCallback((hash: string, s: { w: number; h: number }) => setLoadedSize({ hash, ...s }), []);

  if (!playable(point)) {
    return (
      <UnsupportedArtifact
        label={`${meta?.filename ?? point.artifact_mime} — not playable in the browser`}
        detail={`step ${point.step}`}
        previewSrc={meta?.preview}
        downloadUrl={api.artifactUrl(shown.fg)}
        filename={meta?.filename ?? artifactFilename(name, point.step, point.artifact_mime ?? "video/mp4")}
      />
    );
  }
  const compare = !!shown.ref;
  const pointsByHash = new Map<string, SequencePoint>();
  for (const p of [shown, pending]) {
    if (!p) continue;
    pointsByHash.set(p.fg, p.point);
    if (p.ref && p.refPoint) pointsByHash.set(p.ref, p.refPoint);
  }
  const videos = (slot: "fg" | "ref", imageRendering: CSSProperties["imageRendering"]) =>
    slotElements(shown[slot], pending ? pending[slot] : null).map(({ hash, visible }) => (
      <ClockedVideo
        key={hash}
        point={pointsByHash.get(hash)!}
        hash={hash}
        clock={clock}
        settings={settings}
        visible={visible}
        silent={slot === "ref"}
        imageRendering={imageRendering}
        onReadyChange={visible ? undefined : onReadyChange}
        onSize={slot === "fg" ? onSize : undefined}
        frameLock={props.frameLock}
      />
    ));

  // The card's only pane fills the card; a pane of several takes the video's
  // aspect ratio (known from the logged size before any data arrives).
  const fill = single;
  const aspect = contentSize ? contentSize.w / contentSize.h : 16 / 9;
  const stage = (
    <div
      className={fill ? "relative min-h-0 w-full flex-1" : `relative w-full ${inModal ? "max-h-[70vh]" : "max-h-64"}`}
      style={fill ? undefined : { aspectRatio: aspect }}
      data-video-stage=""
    >
      <ZoomSplitPane
        contentSize={contentSize}
        compare={compare}
        noun="video"
        label={`${name} · ${point.step}`}
        referenceLabel={shown.refPoint ? `${props.referenceName ?? "reference"} · ${shown.refPoint.step}` : undefined}
        split={props.split}
        onSplitChange={props.onSplitChange}
        transform={props.transform}
        onTransformChange={props.onTransformChange}
        rendering={settings.rendering}
        reference={(r) => videos("ref", r)}
      >
        {(r) => videos("fg", r)}
      </ZoomSplitPane>
    </div>
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
  // A pane off the card's clock (synced playback off) has its own transport.
  const transport = props.clock ? null : <ClockTransport clock={own} className="mt-1" />;
  if (single) {
    return (
      <>
        <div className="flex min-h-0 flex-1 flex-col rounded bg-bg p-2">{stage}</div>
        {transport}
        {info}
      </>
    );
  }
  return (
    <div className="flex flex-col rounded bg-bg p-2">
      {stage}
      {transport}
      {info}
    </div>
  );
}

const IDENTITY: PaneTransform = { scale: 1, x: 0, y: 0 };

export default function VideoPlayerCard(props: SteppedMediaCardProps) {
  // Panes of this card play together on `local`; a card following the
  // section's media sync uses the section's clock instead. With synced
  // playback off, each of several panes plays on its own clock.
  const local = useMemo(() => new SharedClock(), []);
  useEffect(() => () => local.pause(), [local]);
  const section = useMediaSyncContext();
  const clockFor = (settings: VideoSettings, paneCount: number, following: boolean): SharedClock | null => {
    if (following && section) return section.clock;
    return settings.syncPlayback || paneCount <= 1 ? local : null;
  };
  // Every pane swaps steps together, and all share one zoom/pan.
  const barrier = useMemo(() => new SwapBarrier(), []);
  const frameLock = useMemo(() => new CardFrameLock(), []);
  const [transform, setTransform] = useState<PaneTransform>(IDENTITY);
  const viewModified = transform.scale !== 1 || transform.x !== 0 || transform.y !== 0;
  // Divider drags stay local until release; arrow keys persist immediately.
  const [dragSplit, setDragSplit] = useState<number | null>(null);
  return (
    <SteppedMediaCard<VideoSettings>
      {...props}
      kind="video"
      noun="video"
      defaultMime="video/mp4"
      defaultHeight={350}
      nearest={false}
      settingsPanel={(ctl, ctx) => <VideoSettingsPanel ctl={ctl} ctx={ctx} mode="card" />}
      prefetch={(_qc, point, signal) => prefetchVideo(point, signal)}
      peek={(_qc, point) => {
        const poster = posterOf(point);
        return !poster || !!peekDecoded(poster);
      }}
      reference={(s) => (s.reference ? { name: s.reference.name, step: s.referenceStep } : null)}
      viewReset={{ modified: viewModified, reset: () => setTransform(IDENTITY) }}
      renderArtifact={(view) => (
        <VideoClip
          {...view}
          clock={clockFor(view.settings, view.paneCount, view.following)}
          barrier={barrier}
          frameLock={frameLock}
          split={dragSplit ?? view.settings.split}
          onSplitChange={(value, final) => {
            if (final) {
              setDragSplit(null);
              view.update({ split: value }, { mergeKey: "split" });
            } else {
              setDragSplit(value);
            }
          }}
          transform={transform}
          onTransformChange={setTransform}
        />
      )}
      footer={({ settings, paneCount, following }) => {
        const clock = clockFor(settings, paneCount, following);
        return clock ? <LoopedTransport clock={clock} loop={settings.loop} autoplay={settings.autoplay && clock === local} /> : null;
      }}
    />
  );
}

/** The card's transport bar; the clock loops when the card's videos do. */
function LoopedTransport({ clock, loop, autoplay }: { clock: SharedClock; loop: boolean; autoplay: boolean }) {
  useEffect(() => clock.setLoop(loop), [clock, loop]);
  useEffect(() => {
    if (autoplay) clock.play();
    // Autoplay starts the card once, when it appears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <ClockTransport clock={clock} className="mt-2" />;
}
