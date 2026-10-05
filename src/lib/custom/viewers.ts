/**
 * Custom viewers: picking viewers from the project's list (pure; tested in
 * viewers.test.ts).
 *
 * The list holds each family's latest published version and, while `cairn
 * viewer dev` runs, a dev entry of the same name — the dev entry wins. A
 * card names its viewer (`viewer`) and may pin a version (`viewer_version`);
 * the pinned version needs the all-versions list.
 */

import type { ViewerDefaults, ViewerInfo } from "../../api/types";
import { acceptScore, parseManifest, type SeriesKind, type ViewerManifest } from "./manifest.ts";

export type { SeriesKind };

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

/**
 * The built-in types a custom viewer can be the default of (every series
 * kind with a built-in card but scalars; the server's
 * `viewer_defaults.BUILTIN_TYPES`).
 */
export const VIEWER_DEFAULT_TYPES: ReadonlySet<string> = new Set([
  "image", "figure", "audio", "video", "histogram", "tensor", "text", "table", "html",
  "markdown", "pointcloud", "mesh", "boxes3d", "volume", "preset", "artifact",
]);

/** The viewer a defaults map (`{key: viewer}`) names for a series: the most specific matching key's. */
function defaultIn(map: Record<string, string>, series: SeriesKind): string | null {
  let best: { score: number; viewer: string } | null = null;
  for (const [key, viewer] of Object.entries(map)) {
    const score = acceptScore({ accepts: [key] }, series);
    if (score >= 0 && (!best || score > best.score)) best = { score, viewer };
  }
  return best?.viewer ?? null;
}

/**
 * The default viewer of a series (one kind of data) — every kind has
 * exactly one: the project's default for it (the Defaults page,
 * `default_for` on publish), else a built-in viewer's (`cairn.volume` for
 * volumes), else, for custom data, the viewer accepting it most
 * specifically. Null: a built-in type's own renderer (or, for custom data,
 * no viewer at all). A named viewer that is not in `list` is skipped.
 */
export function defaultViewerName(
  defaults: ViewerDefaults | null | undefined,
  list: readonly ViewerInfo[],
  series: SeriesKind,
): string | null {
  const known = (n: string | null) => (n != null && list.some((v) => v.name === n) ? n : null);
  const named = known(defaultIn(defaults?.defaults ?? {}, series)) ?? known(defaultIn(defaults?.builtin ?? {}, series));
  if (named) return named;
  return series.object_type === "custom" ? (viewersFor(list, [series])[0]?.name ?? null) : null;
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
  const key = info.builtin
    ? `builtin:${info.name}:${info.content_digest}`
    : info.dev
      ? `dev:${info.name}:${info.revision ?? 0}`
      : `v:${info.version_id}`;
  if (info.error) return { info, manifest: null, error: info.error, key };
  const r = parseManifest(info);
  return r.ok ? { info, manifest: r.manifest, error: null, key } : { info, manifest: null, error: r.errors.join("; "), key };
}

