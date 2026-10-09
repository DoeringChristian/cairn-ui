/**
 * Parameter importance (wandb's approach): how much each config key explains
 * a metric over a set of runs.
 *
 * - importance: a seeded random-forest regressor (bootstrap rows, a random
 *   subset of features per split) over the params; each param's
 *   impurity-based importance (the variance its splits remove, weighted by
 *   rows) normalised per tree, averaged over trees and normalised to sum 1.
 *   Numeric params are one feature each, anything else is one-hot encoded
 *   and a param's one-hot columns add up to one score.
 * - correlation: Pearson r per numeric param (booleans as 0/1); a
 *   categorical param has none (null, shown "—").
 *
 * The correlation's colour says whether raising the param moves the metric
 * the good way of its goal (`correlationTone`).
 *
 * Pure and deterministic for a given seed.
 */

import type { Goal } from "../metric-rules.ts";

export type ParamKind = "numeric" | "categorical";

export interface ImportanceRow {
  /** Param values by key. A missing key is a missing value. */
  params: Readonly<Record<string, unknown>>;
  target: number;
}

export interface ParamImportance {
  key: string;
  kind: ParamKind;
  /** Impurity-based importance; the params' scores sum to 1 (all 0 when no tree splits). */
  importance: number;
  /** Pearson r against the target (numeric params only). */
  correlation: number | null;
}

export interface ForestOptions {
  trees?: number;
  maxDepth?: number;
  seed?: number;
}

/** Fewest runs with the metric for any score. */
export const MIN_RUNS = 5;

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

export type Tone = "good" | "bad" | "neutral";

/**
 * A correlation's colour: green ("good") when raising the param moves the
 * metric the way its goal wants (goal lower: a negative r), red ("bad")
 * the other way, neutral without a goal or a sign.
 */
