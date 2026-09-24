/** Bin counts plus edges (`edges.length === counts.length + 1`). */
export interface HistogramData {
  counts: number[];
  edges: number[];
}

/** `numpy.histogram`-style uniform bins over the finite [min, max] of `values`. */
export function computeHistogram(values: ArrayLike<number>, bins = 64): HistogramData {
  let min = Infinity;
  let max = -Infinity;
  for (let index = 0; index < values.length; index++) {
    const value = values[index]!;
    if (!Number.isFinite(value)) continue;
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  if (!Number.isFinite(min)) [min, max] = [0, 1];
  if (min === max) [min, max] = [min - 0.5, max + 0.5];
  const width = (max - min) / bins;
  const counts = new Array<number>(bins).fill(0);
  for (let index = 0; index < values.length; index++) {
    const value = values[index]!;
    if (!Number.isFinite(value)) continue;
    const bin = Math.max(0, Math.min(bins - 1, Math.floor((value - min) / width)));
    counts[bin]!++;
  }
  return { counts, edges: Array.from({ length: bins + 1 }, (_, index) => min + index * width) };
}

/**
 * Resample histograms with differing edges onto one shared uniform grid
 * spanning all of them (counts split by bin overlap), so they stack into a
 * step × bin matrix. Returns `matrix[histogram][bin]`.
 */
export function rebinHistograms(
  histograms: HistogramData[],
  bins = 64,
): { edges: number[]; matrix: number[][] } {
  let min = Infinity;
  let max = -Infinity;
  for (const h of histograms) {
    if (!h.edges.length) continue;
    min = Math.min(min, h.edges[0]!);
    max = Math.max(max, h.edges[h.edges.length - 1]!);
  }
  if (!Number.isFinite(min)) [min, max] = [0, 1];
  if (min === max) [min, max] = [min - 0.5, max + 0.5];
  const width = (max - min) / bins;
  const edges = Array.from({ length: bins + 1 }, (_, index) => min + index * width);
  const clampBin = (b: number) => Math.max(0, Math.min(bins - 1, b));

  const matrix = histograms.map((h) => {
    const out = new Array<number>(bins).fill(0);
    for (let j = 0; j < h.counts.length; j++) {
      const e0 = h.edges[j]!;
      const e1 = h.edges[j + 1]!;
      const count = h.counts[j]!;
      if (count === 0 || !(e1 > e0)) continue;
      const last = clampBin(Math.floor((e1 - min) / width));
      for (let b = clampBin(Math.floor((e0 - min) / width)); b <= last; b++) {
        const overlap = Math.min(e1, edges[b + 1]!) - Math.max(e0, edges[b]!);
        if (overlap > 0) out[b]! += (count * overlap) / (e1 - e0);
      }
    }
    return out;
  });
  return { edges, matrix };
}
