// Thin fetch wrapper around the Cairn /api/* surface.
// All paths are relative so the same client works in dev (with Vite proxy)
// and prod (served by the UI server).
//
// Auth: the server authenticates the browser via an HttpOnly session
// cookie (see /login), which `fetch`'s default `credentials: "same-origin"`
// already attaches — no header wiring needed here. What IS needed is a
// central 401 handler: any authenticated-route response that comes back
// 401 means "no/expired session" (never "wrong role" — that's 403, which
// callers handle themselves), so every wrapper below funnels through
// `checkOk`, which redirects to /login?return=<path> before the caller's
// `.catch`/error boundary ever sees it.

import { seedRunCursor, seedRunEpoch } from "./live-updates-core";
import { SeriesBatcher, type SeriesBatchResponse } from "./series-batch";

function redirectToLogin(): void {
  if (typeof window === "undefined") return;
  if (window.location.pathname === "/login") return; // avoid a redirect loop
  // A share-link viewer has no login to go to: its page shows the error.
  if (isSharePath(window.location.pathname)) return;
  const returnTo = window.location.pathname + window.location.search;
  window.location.assign(`/login?return=${encodeURIComponent(returnTo)}`);
}

/** The share-link pages: `/share/<secret>` and the report view `/s/<rid>`. */
export function isSharePath(pathname: string): boolean {
  return pathname.startsWith("/share/") || pathname.startsWith("/s/");
}

async function checkOk(res: Response, path: string): Promise<Response> {
  if (res.status === 401) {
    redirectToLogin();
    throw new Error(`401 Unauthorized: ${path}`);
  }
  if (!res.ok) {
    let detail: string | null = null;
    try {
      const body = (await res.clone().json()) as { detail?: unknown };
      if (typeof body.detail === "string") detail = body.detail;
    } catch {
      // Not JSON: the status line is all there is.
    }
    throw new ApiError(res.status, `${res.status} ${res.statusText}: ${path}`, detail);
  }
  return res;
}

/** A non-2xx response: `status`, and the server's `detail` message when it sent one. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly detail: string | null = null,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** What to show the user for a failed request: the server's detail, else the message. */
export function errorText(err: unknown): string {
  if (err instanceof ApiError) return err.detail ?? err.message;
  return err instanceof Error ? err.message : String(err);
}

async function get<T>(path: string): Promise<T> {
  const res = await checkOk(await fetch(path), path);
  return (await res.json()) as T;
}

async function bytes(path: string, init?: RequestInit): Promise<ArrayBuffer> {
  const res = await checkOk(await fetch(path, init), path);
  return res.arrayBuffer();
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await checkOk(
    await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    path,
  );
  return (await res.json()) as T;
}

