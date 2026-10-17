export type ReportWorkspace = {
  id: string; project_id: string; slug: string; entry: string; revision: number;
  files: { path: string; text: string | null }[];
  latest_build?: ReportBuild | null;
};
export type ReportPublication = { id: string; project_id: string; version_id: string; url: string };
export type ReportBuild = { id: string; status: string; error?: string; result?: ReportPublication | null };

async function request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(path, {method, headers: body === undefined ? undefined : {"Content-Type": "application/json"}, body: body === undefined ? undefined : JSON.stringify(body)});
  const value = await response.json();
  if (!response.ok) {
    const detail = typeof value.detail === "string" ? value.detail : value.detail?.message;
    throw new Error(detail || `Request failed (${response.status})`);
  }
  return value as T;
}
const path = (id: string) => `/api/report-workspaces/${encodeURIComponent(id)}`;
export const workspaceApi = {
  create: (project_id: string, slug: string, files: Record<string, string>) => request<ReportWorkspace>("/api/report-workspaces", "POST", {project_id, slug, files}),
  copy: (report_id: string, version_id: string, fork = false) => request<ReportWorkspace>("/api/report-workspaces", "POST", {report_id, version_id, fork}),
  read: (id: string) => request<ReportWorkspace>(path(id)),
  save: (id: string, files: Record<string, string>, expected_revision: number) => request<ReportWorkspace>(path(id), "PUT", {files, expected_revision}),
  build: (id: string, expected_revision: number) => request<ReportBuild>(`${path(id)}/build`, "POST", {expected_revision}),
  status: (id: string) => request<ReportBuild>(`/api/report-builds/${encodeURIComponent(id)}`),
};
