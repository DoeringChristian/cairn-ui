/**
 * Comparing two versions of an artifact (the Versions tab): metadata by
 * flattened key, files by path and content (digest; a reference by its URI
 * and etag).
 */

import type { FileEntryLike } from "./file-tree.ts";

export type DiffStatus = "added" | "removed" | "changed" | "same";

export interface MetadataDiffRow {
  key: string;
  status: DiffStatus;
  before?: unknown;
  after?: unknown;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** `{a: {b: 1}, c: [1]}` -> `{"a.b": 1, "c": [1]}`; arrays and empty objects are leaves. */
export function flattenMetadata(obj: Record<string, unknown>, prefix = ""): Map<string, unknown> {
  const out = new Map<string, unknown>();
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (isPlainObject(v) && Object.keys(v).length > 0) {
      for (const [kk, vv] of flattenMetadata(v, key)) out.set(kk, vv);
    } else {
      out.set(key, v);
    }
  }
  return out;
}

/** Deep equality for JSON values. */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const bb = b as unknown[];
    return a.length === bb.length && a.every((x, i) => jsonEqual(x, bb[i]));
  }
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  return (
    ka.length === kb.length &&
    ka.every((k) => jsonEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
  );
}

/** Every flattened key of either side, sorted, with how it changed from `a` to `b`. */
export function diffMetadata(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): MetadataDiffRow[] {
  const fa = flattenMetadata(a);
  const fb = flattenMetadata(b);
  const keys = [...new Set([...fa.keys(), ...fb.keys()])].sort();
  return keys.map((key) => {
    const inA = fa.has(key);
    const inB = fb.has(key);
    if (!inA) return { key, status: "added", after: fb.get(key) };
    if (!inB) return { key, status: "removed", before: fa.get(key) };
    const before = fa.get(key);
    const after = fb.get(key);
    return { key, status: jsonEqual(before, after) ? "same" : "changed", before, after };
  });
}

/** What makes two entries at one path the same content. */
export function entryIdentity(e: FileEntryLike & { etag?: string | null }): string {
  return e.digest !== null ? `sha:${e.digest}` : `ref:${e.uri ?? ""}#${e.etag ?? ""}`;
}

export interface FileDiff<E extends FileEntryLike> {
  added: E[];
  removed: E[];
  changed: Array<{ path: string; before: E; after: E }>;
  unchanged: E[];
}

/** Files of `b` against `a`, each list by path. */
export function diffFiles<E extends FileEntryLike & { etag?: string | null }>(
  a: readonly E[],
  b: readonly E[],
): FileDiff<E> {
  const byA = new Map(a.map((e) => [e.path, e]));
  const byB = new Map(b.map((e) => [e.path, e]));
  const out: FileDiff<E> = { added: [], removed: [], changed: [], unchanged: [] };
  for (const e of [...b].sort((x, y) => x.path.localeCompare(y.path))) {
    const old = byA.get(e.path);
    if (!old) out.added.push(e);
    else if (entryIdentity(old) !== entryIdentity(e)) out.changed.push({ path: e.path, before: old, after: e });
    else out.unchanged.push(e);
  }
  for (const e of [...a].sort((x, y) => x.path.localeCompare(y.path))) {
    if (!byB.has(e.path)) out.removed.push(e);
  }
  return out;
}

/** A short JSON rendering of a metadata value for a diff cell. */
export function formatValue(v: unknown, max = 120): string {
  if (v === undefined) return "";
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
