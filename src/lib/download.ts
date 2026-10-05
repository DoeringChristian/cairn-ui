/** Artifact download and chart export helpers. */

import { api } from "../api/client";
import { captureCardPng, cardArtifacts, collectLayers } from "./card-capture";
import { zipStore } from "./zip";

export type ExportFormat = "svg" | "png" | "jpg" | "pdf";

const MIME_EXT: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "audio/wav": ".wav",
  "audio/mpeg": ".mp3",
  "video/mp4": ".mp4",
  "text/plain": ".txt",
  "application/json": ".json",
  "text/html": ".html",
  "text/markdown": ".md",
  "application/python-pickle": ".pkl",
  "application/octet-stream": ".bin",
  "image/x-exr": ".exr",
  "application/x-npy": ".npy",
  "application/x-npz": ".npz",
};

/** Trigger a browser download for the given URL. */
export function downloadArtifact(url: string, filename: string): void {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
}

/**
 * Build a safe download filename from metric name, step, and MIME type.
 *
 * `application/octet-stream` covers several distinct binary artifact shapes
 * (npy tensors, npz histograms, ...), so it can't be resolved from MIME alone.
 * Callers that know their own on-disk format (typed cards) can pass
 * `extOverride` to bypass the MIME table entirely; generic callers (that only
 * know the MIME type) keep falling back to `.bin` for octet-stream.
 */
export function artifactFilename(
  metricName: string,
  step: number,
  mime?: string | null,
  extOverride?: string,
): string {
  const safe = metricName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const ext = extOverride ?? (mime && MIME_EXT[mime]) ?? ".bin";
  return `${safe}_step${step}${ext}`;
}

/** Sanitize a name for use as a filename. */
export function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

/** Download a Blob as a file. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Export tabular data as a CSV file. */
export function downloadCsv(headers: string[], rows: (string | number)[][], filename: string): void {
  const csv = [headers.join(","), ...rows.map(r => r.map(v => typeof v === "string" && v.includes(",") ? `"${v}"` : String(v)).join(","))].join("\n");
  downloadBlob(new Blob([csv], { type: "text/csv" }), filename);
}

/**
 * Render the charts under `container` as one PNG. Plotly figures render
 * through `Plotly.toImage`; other canvases (uPlot) and images (a static
 * figure) are copied as drawn; a custom viewer gives its `snapshot()`. Each layer lands at its on-screen position, so
 * a grid of panes stays a grid. Rejects when there is nothing to render.
 */
export async function renderChartPng(container: HTMLElement, scale = 2): Promise<Blob> {
  const layers = await collectLayers(container, scale);
  if (layers.length === 0) throw new Error("no chart found to render");

  const left = Math.min(...layers.map(l => l.rect.left));
  const top = Math.min(...layers.map(l => l.rect.top));
  const right = Math.max(...layers.map(l => l.rect.right));
  const bottom = Math.max(...layers.map(l => l.rect.bottom));
  const out = document.createElement("canvas");
  out.width = Math.round((right - left) * scale);
  out.height = Math.round((bottom - top) * scale);
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("2D canvas unavailable");
  for (const { rect, source } of layers) {
    ctx.drawImage(source, (rect.left - left) * scale, (rect.top - top) * scale, rect.width * scale, rect.height * scale);
  }

  return new Promise<Blob>((resolve, reject) => {
    out.toBlob((value) => value ? resolve(value) : reject(new Error("PNG encoding failed")), "image/png");
  });
}

/** Download the charts under `container` as one PNG (see `renderChartPng`). */
export async function exportChartPng(container: HTMLElement, filename: string): Promise<void> {
  try {
    const blob = await renderChartPng(container);
    downloadBlob(blob, filename.endsWith(".png") ? filename : `${filename}.png`);
  } catch (err) {
    console.error("exportChartPng failed", err);
  }
}

/**
 * Export the Plotly figure under `container` through Plotly's own image
 * export. Anything other than exactly one plot (an `<img>` fallback, a grid
 * of panes) goes through `exportChartPng` instead.
 */
