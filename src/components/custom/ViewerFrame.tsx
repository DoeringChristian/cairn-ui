/**
 * One custom viewer pane: the viewer's code in a sandboxed frame, fed the
 * pane's logged values over postMessage (lib/custom/protocol.ts).
 *
 * Security contract (do not weaken; same as components/viewers/HtmlViewer.tsx):
 * viewer code only ever runs inside `<iframe sandbox="allow-scripts" srcdoc>`
 * — no `allow-same-origin` (opaque origin: no cookies, storage, API or DOM of
 * the app), no `allow-popups`, `allow-forms`, `allow-top-navigation`. The
 * frame's CSP (lib/custom/sdk-runtime.ts) forbids every network request; its
 * modules arrive as text in `cairn:boot` and become blob URLs inside it.
 * Messages from the frame are only taken from this frame's window and pass
 * through `decodeFrameMessage`. A frame that navigates itself away is
 * stopped (it gets no more data).
 *
 * WebGL viewers (`webgl: true`) count against the page's WebGL budget
 * (charts/gl-budget-manager.ts): a frame the budget pauses is asked for a
 * snapshot, torn down and shown as that picture until it is scrolled to or
 * hovered again.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import type { SequencePoint } from "../../api/types";
import { glBudget, type GlRegistration } from "../../charts/gl-budget-manager";
import { pointCaption } from "../../lib/caption";
import type { ViewerBundle } from "../../lib/custom/bundle";
import { decodeForViewer, parseCustomMeta } from "../../lib/custom/data";
import { frameWeight } from "../../lib/custom/budget";
import { registerFrameExport } from "../../lib/custom/frame-snapshots";
import { CaptureQueue } from "../../lib/custom/capture-queue";
import { artifactBytesQuery } from "../../lib/custom/hooks";
import { loadViewerBundle, type Viewer } from "../../lib/custom/loader";
import { decodeFrameMessage, hostMessage, transferables, type HostMessage, type ViewerInput, type ViewerSize, type ViewerTheme } from "../../lib/custom/protocol";
import { viewerDocument } from "../../lib/custom/sdk-runtime";
import type { ZoomViewSync, ZoomViewFollower } from "../../lib/media/zoom-view-sync";

/** One value the pane shows: a logged point and where it comes from. */
export interface FrameInput {
  point: SequencePoint;
  /** Where the bytes load from (an artifact version's file); default `/api/artifacts/{hash}`. */
  url?: string;
  run: string;
  name: string;
  label: string;
}

/** Until `cairn:loaded`: the viewer's modules failed or hang. */
const LOAD_TIMEOUT_MS = 15_000;
/** Until `cairn:rendered`: the render callback hangs. */
const RENDER_TIMEOUT_MS = 20_000;
const SNAPSHOT_TIMEOUT_MS = 1000;
/** A capture turn gives up after this long (the viewer never rendered). */
const CAPTURE_TIMEOUT_MS = 10_000;

/** Paused frames take turns here to render briefly for a snapshot (see capture-queue.ts). */
const captures = new CaptureQueue(1);
let nextFrameId = 1;

/** The app's theme tokens, for viewers to match. */
export function readViewerTheme(el: Element | null): ViewerTheme {
  const style = getComputedStyle(el ?? document.documentElement);
  const token = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  return {
    mode: "light",
    bg: token("--color-bg", "#ffffff"),
    fg: token("--color-fg", "#1f2328"),
    muted: token("--color-fg-muted", "#656d76"),
    border: token("--color-border", "#d0d7de"),
    accent: token("--color-accent", "#0969da"),
    font: style.fontFamily || "system-ui, sans-serif",
    monoFont: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  };
}

