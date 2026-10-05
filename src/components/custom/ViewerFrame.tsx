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
import { artifactBytesQuery } from "../../lib/custom/hooks";
import { loadViewerBundle, type Viewer } from "../../lib/custom/loader";
import { decodeFrameMessage, hostMessage, transferables, type HostMessage, type ViewerInput, type ViewerSize, type ViewerTheme } from "../../lib/custom/protocol";
import { viewerDocument } from "../../lib/custom/sdk-runtime";
import type { ZoomViewSync, ZoomViewFollower } from "../../lib/media/zoom-view-sync";

/** One value the pane shows: a logged point and where it comes from. */
export interface FrameInput {
  point: SequencePoint;
  run: string;
  name: string;
  label: string;
}

/** Until `cairn:loaded`: the viewer's modules failed or hang. */
const LOAD_TIMEOUT_MS = 15_000;
/** Until `cairn:rendered`: the render callback hangs. */
const RENDER_TIMEOUT_MS = 20_000;
const SNAPSHOT_TIMEOUT_MS = 1000;

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

function inputOf(f: FrameInput, data: unknown): ViewerInput {
  const meta = parseCustomMeta(f.point.artifact_metadata);
  const caption = pointCaption(f.point.metadata);
  return {
    data,
    format: meta?.format ?? f.point.artifact_mime ?? "bytes",
    kind: meta?.kind ?? f.point.object_type,
    meta: meta?.meta ?? {},
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
  const [snap, setSnap] = useState<string | null>(null);
  const [mountId, setMountId] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [stopped, setStopped] = useState(false);

  // Latest props for the message handlers (which outlive renders).
  const viewCommitRef = useRef(onViewCommit);
  viewCommitRef.current = onViewCommit;
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
    queries: inputs.map((f) => ({ ...artifactBytesQuery(f.point.artifact_hash ?? ""), enabled: !!f.point.artifact_hash })),
  });
  const buffers = byteQueries.map((q) => q.data);
  const ready = buffers.every((b) => b != null);
  const bytesError = byteQueries.find((q) => q.error)?.error;
  const buffersKey = byteQueries.map((q) => q.dataUpdatedAt).join("|") + inputs.map((f) => f.point.artifact_hash).join("|");
  const settingsJson = JSON.stringify(settings);

  const showFrame = live && !stopped && bundle != null && manifest != null;
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

  // Render whenever the data, step or settings change.
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
          type: "cairn:render", seq, inputs: payload, step, settings, size: sizeRef.current,
          theme: readViewerTheme(boxRef.current), view: viewRef.current ?? null,
        });
        lastViewJson.current = JSON.stringify(viewRef.current ?? null);
        post(msg, transferables(payload));
        if (renderTimer.current) clearTimeout(renderTimer.current);
        renderTimer.current = setTimeout(() => {
          renderTimer.current = null;
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
  }, [showFrame, loaded, ready, buffersKey, step, settingsJson, frameKey]);

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

  // The WebGL budget: paused frames become their snapshot.
  const reg = useRef<GlRegistration | null>(null);
  const loadedRef = useRef(loaded);
  loadedRef.current = loaded;
  useEffect(() => {
    const el = boxRef.current;
    if (!webgl || !el) return;
    let nextId = 1;
    const requestSnapshot = () =>
      new Promise<string | null>((resolve) => {
        if (!frameRef.current || !loadedRef.current) return resolve(null);
        const id = nextId++;
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
    const r = glBudget.register(el, {
      activate: () => {
        setLoaded(false);
        setMountId((n) => n + 1);
        setLive(true);
      },
      deactivate: async () => {
        const url = await requestSnapshot();
        if (url) setSnap(url);
        setLive(false);
        setLoaded(false);
      },
    }, 1);
    reg.current = r;
    return () => {
      r.unregister();
      reg.current = null;
    };
  }, [webgl]);

  const message = error ?? (bytesError ? { message: `could not fetch the data: ${String(bytesError)}` } : null);
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
      data-viewer-state={showFrame ? (loaded ? "live" : "loading") : live ? "waiting" : "paused"}
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
          className="absolute inset-0 h-full w-full border-0"
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
      ) : snap ? (
        <img src={snap} alt={title} className="absolute inset-0 h-full w-full object-contain" draggable={false} />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-fg-subtle">
          {!live ? "paused — scroll here or hover to resume" : !bundle && !message ? "loading viewer…" : null}
        </div>
      )}
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
