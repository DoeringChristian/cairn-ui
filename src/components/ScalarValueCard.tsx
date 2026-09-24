/**
 * Scalar VALUE card — one number, not a plot of one dot.
 *
 * A scalar sequence with a single point is usually not a metric at all: it is a
 * property a component recorded about itself (`n_samples`, `depth`, a seed)
 * through `scope.track` when `scope.config` is what it meant. A line chart of
 * one point communicates nothing and costs a full card of grid space.
 *
 * The rule is applied at RENDER time, in CardRenderer, never at ingest. A real
 * metric also has exactly one point right after its first step — deciding
 * "this is a constant" when the first point lands would render every training
 * curve wrong until its second point arrived, and would need undoing. Keyed off
 * the current count, the card simply becomes a plot when the series grows.
 *
 * The honest fix for a property is `scope.config(...)`, which never creates a
 * sequence. This card makes the accident legible rather than hiding it.
 */

import { useMemo, useRef } from "react";
import { useSequence } from "../api/hooks";
import { formatNum } from "../lib/plot-utils/types";
import { type CardSettingsKey, useCardSettings } from "../lib/card-settings";
import type { SequenceMeta } from "../api/types";
import { type BaseCardSettings } from "./card-kit";
import CardShell from "./CardShell";

interface Props {
  runId: string;
  metric: SequenceMeta;
  settingsKeyOverride?: CardSettingsKey;
  onRemove?: () => void;
  autoOpenSettings?: boolean;
}

const DEFAULT_VALUE_SETTINGS: BaseCardSettings = { version: 1, colSpan: 1 };

export default function ScalarValueCard({
  runId,
  metric,
  settingsKeyOverride,
  onRemove,
  autoOpenSettings,
}: Props) {
  const cardRef = useRef<HTMLDivElement>(null!);
  const settingsKey = useMemo(
    () =>
      settingsKeyOverride ?? {
        runId,
        metricName: metric.name,
      },
    [settingsKeyOverride, runId, metric.name],
  );
  const [settings, updateSettings] = useCardSettings(
    settingsKey,
    DEFAULT_VALUE_SETTINGS,
  );

  const q = useSequence(runId, metric.name);
  const point = q.data?.points?.[0];
  const value = point?.scalar_value;

  return (
    <CardShell
      cardKind="scalar-value"
      cardRef={cardRef}
      settings={settings}
      updateSettings={updateSettings}
      title={metric.name}
      subtitle={
        <span className="text-xs text-fg-subtle">
          single value{point?.step != null ? ` · step ${point.step}` : ""}
        </span>
      }
      defaultHeight={120}
      onRemove={onRemove}
      scrollIntoViewOnMount={autoOpenSettings}
    >
      <div className="flex h-full min-h-0 items-center justify-center px-3 pb-3">
        {q.isLoading ? (
          <div className="h-8 w-24 motion-safe:animate-pulse rounded bg-bg-hover" />
        ) : q.isError ? (
          <span className="text-sm text-status-failed">
            {String(q.error)}
          </span>
        ) : value == null ? (
          <span className="text-sm text-fg-subtle">no value</span>
        ) : (
          <span
            className="mono truncate text-3xl font-semibold tabular-nums"
            title={String(value)}
          >
            {formatNum(value)}
          </span>
        )}
      </div>
    </CardShell>
  );
}
