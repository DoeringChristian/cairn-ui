/**
 * Custom viewers: picking viewers from the project's list (pure; tested in
 * viewers.test.ts).
 *
 * The list holds each family's latest published version and, while `cairn
 * viewer dev` runs, a dev entry of the same name — the dev entry wins. A
 * card names its viewer (`viewer`) and may pin a version (`viewer_version`);
 * the pinned version needs the all-versions list.
 */

import type { ViewerInfo } from "../../api/types";
import { acceptScore, parseManifest, type SeriesKind, type ViewerManifest } from "./manifest.ts";

/** The entry a card with `name` (pinned to `version`, if any) uses; null when there is none. */
export function resolveViewer(list: readonly ViewerInfo[], name: string, version?: number | null): ViewerInfo | null {
  const same = list.filter((v) => v.name === name);
  if (version != null) return same.find((v) => !v.dev && v.version === version) ?? null;
  return same.find((v) => v.dev && !v.error) ?? newest(same.filter((v) => !v.dev)) ?? same.find((v) => v.dev) ?? null;
}

function newest(list: readonly ViewerInfo[]): ViewerInfo | null {
  let best: ViewerInfo | null = null;
  for (const v of list) if (!best || (v.version ?? 0) > (best.version ?? 0)) best = v;
  return best;
}

/** One entry per viewer name (dev over published, newest version), A–Z by title. */
export function currentViewers(list: readonly ViewerInfo[]): ViewerInfo[] {
  const names = [...new Set(list.map((v) => v.name))];
  return names
    .map((n) => resolveViewer(list, n))
    .filter((v): v is ViewerInfo => v != null)
    .sort((a, b) => (a.title || a.name).localeCompare(b.title || b.name));
}

/** The viewers that accept every one of `series` (one kind of data), the most specific first. */
export function viewersFor(list: readonly ViewerInfo[], series: readonly SeriesKind[]): ViewerInfo[] {
  if (series.length === 0) return [];
  const scored = currentViewers(list)
    .map((v) => ({ v, score: Math.min(...series.map((s) => acceptScore(v, s))) }))
    .filter((x) => x.score >= 0);
  return scored.sort((a, b) => b.score - a.score || (a.v.title || a.v.name).localeCompare(b.v.title || b.v.name)).map((x) => x.v);
}

/** A listed viewer with its manifest parsed (`error` set when it is unusable). */
export interface Viewer {
  info: ViewerInfo;
  manifest: ViewerManifest | null;
  error: string | null;
  /** Cache key of its files: the version, or a dev source's revision. */
  key: string;
}

export function viewerFromInfo(info: ViewerInfo): Viewer {
  const key = info.dev ? `dev:${info.name}:${info.revision ?? 0}` : `v:${info.version_id}`;
  if (info.error) return { info, manifest: null, error: info.error, key };
  const r = parseManifest(info);
  return r.ok ? { info, manifest: r.manifest, error: null, key } : { info, manifest: null, error: r.errors.join("; "), key };
}

