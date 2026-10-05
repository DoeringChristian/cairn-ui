/**
 * The card header's screenshot and download, for every card type (the
 * shared actions of components/card-header/CardHeaderActions.tsx).
 *
 * Screenshot (`captureCardPng`): the card's body as one PNG. Its DOM (text,
 * tables, tiles, diffs, legends) is rasterized through an SVG
 * `<foreignObject>` with every element's computed style inlined; over it go
 * the layers the DOM picture cannot hold, each at its on-screen place:
 * Plotly figures (`Plotly.toImage`), canvases (uPlot, three.js with
 * `preserveDrawingBuffer`), images, videos, custom viewers (their
 * `snapshot()`) and logged HTML documents (asked through the server's shim,
 * `cairn:snapshot`, to rasterize themselves the same way).
 *
 * The artifacts a card shows at its step (`cardArtifacts`): every viewer
 * marks its root with `data-cairn-artifact` (the content hash). The
 * downloads themselves are lib/download.ts `downloadCardPng` /
 * `downloadCardArtifacts`.
 */

import { snapshotFrame } from "./custom/frame-snapshots";

export interface Layer {
  rect: DOMRect;
  source: CanvasImageSource;
}

const CUSTOM_VIEWER = '[data-viewer="custom"]';
const HTML_FRAME = "iframe[data-cairn-html]";

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image decode failed"));
    img.src = src;
  });
}

/** Ask a logged HTML document (its server shim) for a picture of what it shows. */
function snapshotHtmlFrame(frame: HTMLIFrameElement, timeoutMs = 3000): Promise<string | null> {
  const win = frame.contentWindow;
  if (!win) return Promise.resolve(null);
  const id = Math.random().toString(36).slice(2);
  return new Promise((resolve) => {
    const done = (url: string | null) => {
      window.removeEventListener("message", onMsg);
      clearTimeout(t);
      resolve(url);
    };
    const onMsg = (e: MessageEvent) => {
      if (e.source !== win || e.data?.type !== "cairn:snapshot" || e.data.id !== id) return;
      done(typeof e.data.url === "string" ? e.data.url : null);
    };
    const t = setTimeout(() => done(null), timeoutMs);
    window.addEventListener("message", onMsg);
    win.postMessage({ type: "cairn:snapshot", id }, "*");
  });
}

/** What the DOM picture cannot hold, under `container`, at its on-screen place. */
export async function collectLayers(container: HTMLElement, scale = 2): Promise<Layer[]> {
  const layers: Layer[] = [];
  // A plot paused by the page's WebGL budget is purged (no `_fullLayout`): its snapshot image is a layer like any image.
  const plots = Array.from(container.querySelectorAll<HTMLElement>(".js-plotly-plot")).filter(
    (p) => (p as HTMLElement & { _fullLayout?: unknown })._fullLayout != null,
  );
  if (plots.length > 0) {
    const Plotly = await (await import("../charts/PlotlyChart")).loadPlotly();
    for (const plot of plots) {
      const url: string = await Plotly.toImage(plot, { format: "png", width: plot.clientWidth, height: plot.clientHeight, scale });
      layers.push({ rect: plot.getBoundingClientRect(), source: await loadImage(url) });
    }
  }
  for (const box of container.querySelectorAll<HTMLElement>(CUSTOM_VIEWER)) {
    const url = await snapshotFrame(box);
    if (url) layers.push({ rect: box.getBoundingClientRect(), source: await loadImage(url) });
  }
  for (const frame of container.querySelectorAll<HTMLIFrameElement>(HTML_FRAME)) {
    const url = await snapshotHtmlFrame(frame);
    if (url) layers.push({ rect: frame.getBoundingClientRect(), source: await loadImage(url).catch(() => new Image()) });
  }
  const skip = (el: Element) => plots.some((p) => p.contains(el)) || el.closest(CUSTOM_VIEWER) != null || el.closest(HTML_FRAME) != null;
  for (const canvas of container.querySelectorAll<HTMLCanvasElement>("canvas")) {
    if (skip(canvas) || canvas.width === 0 || canvas.height === 0) continue;
    layers.push({ rect: canvas.getBoundingClientRect(), source: canvas });
  }
  for (const img of container.querySelectorAll<HTMLImageElement>("img")) {
    if (skip(img) || !img.complete || img.naturalWidth === 0) continue;
    layers.push({ rect: img.getBoundingClientRect(), source: img });
  }
  for (const video of container.querySelectorAll<HTMLVideoElement>("video")) {
    if (skip(video) || video.readyState < 2) continue;
    layers.push({ rect: video.getBoundingClientRect(), source: video });
  }
  return layers.filter((l) => l.rect.width > 0 && l.rect.height > 0);
}

