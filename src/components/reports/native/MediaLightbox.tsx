import { Select } from "../../../prism/Select";
import { copyText, mediaReference } from "./clipboard";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import {
  FIT_VIEW,
  fitRect,
  transformToView,
  viewToTransform,
  type Size,
  type ZoomView,
} from "../../../lib/media/view-geometry";
import type { PaneTransform } from "../../../lib/media/split-geometry";
import "./media/lightbox.css";


export type MediaItem = {
  url: string;
  mime: string;
  name?: string;
  fps?: number;
  time?: number;
  source?: {
    report_ref?: string;
    block_id?: string;
    source?: {file:string;line:number;end_line?:number;hash?:string};
    report_id?:string;version_id?:string;ref?:string;url?:string;source_ref?:string;
    hash?: string;
    path?: string;
    file?: string;
    line?: number;
  };
};
export type MediaSelection = {
  item: MediaItem;
  region?: {
    x: number;
    y: number;
    width: number;
    height: number;
    imageWidth: number;
    imageHeight: number;
  };
  time?: number;
  clip?: { start: number; end: number };
};
const clamp = (value: number, low = 0, high = 1) =>
  Math.min(high, Math.max(low, value));
export function pixelRegion(
  a: { x: number; y: number },
  b: { x: number; y: number },
  size: Size,
) {
  const x = Math.round(clamp(Math.min(a.x, b.x)) * size.w),
    y = Math.round(clamp(Math.min(a.y, b.y)) * size.h);
  return {
    x,
    y,
    width: Math.round(clamp(Math.max(a.x, b.x)) * size.w) - x,
    height: Math.round(clamp(Math.max(a.y, b.y)) * size.h) - y,
    imageWidth: size.w,
    imageHeight: size.h,
  };
}
type Point = { x: number; y: number };

