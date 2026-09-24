/**
 * Parameter importance: how much each run parameter explains a target metric.
 *
 * Two views over the same (params, target) table, one row per run:
 * - correlation: Pearson r and Spearman rho per NUMERIC param (booleans count
 *   as 0/1). Categorical params have no sign, so they get null.
 * - importance: permutation importance from a seeded random forest on the
 *   params, numeric params as one column each and the rest one-hot encoded.
 *   A param's one-hot columns are permuted together, so a categorical param
 *   gets one score, not one per level. Scores are the out-of-bag MSE increase
 *   divided by the target variance, so they are unitless and comparable
 *   across metrics.
 *
 * Pure and deterministic for a given seed.
 */

export type ParamKind = "numeric" | "categorical";

export interface ImportanceRow {
  /** JSON-decoded param values by key. A missing key is a missing value. */
  params: Record<string, unknown>;
  target: number;
}

export interface ParamImportance {
  key: string;
  kind: ParamKind;
  /** Pearson r against the target (numeric params only). */
  pearson: number | null;
  /** Spearman rho against the target (numeric params only). */
  spearman: number | null;
  /** Normalized permutation importance (can be slightly negative: noise). */
  importance: number;
}

export interface ForestOptions {
  trees?: number;
  maxDepth?: number;
  seed?: number;
  /** Permutation repeats per tree and param. */
  repeats?: number;
}

// ---------------------------------------------------------------------------
// Random numbers
// ---------------------------------------------------------------------------

/** mulberry32: a small seeded PRNG returning floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleInPlace<T>(arr: T[], rand: () => number): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
}

// ---------------------------------------------------------------------------
// Correlation
// ---------------------------------------------------------------------------

/** Pearson correlation; null for fewer than 2 pairs or a constant side. */
export function pearson(x: readonly number[], y: readonly number[]): number | null {
  const n = Math.min(x.length, y.length);
  if (n < 2) return null;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) { mx += x[i]!; my += y[i]!; }
  mx /= n;
  my /= n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i]! - mx;
    const dy = y[i]! - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx === 0 || syy === 0) return null;
  return Math.max(-1, Math.min(1, sxy / Math.sqrt(sxx * syy)));
}

/** 1-based ranks, ties get their average rank. */
export function ranks(x: readonly number[]): number[] {
  const idx = x.map((_, i) => i).sort((a, b) => x[a]! - x[b]!);
  const out = new Array<number>(x.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && x[idx[j + 1]!] === x[idx[i]!]) j++;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[idx[k]!] = r;
    i = j + 1;
  }
  return out;
}

/** Spearman rank correlation (Pearson on average ranks). */
export function spearman(x: readonly number[], y: readonly number[]): number | null {
  const n = Math.min(x.length, y.length);
  if (n < 2) return null;
  return pearson(ranks(x.slice(0, n)), ranks(y.slice(0, n)));
}

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------

function numericValue(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "boolean") return v ? 1 : 0;
  return null;
}

function categoryOf(v: unknown): string {
  return typeof v === "string" ? v : JSON.stringify(v);
}

export interface EncodedParam {
  key: string;
  kind: ParamKind;
  /** Column indices of this param in the feature matrix. */
  columns: number[];
}

export interface Encoded {
  params: EncodedParam[];
  /** Row-major feature matrix. */
  X: number[][];
}

/**
 * Encode params as features. A param is numeric when every present value is
 * a finite number or a boolean; missing numeric values take the column mean.
 * Anything else is categorical: one column per distinct value, and a missing
 * value is all zeros. Params with fewer than two distinct values carry no
 * signal and are dropped.
 */