export function correlationTone(r: number | null, goal: Goal): Tone {
  if (r == null || r === 0 || goal === "none") return "neutral";
  return (goal === "lower") === (r < 0) ? "good" : "bad";
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

interface Tree {
  root: Node;
  /** Per feature: the squared error its splits removed (sum over the tree's nodes). */
  gain: number[];
}

export interface Forest {
  trees: Tree[];
  features: number;
}

/** A column's dense value ranks (equal values, equal rank) and how many distinct values. */
interface Ranks {
  rank: Int32Array;
  levels: number;
}

function ranksOf(col: Float64Array): Ranks {
  const distinct = [...new Set(col)].sort((a, b) => a - b);
  const at = new Map(distinct.map((v, r) => [v, r]));
  return { rank: Int32Array.from(col, (v) => at.get(v)!), levels: distinct.length };
}

function buildTree(
  cols: readonly Float64Array[],
  ranks: readonly Ranks[],
  y: Float64Array,
  idx: number[],
  depth: number,
  maxDepth: number,
  mtry: number,
  rand: () => number,
  gain: number[],
): Node {
  let sum = 0;
  let sq = 0;
  for (const i of idx) { sum += y[i]!; sq += y[i]! * y[i]!; }
  const value = sum / idx.length;
  if (depth >= maxDepth || idx.length < 2) return { leaf: true, value };
  const parentSse = sq - (sum * sum) / idx.length;
  if (parentSse <= 1e-12) return { leaf: true, value };

  const features = Array.from({ length: gain.length }, (_, i) => i);
  shuffleInPlace(features, rand);

  // Column-major typed columns: the per-node sort is the hot loop (a
  // comparator over X[a][f] was ~0.8 s per 1000-run forest). Same stable
  // order and arithmetic as before, so the same trees.
  let best: { feature: number; threshold: number; sse: number } | null = null;
  const sorted = new Array<number>(idx.length);
  for (const f of features.slice(0, mtry)) {
    const col = cols[f]!;
    const { rank, levels } = ranks[f]!;
    if (levels <= 4 * idx.length) {
      // A stable counting sort by the value's rank: the order the stable
      // comparator sort gives, in O(rows + levels) (one-hot columns: 2),
      // cheaper than the comparator until a node is small.
      const counts = new Int32Array(levels + 1);
      for (const i of idx) counts[rank[i]! + 1]!++;
      for (let r = 1; r <= levels; r++) counts[r]! += counts[r - 1]!;
      for (const i of idx) sorted[counts[rank[i]!]!++] = i;
    } else {
      for (let k = 0; k < idx.length; k++) sorted[k] = idx[k]!;
      sorted.sort((a, b) => col[a]! - col[b]!);
    }
    let leftSum = 0;
    let leftSq = 0;
    for (let k = 0; k < sorted.length - 1; k++) {
      const yi = y[sorted[k]!]!;
      leftSum += yi;
      leftSq += yi * yi;
      const xa = col[sorted[k]!]!;
      const xb = col[sorted[k + 1]!]!;
      if (xa === xb) continue;
      const nl = k + 1;
      const nr = sorted.length - nl;
      const rightSum = sum - leftSum;
      const rightSq = sq - leftSq;
      const sse = leftSq - (leftSum * leftSum) / nl + rightSq - (rightSum * rightSum) / nr;
      if (!best || sse < best.sse - 1e-12) best = { feature: f, threshold: (xa + xb) / 2, sse };
    }
  }
  if (!best || best.sse >= parentSse - 1e-12) return { leaf: true, value };

  gain[best.feature]! += parentSse - best.sse;
  const left: number[] = [];
  const right: number[] = [];
  const split = cols[best.feature]!;
  for (const i of idx) (split[i]! <= best.threshold ? left : right).push(i);
  return {
    leaf: false,
    feature: best.feature,
    threshold: best.threshold,
    left: buildTree(cols, ranks, y, left, depth + 1, maxDepth, mtry, rand, gain),
    right: buildTree(cols, ranks, y, right, depth + 1, maxDepth, mtry, rand, gain),
  };
}

function predictTree(node: Node, x: readonly number[]): number {
  let n = node;
  while (!n.leaf) n = x[n.feature]! <= n.threshold ? n.left : n.right;
  return n.value;
}

/**
 * Bootstrap-aggregated regression trees: each tree on n rows drawn with
 * replacement, each split choosing among ceil(sqrt(p)) random features
 * (p = feature columns), grown until pure or `maxDepth`.
 */
export function fitForest(
  X: readonly number[][],
  y: readonly number[],
  { trees = 100, maxDepth = 32, seed = 0 }: ForestOptions = {},
): Forest {
  const rand = mulberry32(seed);
  const n = X.length;
  const p = X[0]?.length ?? 0;
  const mtry = Math.max(1, Math.ceil(Math.sqrt(p)));
  const cols = Array.from({ length: p }, (_, f) => Float64Array.from(X, (row) => row[f]!));
  const ranks = cols.map(ranksOf);
  const ys = Float64Array.from(y);
  const out: Tree[] = [];
  for (let t = 0; t < trees; t++) {
    const sample: number[] = [];
    for (let i = 0; i < n; i++) sample.push(Math.floor(rand() * n));
    const gain = new Array<number>(p).fill(0);
    out.push({ root: buildTree(cols, ranks, ys, sample, 0, maxDepth, mtry, rand, gain), gain });
  }
  return { trees: out, features: p };
}

export function predictForest(forest: Forest, x: readonly number[]): number {
  let s = 0;
  for (const t of forest.trees) s += predictTree(t.root, x);
  return s / forest.trees.length;
}

/**
 * Impurity-based (mean decrease in impurity) feature importances: each
 * tree's gains normalised to sum 1, averaged over the trees that split,
 * normalised to sum 1 (all 0 when no tree splits).
 */
export function featureImportances(forest: Forest): number[] {
  const acc = new Array<number>(forest.features).fill(0);
  for (const t of forest.trees) {
    const total = t.gain.reduce((a, b) => a + b, 0);
    if (total <= 0) continue;
    t.gain.forEach((g, i) => (acc[i]! += g / total));
  }
  const total = acc.reduce((a, b) => a + b, 0);
  return total > 0 ? acc.map((v) => v / total) : acc;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Score every param with at least two distinct values against the target.
 * Rows with a non-finite target are dropped first; fewer than `MIN_RUNS`
 * rows score nothing. Sorted by importance (descending), then key.
 */
export function parameterImportance(rows: readonly ImportanceRow[], opts: ForestOptions = {}): ParamImportance[] {
  const kept = rows.filter((r) => Number.isFinite(r.target));
  if (kept.length < MIN_RUNS) return [];
  const y = kept.map((r) => r.target);
  const enc = encodeParams(kept);
  if (enc.params.length === 0) return [];

  const perFeature = featureImportances(fitForest(enc.X, y, opts));
  const out: ParamImportance[] = enc.params.map((p) => {
    let correlation: number | null = null;
    if (p.kind === "numeric") {
      const xs: number[] = [];
      const ys: number[] = [];
      kept.forEach((row, k) => {
        const v = numericValue(row.params[p.key]);
        if (v != null) { xs.push(v); ys.push(y[k]!); }
      });
      correlation = pearson(xs, ys);
    }
    const importance = p.columns.reduce((a, c) => a + perFeature[c]!, 0);
    return { key: p.key, kind: p.kind, importance, correlation };
  });
  return sortImportance(out, "importance");
}

export type ImportanceSort = "importance" | "correlation";

/** By importance, or by the correlation's strength (|r|, none last); descending, ties by key. */
export function sortImportance(rows: readonly ParamImportance[], by: ImportanceSort): ParamImportance[] {
  const score = (r: ParamImportance) => (by === "importance" ? r.importance : r.correlation == null ? -1 : Math.abs(r.correlation));
  return [...rows].sort((a, b) => score(b) - score(a) || a.key.localeCompare(b.key));
}