/** A built-in kind's artifact metadata (a volume's shape, spacing, value range, …): its `meta` for a viewer. */
function builtinMeta(raw: unknown): Record<string, unknown> {
  let v = raw;
  if (typeof raw === "string") {
    try {
      v = JSON.parse(raw);
    } catch {
      return {};
    }
  }
  return v != null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function inputOf(f: FrameInput, data: unknown): ViewerInput {
  const meta = parseCustomMeta(f.point.artifact_metadata);
  const caption = pointCaption(f.point.metadata);
  return {
    data,
    format: meta?.format ?? f.point.artifact_mime ?? "bytes",
    kind: meta?.kind ?? f.point.object_type,
    // Custom data: the `meta` logged with it; a built-in kind: its artifact metadata.
    meta: meta ? meta.meta : builtinMeta(f.point.artifact_metadata),
    step: f.point.step,
    run: f.run,
    name: f.name,
    label: f.label,
    ...(caption ? { caption } : {}),
  };
}

interface FrameError {
  message: string;
  stack?: string;
}

export default function ViewerFrame({
  project,
  viewer,
  inputs,
  step,
  settings,
  view,
  bus,
  onViewCommit,
  onSettingsPatch,
  height,
  title,
}: {
  project: string;
  viewer: Viewer;
  inputs: FrameInput[];
  step: number;
  /** The viewer's settings values (manifest keys). */
  settings: Record<string, unknown>;
  /** The card's stored view (shared by its panes). */
  view?: unknown;
  /** Live view sync with the card's other panes. */
  bus?: ZoomViewSync<unknown>;
  /** The user's view gesture ended: store it on the card. */
  onViewCommit?: (view: unknown) => void;
  /** The viewer changed its own settings (`setSettings`; checked by the caller against the manifest). */
  onSettingsPatch?: (patch: Record<string, string | number | boolean>) => void;
  /** Fixed height in px; omitted, the pane fills its parent. */
  height?: number;
  /** The frame's accessible title. */
  title: string;
}) {
  const manifest = viewer.manifest;
  const webgl = manifest ? frameWeight(manifest) > 0 : false;
  const boxRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [bundle, setBundle] = useState<ViewerBundle | null>(null);
  const [error, setError] = useState<FrameError | null>(viewer.error ? { message: viewer.error } : null);
  // A budgeted frame waits for the budget to let it in.
  const [live, setLive] = useState(!webgl);
  /** The last picture of the frame, and what it showed (data, step, settings). */
  const [snap, setSnap] = useState<{ url: string; key: string } | null>(null);
  /** Running briefly (paused by the budget) to take a snapshot. */
  const [capturing, setCapturing] = useState(false);
  const capturingRef = useRef(false);
  capturingRef.current = capturing;
  const captureDone = useRef<(() => void) | null>(null);
  /** 2 on screen, 1 near it, 0 away: what a paused frame's capture turn is worth. */
  const [onScreen, setOnScreen] = useState(0);
  const frameId = useMemo(() => `f${nextFrameId++}`, []);
  const [mountId, setMountId] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [stopped, setStopped] = useState(false);
  /** A render was sent and has not returned yet (exports wait for it). */
  const [renderPending, setRenderPending] = useState(false);
  /** While printing: the snapshot shown in place of the frame (frame-snapshots.ts). */
  const [printUrl, setPrintUrl] = useState<string | null>(null);

  // Latest props for the message handlers (which outlive renders).
  const viewCommitRef = useRef(onViewCommit);
  viewCommitRef.current = onViewCommit;
  const settingsPatchRef = useRef(onSettingsPatch);
  settingsPatchRef.current = onSettingsPatch;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  /** The settings the frame has (from the last render or settings message). */
  const sentSettingsJson = useRef<string | null>(null);
  const lastViewJson = useRef<string | undefined>(undefined);
  const viewRef = useRef(view);
  viewRef.current = view;
  const sizeRef = useRef<ViewerSize>({ width: 0, height: 0, dpr: 1 });
  const snapshotWaiters = useRef(new Map<number, (url: string | null) => void>());
  const seqRef = useRef(0);
  const renderTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const post = (msg: HostMessage, transfer: Transferable[] = []) => {
    // The frame's origin is opaque: "*" is the only target that reaches it.
    frameRef.current?.contentWindow?.postMessage(msg, "*", transfer);
  };

  // The viewer's files (cached per version for the page).
  useEffect(() => {
    let cancelled = false;
    setBundle(null);
    setLoaded(false);
    if (!viewer.manifest) {
      setError({ message: viewer.error ?? "invalid viewer" });
      return;
    }
    setError(null);
    loadViewerBundle(project, viewer).then(
      (b) => !cancelled && setBundle(b),
      (e) => !cancelled && setError({ message: `could not load viewer ${viewer.info.name}: ${e instanceof Error ? e.message : String(e)}` }),
    );
    return () => {
      cancelled = true;
    };
  }, [project, viewer]);

  // The inputs' bytes.
  const byteQueries = useQueries({
    queries: inputs.map((f) => ({ ...artifactBytesQuery(f.point.artifact_hash ?? "", f.url), enabled: !!f.point.artifact_hash })),
  });
  const buffers = byteQueries.map((q) => q.data);
  const ready = buffers.every((b) => b != null);
  const bytesError = byteQueries.find((q) => q.error)?.error;
  const buffersKey = byteQueries.map((q) => q.dataUpdatedAt).join("|") + inputs.map((f) => f.point.artifact_hash).join("|");
  const settingsJson = JSON.stringify(settings);

  const dataKey = `${viewer.key}|${buffersKey}|${step}|${settingsJson}`;
  const dataKeyRef = useRef(dataKey);
  dataKeyRef.current = dataKey;
  const showFrame = (live || capturing) && !stopped && bundle != null && manifest != null;
  const frameKey = `${viewer.key}:${mountId}`;

  // Messages from this frame only.
  useEffect(() => {
    if (!showFrame) return;
    const onMessage = (e: MessageEvent) => {
      if (e.source == null || e.source !== frameRef.current?.contentWindow) return;
      const msg = decodeFrameMessage(e.data);
      if (!msg) return;
      switch (msg.type) {
        case "cairn:ready":
          post(hostMessage({ type: "cairn:boot", files: bundle!.files, imports: bundle!.imports, entry: bundle!.entry }));
          break;
        case "cairn:loaded":
          setLoaded(true);
          break;
        case "cairn:rendered":
          if (msg.seq === seqRef.current && renderTimer.current) {
            clearTimeout(renderTimer.current);
            renderTimer.current = null;
          }
          if (msg.seq === seqRef.current) setRenderPending(false);
          // A capture turn: the picture is there, keep it and give the turn back.
          if (msg.seq === seqRef.current && capturingRef.current) {
            const key = dataKeyRef.current;
            void requestSnapshot().then((url) => {
              if (url) setSnap({ url, key });
              finishCapture();
            });
          }
          break;
        case "cairn:view":
          lastViewJson.current = JSON.stringify(msg.view);
          bus?.publish(msg.view, follower);
          if (msg.final) viewCommitRef.current?.(msg.view);
          break;
        case "cairn:snapshot": {
          const w = snapshotWaiters.current.get(msg.id);
          snapshotWaiters.current.delete(msg.id);
          w?.(msg.url);
          break;
        }
        case "cairn:error":
          setError({ message: msg.message, stack: msg.stack });
          setRenderPending(false);
          break;
        case "cairn:settings":
          settingsPatchRef.current?.(msg.patch);
          break;
        case "cairn:size":
          break;
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showFrame, frameKey, bundle, bus]);

  // A viewer that never finishes loading.
  useEffect(() => {
    if (!showFrame || loaded) return;
    const t = setTimeout(() => setError({ message: `viewer ${viewer.info.name} did not load within ${LOAD_TIMEOUT_MS / 1000} s` }), LOAD_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [showFrame, loaded, frameKey, viewer.info.name]);

  // Render whenever the data or step change (settings alone: see below).
  useEffect(() => {
    if (!showFrame || !loaded || !ready) return;
    let cancelled = false;
    const seq = ++seqRef.current;
    void (async () => {
      try {
        const decoded = await Promise.all(
          inputs.map((f, i) => decodeForViewer(buffers[i]!, parseCustomMeta(f.point.artifact_metadata)?.format ?? null, parseCustomMeta(f.point.artifact_metadata)?.values)),
        );
        if (cancelled) return;
        const payload = inputs.map((f, i) => inputOf(f, decoded[i]));
        const msg = hostMessage({
          type: "cairn:render", seq, inputs: payload, step, settings: settingsRef.current, size: sizeRef.current,
          theme: readViewerTheme(boxRef.current), view: viewRef.current ?? null,
        });
        lastViewJson.current = JSON.stringify(viewRef.current ?? null);
        sentSettingsJson.current = JSON.stringify(settingsRef.current);
        post(msg, transferables(payload));
        setRenderPending(true);
        if (renderTimer.current) clearTimeout(renderTimer.current);
        renderTimer.current = setTimeout(() => {
          renderTimer.current = null;
          setRenderPending(false);
          setError({ message: `viewer ${viewer.info.name} did not finish rendering step ${step} within ${RENDER_TIMEOUT_MS / 1000} s` });
        }, RENDER_TIMEOUT_MS);
      } catch (e) {
        if (!cancelled) setError({ message: `could not decode the data: ${e instanceof Error ? e.message : String(e)}` });
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showFrame, loaded, ready, buffersKey, step, frameKey]);

  // Only the settings changed: the frame keeps its inputs (onSettings, or a re-render there).
  useEffect(() => {
    if (!showFrame || !loaded || sentSettingsJson.current == null || sentSettingsJson.current === settingsJson) return;
    sentSettingsJson.current = settingsJson;
    post(hostMessage({ type: "cairn:settings", settings }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsJson, showFrame, loaded]);

  useEffect(() => () => {
    if (renderTimer.current) clearTimeout(renderTimer.current);
  }, []);

  // The stored view changed (another pane's gesture ended, a reset): show it.
  useEffect(() => {
    if (!showFrame || !loaded) return;
    const json = JSON.stringify(view ?? null);
    if (json === lastViewJson.current) return;
    lastViewJson.current = json;
    post(hostMessage({ type: "cairn:view", view: view ?? null }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, showFrame, loaded]);

  // Live view sync: a sibling pane's gesture shows here at once.
  const follower = useMemo<ZoomViewFollower<unknown>>(
    () => ({
      show: (v) => {
        lastViewJson.current = JSON.stringify(v);
        frameRef.current?.contentWindow?.postMessage(hostMessage({ type: "cairn:view", view: v }), "*");
      },
    }),
    [],
  );
  useEffect(() => (bus ? bus.join(follower) : undefined), [bus, follower]);

  // Size.
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    let raf = 0;
    const measure = () => {
      const r = el.getBoundingClientRect();
      const next = { width: Math.round(r.width), height: Math.round(r.height), dpr: window.devicePixelRatio || 1 };
      const prev = sizeRef.current;
      if (prev.width === next.width && prev.height === next.height && prev.dpr === next.dpr) return;
      sizeRef.current = next;
      if (frameRef.current) post(hostMessage({ type: "cairn:resize", size: next }));
    };
    measure();
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Snapshots: asked of the frame, answered by its snapshot() callback (or its first canvas).
  const loadedRef = useRef(loaded);
  loadedRef.current = loaded;
  const snapshotId = useRef(1);
  const requestSnapshot = () =>
    new Promise<string | null>((resolve) => {
      if (!frameRef.current || !loadedRef.current) return resolve(null);
      const id = snapshotId.current++;
      const timer = setTimeout(() => {
        snapshotWaiters.current.delete(id);
        resolve(null);
      }, SNAPSHOT_TIMEOUT_MS);
      snapshotWaiters.current.set(id, (url) => {
        clearTimeout(timer);
        resolve(url);
      });
      frameRef.current.contentWindow?.postMessage(hostMessage({ type: "cairn:snapshot", id }), "*");
    });
  const finishCapture = () => {
    const done = captureDone.current;
    captureDone.current = null;
    if (!capturingRef.current && !done) return;
    capturingRef.current = false;
    setCapturing(false);
    setLoaded(false);
    done?.();
  };

  // Report exports: the viewer's snapshot while it runs, else the picture shown while paused.
  const snapRef = useRef(snap);
  snapRef.current = snap;
  const liveRef = useRef(false);
  liveRef.current = showFrame && loaded && !capturing;
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    return registerFrameExport(el, {
      snapshot: async () => (liveRef.current ? ((await requestSnapshot()) ?? snapRef.current?.url ?? null) : (snapRef.current?.url ?? null)),
      setPrint: setPrintUrl,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The WebGL budget: paused frames become their snapshot.
  const reg = useRef<GlRegistration | null>(null);
  useEffect(() => {
    const el = boxRef.current;
    if (!webgl || !el) return;
    const r = glBudget.register(el, {
      activate: () => {
        // Live now: a capture turn in progress is over (its frame stays as the live one).
        const done = captureDone.current;
        captureDone.current = null;
        if (capturingRef.current) {
          capturingRef.current = false;
          setCapturing(false);
          done?.();
          setLive(true);
          return;
        }
        setLoaded(false);
        setMountId((n) => n + 1);
        setLive(true);
      },
      deactivate: async () => {
        const key = dataKeyRef.current;
        const url = await requestSnapshot();
        if (url) setSnap({ url, key });
        setLive(false);
        setLoaded(false);
      },
    }, 1);
    reg.current = r;
    return () => {
      r.unregister();
      reg.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [webgl]);

  // Where the frame is (a paused frame's capture turn goes to on-screen frames first).
  useEffect(() => {
    const el = boxRef.current;
    if (!webgl || !el) return;
    const visible = new IntersectionObserver(([e]) => setOnScreen((v) => (e!.isIntersecting ? 2 : v === 2 ? 0 : v)), { threshold: 0 });
    const near = new IntersectionObserver(([e]) => setOnScreen((v) => (e!.isIntersecting ? Math.max(v, 1) : 0)), { rootMargin: "100% 0px", threshold: 0 });
    visible.observe(el);
    near.observe(el);
    return () => {
      visible.disconnect();
      near.disconnect();
    };
  }, [webgl]);

  // A paused frame on or near the screen without a current picture takes a capture turn.
  const needsCapture = webgl && !live && !capturing && !stopped && !error && bundle != null && ready && onScreen > 0 && snap?.key !== dataKey;
  useEffect(() => {
    if (!needsCapture) return;
    const cancel = captures.request(frameId, (done) => {
      captureDone.current = done;
      capturingRef.current = true;
      setLoaded(false);
      setMountId((n) => n + 1);
      setCapturing(true);
    }, onScreen);
    return () => {
      // Only a turn that has not started yet is dropped here; a started one ends in finishCapture.
      if (!capturingRef.current) cancel();
    };
  }, [needsCapture, frameId, onScreen, dataKey]);

  // A capture turn that never renders gives the turn back.
  useEffect(() => {
    if (!capturing) return;
    const t = setTimeout(finishCapture, CAPTURE_TIMEOUT_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capturing]);

  // Unmounting mid-turn gives the turn back.
  useEffect(() => () => {
    captureDone.current?.();
    captures.cancel(frameId);
  }, [frameId]);

  const message = error ?? (bytesError ? { message: `could not fetch the data: ${String(bytesError)}` } : null);
  useEffect(() => {
    if (!loaded) sentSettingsJson.current = null;
  }, [loaded]);

  const reload = () => {
    setError(null);
    setStopped(false);
    setLoaded(false);
    setMountId((n) => n + 1);
  };

  return (
    <div
      ref={boxRef}
      className="relative w-full min-h-0 overflow-hidden rounded bg-bg"
      style={{ height: height ?? "100%" }}
      data-viewer="custom"
      data-viewer-name={viewer.info.name}
      data-viewer-state={capturing ? "capturing" : showFrame ? (loaded ? "live" : "loading") : live ? "waiting" : snap ? "snapshot" : "paused"}
      data-viewer-busy={String(!message && ((showFrame && (!loaded || !ready || renderPending)) || (live && !showFrame && !stopped)))}
      onPointerEnter={() => reg.current?.pin(true)}
      onPointerLeave={() => reg.current?.pin(false)}
      onPointerDown={() => reg.current?.touch()}
      onWheel={() => reg.current?.touch()}
    >
      {showFrame ? (
        <iframe
          key={frameKey}
          ref={frameRef}
          sandbox="allow-scripts"
          srcDoc={viewerDocument()}
          title={title}
          className={`absolute inset-0 h-full w-full border-0${printUrl ? " print:hidden" : ""}`}
          onLoad={(e) => {
            // srcdoc loads once; a second load means the frame navigated itself away.
            const el = e.currentTarget as HTMLIFrameElement & { __cairnLoads?: number };
            el.__cairnLoads = (el.__cairnLoads ?? 0) + 1;
            if (el.__cairnLoads > 1) {
              setStopped(true);
              setError({ message: "the viewer navigated its frame away; it was stopped" });
            }
          }}
        />
      ) : null}
      {/* Printing: the viewer's snapshot (its own canvas may print blank). */}
      {printUrl && <img src={printUrl} alt={title} className="pointer-events-none absolute inset-0 hidden h-full w-full object-contain print:block" draggable={false} />}
      {/* While paused (or while a capture turn loads behind it): the last picture, else a skeleton. */}
      {(!showFrame || capturing) &&
        (snap ? (
          <img src={snap.url} alt={title} className="pointer-events-none absolute inset-0 h-full w-full object-contain" draggable={false} />
        ) : (
          <div className="absolute inset-0 motion-safe:animate-pulse bg-bg-hover" aria-label={`${title}: loading`} />
        ))}
      {!ready && !message && showFrame && (
        <div className="pointer-events-none absolute right-1 top-1 rounded bg-bg/80 px-1 text-[10px] text-fg-subtle">loading data…</div>
      )}
      {message && (
        <div role="alert" className="absolute inset-x-1 bottom-1 max-h-[70%] overflow-auto rounded border border-status-failed/40 bg-bg/95 p-2 text-xs text-status-failed">
          <div className="flex items-start gap-2">
            <pre className="min-w-0 flex-1 whitespace-pre-wrap break-words font-mono">{message.message}</pre>
            <button type="button" onClick={reload} className="shrink-0 rounded px-1.5 py-0.5 text-fg-muted hover:bg-bg-hover hover:text-fg">
              Reload
            </button>
          </div>
          {message.stack && <pre className="mt-1 whitespace-pre-wrap break-words text-[10px] text-fg-muted">{message.stack}</pre>}
        </div>
      )}
    </div>
  );
}
