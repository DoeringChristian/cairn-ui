/**
 * Artifact explorer URLs and the alias / tag rules the server enforces.
 *
 * Explorer URLs name artifacts, not ids: `/p/<project>/artifacts/<name>/v<N>/<tab>`.
 * An artifact name never contains `:` or `/` (ref syntax), so it is one path
 * segment once encoded.
 */

export const VERSION_TABS = ["overview", "metadata", "usage", "files", "lineage", "versions"] as const;
export type VersionTab = (typeof VERSION_TABS)[number];

export function isVersionTab(s: string | undefined): s is VersionTab {
  return !!s && (VERSION_TABS as readonly string[]).includes(s);
}

/** The explorer URL of a project, artifact, version or version tab. */
export function explorerPath(
  projectId: string,
  name?: string | null,
  version?: number | null,
  tab?: VersionTab | null,
  query?: Record<string, string>,
): string {
  let p = `/p/${encodeURIComponent(projectId)}/artifacts`;
  if (name) {
    p += `/${encodeURIComponent(name)}`;
    if (version != null) {
      p += `/v${version}`;
      if (tab) p += `/${tab}`;
    }
  }
  const qs = query ? new URLSearchParams(query).toString() : "";
  return qs ? `${p}?${qs}` : p;
}

/** `"v3"` -> 3; anything else -> null. */
export function parseVersionSegment(seg: string | undefined): number | null {
  const m = /^v(\d+)$/.exec(seg ?? "");
  return m ? Number(m[1]) : null;
}

/** `latest` and `v<N>` are maintained by cairn: never set or removed by hand. */
export const RESERVED_ALIAS = /^(latest|v\d+)$/;

/** Why `alias` cannot be added as a user alias, or null when it can. */
export function aliasError(alias: string): string | null {
  const a = alias.trim();
  if (!a) return "an alias cannot be empty";
  if (RESERVED_ALIAS.test(a)) return `"${a}" is reserved ("latest" and "vN" are maintained by cairn)`;
  if (a.includes(":") || a.includes("/")) return "an alias cannot contain ':' or '/'";
  return null;
}

/** Why `tag` cannot be added, or null when it can. */
export function tagError(tag: string): string | null {
  return tag.trim() ? null : "a tag cannot be empty";
}

/** User aliases can be removed; `latest` (and `vN`, never stored) cannot. */
export function isRemovableAlias(alias: string): boolean {
  return !RESERVED_ALIAS.test(alias);
}

/** An external reference's URI is a link only when a browser can open it. */
export function isBrowsableUri(uri: string): boolean {
  return /^https?:\/\//i.test(uri);
}
