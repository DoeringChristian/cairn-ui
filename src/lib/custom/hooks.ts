/**
 * Custom viewers: React Query hooks — the project's viewer list (polled
 * fast while a dev source is live, so `cairn viewer dev` edits reload the
 * frames) and logged values' bytes.
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { qk } from "../../api/query-keys";
import type { ViewerInfo } from "../../api/types";
import { useProjectId } from "../project-context";
import { defaultViewerName, resolveViewer, viewerFromInfo, type SeriesKind, type Viewer } from "./viewers.ts";

const DEV_POLL_MS = 2000;
const POLL_MS = 15_000;

/** The project a card's viewers come from: the ambient project, else the run's. */
export function useViewerProject(runId: string | null | undefined): string | null {
  const ambient = useProjectId();
  const run = useQuery({
    queryKey: qk.run(runId ?? ""),
    queryFn: () => api.run(runId!),
    enabled: !ambient && !!runId,
    staleTime: 60_000,
  });
  return ambient ?? run.data?.run.project_id ?? null;
}

/** The project's viewers (each family's latest, plus dev sources); `allVersions` for pinned cards. */
export function useViewerList(project: string | null, allVersions = false) {
  return useQuery({
    queryKey: ["viewers", project, allVersions],
    queryFn: () => api.viewers(project!, { allVersions }),
    enabled: !!project,
    select: (d) => d.viewers,
    staleTime: 1000,
    refetchInterval: (q) => (q.state.data?.viewers.some((v: ViewerInfo) => v.dev) ? DEV_POLL_MS : POLL_MS),
  });
}

/** The project's default viewer per kind (lib/custom/viewers.ts defaultViewerName). */
export function useViewerDefaults(project: string | null) {
  return useQuery({
    queryKey: qk.viewerDefaults(project ?? ""),
    queryFn: () => api.viewerDefaults(project!),
    enabled: !!project,
    staleTime: 5000,
  });
}

/**
 * The default viewer of one kind of data in a project; `ready` once the
 * viewer list and the defaults are in (null: a built-in type's own renderer).
 */
export function useDefaultViewer(project: string | null, series: SeriesKind | null) {
  const list = useViewerList(project);
  const defaults = useViewerDefaults(project);
  const ready = project != null && (list.data !== undefined || list.isError) && (defaults.data !== undefined || defaults.isError);
  const name = ready && series ? defaultViewerName(defaults.data, list.data ?? [], series) : null;
  return { ready, name, list: list.data ?? [] };
}

/** The viewer a card names (null while loading or when there is none) and why it is missing. */
export function useViewer(project: string | null, name: string | null | undefined, version?: number | null) {
  const q = useViewerList(project, version != null);
  const info = name && q.data ? resolveViewer(q.data, name, version) : null;
  const key = info ? `${info.dev ? "dev" : "v"}:${info.version_id ?? ""}:${info.revision ?? ""}:${info.content_digest}` : null;
  // One Viewer object per listed entry: the frame reloads only when it changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const viewer: Viewer | null = useMemo(() => (info ? viewerFromInfo(info) : null), [key]);
  return {
    viewer,
    loading: q.isLoading,
    error: q.error ? String(q.error) : !name ? "no viewer chosen" : q.data && !info ? `no viewer "${name}"${version != null ? ` v${version}` : ""} in this project` : null,
    list: q.data ?? [],
  };
}

/** A logged value's bytes (cached; the frame decodes a fresh copy per render). */
export const artifactBytesQuery = (hash: string, url?: string) => ({
  queryKey: ["artifact-bytes", hash] as const,
  queryFn: async () => {
    const res = await fetch(url ?? api.artifactUrl(hash));
    if (!res.ok) throw new Error(`artifact ${hash.slice(0, 8)}: HTTP ${res.status}`);
    return res.arrayBuffer();
  },
  staleTime: Infinity,
  gcTime: 60_000,
});
