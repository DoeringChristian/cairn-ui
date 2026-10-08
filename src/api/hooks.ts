import { useEffect, useMemo } from "react";
import {
  type InfiniteData,
  useInfiniteQuery,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";
import type { RunDetailResponse, RunsListResponse, RunsQuery } from "./types";
import { api } from "./client";
import { qk } from "./query-keys";
import { MAX_LIVE_IDS, mergeLiveRuns, runningIds } from "./runs-live-core";
import { addRunMetadata, setRunMetadata } from "../lib/run-label";
import { RUN_SET_POOL } from "../lib/run-sets";
import { rulesOf, type MetricOverride, type MetricRulesDoc, type RuleOf } from "../lib/metric-rules";

export function useHealth() {
  return useQuery({ queryKey: qk.health(), queryFn: api.health, refetchInterval: 5_000 });
}

/** Who-am-I. Always resolves (server never 401s /api/auth/session) — check
 * `.data.authenticated` / `.data.auth_enabled` rather than `.isError`. */
export function useSession() {
  return useQuery({ queryKey: qk.session(), queryFn: api.session, staleTime: 30_000 });
}

export function useProjects() {
  return useQuery({ queryKey: qk.projects(), queryFn: api.projects });
}

export function useRuns(params: Parameters<typeof api.runs>[0], { enabled = true }: { enabled?: boolean } = {}) {
  const q = useQuery({
    queryKey: qk.runs(params),
    queryFn: () => api.runs(params),
    enabled,
    refetchInterval: (q) => {
      // Poll every 3s if there are any running runs.
      const data = q.state.data;
      if (!data) return false;
      return data.runs.some((r) => r.status === "running") ? 3_000 : false;
    },
  });

  // Seed the shared run-label cache centrally. `setRunMetadata` only bumps
  // its version (re-rendering label consumers) when data actually changed,
  // so this is safe to run on every fetch/poll.
  useEffect(() => {
    if (q.data && q.data.runs.length > 0) setRunMetadata(q.data.runs);
  }, [q.data]);

  return q;
}

const INFINITE_PAGE_SIZE = 100;

export function useInfiniteRuns(params: Omit<RunsQuery, "limit" | "offset">) {
  const qc = useQueryClient();
  const key = qk.runsInfinite(params);
  const q = useInfiniteQuery<RunsListResponse>({
    queryKey: key,
    queryFn: ({ pageParam }) =>
      api.runs({ ...params, limit: INFINITE_PAGE_SIZE, offset: pageParam as number }),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => {
      const next = lastPage.offset + lastPage.limit;
      return next < lastPage.total ? next : undefined;
    },
  });

  // Live poll, every 3 s: the list head (to notice new and deleted runs,
  // even when nothing on screen is running) plus just the running runs,
  // merged into the pages instead of refetching every loaded page. See
  // runs-live-core.ts.
  const running = useMemo(() => runningIds(q.data?.pages), [q.data]);
  useQuery({
    // Not under the "runs-infinite" prefix: invalidating the lists (after a
    // mutation) refetches the pages, and must not also fire this poll.
    queryKey: ["runs-live", params, running],
    enabled: q.data != null,
    // The pages were just fetched: the first poll is due in one interval.
    initialData: 0,
    staleTime: 3_000,
    refetchInterval: 3_000,
    queryFn: async () => {
      const refetchPages = () => qc.invalidateQueries({ queryKey: key, exact: true });
      if (running.length > MAX_LIVE_IDS) {
        await refetchPages();
        return Date.now();
      }
      const [head, live] = await Promise.all([
        api.runs({ ...params, include: undefined, limit: 1 }),
        running.length > 0 ? api.runs({ ...params, ids: running, limit: running.length }) : null,
      ]);
      const cached = qc.getQueryData<InfiniteData<RunsListResponse>>(key);
      const merged = cached ? mergeLiveRuns(cached, head, live ?? { ...head, runs: [] }, running) : null;
      if (merged === null) await refetchPages();
      else if (merged !== cached) qc.setQueryData(key, merged);
      return Date.now();
    },
  });

  useEffect(() => {
    const pages = q.data?.pages;
    if (!pages) return;
    const runs = pages.flatMap((p) => p.runs);
    if (runs.length > 0) setRunMetadata(runs);
  }, [q.data]);

  return q;
}

export function useRun(runId: string) {
  const q = useQuery({
    queryKey: qk.run(runId),
    queryFn: () => api.run(runId),
    refetchInterval: (q) =>
      q.state.data?.run.status === "running" ? 2_000 : false,
  });

  useEffect(() => {
    if (q.data) addRunMetadata(q.data.run);
  }, [q.data]);

  return q;
}

/** Fetch run details for a set of runs (e.g. comparison tabs). `live`
 * re-fetches running runs every 2 s, as `useRun` does (their progress). */
export function useRunsDetails(
  runIds: string[],
  { live = false }: { live?: boolean } = {},
): UseQueryResult<RunDetailResponse>[] {
  const results = useQueries({
    queries: runIds.map((rid) => ({
      queryKey: qk.run(rid),
      queryFn: () => api.run(rid),
      staleTime: 5_000,
      refetchInterval: (q: { state: { data?: RunDetailResponse } }) =>
        live && q.state.data?.run.status === "running" ? 2_000 : false,
    })),
  });

  // `results` is a fresh array each render, so key the seeding effect on the
  // queries' dataUpdatedAt timestamps instead (changes iff any fetch landed).
  const dataKey = results.map((r) => r.dataUpdatedAt).join("|");
  useEffect(() => {
    const runs = results
      .map((r) => r.data?.run)
      .filter((r): r is NonNullable<typeof r> => r != null);
    if (runs.length > 0) setRunMetadata(runs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataKey]);

  return results;
}

export function useSequences(runId: string) {
  const runQ = useQuery({
    queryKey: qk.run(runId),
    queryFn: () => api.run(runId),
    staleTime: 5_000,
    enabled: !!runId,
  });
  const live = runQ.data ? runQ.data.run.status === "running" : true;
  return useQuery({
    queryKey: qk.sequences(runId),
    queryFn: () => api.sequences(runId),
    // Deliberately still polled. This is the small GROUP BY roster of metric
    // NAMES, not their points, and it is the only thing that makes a metric
    // first logged mid-run appear at all — the live-updates poller appends
    // into existing cached sequences and never creates new ones.
    refetchInterval: live ? 2_000 : false,
  });
}

/**
 * One full read, then deltas. Liveness is NOT this hook's business any more:
 * `LiveUpdatesProvider` (mounted once at the app root) polls one cursor-based
 * `/updates` request per live run and appends new points into this query's
 * cached data. Re-downloading the whole sequence every 2s is what saturated
 * the server; `staleTime: Infinity` makes sure it never happens again.
 */
export function useSequence(runId: string, name: string) {
  return useQuery({
    queryKey: qk.sequence(runId, name),
    queryFn: () => api.sequence(runId, name),
    staleTime: Infinity,
  });
}

/**
 * Fetch sequences for multiple (runId, name) specs at once —
 * e.g. a multi-run card. Like `useSequence`, each spec is read in full once
 * and then kept current by the app-wide live-updates poller.
 */
export function useSequencesForRuns(
  specs: Array<{ runId: string; name: string }>,
) {
  return useQueries({
    queries: specs.map((spec) => ({
      queryKey: qk.sequence(spec.runId, spec.name),
      queryFn: () => api.sequence(spec.runId, spec.name),
      staleTime: Infinity,
    })),
  });
}

export function useLogs(
  runId: string,
  opts: { offset?: number; limit?: number; stream?: string; search?: string; label?: string | null },
) {
  const runQ = useQuery({
    queryKey: qk.run(runId),
    queryFn: () => api.run(runId),
    staleTime: 5_000,
    enabled: !!runId,
  });
  const live = runQ.data ? runQ.data.run.status === "running" : true;
  return useQuery({
    queryKey: qk.logs(runId, opts),
    queryFn: () => api.logs(runId, opts),
    refetchInterval: live ? 3_000 : false,
  });
}

export function useSourceTree(runId: string) {
  return useQuery({
    queryKey: qk.sourceTree(runId),
    queryFn: () => api.sourceTree(runId),
    retry: false,
  });
}

export function useSourceFile(runId: string, path: string | null) {
  return useQuery({
    queryKey: qk.sourceFile(runId, path),
    queryFn: () => {
      if (!path) throw new Error("no path");
      return api.sourceFile(runId, path);
    },
    enabled: !!path,
  });
}

export function useSetTags(runId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tags: string[]) => api.setTags(runId, tags),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.run(runId) });
      qc.invalidateQueries({ queryKey: ["runs"] });
      qc.invalidateQueries({ queryKey: qk.runsInfinite() });
    },
  });
}

