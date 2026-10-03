/**
 * The tensor viewer every surface shares: a logged `cairn.Tensor` or a
 * `.npy` file as its stats, a histogram of its values, or a heatmap of a 2D
 * slice (the tensor card's pane).
 */

import { useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { formatNum } from "../../lib/plot-utils/format";
import { computeHistogram } from "../../lib/plot-utils/histogram";
import { parseNpy, type NpyArray } from "../../lib/parse-npy";
import type { ViewerSource } from "../../lib/viewers/source";
import { HistogramBars, MatrixHeatmap } from "../../charts/HistogramChart";
import ViewModeSwitch from "./ViewModeSwitch";
import { builtin as TENSOR_DEFAULTS, type TensorSettings, type TensorViewMode as ViewMode } from "../cards-settings/tensor";

export interface TensorMeta {
  shape: number[];
  dtype: string;
  min: number;
  max: number;
  mean: number;
  size_bytes: number;
}


const SIZE_CAP = 10 * 1024 * 1024;

/** C- or Fortran-order strides for a shape. */
function strides(shape: number[], fortran: boolean): number[] {
  const n = shape.length;
  const st = new Array<number>(n).fill(1);
  if (fortran) {
    for (let k = 1; k < n; k++) st[k] = st[k - 1]! * shape[k - 1]!;
  } else {
    for (let k = n - 2; k >= 0; k--) st[k] = st[k + 1]! * shape[k + 1]!;
  }
  return st;
}

/** Extract the trailing 2D slice `[rows, cols]` at the given leading indices. */
function sliceMatrix(
  data: Float64Array,
  shape: number[],
  fortran: boolean,
  leading: number[],
): number[][] {
  const n = shape.length;
  const rows = shape[n - 2]!;
  const cols = shape[n - 1]!;
  const st = strides(shape, fortran);
  let base = 0;
  for (let k = 0; k < n - 2; k++) {
    const idx = Math.max(0, Math.min(shape[k]! - 1, leading[k] ?? 0));
    base += idx * st[k]!;
  }
  const rs = st[n - 2]!;
  const cs = st[n - 1]!;
  const m: number[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: number[] = new Array(cols);
    for (let c = 0; c < cols; c++) row[c] = data[base + r * rs + c * cs]!;
    m.push(row);
  }
  return m;
}

async function fetchNpy(hash: string): Promise<NpyArray> {
  const res = await fetch(api.artifactUrl(hash));
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return parseNpy(await res.arrayBuffer());
}

export const npyQueryOf = (hash: string) => ({
  queryKey: ["cairn-npy", hash],
  queryFn: () => fetchNpy(hash),
  staleTime: Infinity,
});

/** The shape/stats facts of one tensor. */
export function tensorFacts(meta: TensorMeta | null, settings: TensorSettings) {
  const shape = meta?.shape ?? [];
  const ndim = shape.length;
  const tooBig = (meta?.size_bytes ?? 0) > SIZE_CAP;
  // Resolve the effective view: fall back to stats for oversized blobs and to
  // histogram when a heatmap is requested for a < 2D tensor.
  let effectiveView: ViewMode = settings.viewMode;
  if (tooBig) effectiveView = "stats";
  else if (effectiveView === "heatmap" && ndim < 2) effectiveView = "histogram";
  const shapeLabel = ndim > 0 ? shape.join("×") : "scalar";
  return { shape, ndim, tooBig, effectiveView, shapeLabel, leadingDims: ndim > 2 ? shape.slice(0, ndim - 2) : [] };
}

export function StatsGrid({ meta, shapeLabel }: { meta: TensorMeta; shapeLabel: string }) {
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-fg-muted">
      <span>shape</span>
      <span className="mono num">{shapeLabel}</span>
      <span>dtype</span>
      <span className="mono num">{meta.dtype}</span>
      <span>min</span>
      <span className="mono num">{formatNum(meta.min)}</span>
      <span>max</span>
      <span className="mono num">{formatNum(meta.max)}</span>
      <span>mean</span>
      <span className="mono num">{formatNum(meta.mean)}</span>
      <span>size</span>
      <span className="mono num">{meta.size_bytes} B</span>
    </div>
  );
}

