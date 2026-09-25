/**
 * `useScalarExprs(runIds, srcs)`: one scalar per run for each expression
 * (a scatter axis, a parallel column, the bar metric…).
 *
 * Run details come from `useRunsDetails` (which also seeds the run-label
 * cache); they carry the config, summary and per-metric `run.stats`. An
 * expression whose metrics are only reduced (`min(val.loss)`,
 * `last(acc) / config.bs`) is answered from those stats with no series
 * fetch. Only the metrics of the other expressions (`max(ema(acc, 0.9))`)
 * are fetched, once per run, and kept live by the app-wide updates poller.
 *
 * The planning and evaluation are pure (lib/scalar-exprs.ts).
 */
import { useMemo } from "react";
import { useRunsDetails, useSequencesForRuns } from "../api/hooks";
import type { RunDetailResponse } from "../api/types";
import type { RunContext, SeriesData } from "./expr";
import {
  evalScalar,
  planScalarExprs,
  pointsToSeries,
  runContext,
  scalarFieldOptions,
} from "./scalar-exprs";
import type { FieldOption } from "../components/settings/palette";

export interface ScalarExprs {
  /** Per src (in order): run id → value (null when missing or failing). */
  values: Array<Map<string, unknown>>;
  /** Per src: its compile error, else the first per-run evaluation error. */
  errors: Array<string | null>;
  /** Per src: some run's value needed an as-of join of differently-stepped series. */
  asofJoin: boolean[];
  /** Run id → its expression context (for `${…}` templates over the same data). */
  contexts: Map<string, RunContext>;
  /** Run id → details (params, summary, metric rules, stats). */
  details: Map<string, RunDetailResponse>;
  /** Picker options over these runs' params, metrics and summary keys. */
  options: FieldOption[];
  loading: boolean;
}

export function useScalarExprs(runIds: string[], srcs: readonly string[]): ScalarExprs {
  const srcKey = srcs.join("\u0000");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const plan = useMemo(() => planScalarExprs(srcs), [srcKey]);

  const detailQs = useRunsDetails(runIds);
  const detailsKey = detailQs.map((q) => q.dataUpdatedAt).join("|");

  const specs = useMemo(
    () => runIds.flatMap((runId) => plan.seriesMetrics.map((name) => ({ runId, name }))),
    [runIds, plan],
  );
  const seriesQs = useSequencesForRuns(specs);
  const seriesKey = seriesQs.map((q) => q.dataUpdatedAt).join("|");

  const loading = detailQs.some((q) => q.isLoading) || seriesQs.some((q) => q.isLoading);

  return useMemo(() => {
    const details = new Map<string, RunDetailResponse>();
    runIds.forEach((rid, i) => {
      const d = detailQs[i]?.data;
      if (d) details.set(rid, d);
    });

    const seriesByRun = new Map<string, Map<string, SeriesData>>();
    specs.forEach((spec, i) => {
      const points = seriesQs[i]?.data?.points;
      if (!points) return;
      let m = seriesByRun.get(spec.runId);
      if (!m) seriesByRun.set(spec.runId, (m = new Map()));
      m.set(spec.name, pointsToSeries(points));
    });

    const contexts = new Map<string, RunContext>();
    for (const [rid, d] of details) contexts.set(rid, runContext(d, seriesByRun.get(rid) ?? new Map()));

    const values = plan.compiled.map(() => new Map<string, unknown>());
    const errors = plan.compiled.map((c) => c.error);
    const asofJoin = plan.compiled.map(() => false);
    plan.compiled.forEach((c, i) => {
      if (!c.node) return;
      for (const [rid, ctx] of contexts) {
        // A "series" expression waits for its series (else it would read as empty).
        if (c.plan === "series" && c.metrics.some((m) => !seriesByRun.get(rid)?.has(m))) continue;
        const r = evalScalar(c, ctx);
        values[i]!.set(rid, r.value);
        if (r.error && !errors[i]) errors[i] = r.error;
        if (r.warnings.some((w) => w.kind === "asof-join")) asofJoin[i] = true;
      }
    });

    const options = scalarFieldOptions([...details.values()]);
    return { values, errors, asofJoin, contexts, details, options, loading };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runIds, plan, specs, detailsKey, seriesKey, loading]);
}