export function useBulkRunMutation() {
  const qc = useQueryClient();
  const invalidate = (runIds: string[]) => {
    qc.invalidateQueries({ queryKey: qk.runsInfinite() });
    qc.invalidateQueries({ queryKey: ["runs"] });
    for (const rid of runIds) qc.invalidateQueries({ queryKey: qk.run(rid) });
  };
  return {
    bulkDelete: async (runIds: string[]) => {
      await Promise.all(runIds.map((id) => api.deleteRun(id)));
      invalidate(runIds);
    },
    bulkArchive: async (runIds: string[], archived: boolean) => {
      await Promise.all(
        runIds.map((id) => (archived ? api.archiveRun(id) : api.unarchiveRun(id))),
      );
      invalidate(runIds);
    },
    bulkStop: async (runIds: string[]) => {
      await Promise.all(runIds.map((id) => api.stopRun(id)));
      invalidate(runIds);
    },
  };
}

/** A project's newest alerts (or one run's), polled. */
export function useAlerts(projectId: string, opts: { runId?: string; limit?: number } = {}) {
  return useQuery({
    queryKey: qk.alerts(projectId, opts.runId),
    queryFn: () => api.alerts(projectId, { runId: opts.runId, limit: opts.limit ?? 20 }),
    enabled: !!projectId,
    refetchInterval: 10_000,
  });
}

