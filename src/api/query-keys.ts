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
  logs: (runId: string, opts: unknown) => ["logs", runId, opts] as const,
  sourceTree: (runId: string) => ["source-tree", runId] as const,
  sourceFile: (runId: string, path: string | null) => ["source-file", runId, path] as const,
  plotlySource: (sourceHash: string | null | undefined) => ["plotly-source", sourceHash] as const,
  /** A gallery point's manifest (lib/media/gallery.ts); content addressed, so never stale. */
  gallery: (hash: string | null | undefined) => ["gallery", hash] as const,
  /** An artifact's bytes as text (markdown, HTML); content addressed, so never stale. */
  artifactText: (hash: string | null | undefined) => ["artifact-text", hash] as const,
  /** A project's default viewer per kind (lib/custom/hooks useViewerDefaults). */
  viewerDefaults: (project: string) => ["viewer-defaults", project] as const,
  /** The first `bytes` of an artifact as text (a file too big to show whole). */
  artifactTextHead: (hash: string, bytes: number) => ["artifact-text-head", hash, bytes] as const,
  // Artifact registry: every key starts with "artifact-" or "lineage" (see
  // invalidateArtifacts in api/artifact-hooks.ts).
  artifactFamilies: (projectId: string) => ["artifact-families", projectId] as const,
  artifactFamilyByName: (projectId: string, name: string) => ["artifact-family", projectId, name] as const,
  artifactVersion: (versionId: string) => ["artifact-version", versionId] as const,
  artifactVersionFiles: (versionId: string) => ["artifact-version-files", versionId] as const,
  artifactVersionConsumers: (versionId: string) => ["artifact-version-consumers", versionId] as const,
  runInputArtifacts: (runId: string) => ["run-input-artifacts", runId] as const,
  runOutputArtifacts: (runId: string) => ["run-output-artifacts", runId] as const,
  lineage: (projectId: string, familyId?: string | null) => ["lineage", projectId, familyId ?? null] as const,
  lineageAround: (kind: string, id: string, depth: number | null, direction: string) =>
    ["lineage-around", kind, id, depth, direction] as const,
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
  /** The project's comparisons (names + run counts); each one's document lives in lib/workspace/store.ts. */
  comparisons: (projectId: string) => ["comparisons", projectId] as const,
  // Report share links (wave 3 / I).
  reportShares: (projectId: string, reportId: string) => ["report-shares", projectId, reportId] as const,
  shareContext: () => ["share-context"] as const,
} as const;