export function encodeParams(rows: readonly ImportanceRow[]): Encoded {
  const keys = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r.params)) keys.add(k);

  const params: EncodedParam[] = [];
  const columns: number[][] = [];
  for (const key of [...keys].sort()) {
    const present = rows.map((r) => r.params[key]).filter((v) => v !== undefined && v !== null);
    const numeric = present.length > 0 && present.every((v) => numericValue(v) != null);
    if (numeric) {
      const vals = rows.map((r) => numericValue(r.params[key]));
      const known = vals.filter((v): v is number => v != null);
      if (new Set(known).size < 2) continue;
      const mean = known.reduce((a, b) => a + b, 0) / known.length;
      params.push({ key, kind: "numeric", columns: [columns.length] });
      columns.push(vals.map((v) => v ?? mean));
    } else {
      const cats = rows.map((r) => {
        const v = r.params[key];
        return v === undefined || v === null ? null : categoryOf(v);
      });
      const levels = [...new Set(cats.filter((c): c is string => c != null))].sort();
      const distinct = levels.length + (cats.includes(null) ? 1 : 0);
      if (distinct < 2) continue;
      const cols: number[] = [];
      for (const level of levels) {
        cols.push(columns.length);
        columns.push(cats.map((c) => (c === level ? 1 : 0)));
      }
      params.push({ key, kind: "categorical", columns: cols });
    }
  }
  const X = rows.map((_, i) => columns.map((c) => c[i]!));
  return { params, X };
}

// ---------------------------------------------------------------------------
// Random forest (regression)
// ---------------------------------------------------------------------------

type Node =
  | { leaf: true; value: number }
  | { leaf: false; feature: number; threshold: number; left: Node; right: Node };

function mean(y: readonly number[], idx: readonly number[]): number {
  let s = 0;
  for (const i of idx) s += y[i]!;
  return s / idx.length;
}

function buildTree(
  X: readonly number[][],
  y: readonly number[],
  idx: number[],
  depth: number,
  maxDepth: number,
  mtry: number,
  rand: () => number,
): Node {
  const value = mean(y, idx);
  if (depth >= maxDepth || idx.length < 2) return { leaf: true, value };

  const nFeatures = X[0]?.length ?? 0;
  const features = Array.from({ length: nFeatures }, (_, i) => i);
  shuffleInPlace(features, rand);

  let best: { feature: number; threshold: number; sse: number } | null = null;
  let totalSum = 0;
  let totalSq = 0;
  for (const i of idx) { totalSum += y[i]!; totalSq += y[i]! * y[i]!; }
  const parentSse = totalSq - (totalSum * totalSum) / idx.length;

  for (const f of features.slice(0, mtry)) {
    const sorted = [...idx].sort((a, b) => X[a]![f]! - X[b]![f]!);
    let leftSum = 0;
    let leftSq = 0;
    for (let k = 0; k < sorted.length - 1; k++) {
      const yi = y[sorted[k]!]!;
      leftSum += yi;
      leftSq += yi * yi;
      const xa = X[sorted[k]!]![f]!;
      const xb = X[sorted[k + 1]!]![f]!;
      if (xa === xb) continue;
      const nl = k + 1;
      const nr = sorted.length - nl;
      const rightSum = totalSum - leftSum;
      const rightSq = totalSq - leftSq;
      const sse = leftSq - (leftSum * leftSum) / nl + rightSq - (rightSum * rightSum) / nr;
      if (!best || sse < best.sse) best = { feature: f, threshold: (xa + xb) / 2, sse };
    }
  }
  if (!best || best.sse >= parentSse - 1e-12) return { leaf: true, value };

  const left: number[] = [];
  const right: number[] = [];
  for (const i of idx) (X[i]![best.feature]! <= best.threshold ? left : right).push(i);
  return {
    leaf: false,
    feature: best.feature,
    threshold: best.threshold,
    left: buildTree(X, y, left, depth + 1, maxDepth, mtry, rand),
    right: buildTree(X, y, right, depth + 1, maxDepth, mtry, rand),
  };
}

export function predictTree(node: Node, x: readonly number[]): number {
  let n = node;
  while (!n.leaf) n = x[n.feature]! <= n.threshold ? n.left : n.right;
  return n.value;
}

export interface Forest {
  trees: Array<{ root: Node; oob: number[] }>;
}

