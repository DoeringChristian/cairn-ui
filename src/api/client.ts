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
    throw new Error(`${res.status} ${res.statusText}: ${path}`);
  }
  return res;
}

async function get<T>(path: string): Promise<T> {
  const res = await checkOk(await fetch(path), path);
  return (await res.json()) as T;
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

async function del_<T>(path: string): Promise<T> {
  const res = await checkOk(await fetch(path, { method: "DELETE" }), path);
  return (await res.json()) as T;
}

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
    if (params.include?.length) q.set("include", params.include.join(","));
    if (params.limit != null) q.set("limit", String(params.limit));
    if (params.offset != null) q.set("offset", String(params.offset));
    const qs = q.toString();
    return get<import("./types").RunsListResponse>(
      `/api/runs${qs ? `?${qs}` : ""}`,
    );
  },
  run: (runId: string) =>
    get<import("./types").RunDetailResponse>(`/api/runs/${runId}`),
  sequences: (runId: string) =>
    get<{ sequences: import("./types").SequenceMeta[] }>(
      `/api/runs/${runId}/sequences`,
    ),
  sequence: async (runId: string, name: string) => {
    const res = await get<import("./types").SequenceResponse>(
      `/api/runs/${runId}/sequences/${encodeURIComponent(name)}`,
    );
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
  artifactsForRun: (runId: string) =>
    get<import("./types").ArtifactsResponse>(`/api/runs/${runId}/artifacts`),
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
    post<{ run_id: string; status: string }>(`/api/runs/${runId}/archive`, {}),
  unarchiveRun: (runId: string) =>
    post<{ run_id: string; status: string }>(`/api/runs/${runId}/unarchive`, {}),
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

  // Comparisons (server-persisted)
  comparisons: (projectId: string) =>
    get<{ comparisons: Array<{ id: string; name: string; created_at: string; updated_at: string; card_count: number }> }>(
      `/api/projects/${projectId}/comparisons`,
    ),
  comparison: (projectId: string, id: string) =>
    get<{ id: string; project_id: string; name: string; created_at: string; updated_at: string; payload: Record<string, unknown> }>(
      `/api/projects/${projectId}/comparisons/${id}`,
    ),
  createServerComparison: (projectId: string, name: string, payload: Record<string, unknown>) =>
    post<{ id: string; name: string; created_at: string }>(
      `/api/projects/${projectId}/comparisons`,
      { name, payload },
    ),
  updateServerComparison: (projectId: string, id: string, body: { name?: string; payload?: Record<string, unknown> }) =>
    put<{ id: string; updated_at: string }>(
      `/api/projects/${projectId}/comparisons/${id}`,
      body,
    ),
  deleteServerComparison: (projectId: string, id: string) =>
    del_<{ deleted: string }>(`/api/projects/${projectId}/comparisons/${id}`),

  // Comparison templates (server-persisted)
  comparisonTemplates: (projectId: string) =>
    get<{ comparison_templates: Array<{ id: string; name: string; created_at: string; updated_at: string; card_count: number }> }>(
      `/api/projects/${projectId}/comparison-templates`,
    ),
  comparisonTemplate: (projectId: string, id: string) =>
    get<{ id: string; project_id: string; name: string; created_at: string; updated_at: string; payload: Record<string, unknown> }>(
      `/api/projects/${projectId}/comparison-templates/${id}`,
    ),
  createServerComparisonTemplate: (projectId: string, name: string, payload: Record<string, unknown>) =>
    post<{ id: string; name: string; created_at: string }>(
      `/api/projects/${projectId}/comparison-templates`,
      { name, payload },
    ),
  updateServerComparisonTemplate: (projectId: string, id: string, body: { name?: string; payload?: Record<string, unknown> }) =>
    put<{ id: string; updated_at: string }>(
      `/api/projects/${projectId}/comparison-templates/${id}`,
      body,
    ),
  deleteServerComparisonTemplate: (projectId: string, id: string) =>
    del_<{ deleted: string }>(`/api/projects/${projectId}/comparison-templates/${id}`),

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

  // Artifact registry
  artifactFamilies: (projectId: string) =>
    get<{ families: import("./types").ArtifactFamily[] }>(
      `/api/projects/${projectId}/artifact-families`,
    ),
  artifactFamily: (_projectId: string, familyId: string) =>
    get<import("./types").ArtifactFamilyDetail>(
      `/api/artifact-families/${familyId}`,
    ),
  updateArtifactFamily: (familyId: string, body: { name?: string; description?: string | null }) =>
    patch<import("./types").ArtifactFamily>(
      `/api/artifact-families/${familyId}`,
      body,
    ),
  setArtifactAlias: (familyId: string, alias: string, version: number) =>
    put<{ alias: string; version: number }>(
      `/api/artifact-families/${familyId}/aliases`,
      { alias, version },
    ),
  deleteArtifactAlias: (familyId: string, alias: string) =>
    del_<{ deleted: string }>(
      `/api/artifact-families/${familyId}/aliases/${encodeURIComponent(alias)}`,
    ),
  runInputArtifacts: (runId: string) =>
    get<{ inputs: import("./types").RunArtifactInput[] }>(
      `/api/runs/${runId}/inputs`,
    ),
  runOutputArtifacts: (runId: string) =>
    get<{ outputs: import("./types").RunArtifactOutput[] }>(
      `/api/runs/${runId}/outputs`,
    ),
  lineage: (projectId: string) =>
    get<import("./types").LineageGraph>(
      `/api/projects/${projectId}/lineage`,
    ),
  sweeps: (projectId: string) =>
    get<{ sweeps: import("./types").Sweep[] }>(
      `/api/sweeps?project=${encodeURIComponent(projectId)}`,
    ),
  sweep: (sweepId: string) =>
    get<import("./types").SweepDetail>(`/api/sweeps/${sweepId}`),
  sweepAction: (sweepId: string, action: import("./types").SweepAction) =>
    post<import("./types").SweepDetail>(`/api/sweeps/${sweepId}/${action}`, {}),

  // ── Project workspace + saved views (lib/workspace/*) ──────────────────
  workspace: (projectId: string) =>
    get<import("./types").WorkspaceGet>(`/api/projects/${projectId}/workspace`),
  /** A stale `baseRev` resolves to `{conflict}` (the server's document), not an error. */
  putWorkspace: async (
    projectId: string,
    baseRev: number,
    payload: Record<string, unknown>,
  ): Promise<import("./types").WorkspacePutResult> => {
    const path = `/api/projects/${projectId}/workspace`;
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
