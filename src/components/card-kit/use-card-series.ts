import { useMemo, useRef } from "react";
import type { SequenceMeta } from "../../api/types";
import type { ComparisonSeriesRef } from "../../lib/comparisons";
import type { CardType } from "../../lib/cards/card-spec";
import { useCardSettings, type CardSettingsKey, type SettingsController } from "../../lib/card-settings";
import { seriesKey } from "../../lib/series-utils";

export interface SeriesRef {
  runId?: string;
  name: string;
}

export interface CardSeriesResult<TSettings> {
  /** The card's settings controller (`ctl.value`, `ctl.set`, …). */
  ctl: SettingsController<TSettings>;
  /** Series to render, canonical order (sorted by seriesKey). */
  effectiveMetrics: SeriesRef[];
  /** Distinct run ids across effectiveMetrics (always includes runId). */
  allRunIds: string[];
  multipleRuns: boolean;
}

/**
 * Canonical series-merge logic shared by every series card, owning the card's
 * settings controller (`useCardSettings`).
 *
 * This is the reference (ScalarPlotCard) implementation, moved verbatim:
 *
 *  - default metrics = dedupe(seed ∪ extraSeries) sorted by `seriesKey`,
 *    layered over the card's `instanceDefaults(seed)` (read via a ref, so an
 *    inline arrow at the call site is fine) as its instance defaults.
 *  - settingsKey     = settingsKeyOverride ?? {runId, metricName}.
 *  - effective       (controlled)   = props series first, then persisted
 *                                     metrics whose *name* is not among the
 *                                     prop series names, deduped by `seriesKey`.
 *                    (uncontrolled) = settings.metrics as-is.
 *  - identity        = the sorted-join string of extraSeries keys (the
 *                      `JSON.stringify` dep trick is centralised here, once).
 */
export function useCardSeries<
  TSettings extends { version: number; metrics: SeriesRef[] },
>(args: {
  runId: string;
  metric: SequenceMeta;
  extraSeries?: ComparisonSeriesRef[];
  controlledSeries?: boolean;
  settingsKeyOverride?: CardSettingsKey;
  /** The card type: its builtin defaults and cascade keys (lib/cards/settings-registry.ts). */
  type: CardType;
  /**
   * The card's instance defaults for a seed metric (`metrics` is replaced by
   * the merged+sorted default metrics list). Read via a ref internally so an
   * inline arrow at the call site is fine.
   */
  instanceDefaults?: (seed: { name: string }) => Partial<TSettings>;
}): CardSeriesResult<TSettings> {
  const {
    runId,
    metric,
    extraSeries,
    controlledSeries = false,
    settingsKeyOverride,
    type,
    instanceDefaults,
  } = args;

  const seed = useMemo(
    () => ({ name: metric.name }),
    [metric.name],
  );

  const extraSeriesKey = useMemo(
    () =>
      (extraSeries ?? [])
        .map((s) => `${s.runId}::${s.name}`)
        .sort()
        .join("|"),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify((extraSeries ?? []).map((s) => [s.runId, s.name]).sort())],
  );

  const defaultMetrics = useMemo<SeriesRef[]>(() => {
    const all: SeriesRef[] = [
      seed,
      ...(extraSeries ?? []).map((s) => ({
        runId: s.runId,
        name: s.name,
      })),
    ];
    const seen = new Set<string>();
    const unique = all.filter((m) => {
      const k = seriesKey(m);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    unique.sort((a, b) => seriesKey(a).localeCompare(seriesKey(b)));
    return unique;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed, extraSeriesKey]);

  // Read the factory via a ref so callers can pass an inline arrow without
  // invalidating the memo every render.
  const instanceDefaultsRef = useRef(instanceDefaults);
  instanceDefaultsRef.current = instanceDefaults;

  const defaults = useMemo<Partial<TSettings>>(
    () => ({ ...instanceDefaultsRef.current?.(seed), metrics: defaultMetrics }) as Partial<TSettings>,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [seed, extraSeriesKey],
  );

  const settingsKey = useMemo<CardSettingsKey>(
    () =>
      settingsKeyOverride ?? {
        runId,
        metricName: metric.name,
      },
    [settingsKeyOverride, runId, metric.name],
  );

  const ctl = useCardSettings<TSettings>(settingsKey, type, defaults);
  const settings = ctl.value;

  const effectiveMetrics = useMemo<SeriesRef[]>(() => {
    if (!controlledSeries) return settings.metrics;
    const all: SeriesRef[] = [
      { name: metric.name },
      ...(extraSeries ?? []).map((s) => ({
        runId: s.runId,
        name: s.name,
      })),
    ];
    const propsTagNames = new Set(all.map((m) => m.name));
    for (const sm of settings.metrics) {
      if (!propsTagNames.has(sm.name)) {
        all.push(sm);
      }
    }
    const seen = new Set<string>();
    return all.filter((m) => {
      const k = seriesKey(m);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controlledSeries, settings.metrics, metric.name, extraSeriesKey]);

  const allRunIds = useMemo(() => {
    const set = new Set<string>([runId]);
    for (const m of effectiveMetrics) set.add(m.runId ?? runId);
    return Array.from(set);
  }, [runId, effectiveMetrics]);
  const multipleRuns = allRunIds.length > 1;

  return {
    ctl,
    effectiveMetrics,
    allRunIds,
    multipleRuns,
  };
}