/** Every element's computed style, inline on its clone (the SVG picture has no stylesheets). */
function inlineStyles(src: Element, dst: Element): void {
  const cs = getComputedStyle(src);
  let css = "";
  for (let i = 0; i < cs.length; i++) {
    const p = cs[i]!;
    css += `${p}:${cs.getPropertyValue(p)};`;
  }
  dst.setAttribute("style", css);
  for (let i = 0; i < src.children.length; i++) {
    const s = src.children[i]!;
    const d = dst.children[i];
    if (d) inlineStyles(s, d);
  }
}

/** `el` as drawn, through an SVG `<foreignObject>`; media, canvases and frames are left blank (they are layers). */
async function rasterizeDom(el: HTMLElement): Promise<HTMLImageElement> {
  const rect = el.getBoundingClientRect();
  const clone = el.cloneNode(true) as HTMLElement;
  inlineStyles(el, clone);
  for (const n of clone.querySelectorAll("img, canvas, video, iframe, audio")) {
    (n as HTMLElement).style.visibility = "hidden";
    n.removeAttribute("src");
    n.removeAttribute("srcset");
  }
  for (const n of clone.querySelectorAll("script, [data-cairn-capture-skip]")) n.remove();
  clone.style.margin = "0";
  const xml = new XMLSerializer().serializeToString(clone);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${rect.width}" height="${rect.height}">` +
    `<foreignObject x="0" y="0" width="100%" height="100%">${xml}</foreignObject></svg>`;
  return loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
}

function toPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG encoding failed"))), "image/png"));
}

/** The body of card `card` (below its header) as one PNG. */
export async function captureCardPng(card: HTMLElement, scale = 2): Promise<Blob> {
  const cardRect = card.getBoundingClientRect();
  const header = card.querySelector<HTMLElement>("[data-cairn-card-header]");
  const top = header ? header.getBoundingClientRect().bottom : cardRect.top;
  const region = { left: cardRect.left, top, width: cardRect.width, height: Math.max(1, cardRect.bottom - top) };
  const out = document.createElement("canvas");
  out.width = Math.round(region.width * scale);
  out.height = Math.round(region.height * scale);
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("2D canvas unavailable");
  ctx.scale(scale, scale);
  ctx.fillStyle = getComputedStyle(card).backgroundColor || "#ffffff";
  ctx.fillRect(0, 0, region.width, region.height);
  try {
    ctx.drawImage(await rasterizeDom(card), cardRect.left - region.left, cardRect.top - region.top, cardRect.width, cardRect.height);
  } catch (err) {
    console.warn("card screenshot: the DOM picture failed", err);
  }
  for (const { rect, source } of await collectLayers(card, scale)) {
    if (header?.contains(source as Node)) continue;
    ctx.drawImage(source, rect.left - region.left, rect.top - region.top, rect.width, rect.height);
  }
  return toPng(out);
}

/** The artifacts card `card` shows (`data-cairn-artifact` marks), deduplicated, in page order. */
export function cardArtifacts(card: HTMLElement): Array<{ hash: string; name: string | null }> {
  const seen = new Set<string>();
  const out: Array<{ hash: string; name: string | null }> = [];
  for (const el of card.querySelectorAll<HTMLElement>("[data-cairn-artifact]")) {
    for (const hash of (el.dataset.cairnArtifact ?? "").split(",").filter(Boolean)) {
      if (seen.has(hash)) continue;
      seen.add(hash);
      out.push({ hash, name: el.dataset.cairnArtifactName || null });
    }
  }
  return out;
}