export function useStopRun(runId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.stopRun(runId),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.run(runId) }),
  });
}

export function useSetNotes(runId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (notes: string) => api.setNotes(runId, notes),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.run(runId) }),
  });
}

export function useRunInputArtifacts(runId: string) {
  return useQuery({
    queryKey: qk.runInputArtifacts(runId),
    queryFn: () => api.runInputArtifacts(runId),
    enabled: !!runId,
  });
}

export function useRunOutputArtifacts(runId: string) {
  return useQuery({
    queryKey: qk.runOutputArtifacts(runId),
    queryFn: () => api.runOutputArtifacts(runId),
    enabled: !!runId,
  });
}

// ---------------------------------------------------------------------------
// Reports (server-persisted; see api/client.ts's Reports section)
// ---------------------------------------------------------------------------

export function useReports(projectId: string, params?: Parameters<typeof api.reports>[1]) {
  return useQuery({
    queryKey: qk.reports(projectId, params),
    queryFn: () => api.reports(projectId, params),
    enabled: !!projectId,
  });
}

export function useReport(projectId: string, reportId: string) {
  return useQuery({
    queryKey: qk.report(projectId, reportId),
    queryFn: () => api.report(projectId, reportId),
    enabled: !!projectId && !!reportId,
  });
}

export function useCreateReport(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { name: string; payload: Record<string, unknown> }) =>
      api.createReport(projectId, vars.name, vars.payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.reports(projectId) }),
  });
}

export function useUpdateReport(projectId: string, reportId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name?: string; payload?: Record<string, unknown> }) =>
      api.updateReport(projectId, reportId, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.report(projectId, reportId) });
      qc.invalidateQueries({ queryKey: qk.reports(projectId) });
    },
  });
}

// --- report comments (wave 3, agent H) ---
export function useReportComments(projectId: string, reportId: string, enabled = true) {
  return useQuery({
    queryKey: qk.reportComments(projectId, reportId),
    queryFn: () => api.reportComments(projectId, reportId),
    enabled: enabled && !!projectId && !!reportId,
  });
}