/** Shape, dtype and stats of a loaded array (a `.npy` file logged without the tensor handler's metadata). */
export function arrayMeta(arr: NpyArray, sizeBytes: number | null): TensorMeta {
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let n = 0;
  for (const v of arr.data) {
    if (!Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
    n += 1;
  }
  return {
    shape: arr.shape,
    dtype: arr.dtype,
    min: n ? min : NaN,
    max: n ? max : NaN,
    mean: n ? sum / n : NaN,
    size_bytes: sizeBytes ?? arr.data.length * 8,
  };
}

/**
 * One tensor (a card's point or gallery item, an `.npy` file) in a view
 * mode: its stats, a histogram of its values, or a heatmap of a 2D slice.
 * Without the handler's metadata (`meta` null) the array is loaded and its
 * facts computed here.
 */
/** The tensor handler's metadata, or null when `meta` is anything else (user metadata, a plain file). */
export function tensorMetaOf(meta: unknown): TensorMeta | null {
  const m = meta as Partial<TensorMeta> | null;
  return m && Array.isArray(m.shape) && typeof m.dtype === "string" ? (m as TensorMeta) : null;
}

export function TensorView({ hash, meta: given, size = null, settings }: {
  hash: string;
  meta: TensorMeta | null;
  /** Byte size, for the facts of a file without metadata. */
  size?: number | null;
  settings: TensorSettings;
}) {
  const logged = tensorMetaOf(given);
  const facts = tensorFacts(logged, settings);
  // A file without the handler's facts is read for them, unless it is too big to read at all.
  const unreadable = !logged && (size ?? 0) > SIZE_CAP;
  const needsBlob = !unreadable && (!logged || facts.effectiveView !== "stats");
  const npyQuery = useQuery({
    ...npyQueryOf(hash),
    enabled: needsBlob,
    // The previous step stays on screen while the next one loads (no placeholder flash).
    placeholderData: keepPreviousData,
  });
  const arr = npyQuery.data;
  // A file's facts come from its own array, never the previous file's placeholder.
  const ownArr = npyQuery.isPlaceholderData ? undefined : arr;
  const meta = useMemo(() => logged ?? (ownArr ? arrayMeta(ownArr, size) : null), [logged, ownArr, size]);
  const { ndim, tooBig, effectiveView, shapeLabel } = tensorFacts(meta, settings);

  const histogram = useMemo(() => {
    if (effectiveView !== "histogram" || !arr) return null;
    return computeHistogram(arr.data, settings.bins);
  }, [effectiveView, arr, settings.bins]);

  const matrix = useMemo(() => {
    if (effectiveView !== "heatmap" || !arr || arr.shape.length < 2) return null;
    return sliceMatrix(
      arr.data,
      arr.shape,
      arr.fortranOrder,
      settings.sliceIndices ?? [],
    );
  }, [effectiveView, arr, settings.sliceIndices]);

  const statsGrid = meta && <StatsGrid meta={meta} shapeLabel={shapeLabel} />;
  const renderBody = () => {
    if (!meta) {
      if (unreadable) return <p className="text-xs text-fg-subtle">Larger than 10 MB: download it to inspect.</p>;
      if (npyQuery.isLoading) return <div className="flex-1 min-h-0 motion-safe:animate-pulse rounded bg-bg-hover" />;
      if (npyQuery.isError) return <div className="flex-1 min-h-0 text-xs text-fg-muted">could not read tensor blob</div>;
      return <div className="text-sm text-fg-muted">no tensor logged yet</div>;
    }

    if (effectiveView === "stats") {
      return (
        <div className="flex-1 min-h-0 overflow-auto">
          {statsGrid}
          {tooBig && (
            <p className="mt-2 text-xs text-fg-subtle">
              Blob exceeds 10MB — showing stats only.
            </p>
          )}
        </div>
      );
    }

    if (npyQuery.isLoading) {
      return <div className="flex-1 min-h-0 motion-safe:animate-pulse rounded bg-bg-hover" />;
    }
    if (npyQuery.isError || !arr) {
      return (
        <div className="flex-1 min-h-0 text-xs text-fg-muted">
          could not read tensor blob
        </div>
      );
    }

    if (effectiveView === "histogram") {
      return (
        <div className="flex-1 min-h-0">
          {histogram && (
            <HistogramBars
              counts={histogram.counts}
              edges={histogram.edges}
              logY={settings.logY}
            />
          )}
        </div>
      );
    }

    // heatmap
    return (
      <div className="flex-1 min-h-0">
        {matrix ? (
          <MatrixHeatmap
            matrix={matrix}
            colormap={settings.colormap}
            min={meta.min}
            max={meta.max}
            logColor={settings.logY}
            xLabel={`dim ${ndim - 1}`}
            yLabel={`dim ${ndim - 2}`}
          />
        ) : (
          <div className="text-xs text-fg-muted">tensor is not 2D</div>
        )}
      </div>
    );
  };

  return <div className="flex min-h-0 flex-1 flex-col" data-viewer="tensor">{renderBody()}</div>;
}

const MODES: ViewMode[] = ["heatmap", "histogram", "stats"];

/** One tensor source on its own, with the tensor card's defaults and a view-mode switch. */
export default function TensorViewer({ source }: { source: Pick<ViewerSource, "hash" | "size" | "meta"> }) {
  const [viewMode, setViewMode] = useState<ViewMode>(TENSOR_DEFAULTS.viewMode);
  const settings = useMemo(() => ({ ...TENSOR_DEFAULTS, viewMode }), [viewMode]);
  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <ViewModeSwitch modes={MODES} value={viewMode} onChange={setViewMode} />
      <TensorView hash={source.hash} meta={(source.meta as TensorMeta | null) ?? null} size={source.size} settings={settings} />
    </div>
  );
}