export function MediaLightbox({
  items,
  initialIndex = 0,
  onClose,
  onSelection,
}: {
  items: MediaItem[];
  initialIndex?: number;
  onClose: () => void;
  onSelection?: (selection: MediaSelection) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    surface = useRef<HTMLDivElement>(null),
    stage = useRef<HTMLDivElement>(null),
    video = useRef<HTMLVideoElement>(null);
  const [manualCopy,setManualCopy]=useState("");
  const [index, setIndex] = useState(
    clamp(initialIndex, 0, Math.max(0, items.length - 1)),
  );
  const item = items[index],
    isVideo = item?.mime.startsWith("video/");
  const [pane, setPane] = useState<Size>({ w: 1, h: 1 }),
    [natural, setNatural] = useState<Size | null>(null);
  const [view, setView] = useState<ZoomView>(FIT_VIEW),
    [selecting, setSelecting] = useState(false);
  const liveView = useRef<ZoomView>(FIT_VIEW),
    animation = useRef<number | null>(null);
  const [region, setRegion] = useState<{ a: Point; b: Point } | null>(null);
  const [time, setTime] = useState(0),
    [duration, setDuration] = useState(0),
    [playing, setPlaying] = useState(false);
  const [clipStart, setClipStart] = useState<number | null>(null),
    [clipEnd, setClipEnd] = useState<number | null>(null);
  const [loop, setLoop] = useState(false),
    [copied, setCopied] = useState(""),
    [failure, setFailure] = useState("");
  const [fps, setFps] = useState(clamp(item?.fps || 30, 1, 240)),
    [rate, setRate] = useState(1);
  const [volume, setVolume] = useState(1),
    [muted, setMuted] = useState(false),
    [fullscreen, setFullscreen] = useState(false),
    [notice, setNotice] = useState("");
  const pointers = useRef(new Map<number, Point>()),
    drag = useRef<{ start: Point; view: ZoomView } | null>(null);
  const pinch = useRef<{
    distance: number;
    center: Point;
    transform: PaneTransform;
  } | null>(null);
  const fit = fitRect(pane, natural),
    transform = viewToTransform(view, pane, natural);
  const crisp =
    natural && (fit.w / natural.w) * view.zoom > 1.5 ? "pixelated" : "auto";
  // Gesture updates are local to this dialog and coalesced to one React commit per
  // animation frame. The stable video element never remounts for zoom/pan/playback.
  function changeView(next: ZoomView | ((previous: ZoomView) => ZoomView)) {
    liveView.current =
      typeof next === "function" ? next(liveView.current) : next;
    if (animation.current === null)
      animation.current = requestAnimationFrame(() => {
        animation.current = null;
        setView(liveView.current);
      });
  }
  useEffect(() => {
    const prior = document.activeElement as HTMLElement | null,
      node = dialog.current;
    if (node && !node.open) {
      if (node.showModal) node.showModal();
      else node.setAttribute("open", "");
    }
    const fullscreenChanged = () =>
      setFullscreen(document.fullscreenElement === surface.current);
    document.addEventListener("fullscreenchange", fullscreenChanged);
    return () => {
      if (animation.current !== null) cancelAnimationFrame(animation.current);
      document.removeEventListener("fullscreenchange", fullscreenChanged);
      node?.close?.();
      prior?.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const measure = () => {
      const box = element.getBoundingClientRect();
      setPane({ w: Math.max(1, box.width), h: Math.max(1, box.height) });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    setNatural(null);
    setPlaying(false);
    changeView(FIT_VIEW);
    setSelecting(false);
    setRegion(null);
    setTime(item?.time || 0);
    setDuration(0);
    setClipStart(null);
    setClipEnd(null);
    setFailure("");
    setCopied("");
    setNotice("");
    setFps(clamp(item?.fps || 30, 1, 240));
    pointers.current.clear();
    drag.current = null;
    pinch.current = null;
  }, [item?.url]);
  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      if ((event.target as HTMLElement).closest("button,input,select,a"))
        return;
      event.preventDefault();
      const bounds = element.getBoundingClientRect(),
        x = event.clientX - bounds.left,
        y = event.clientY - bounds.top;
      const delta =
        event.deltaY *
        (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? pane.h : 1);
      changeView((previous) => {
        const old = viewToTransform(previous, pane, natural),
          scale = clamp(old.scale * Math.exp(-delta * 0.002), 1, 32);
        return transformToView(
          {
            scale,
            x: x - ((x - old.x) * scale) / old.scale,
            y: y - ((y - old.y) * scale) / old.scale,
          },
          pane,
          natural,
        );
      });
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, [pane, natural]);
  if (!item) return null;
  const selection: MediaSelection = {
    item,
    ...(region && natural
      ? { region: pixelRegion(region.a, region.b, natural) }
      : {}),
    ...(isVideo
      ? {
          time,
          ...(clipStart !== null && clipEnd !== null && clipEnd >= clipStart
            ? { clip: { start: clipStart, end: clipEnd } }
            : {}),
        }
      : {}),
  };
  const seek = (value: number) => {
    if (video.current && duration) {
      video.current.currentTime = clamp(value, 0, duration);
      setTime(video.current.currentTime);
    }
  };
  const step = (direction: number) => {
    video.current?.pause();
    seek(time + direction / fps);
  };
  const play = () => {
    const node = video.current;
    if (node) {
      if (node.paused)
        void node
          .play()
          .catch(() =>
            setNotice(
              "Playback could not start. Try Play again or download the original.",
            ),
          );
      else node.pause();
    }
  };
  function point(event: PointerEvent<HTMLDivElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    return {
      x: clamp((event.clientX - box.left) / box.width),
      y: clamp((event.clientY - box.top) / box.height),
    };
  }
  function pointerUp(event: PointerEvent<HTMLDivElement>) {
    pointers.current.delete(event.pointerId);
    pinch.current = null;
    const remaining = [...pointers.current.values()][0];
    drag.current = remaining
      ? { start: remaining, view: liveView.current }
      : null;
  }
  async function copy() {
    const { item: selected, ...position } = selection;
    let reference="";
    try {
      reference=mediaReference(selected,position);
      await copyText(reference);
      setCopied("Copied");setManualCopy("");
    } catch {
      setCopied("Copy unavailable");
      setManualCopy(reference);
    }
  }

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement === surface.current)
        await document.exitFullscreen();
      else await surface.current?.requestFullscreen();
    } catch {
      setNotice("Fullscreen is unavailable in this browser context.");
    }
  }
  return (
    <dialog
      ref={dialog}
      className="prism-lightbox"
      aria-label={item.name || "Media viewer"}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={(event) => {
        if (
          event.defaultPrevented ||
          (event.target as HTMLElement).matches("input,textarea,select")
        )
          return;
        if (event.key === "Escape") {
          event.preventDefault();
          if (document.fullscreenElement === surface.current)
            void document.exitFullscreen();
          else onClose();
        }
        if (event.key === "0") changeView(FIT_VIEW);
        if (event.key === "+" || event.key === "=")
          changeView((previous) => ({
            ...previous,
            zoom: Math.min(32, previous.zoom * 1.25),
          }));
        if (event.key === "-")
          changeView((previous) => ({
            ...previous,
            zoom: Math.max(1, previous.zoom / 1.25),
          }));
        if (isVideo && event.key === ".") {
          event.preventDefault();
          step(1);
        }
        if (isVideo && event.key === ",") {
          event.preventDefault();
          step(-1);
        }
        if (
          isVideo &&
          event.key === " " &&
          !(event.target as HTMLElement).closest("button")
        ) {
          event.preventDefault();
          play();
        }
        if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
          event.preventDefault();
          const direction = event.key === "ArrowRight" ? 1 : -1;
          if (isVideo) seek(time + direction * 5);
          else setIndex((index + direction + items.length) % items.length);
        }
      }}
    >
      <div ref={surface} className="prism-lightbox-surface">
        <header className="prism-lightbox-header">
          <div>
            <strong>{item.name || "Media"}</strong>
            <span>
              {index + 1} / {items.length}
            </span>
          </div>
          <div>
            {items.length > 1 && (
              <>
                <button
                  onClick={() =>
                    setIndex((index - 1 + items.length) % items.length)
                  }
                  aria-label="Previous media"
                >
                  ←
                </button>
                <button
                  onClick={() => setIndex((index + 1) % items.length)}
                  aria-label="Next media"
                >
                  →
                </button>
              </>
            )}
            <a href={item.url} download={item.name || "media"}>
              Download
            </a>
            <button autoFocus onClick={onClose} aria-label="Close media viewer">
              Close ×
            </button>
          </div>
        </header>
        <div
          ref={stage}
          tabIndex={0}
          role="region"
          aria-label={
            isVideo ? "Zoomable video viewport" : "Zoomable image viewport"
          }
          className={
            "prism-lightbox-stage" + (selecting ? " select-region" : "")
          }
          onDoubleClick={(event) => {
            if (!(event.target as HTMLElement).closest("button,input,select,a"))
              changeView(FIT_VIEW);
          }}
          onPointerDown={(event) => {
            if (
              selecting ||
              (event.target as HTMLElement).closest("button,input,select,a")
            )
              return;
            if (event.pointerType === "mouse" && event.button !== 0) return;
            event.preventDefault();
            event.currentTarget.focus({ preventScroll: true });
            event.currentTarget.setPointerCapture(event.pointerId);
            const current = { x: event.clientX, y: event.clientY };
            pointers.current.set(event.pointerId, current);
            const positions = [...pointers.current.values()];
            if (positions.length === 2) {
              const [a, b] = positions,
                box = event.currentTarget.getBoundingClientRect();
              pinch.current = {
                distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
                center: {
                  x: (a.x + b.x) / 2 - box.left,
                  y: (a.y + b.y) / 2 - box.top,
                },
                transform: viewToTransform(liveView.current, pane, natural),
              };
              drag.current = null;
            } else if (positions.length === 1)
              drag.current = { start: current, view: liveView.current };
          }}
          onPointerMove={(event) => {
            if (!pointers.current.has(event.pointerId)) return;
            pointers.current.set(event.pointerId, {
              x: event.clientX,
              y: event.clientY,
            });
            const gesture = pinch.current;
            if (gesture && pointers.current.size === 2) {
              const [a, b] = [...pointers.current.values()],
                box = event.currentTarget.getBoundingClientRect();
              const scale = clamp(
                (gesture.transform.scale * Math.hypot(a.x - b.x, a.y - b.y)) /
                  gesture.distance,
                1,
                32,
              );
              const center = {
                x: (a.x + b.x) / 2 - box.left,
                y: (a.y + b.y) / 2 - box.top,
              };
              changeView(
                transformToView(
                  {
                    scale,
                    x:
                      center.x -
                      ((gesture.center.x - gesture.transform.x) * scale) /
                        gesture.transform.scale,
                    y:
                      center.y -
                      ((gesture.center.y - gesture.transform.y) * scale) /
                        gesture.transform.scale,
                  },
                  pane,
                  natural,
                ),
              );
            } else if (drag.current) {
              const start = drag.current,
                old = viewToTransform(start.view, pane, natural);
              changeView(
                transformToView(
                  {
                    ...old,
                    x: old.x + event.clientX - start.start.x,
                    y: old.y + event.clientY - start.start.y,
                  },
                  pane,
                  natural,
                ),
              );
            }
          }}
          onPointerUp={pointerUp}
          onPointerCancel={pointerUp}
          onLostPointerCapture={pointerUp}
        >
          {failure ? (
            <div role="alert" className="prism-lightbox-error">
              {failure}{" "}
              <a href={item.url} download={item.name}>
                Download original
              </a>
            </div>
          ) : (
            <div
              className="prism-lightbox-transform"
              style={{
                width: pane.w,
                height: pane.h,
                transform:
                  "translate(" +
                  transform.x +
                  "px," +
                  transform.y +
                  "px) scale(" +
                  transform.scale +
                  ")",
              }}
            >
              {isVideo ? (
                <video
                  key={item.url}
                  ref={video}
                  preload="metadata"
                  loop={loop && clipEnd === null}
                  playsInline
                  muted={muted}
                  style={{
                    position: "absolute",
                    left: fit.x,
                    top: fit.y,
                    width: fit.w,
                    height: fit.h,
                    imageRendering: crisp,
                  }}
                  onPlay={() => setPlaying(true)}
                  onPause={() => setPlaying(false)}
                  onEnded={() => setPlaying(false)}
                  onDurationChange={(event) => {
                    if (Number.isFinite(event.currentTarget.duration))
                      setDuration(event.currentTarget.duration);
                  }}
                  onLoadedMetadata={(event) => {
                    const node = event.currentTarget;
                    setNatural({ w: node.videoWidth, h: node.videoHeight });
                    setDuration(
                      Number.isFinite(node.duration) ? node.duration : 0,
                    );
                    node.volume = volume;
                    node.playbackRate = rate;
                    if (item.time && Number.isFinite(item.time)) {
                      node.currentTime = clamp(
                        item.time,
                        0,
                        Number.isFinite(node.duration)
                          ? node.duration
                          : item.time,
                      );
                      setTime(node.currentTime);
                    }
                  }}
                  onTimeUpdate={(event) => {
                    const node = event.currentTarget;
                    setTime(node.currentTime);
                    if (
                      loop &&
                      clipStart !== null &&
                      clipEnd !== null &&
                      clipEnd > clipStart &&
                      node.currentTime >= clipEnd
                    )
                      node.currentTime = clipStart;
                  }}
                  onError={() =>
                    setFailure(
                      "This video codec or file could not be decoded by the browser.",
                    )
                  }
                >
                  <source src={item.url} type={item.mime} />
                </video>
              ) : (
                <img
                  src={item.url}
                  alt={item.name || "Media"}
                  draggable={false}
                  style={{
                    position: "absolute",
                    left: fit.x,
                    top: fit.y,
                    width: fit.w,
                    height: fit.h,
                    imageRendering: crisp,
                  }}
                  onLoad={(event) =>
                    setNatural({
                      w: event.currentTarget.naturalWidth,
                      h: event.currentTarget.naturalHeight,
                    })
                  }
                  onError={() =>
                    setFailure(
                      "This image format could not be decoded by the browser.",
                    )
                  }
                />
              )}
              {selecting && !isVideo && (
                <div
                  className="prism-region-layer"
                  style={{
                    left: fit.x,
                    top: fit.y,
                    width: fit.w,
                    height: fit.h,
                  }}
                  onPointerDown={(event) => {
                    const p = point(event);
                    setRegion({ a: p, b: p });
                    event.currentTarget.setPointerCapture(event.pointerId);
                  }}
                  onPointerMove={(event) => {
                    if (event.buttons) {
                      const p = point(event);
                      setRegion((previous) =>
                        previous ? { ...previous, b: p } : null,
                      );
                    }
                  }}
                  onPointerUp={(event) => {
                    const p = point(event);
                    setRegion((previous) =>
                      previous ? { ...previous, b: p } : null,
                    );
                  }}
                >
                  {region && (
                    <div
                      className="prism-region-box"
                      style={{
                        left: Math.min(region.a.x, region.b.x) * 100 + "%",
                        top: Math.min(region.a.y, region.b.y) * 100 + "%",
                        width: Math.abs(region.b.x - region.a.x) * 100 + "%",
                        height: Math.abs(region.b.y - region.a.y) * 100 + "%",
                        borderWidth: 2 / transform.scale,
                      }}
                    />
                  )}
                </div>
              )}
            </div>
          )}
          <div className="prism-zoom-toolbar" aria-label="Media zoom controls">
            <button
              aria-label="Zoom out"
              onClick={() =>
                changeView((previous) => ({
                  ...previous,
                  zoom: Math.max(1, previous.zoom / 1.25),
                }))
              }
            >
              −
            </button>
            <output aria-label="Zoom level">
              {Math.round(view.zoom * 100)}%
            </output>
            <button
              aria-label="Zoom in"
              onClick={() =>
                changeView((previous) => ({
                  ...previous,
                  zoom: Math.min(32, previous.zoom * 1.25),
                }))
              }
            >
              +
            </button>
            <button onClick={() => changeView(FIT_VIEW)}>Fit / reset</button>
            <button
              onClick={() => void toggleFullscreen()}
              aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen viewer"}
            >
              {fullscreen ? "Exit fullscreen" : "Fullscreen"}
            </button>
          </div>
          <span className="prism-gesture-hint">
            Scroll or pinch to zoom · drag to pan · double-click to fit
          </span>
        </div>
        {isVideo && (
          <div className="prism-video-transport">
            <div className="prism-video-main">
              <button onClick={play}>
                {playing ? "Pause video" : "Play video"}
              </button>
              <input
                aria-label="Video position"
                type="range"
                min={0}
                max={duration || 1}
                step="any"
                value={time}
                disabled={!duration}
                onChange={(event) => seek(Number(event.target.value))}
              />
              <span>
                {time.toFixed(3)} / {duration.toFixed(3)} s
              </span>
            </div>
            <div className="prism-video-options">
              <button
                onClick={() => step(-1)}
                aria-label="Previous video frame"
              >
                ▏←
              </button>
              <button onClick={() => step(1)} aria-label="Next video frame">
                →▕
              </button>
              <label>
                FPS{" "}
                <input
                  aria-label="Frame step rate"
                  type="number"
                  min={1}
                  max={240}
                  value={fps}
                  onChange={(event) =>
                    setFps(clamp(Number(event.target.value) || 30, 1, 240))
                  }
                />
              </label>
              <label>
                Speed{" "}
                <Select
                  label="Playback speed"
                  value={String(rate)}
                  onChange={(value) => {
                    const next = Number(value);
                    setRate(next);
                    if (video.current) video.current.playbackRate = next;
                  }}
                  options={[0.25, 0.5, 1, 1.5, 2].map((value) => ({
                    value: String(value),
                    label: value + "×",
                  }))}
                />
              </label>
              <button
                onClick={() => {
                  setMuted(!muted);
                  if (video.current) video.current.muted = !muted;
                }}
                aria-label={muted ? "Unmute video" : "Mute video"}
              >
                {muted ? "Unmute" : "Mute"}
              </button>
              <input
                aria-label="Video volume"
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={volume}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  setVolume(next);
                  if (video.current) video.current.volume = next;
                }}
              />
              <label>
                <input
                  type="checkbox"
                  checked={loop}
                  onChange={(event) => setLoop(event.target.checked)}
                />{" "}
                Loop
              </label>
              <button
                onClick={() => {
                  setClipStart(time);
                  if (clipEnd !== null && clipEnd < time) setClipEnd(null);
                }}
              >
                Mark start
              </button>
              <button
                disabled={clipStart === null || time < clipStart}
                onClick={() => setClipEnd(time)}
              >
                Mark end
              </button>
              {clipStart !== null && (
                <span>
                  Clip {clipStart.toFixed(3)}–{clipEnd?.toFixed(3) || "…"} s{" "}
                  <button
                    onClick={() => {
                      setClipStart(null);
                      setClipEnd(null);
                    }}
                  >
                    Clear clip
                  </button>
                </span>
              )}
            </div>
          </div>
        )}
        {notice && (
          <div role="status" className="prism-media-notice">
            {notice}
          </div>
        )}
        {manualCopy&&<div className="report-copy-fallback"><p>Select and copy this reference:</p><textarea readOnly aria-label="Reference to copy" value={manualCopy} onFocus={event=>event.currentTarget.select()}/></div>}
        <footer className="prism-lightbox-footer">
          <div>
            <button onClick={copy}>
              {copied ||
                (selection.clip
                  ? "Copy clip reference"
                  : selection.region
                    ? "Copy region reference"
                    : isVideo
                      ? "Copy time reference"
                      : "Copy source reference")}
            </button>
            {onSelection && (
              <button onClick={() => onSelection(selection)}>
                Use selection
              </button>
            )}
            {!isVideo && (
              <button
                aria-pressed={selecting}
                onClick={() => {
                  setSelecting(!selecting);
                  setRegion(null);
                }}
              >
                Mark region
              </button>
            )}
          </div>
          <small>
            {natural ? natural.w + " × " + natural.h : "Loading dimensions"}
            {isVideo && !item.fps ? " · frame step uses chosen FPS" : ""}
          </small>
        </footer>
      </div>
    </dialog>
  );
}