async function put<T>(path: string, body: unknown): Promise<T> {
  const res = await checkOk(
    await fetch(path, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    path,
  );
  return (await res.json()) as T;
}

async function patch<T>(path: string, body: unknown): Promise<T> {
  const res = await checkOk(
    await fetch(path, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    path,
  );
  return (await res.json()) as T;
}

function workspaceDocUrl(ref: import("../lib/workspace/ref").WorkspaceRef): string {
  return ref.kind === "project"
    ? `/api/projects/${ref.projectId}/workspace`
    : `/api/projects/${ref.projectId}/comparisons/${ref.id}`;
}

async function del_<T>(path: string): Promise<T> {
  const res = await checkOk(await fetch(path, { method: "DELETE" }), path);
  return (await res.json()) as T;
}

/** Estimated points of a series; set by the app from the run catalogues it holds. */
let seriesSize: (runId: string, name: string) => number = () => 0;
export function setSeriesSizeHint(fn: (runId: string, name: string) => number): void {
  seriesSize = fn;
}

const seriesBatcher = new SeriesBatcher({
  fetchBatch: (runId, names) => {
    const q = new URLSearchParams();
    for (const n of names) q.append("name", n);
    return get<SeriesBatchResponse>(`/api/runs/${runId}/series?${q.toString()}`);
  },
  size: (runId, name) => seriesSize(runId, name),
});

export const api = {
  health: () => get<import("./types").Health>("/api/health"),
  projects: () =>
    get<{ projects: import("./types").Project[] }>("/api/projects"),
  createProject: (name: string) =>
    post<{ id: string; name: string; created_at: string }>("/api/projects", { name }),
  runs: (params: import("./types").RunsQuery = {}) => {
    const q = new URLSearchParams();
    if (params.project) q.set("project", params.project);
    if (params.status) q.set("status", params.status);
    if (params.group) q.set("group", params.group);
    if (params.job_type) q.set("job_type", params.job_type);
    if (params.sweep_id) q.set("sweep_id", params.sweep_id);
    if (params.ids) q.set("ids", params.ids.join(","));
    if (params.include?.length) q.set("include", params.include.join(","));
    q.set("archived", params.archived ?? "all");
    if (params.sort) q.set("sort", params.sort);
    q.set("desc", params.desc === false ? "false" : "true");
    if (params.limit != null) q.set("limit", String(params.limit));
    if (params.offset != null) q.set("offset", String(params.offset));
    const qs = q.toString();
    return get<import("./types").RunsListResponse>(
      `/api/runs${qs ? `?${qs}` : ""}`,
    );
  },
  run: (runId: string) =>
    get<import("./types").RunDetailResponse>(`/api/runs/${runId}`),
  sequences: async (runId: string) => {
    const res = await get<{ sequences: import("./types").SequenceMeta[] }>(
      `/api/runs/${runId}/sequences`,
    );
    // A series' object_type picks its card; a `pickle` series renders as the
    // artifact card (the card kind keeps its name).
    for (const s of res.sequences) if (s.object_type === "pickle") s.object_type = "artifact";
    return res;
  },
  /** One series, read through the batcher: the series asked for in the same task share a request per run. */
  sequence: async (runId: string, name: string) => {
    const res = await seriesBatcher.load(runId, name);
    // A full read tells the live-updates poller how far this run's append
    // stream had got, so it can resume with deltas instead of having every
    // card re-download its whole sequence every two seconds.
    if (typeof res.cursor === "number") seedRunCursor(runId, res.cursor);
    seedRunEpoch(runId, res.data_epoch);
    return res;
  },
  /** Everything appended to a run's sequences after `since`. One poll per
   * live run, app-wide — see api/live-updates.tsx. */
  updates: (runId: string, since: number) =>
    get<import("./types").UpdatesResponse>(
      `/api/runs/${runId}/updates?since=${since}`,
    ),
  artifactUrl: (hash: string) => `/api/artifacts/${hash}`,
  logs: (
    runId: string,
    opts: { offset?: number; limit?: number; stream?: string; search?: string } = {},
  ) => {
    const q = new URLSearchParams();
    if (opts.offset != null) q.set("offset", String(opts.offset));
    if (opts.limit != null) q.set("limit", String(opts.limit));
    if (opts.stream) q.set("stream", opts.stream);
    if (opts.search) q.set("search", opts.search);
    const qs = q.toString();
    return get<import("./types").LogsResponse>(
      `/api/runs/${runId}/logs${qs ? `?${qs}` : ""}`,
    );
  },
  sourceTree: (runId: string) =>
    get<import("./types").SourceTreeResponse>(`/api/runs/${runId}/source/tree`),
  sourceFile: (runId: string, path: string) =>
    get<import("./types").SourceFileResponse>(
      `/api/runs/${runId}/source/file?path=${encodeURIComponent(path)}`,
    ),
  setTags: (runId: string, tags: string[]) =>
    post<{ run_id: string; tags: string[] }>(`/api/runs/${runId}/tags`, { tags }),
  setNotes: (runId: string, notes: string) =>
    post<{ run_id: string; notes: string }>(`/api/runs/${runId}/notes`, { notes }),
  deleteRun: (runId: string) =>
    del_<{ deleted: string }>(`/api/runs/${runId}`),
  archiveRun: (runId: string) =>
    post<{ run_id: string; archived: boolean; archived_at: string | null }>(`/api/runs/${runId}/archive`, {}),
  unarchiveRun: (runId: string) =>
    post<{ run_id: string; archived: boolean; archived_at: string | null }>(`/api/runs/${runId}/unarchive`, {}),
  alerts: (projectId: string, opts: { since?: string; runId?: string; limit?: number } = {}) => {
    const q = new URLSearchParams();
    if (opts.since) q.set("since", opts.since);
    if (opts.runId) q.set("run_id", opts.runId);
    if (opts.limit != null) q.set("limit", String(opts.limit));
    const qs = q.toString();
    return get<{ alerts: import("./types").Alert[] }>(
      `/api/projects/${encodeURIComponent(projectId)}/alerts${qs ? `?${qs}` : ""}`,
    );
  },
  /** Ask a running run to stop; the SDK sees it on its next heartbeat (≤10 s). */
  stopRun: (runId: string) =>
    post<{ run_id: string; stop_requested: string }>(`/api/runs/${runId}/stop`, {}),
  exportRuns: async (runIds: string[]): Promise<Blob> => {
    const resp = await checkOk(
      await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ run_ids: runIds }),
      }),
      "/api/export",
    );
    return resp.blob();
  },
  importRuns: async (file: File): Promise<{ imported: Array<{ original_id: string; new_id: string; name: string }> }> => {
    const form = new FormData();
    form.append("file", file);
    const resp = await checkOk(
      await fetch("/api/import", { method: "POST", body: form }),
      "/api/import",
    );
    return resp.json();
  },

  // Auth
  session: () =>
    get<{ authenticated: boolean; auth_enabled: boolean; name: string | null; role: string | null }>(
      "/api/auth/session",
    ),
  login: (token: string) =>
    post<{ name: string; role: string }>("/api/auth/login", { token }),
  loginWithOtp: (otp: string) =>
    post<{ name: string; role: string }>("/api/auth/otp", { otp }),
  logout: () => post<{ ok: boolean }>("/api/auth/logout", {}),

  // Comparisons: workspace documents with a run set (routes/project_docs.py).
  comparisons: (projectId: string) =>
    get<{ comparisons: import("./types").ComparisonSummary[] }>(`/api/projects/${projectId}/comparisons`),
  createComparison: (projectId: string, name: string, payload: Record<string, unknown>) =>
    post<{ id: string; name: string; rev: number; created_at: string }>(
      `/api/projects/${projectId}/comparisons`,
      { name, payload },
    ),
  renameComparison: (projectId: string, id: string, name: string) =>
    patch<{ id: string; name: string }>(`/api/projects/${projectId}/comparisons/${id}`, { name }),
  deleteComparison: (projectId: string, id: string) =>
    del_<{ deleted: string }>(`/api/projects/${projectId}/comparisons/${id}`),

  // Reports (server-persisted)
  reports: (projectId: string, params: { limit?: number; offset?: number } = {}) => {
    const q = new URLSearchParams();
    if (params.limit != null) q.set("limit", String(params.limit));
    if (params.offset != null) q.set("offset", String(params.offset));
    const qs = q.toString();
    return get<{
      reports: Array<{ id: string; name: string; updated_at: string; block_count: number }>;
      total: number;
      limit: number;
      offset: number;
    }>(`/api/projects/${projectId}/reports${qs ? `?${qs}` : ""}`);
  },
  report: (projectId: string, id: string) =>
    get<{ id: string; project_id: string; name: string; created_at: string; updated_at: string; payload: Record<string, unknown> }>(
      `/api/projects/${projectId}/reports/${id}`,
    ),
  createReport: (projectId: string, name: string, payload: Record<string, unknown>) =>
    post<{ id: string; name: string; created_at: string }>(
      `/api/projects/${projectId}/reports`,
      { name, payload },
    ),
  updateReport: (projectId: string, id: string, body: { name?: string; payload?: Record<string, unknown> }) =>
    put<{ id: string; updated_at: string }>(
      `/api/projects/${projectId}/reports/${id}`,
      body,
    ),
  deleteReport: (projectId: string, id: string) =>
    del_<{ deleted: string }>(`/api/projects/${projectId}/reports/${id}`),

  // --- reports editing (wave 3, agent H) ---
  /** PUT a report only if it is still at `expectedUpdatedAt`; a stale write returns the server copy. */
  updateReportIfUnchanged: async (
    projectId: string,
    id: string,
    body: { name?: string; payload?: Record<string, unknown> },
    expectedUpdatedAt: string,
  ): Promise<import("./types").ReportPutResult> => {
    const path = `/api/projects/${projectId}/reports/${id}`;
    const res = await fetch(path, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, expected_updated_at: expectedUpdatedAt }),
    });
    if (res.status === 409) {
      const b = (await res.json()) as { name: string; updated_at: string; payload: Record<string, unknown> };
      return { conflict: { name: b.name, updated_at: b.updated_at, payload: b.payload } };
    }
    await checkOk(res, path);
    return { ok: (await res.json()) as { id: string; updated_at: string } };
  },
  /**
   * Upload an image into a report (multipart `file`). XHR rather than fetch
   * for upload progress (`onProgress` gets 0..1). Rejects with the server's
   * `detail` message on failure.
   */
  uploadReportAsset: (
    projectId: string,
    reportId: string,
    file: Blob,
    onProgress?: (fraction: number) => void,
  ): Promise<import("./types").ReportAsset> =>
    new Promise((resolve, reject) => {
      const path = `/api/projects/${projectId}/reports/${reportId}/assets`;
      const xhr = new XMLHttpRequest();
      xhr.open("POST", path);
      xhr.responseType = "json";
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress?.(e.loaded / e.total);
      };
      xhr.onload = () => {
        if (xhr.status === 401) redirectToLogin();
        if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.response as import("./types").ReportAsset);
        else {
          const detail = (xhr.response as { detail?: unknown } | null)?.detail;
          reject(new Error(typeof detail === "string" ? detail : `${xhr.status} ${xhr.statusText}`));
        }
      };
      xhr.onerror = () => reject(new Error("network error"));
      const form = new FormData();
      form.append("file", file, (file as File).name || "image");
      xhr.send(form);
    }),
  reportComments: (projectId: string, reportId: string) =>
    get<{ comments: import("./types").ReportComment[] }>(`/api/projects/${projectId}/reports/${reportId}/comments`),
  createReportComment: (projectId: string, reportId: string, body: import("./types").ReportCommentCreate) =>
    post<import("./types").ReportComment>(`/api/projects/${projectId}/reports/${reportId}/comments`, body),
  updateReportComment: (projectId: string, reportId: string, commentId: string, body: string) =>
    put<import("./types").ReportComment>(
      `/api/projects/${projectId}/reports/${reportId}/comments/${commentId}`,
      { body },
    ),
  deleteReportComment: (projectId: string, reportId: string, commentId: string) =>
    del_<{ deleted: string[] }>(`/api/projects/${projectId}/reports/${reportId}/comments/${commentId}`),
  resolveReportComment: (projectId: string, reportId: string, commentId: string, resolved: boolean) =>
    post<import("./types").ReportComment>(
      `/api/projects/${projectId}/reports/${reportId}/comments/${commentId}/resolve`,
      { resolved },
    ),
  // --- end reports editing ---

  // Report templates (server-persisted)
  reportTemplates: (projectId: string) =>
    get<{ report_templates: Array<{ id: string; name: string; created_at: string; updated_at: string; card_count: number }> }>(
      `/api/projects/${projectId}/report-templates`,
    ),
  reportTemplate: (projectId: string, id: string) =>
    get<{ id: string; project_id: string; name: string; created_at: string; updated_at: string; payload: Record<string, unknown> }>(
      `/api/projects/${projectId}/report-templates/${id}`,
    ),
  createServerReportTemplate: (projectId: string, name: string, payload: Record<string, unknown>) =>
    post<{ id: string; name: string; created_at: string }>(
      `/api/projects/${projectId}/report-templates`,
      { name, payload },
    ),
  updateServerReportTemplate: (projectId: string, id: string, body: { name?: string; payload?: Record<string, unknown> }) =>
    put<{ id: string; updated_at: string }>(
      `/api/projects/${projectId}/report-templates/${id}`,
      body,
    ),
  deleteServerReportTemplate: (projectId: string, id: string) =>
    del_<{ deleted: string }>(`/api/projects/${projectId}/report-templates/${id}`),

  // Artifact registry (cairn/server/routes/artifact_registry.py)
  artifactFamilies: (projectId: string) =>
    get<{ families: import("./types").ArtifactFamily[] }>(
      `/api/projects/${encodeURIComponent(projectId)}/artifact-families`,
    ),
  artifactFamily: (familyId: string) =>
    get<import("./types").ArtifactFamilyDetail>(`/api/artifact-families/${familyId}`),
  artifactFamilyByName: (projectId: string, name: string) =>
    get<import("./types").ArtifactFamilyDetail>(
      `/api/projects/${encodeURIComponent(projectId)}/artifact-families/by-name/${encodeURIComponent(name)}`,
    ),
  updateArtifactFamily: (familyId: string, body: { description?: string | null }) =>
    patch<import("./types").ArtifactFamilyDetail>(`/api/artifact-families/${familyId}`, body),
  deleteArtifactFamily: (familyId: string) =>
    del_<{ deleted: string }>(`/api/artifact-families/${familyId}`),
  artifactVersion: (versionId: string) =>
    get<import("./types").ArtifactVersionInfo>(`/api/artifact-versions/${versionId}`),
  /** Replace the description and/or merge keys into the metadata. */
  updateArtifactVersion: (
    versionId: string,
    body: { description?: string; metadata?: Record<string, unknown> },
  ) => patch<import("./types").ArtifactVersionInfo>(`/api/artifact-versions/${versionId}`, body),
  /** 409 (ApiError) when an alias names the version, unless `force`. */
  deleteArtifactVersion: (versionId: string, force = false) =>
    del_<{ deleted: string }>(`/api/artifact-versions/${versionId}${force ? "?force=true" : ""}`),
  resolveArtifactRef: (projectId: string, ref: string) =>
    post<import("./types").ArtifactVersionInfo>(
      `/api/projects/${encodeURIComponent(projectId)}/resolve-artifact-ref`,
      { ref },
    ),
  /** The project's custom viewers: each family's latest version, plus live dev sources (`cairn viewer dev`). */
  viewers: (projectId: string, opts: { allVersions?: boolean } = {}) =>
    get<{ viewers: import("./types").ViewerInfo[] }>(
      `/api/projects/${encodeURIComponent(projectId)}/viewers${opts.allVersions ? "?all_versions=1" : ""}`,
    ),
  /** The project's default viewer per kind (lib/custom/viewers.ts defaultViewerName). */
  viewerDefaults: (projectId: string) =>
    get<import("./types").ViewerDefaults>(`/api/projects/${encodeURIComponent(projectId)}/viewer-defaults`),
  /** Set (a viewer's name) or clear (null: a built-in type's own renderer) one kind's default viewer. */
  setViewerDefault: (projectId: string, kind: string, viewer: string | null) =>
    put<import("./types").ViewerDefaults>(`/api/projects/${encodeURIComponent(projectId)}/viewer-defaults`, { kind, viewer }),
  /** A built-in viewer's files (shipped with cairn). */
  builtinViewerFiles: (name: string) =>
    get<{ files: import("./types").ViewerFileInfo[] }>(`/api/viewers/builtin/${encodeURIComponent(name)}/files`),
  builtinViewerFile: (name: string, path: string) =>
    bytes(`/api/viewers/builtin/${encodeURIComponent(name)}/file?path=${encodeURIComponent(path)}`),
  /** A dev viewer's current files (404 once `cairn viewer dev` stopped). */
  viewerDevFiles: (projectId: string, name: string) =>
    get<{ revision: number; files: import("./types").ViewerFileInfo[] }>(
      `/api/projects/${encodeURIComponent(projectId)}/viewers/dev/${encodeURIComponent(name)}/files`,
    ),
  viewerDevFile: (projectId: string, name: string, path: string) =>
    bytes(`/api/projects/${encodeURIComponent(projectId)}/viewers/dev/${encodeURIComponent(name)}/file?path=${encodeURIComponent(path)}`, { cache: "no-store" }),
  /** One file of a published version's entries, as bytes. */
  artifactVersionFileBytes: (versionId: string, path: string) =>
    bytes(`/api/artifact-versions/${versionId}/file?path=${encodeURIComponent(path)}`),
  artifactVersionFiles: (versionId: string) =>
    get<{ files: import("./types").ArtifactEntryInfo[] }>(
      `/api/artifact-versions/${versionId}/files`,
    ),
  /** One uploaded entry's bytes, served with the entry's mime type (Range aware). */
  artifactVersionFileUrl: (versionId: string, path: string) =>
    `/api/artifact-versions/${versionId}/file?path=${encodeURIComponent(path)}`,
  /** Every uploaded entry as `<name>-v<N>.zip` (references are left out). */
  artifactVersionDownloadUrl: (versionId: string) => `/api/artifact-versions/${versionId}/download`,
  artifactVersionConsumers: (versionId: string) =>
    get<{ consumers: import("./types").ArtifactConsumer[]; count: number }>(
      `/api/artifact-versions/${versionId}/consumers`,
    ),
  /** Point a user alias at a version (moving it within the family); `latest` / `vN` are a 400. */
  addArtifactAlias: (versionId: string, alias: string) =>
    post<import("./types").ArtifactVersionInfo>(`/api/artifact-versions/${versionId}/aliases`, { alias }),
  removeArtifactAlias: (versionId: string, alias: string) =>
    del_<import("./types").ArtifactVersionInfo>(
      `/api/artifact-versions/${versionId}/aliases/${encodeURIComponent(alias)}`,
    ),
  addArtifactTag: (versionId: string, tag: string) =>
    post<import("./types").ArtifactVersionInfo>(`/api/artifact-versions/${versionId}/tags`, { tag }),
  removeArtifactTag: (versionId: string, tag: string) =>
    del_<import("./types").ArtifactVersionInfo>(
      `/api/artifact-versions/${versionId}/tags/${encodeURIComponent(tag)}`,
    ),
  runInputArtifacts: (runId: string) =>
    get<{ inputs: import("./types").RunArtifactInput[] }>(`/api/runs/${runId}/inputs`),
  runOutputArtifacts: (runId: string) =>
    get<{ outputs: import("./types").ArtifactVersionInfo[] }>(
      `/api/runs/${runId}/outputs?include=files`,
    ),
  /** The project's lineage (`familyId`: one artifact's versions). */
  lineage: (projectId: string, familyId?: string | null) =>
    get<import("./types").LineageGraph>(
      `/api/projects/${encodeURIComponent(projectId)}/lineage${familyId ? `?family_id=${familyId}` : ""}`,
    ),
  /** The lineage around one version or run. */
  lineageAround: (
    center: { kind: "artifact_version" | "run"; id: string },
    opts: { depth?: number; direction?: "upstream" | "downstream" | "both" } = {},
  ) => {
    const q = new URLSearchParams();
    if (opts.depth != null) q.set("depth", String(opts.depth));
    if (opts.direction) q.set("direction", opts.direction);
    const base = center.kind === "run" ? `/api/runs/${center.id}` : `/api/artifact-versions/${center.id}`;
    return get<import("./types").LineageGraph>(`${base}/lineage?${q}`);
  },
  sweeps: (projectId: string) =>
    get<{ sweeps: import("./types").Sweep[] }>(
      `/api/sweeps?project=${encodeURIComponent(projectId)}`,
    ),
  sweep: (sweepId: string) =>
    get<import("./types").SweepDetail>(`/api/sweeps/${sweepId}`),
  sweepAction: (sweepId: string, action: import("./types").SweepAction) =>
    post<import("./types").SweepDetail>(`/api/sweeps/${sweepId}/${action}`, {}),

  // ── Workspace documents + saved views (lib/workspace/*) ──────────────
  /** The project workspace or a comparison: `{rev, payload}` (rev 0 / null payload before the first save). */
  workspaceDoc: (ref: import("../lib/workspace/ref").WorkspaceRef) =>
    get<import("./types").WorkspaceGet>(workspaceDocUrl(ref)),
  /** A stale `baseRev` resolves to `{conflict}` (the server's document), not an error. */
  putWorkspaceDoc: async (
    ref: import("../lib/workspace/ref").WorkspaceRef,
    baseRev: number,
    payload: Record<string, unknown>,
  ): Promise<import("./types").WorkspacePutResult> => {
    const path = workspaceDocUrl(ref);
    const res = await fetch(path, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ base_rev: baseRev, payload }),
    });
    if (res.status === 409) {
      const body = (await res.json()) as { rev: number; payload: Record<string, unknown> | null };
      return { conflict: { rev: body.rev, payload: body.payload } };
    }
    await checkOk(res, path);
    return { ok: (await res.json()) as { rev: number; updated_at: string } };
  },
  views: (projectId: string) =>
    get<{ views: import("./types").SavedViewSummary[] }>(`/api/projects/${projectId}/views`),
  view: (projectId: string, id: string) =>
    get<import("./types").SavedView>(`/api/projects/${projectId}/views/${id}`),
  createView: (projectId: string, name: string, payload: Record<string, unknown>) =>
    post<{ id: string; name: string; rev: number; created_at: string }>(
      `/api/projects/${projectId}/views`,
      { name, payload },
    ),
  deleteView: (projectId: string, id: string) =>
    del_<{ deleted: string }>(`/api/projects/${projectId}/views/${id}`),

  // Report share links (routes/shares.py) — wave 3 / I
  reportShares: (projectId: string, reportId: string) =>
    get<{ shares: import("./types").ReportShare[] }>(
      `/api/projects/${projectId}/reports/${reportId}/shares`,
    ),
  /** `expiresAt`: ISO timestamp; the server defaults to 30 days. */
  createReportShare: (projectId: string, reportId: string, expiresAt?: string) =>
    post<import("./types").ReportShareCreated>(
      `/api/projects/${projectId}/reports/${reportId}/shares`,
      expiresAt ? { expires_at: expiresAt } : {},
    ),
  revokeReportShare: (projectId: string, reportId: string, shareId: string) =>
    del_<{ revoked: string }>(`/api/projects/${projectId}/reports/${reportId}/shares/${shareId}`),
  /** Trade a link's secret for the share cookie. Throws with `status` set on failure. */
  redeemShare: async (secret: string): Promise<{ report_id: string; project_id: string }> => {
    const res = await fetch("/api/share/redeem", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret }),
    });
    if (!res.ok) throw Object.assign(new Error(`${res.status} ${res.statusText}`), { status: res.status });
    return (await res.json()) as { report_id: string; project_id: string };
  },
  shareContext: () => get<import("./types").ShareContext>("/api/share/context"),
};