/** Bootstrap-aggregated regression trees with random feature subsets (p/3). */
export function fitForest(
  X: readonly number[][],
  y: readonly number[],
  { trees = 50, maxDepth = 5, seed = 0 }: ForestOptions = {},
): Forest {
  const rand = mulberry32(seed);
  const n = X.length;
  const nFeatures = X[0]?.length ?? 0;
  const mtry = Math.max(1, Math.floor(nFeatures / 3));
  const out: Forest["trees"] = [];
  for (let t = 0; t < trees; t++) {
    const inBag = new Array<boolean>(n).fill(false);
    const sample: number[] = [];
    for (let i = 0; i < n; i++) {
      const j = Math.floor(rand() * n);
      sample.push(j);
      inBag[j] = true;
    }
    const oob: number[] = [];
    for (let i = 0; i < n; i++) if (!inBag[i]) oob.push(i);
    out.push({ root: buildTree(X, y, sample, 0, maxDepth, mtry, rand), oob });
  }
  return { trees: out };
}

export function predictForest(forest: Forest, x: readonly number[]): number {
  let s = 0;
  for (const t of forest.trees) s += predictTree(t.root, x);
  return s / forest.trees.length;
}

/**
 * Breiman's out-of-bag permutation importance: for every tree, the MSE on its
 * out-of-bag rows after shuffling one param's columns among those rows, minus
 * the unshuffled MSE, averaged over trees and divided by var(y).
 */
export function permutationImportance(
  forest: Forest,
  enc: Encoded,
  y: readonly number[],
  { seed = 0, repeats = 3 }: ForestOptions = {},
): number[] {
  const rand = mulberry32(seed ^ 0x9e3779b9);
  const n = y.length;
  const my = y.reduce((a, b) => a + b, 0) / n;
  const variance = y.reduce((a, b) => a + (b - my) * (b - my), 0) / n;
  const sums = new Array<number>(enc.params.length).fill(0);
  let used = 0;
  for (const { root, oob } of forest.trees) {
    if (oob.length < 2) continue;
    used++;
    let base = 0;
    for (const i of oob) base += (predictTree(root, enc.X[i]!) - y[i]!) ** 2;
    base /= oob.length;
    enc.params.forEach((p, pi) => {
      let acc = 0;
      for (let r = 0; r < repeats; r++) {
        const perm = [...oob];
        shuffleInPlace(perm, rand);
        let err = 0;
        oob.forEach((i, k) => {
          const x = [...enc.X[i]!];
          const donor = enc.X[perm[k]!]!;
          for (const c of p.columns) x[c] = donor[c]!;
          err += (predictTree(root, x) - y[i]!) ** 2;
        });
        acc += err / oob.length - base;
      }
      sums[pi] += acc / repeats;
    });
  }
  if (used === 0 || variance === 0) return sums.map(() => 0);
  return sums.map((s) => s / used / variance);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/** Minimum runs for any score: fewer cannot separate signal from noise at all. */
export const MIN_RUNS = 3;

/**
 * Score every param with at least two distinct values against the target.
 * Rows with a non-finite target are dropped first. Sorted by importance
 * (descending), then key.
 */
export function parameterImportance(
  rows: readonly ImportanceRow[],
  opts: ForestOptions = {},
): ParamImportance[] {
  const kept = rows.filter((r) => Number.isFinite(r.target));
  if (kept.length < MIN_RUNS) return [];
  const y = kept.map((r) => r.target);
  const enc = encodeParams(kept);
  if (enc.params.length === 0) return [];

  const forest = fitForest(enc.X, y, { trees: 50, maxDepth: 5, seed: 0, ...opts });
  const imp = permutationImportance(forest, enc, y, { seed: 0, repeats: 3, ...opts });

  const out: ParamImportance[] = enc.params.map((p, i) => {
    let r: number | null = null;
    let rho: number | null = null;
    if (p.kind === "numeric") {
      const xs: number[] = [];
      const ys: number[] = [];
      kept.forEach((row, k) => {
        const v = numericValue(row.params[p.key]);
        if (v != null) { xs.push(v); ys.push(y[k]!); }
      });
      r = pearson(xs, ys);
      rho = spearman(xs, ys);
    }
    return { key: p.key, kind: p.kind, pearson: r, spearman: rho, importance: imp[i]! };
  });
  out.sort((a, b) => b.importance - a.importance || a.key.localeCompare(b.key));
  return out;
}
