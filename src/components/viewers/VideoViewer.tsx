import { useCallback, useEffect, useMemo, useState } from "react";
import { describeEncoding } from "../../lib/artifact-format";
import { SharedClock } from "../../lib/media/shared-clock";
import { FIT_VIEW, isFitView, type ZoomView } from "../../lib/media/view-geometry";
import type { ViewerSource } from "../../lib/viewers/source";
import { builtin as VIDEO_DEFAULTS } from "../cards-settings/video";
import ZoomSplitPane from "../media/ZoomSplitPane";
import UnsupportedArtifact from "../UnsupportedArtifact";
import { CardFrameLock, ClockedVideo, LoopedTransport, VideoFacts, isPlayable, type VideoMetadata } from "./video";
import ViewerToolbar from "./ViewerToolbar";

/**
 * One video on its own: the video card's player (a clocked `<video>` in the
 * zoomable pane: wheel zoom, drag pan, double-click resets) with its
 * transport bar and loop toggle, and the clip's facts. Plays as the video
 * card does by default (the card's built-in settings).
 */
export default function VideoViewer({ source, toolbar = true }: { source: ViewerSource; toolbar?: boolean }) {
  const meta = source.meta as VideoMetadata | null;
  const clock = useMemo(() => new SharedClock(), []);
  useEffect(() => () => clock.pause(), [clock]);
  const frameLock = useMemo(() => new CardFrameLock(), []);
  const [loop, setLoop] = useState(VIDEO_DEFAULTS.loop);
  const [view, setView] = useState<ZoomView>(FIT_VIEW);
  const [loaded, setLoaded] = useState<{ w: number; h: number } | null>(null);
  const onSize = useCallback((_hash: string, size: { w: number; h: number }) => setLoaded(size), []);
  const contentSize = meta?.width && meta.height ? { w: meta.width, h: meta.height } : loaded;

  if (!isPlayable(source.mime)) {
    return (
      <UnsupportedArtifact
        label={`${meta?.filename ?? describeEncoding(source.mime)} — not playable in the browser`}
        previewSrc={meta?.preview}
        downloadUrl={source.url}
        filename={source.name}
      />
    );
  }
  const playback = { ...VIDEO_DEFAULTS, loop };
  return (
    <div className="flex h-full min-h-0 w-full flex-col" data-viewer="video">
      <div className="relative min-h-0 w-full flex-1" data-video-stage="">
        <ZoomSplitPane
          contentSize={contentSize}
          compare={false}
          noun="video"
          split={0.5}
          view={view}
          onViewChange={setView}
          rendering={VIDEO_DEFAULTS.rendering}
        >
          {(r) => (
            <ClockedVideo
              hash={source.hash}
              src={source.url}
              poster={meta?.preview}
              clock={clock}
              settings={playback}
              visible
              imageRendering={r}
              onSize={onSize}
              frameLock={frameLock}
            />
          )}
        </ZoomSplitPane>
        {toolbar && (
          <ViewerToolbar
            onResetView={isFitView(view) ? undefined : () => setView(FIT_VIEW)}
            download={{ url: source.url, name: source.name }}
          />
        )}
      </div>
      <LoopedTransport clock={clock} loop={loop} onLoopChange={setLoop} autoplay={VIDEO_DEFAULTS.autoplay} />
      <VideoFacts meta={meta} />
    </div>
  );
}
