/** Artifact download and chart export helpers. */

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
function downloadBlob(blob: Blob, filename: string): void {
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

/** Decode a data URL into an image element. */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image decode failed"));
    img.src = src;
  });
}

/**
 * Export the charts under `container` as one PNG. Plotly figures render
 * through `Plotly.toImage`; other canvases (uPlot) and images (a static
 * figure) are copied as drawn. Each layer lands at its on-screen position, so
 * a grid of panes stays a grid.
 */
export async function exportChartPng(container: HTMLElement, filename: string): Promise<void> {
  try {
    const scale = 2;
    const layers: { rect: DOMRect; source: CanvasImageSource }[] = [];
    const plots = Array.from(container.querySelectorAll<HTMLElement>(".js-plotly-plot"));
    if (plots.length > 0) {
      const { Plotly } = await import("../charts/PlotlyChart");
      for (const plot of plots) {
        const url: string = await Plotly.toImage(plot, {
          format: "png",
          width: plot.clientWidth,
          height: plot.clientHeight,
          scale,
        });
        layers.push({ rect: plot.getBoundingClientRect(), source: await loadImage(url) });
      }
    }
    for (const canvas of container.querySelectorAll<HTMLCanvasElement>("canvas")) {
      if (canvas.closest(".js-plotly-plot") || canvas.width === 0 || canvas.height === 0) continue;
      layers.push({ rect: canvas.getBoundingClientRect(), source: canvas });
    }
    for (const img of container.querySelectorAll<HTMLImageElement>("img")) {
      if (img.closest(".js-plotly-plot") || !img.complete || img.naturalWidth === 0) continue;
      layers.push({ rect: img.getBoundingClientRect(), source: img });
    }
    if (layers.length === 0) {
      console.warn("exportChartPng: no chart found to export");
      return;
    }

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

    const blob = await new Promise<Blob>((resolve, reject) => {
      out.toBlob((value) => value ? resolve(value) : reject(new Error("PNG encoding failed")), "image/png");
    });
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
  if (plots.length !== 1) {
    await exportChartPng(container, filename);
    return;
  }
  const plot = plots[0]!;
  const { Plotly } = await import("../charts/PlotlyChart");
  await Plotly.downloadImage(plot, {
    format: format === "jpg" ? "jpeg" : format === "pdf" ? "svg" : format,
    filename,
    width: plot.clientWidth,
    height: plot.clientHeight,
    scale: 2,
  });
}
