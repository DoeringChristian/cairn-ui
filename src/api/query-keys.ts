/**
 * Centralized query-key factories.
 *
 * Every react-query `queryKey` and `invalidateQueries` call should
 * reference these builders so keys stay consistent across the app.
 */

import type { RunsQuery } from "./types.ts";

export const qk = {
  health: () => ["health"] as const,
  session: () => ["auth-session"] as const,
  projects: () => ["projects"] as const,
  runs: (params?: unknown) => params != null ? ["runs", params] as const : ["runs"] as const,
  /** No params: the prefix every runs-infinite query shares (for invalidation). */
  runsInfinite: (params?: Omit<RunsQuery, "limit" | "offset">) =>
    params != null ? ["runs-infinite", params] as const : ["runs-infinite"] as const,
  run: (runId: string) => ["run", runId] as const,
  sequences: (runId: string) => ["sequences", runId] as const,
  sequence: (runId: string, name: string) => ["sequence", runId, name] as const,
  artifacts: (runId: string) => ["artifacts", runId] as const,
  logs: (runId: string, opts: unknown) => ["logs", runId, opts] as const,
  sourceTree: (runId: string) => ["source-tree", runId] as const,
  sourceFile: (runId: string, path: string | null) => ["source-file", runId, path] as const,
  highlight: (selected: string | null, content: string | undefined) => ["highlight", selected, content] as const,
  plotlySource: (sourceHash: string | null | undefined) => ["plotly-source", sourceHash] as const,
  imageGallery: (hash: string | null | undefined) => ["image-gallery", hash] as const,
  artifactFamilies: (projectId: string) => ["artifact-families", projectId] as const,
  artifactFamily: (projectId: string, familyId: string) => ["artifact-family", projectId, familyId] as const,
  runInputArtifacts: (runId: string) => ["run-input-artifacts", runId] as const,
  runOutputArtifacts: (runId: string) => ["run-output-artifacts", runId] as const,
  lineage: (projectId: string) => ["lineage", projectId] as const,
  alerts: (projectId: string, runId?: string) => ["alerts", projectId, runId ?? null] as const,
  reports: (projectId: string, params?: unknown) =>
    params != null ? (["reports", projectId, params] as const) : (["reports", projectId] as const),
  report: (projectId: string, reportId: string) => ["report", projectId, reportId] as const,
  // Report comment threads (wave 3, agent H).
  reportComments: (projectId: string, reportId: string) => ["report-comments", projectId, reportId] as const,
  sweeps: (projectId: string) => ["sweeps", projectId] as const,
  sweep: (sweepId: string) => ["sweep", sweepId] as const,
  // Saved workspace views (lib/workspace/views.ts).
  views: (projectId: string) => ["views", projectId] as const,
} as const;
