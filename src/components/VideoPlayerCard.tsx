import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react";
import { api } from "../api/client";
import { safeJsonParse } from "../lib/format";
import { pointCaption } from "../lib/caption";
import { artifactFilename } from "../lib/download";
import UnsupportedArtifact from "./UnsupportedArtifact";
import type { SequencePoint } from "../api/types";
import { decodeImage, peekDecoded } from "../lib/media/decoded-image";
import SteppedMediaCard, { type MediaView, type SteppedMediaCardProps } from "./media/SteppedMediaCard";
import type { VideoSettings } from "./cards-settings/video";
import { SharedClock } from "../lib/media/shared-clock";
import { FIT_VIEW, isFitView, type ZoomView } from "../lib/media/view-geometry";
import { ZoomViewSync } from "../lib/media/zoom-view-sync";
import { SwapBarrier, pairKey, requestPair, slotElements, type SwapState, type VideoPair } from "../lib/media/video-swap";
import { useMediaSyncContext } from "./card-kit/media-sync";
import ClockTransport from "./media/ClockTransport";
import ZoomSplitPane from "./media/ZoomSplitPane";
import { CardFrameLock, ClockedVideo, LoopedTransport, VideoFacts, isPlayable, type VideoMetadata } from "./viewers/video";
import VideoSettingsPanel from "./settings-panels/VideoSettingsPanel";

/** A pending swap whose videos never get ready (a broken stream) swaps anyway after this. */
const SWAP_TIMEOUT_MS = 4000;

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
  zoomView: ZoomView;
  onZoomViewChange: (view: ZoomView) => void;
  /** Moves every pane in the same frame during a gesture (see ZoomSplitPane). */
  zoomSync: ZoomViewSync;
}

const playable = (p: SequencePoint | null) => !!p && isPlayable(p.artifact_mime);

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
        hash={hash}
        src={api.artifactUrl(hash)}
        poster={metaOf(pointsByHash.get(hash)!)?.preview}
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
        view={props.zoomView}
        onViewChange={props.onZoomViewChange}
        viewSync={props.zoomSync}
        rendering={settings.rendering}
        reference={(r) => videos("ref", r)}
      >
        {(r) => videos("fg", r)}
      </ZoomSplitPane>
    </div>
  );
  const info = <VideoFacts meta={meta} caption={pointCaption(point.metadata)} />;
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
  const [zoomView, setZoomView] = useState<ZoomView>(FIT_VIEW);
  const zoomSync = useMemo(() => new ZoomViewSync(), []);
  const viewModified = !isFitView(zoomView);
  // Divider drags stay local until release; arrow keys persist immediately.
  const [dragSplit, setDragSplit] = useState<number | null>(null);
  return (
    <SteppedMediaCard<VideoSettings>
      {...props}
      captionOverlay
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
      viewReset={{ modified: viewModified, reset: () => setZoomView(FIT_VIEW) }}
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
          zoomView={zoomView}
          onZoomViewChange={setZoomView}
          zoomSync={zoomSync}
        />
      )}
      footer={({ settings, paneCount, following, update }) => {
        const clock = clockFor(settings, paneCount, following);
        if (!clock) return null;
        // Following the section: the section's clock (and its loop) is shared, so the card doesn't set it.
        if (clock !== local) return <ClockTransport clock={clock} className="mt-2" />;
        return (
          <LoopedTransport
            clock={clock}
            loop={settings.loop}
            onLoopChange={(loop) => update({ loop } as Partial<VideoSettings>)}
            autoplay={settings.autoplay}
          />
        );
      }}
    />
  );
}