export async function exportPlotlyChart(
  container: HTMLElement,
  filename: string,
  format: ExportFormat,
): Promise<void> {
  const plots = container.querySelectorAll<HTMLElement>(".js-plotly-plot");
  // A WebGL plot paused by the page's WebGL budget is purged (no
  // `_fullLayout`): screenshot its snapshot with the rest of the card.
  if (plots.length !== 1 || !(plots[0] as HTMLElement & { _fullLayout?: unknown })._fullLayout) {
    await exportChartPng(container, filename);
    return;
  }
  const plot = plots[0]!;
  const Plotly = await (await import("../charts/PlotlyChart")).loadPlotly();
  await Plotly.downloadImage(plot, {
    format: format === "jpg" ? "jpeg" : format === "pdf" ? "svg" : format,
    filename,
    width: plot.clientWidth,
    height: plot.clientHeight,
    scale: 2,
  });
}

/** Download the screenshot of card `card` as `<name>.png`. */
export async function downloadCardPng(card: HTMLElement, name: string): Promise<void> {
  try {
    downloadBlob(await captureCardPng(card), `${safeName(name)}.png`);
  } catch (err) {
    console.error("card screenshot failed", err);
  }
}

const EXT: Record<string, string> = {
  "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif", "image/x-exr": "exr",
  "audio/wav": "wav", "audio/x-wav": "wav", "audio/mpeg": "mp3", "video/mp4": "mp4", "video/webm": "webm",
  "text/plain": "txt", "text/html": "html", "text/markdown": "md", "application/json": "json",
  "application/x-npy": "npy", "application/x-npz": "npz", "application/python-pickle": "pkl",
};

/** Download what card `card` shows (its `data-cairn-artifact` marks): one artifact as itself, several as `<name>.zip`. Returns how many. */
export async function downloadCardArtifacts(card: HTMLElement, name: string): Promise<number> {
  return downloadArtifacts(cardArtifacts(card), name);
}

/** Download stored artifacts: one as itself, several as `<zipName>.zip` (names made unique). Returns how many. */
export async function downloadArtifacts(items: ReadonlyArray<{ hash: string; name: string | null }>, zipName: string): Promise<number> {
  if (items.length === 0) return 0;
  const files = await Promise.all(
    items.map(async (it, i) => {
      const res = await fetch(api.artifactUrl(it.hash));
      const blob = await res.blob();
      const ext = EXT[(blob.type || "").split(";")[0]!] ?? "bin";
      const base = it.name ? safeName(it.name) : `${safeName(zipName)}_${i + 1}`;
      return { name: /\.[a-z0-9]+$/i.test(base) ? base : `${base}.${ext}`, blob };
    }),
  );
  if (files.length === 1) {
    downloadBlob(files[0]!.blob, files[0]!.name);
    return 1;
  }
  const used = new Map<string, number>();
  const entries = await Promise.all(
    files.map(async (f) => {
      const n = used.get(f.name) ?? 0;
      used.set(f.name, n + 1);
      const fname = n === 0 ? f.name : f.name.replace(/(\.[^.]*)?$/, `_${n + 1}$1`);
      return { name: fname, data: new Uint8Array(await f.blob.arrayBuffer()) };
    }),
  );
  downloadBlob(new Blob([zipStore(entries) as Uint8Array<ArrayBuffer>], { type: "application/zip" }), `${safeName(zipName)}.zip`);
  return files.length;
}

/** Every Plotly figure under `container` back to its autorange (the card header's reset view). */
export async function resetPlotlyViews(container: HTMLElement): Promise<void> {
  type Plot = HTMLElement & { _fullLayout?: Record<string, unknown> };
  const plots = Array.from(container.querySelectorAll<Plot>(".js-plotly-plot")).filter((p) => p._fullLayout);
  if (plots.length === 0) return;
  const Plotly = await (await import("../charts/PlotlyChart")).loadPlotly();
  for (const plot of plots) {
    const update: Record<string, unknown> = {};
    for (const k of Object.keys(plot._fullLayout!)) if (/^[xy]axis\d*$/.test(k)) update[`${k}.autorange`] = true;
    if (Object.keys(update).length > 0) await Plotly.relayout(plot, update);
  }
}