/** Every comment write, each refreshing the report's comment list. */
export function useReportCommentMutations(projectId: string, reportId: string) {
  const qc = useQueryClient();
  const onSuccess = () => qc.invalidateQueries({ queryKey: qk.reportComments(projectId, reportId) });
  return {
    create: useMutation({
      mutationFn: (body: import("./types").ReportCommentCreate) => api.createReportComment(projectId, reportId, body),
      onSuccess,
    }),
    update: useMutation({
      mutationFn: (v: { id: string; body: string }) => api.updateReportComment(projectId, reportId, v.id, v.body),
      onSuccess,
    }),
    remove: useMutation({
      mutationFn: (id: string) => api.deleteReportComment(projectId, reportId, id),
      onSuccess,
    }),
    resolve: useMutation({
      mutationFn: (v: { id: string; resolved: boolean }) => api.resolveReportComment(projectId, reportId, v.id, v.resolved),
      onSuccess,
    }),
  };
}
// --- end report comments ---

export function useDeleteReport(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (reportId: string) => api.deleteReport(projectId, reportId),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.reports(projectId) }),
  });
}

// ---------------------------------------------------------------------------
// Run sets (lib/run-sets.ts): a report cell's runs, resolved live
// ---------------------------------------------------------------------------

/**
 * The project's runs a report's run sets resolve against: the newest
 * `RUN_SET_POOL`, archived included, with params and stats (the workspace's
 * fetch, so the two share the cache).
 */
export function useRunSetPool(projectId: string | null | undefined, enabled = true) {
  return useRuns({ project: projectId ?? "", limit: RUN_SET_POOL, include: ["params", "stats"] }, { enabled: enabled && !!projectId });
}

/** A project's sweeps; polls while any is running (agents report trials live). */
export function useSweeps(projectId: string) {
  return useQuery({
    queryKey: qk.sweeps(projectId),
    queryFn: () => api.sweeps(projectId),
    enabled: !!projectId,
    refetchInterval: (q) => (q.state.data?.sweeps.some((s) => s.status === "running") ? 5_000 : false),
  });
}

/** One sweep with its trials; polls while it runs or has trials in flight. */
export function useSweep(sweepId: string) {
  return useQuery({
    queryKey: qk.sweep(sweepId),
    queryFn: () => api.sweep(sweepId),
    enabled: !!sweepId,
    refetchInterval: (q) => {
      const s = q.state.data;
      return s && (s.status === "running" || s.trials.some((t) => t.status === "running")) ? 5_000 : false;
    },
  });
}

export function useSweepAction(sweepId: string, projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (action: import("./types").SweepAction) => api.sweepAction(sweepId, action),
    onSuccess: (data) => {
      qc.setQueryData(qk.sweep(sweepId), data);
      qc.invalidateQueries({ queryKey: qk.sweeps(projectId) });
    },
  });
}

/**
 * A project's metric rules as a resolver (lib/metric-rules.ts): each
 * metric's effective summary and goal. No project (or not loaded yet): no
 * rules.
 */
export function useMetricRules(projectId: string | null | undefined): RuleOf {
  const doc = useMetricRulesDoc(projectId);
  return useMemo(() => rulesOf(doc), [doc]);
}

/** A project's metric rules document (logged, overrides, effective); undefined until loaded. */
export function useMetricRulesDoc(projectId: string | null | undefined): MetricRulesDoc | undefined {
  const q = useQuery({
    queryKey: qk.metricRules(projectId ?? ""),
    queryFn: () => api.metricRules(projectId!),
    enabled: !!projectId,
    staleTime: 10_000,
  });
  return q.data;
}

/**
 * Set (an override) or reset (`null`: back to the logged rule) one metric's
 * rule in the project. The rule changes the values the runs show
 * (`run.values`), so the rules, the runs lists and the run details are
 * re-read.
 */
export function useSetMetricRule(projectId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ metric, override }: { metric: string; override: MetricOverride | null }) =>
      override ? api.setMetricRule(projectId!, metric, override) : api.resetMetricRule(projectId!, metric),
    onSuccess: (doc) => {
      if (projectId) qc.setQueryData(qk.metricRules(projectId), doc);
    },
    onSettled: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: qk.metricRules(projectId ?? "") }),
        qc.invalidateQueries({ queryKey: qk.runs() }),
        qc.invalidateQueries({ queryKey: qk.runsInfinite() }),
        qc.invalidateQueries({ queryKey: ["run"] }),
      ]),
  });
}
