/** Color helpers for the 3D viewers: a turbo colormap and a categorical palette, both 0..1 RGB. */

/** Turbo colormap (polynomial approximation), `t` in 0..1. */
export function turbo(t: number, out: Float32Array, at: number): void {
  const x = Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0;
  const r = 0.13572138 + x * (4.6153926 + x * (-42.66032258 + x * (132.13108234 + x * (-152.94239396 + x * 59.28637943))));
  const g = 0.09140261 + x * (2.19418839 + x * (4.84296658 + x * (-14.18503333 + x * (4.27729857 + x * 2.82956604))));
  const b = 0.1066733 + x * (12.64194608 + x * (-60.58204836 + x * (110.36276771 + x * (-89.90310912 + x * 27.34824973))));
  out[at] = Math.min(1, Math.max(0, r));
  out[at + 1] = Math.min(1, Math.max(0, g));
  out[at + 2] = Math.min(1, Math.max(0, b));
}

/** Min/max over the finite entries of `values` (strided). */
export function valueRange(values: ArrayLike<number>, n: number, stride = 1, offset = 0): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < n; i++) {
    const v = values[i * stride + offset]!;
    if (!Number.isFinite(v)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return lo <= hi ? [lo, hi] : [0, 1];
}

/** `n` scalars (strided) → interleaved RGB through turbo over their own range. */
export function valuesToColors(values: ArrayLike<number>, n: number, stride = 1, offset = 0): Float32Array {
  const [lo, hi] = valueRange(values, n, stride, offset);
  const span = hi - lo || 1;
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) turbo((values[i * stride + offset]! - lo) / span, out, i * 3);
  return out;
}

/**
 * Ten distinct category colours (0xRRGGBB). Deliberately longer than the
 * six-colour series palette: segmentations routinely carry more classes than
 * a card carries runs.
 */
const CATEGORY_RGB = [
  0x1f77b4, 0xff7f0e, 0x2ca02c, 0xd62728, 0x9467bd,
  0x8c564b, 0xe377c2, 0x7f7f7f, 0xbcbd22, 0x17becf,
];

/** Integer category ids (strided) → interleaved RGB from a cycled ten-colour palette. */
export function categoriesToColors(ids: ArrayLike<number>, n: number, stride = 1, offset = 0): Float32Array {
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const c = CATEGORY_RGB[Math.max(0, Math.round(ids[i * stride + offset]!)) % CATEGORY_RGB.length]!;
    out[i * 3] = ((c >> 16) & 255) / 255;
    out[i * 3 + 1] = ((c >> 8) & 255) / 255;
    out[i * 3 + 2] = (c & 255) / 255;
  }
  return out;
}

/** Uniform color for "solid" rendering. */
export const SOLID_COLOR = 0x6e9bd1;
