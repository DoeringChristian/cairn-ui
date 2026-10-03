/**
 * One workspace panel, rendered for the bound runs.
 *
 * - A per-metric panel shows its resolved metrics for every bound run that
 *   logs them (one run and one metric: the plain single-run card).
 * - A multi-run panel (run comparer, code diff, scatter, …) takes the bound
 *   runs; with fewer than it needs it shows why instead.
 * - A panel none of whose metrics the bound runs log shows an empty state,
 *   so the layout holds still while flipping runs.
 *
 * Cards mount when on or near the screen (LazyPanel); until then a
 * placeholder of the card's size holds its place.
 *
 * Settings: the card's key is `{runId: "ws:<workspace>", metricName: panel.id}`;
 * the enclosing workspace's settings store maps it to the panel's settings.
 */

import { useContext, useMemo } from "react";
import CardRenderer from "../CardRenderer";
import CardHeader from "../CardHeader";
import LazyPanel from "./LazyPanel";
import { CardMutationContext, useCardOverridesReader, type CardSettingsKey } from "../../lib/card-settings";
import { isMultiRunCardType, minRunsFor, type ComparisonSeriesRef } from "../../lib/comparisons/types";
import type { RenderedPanel } from "../../lib/workspace/layout";
import { PanelTitleContext } from "../../lib/workspace/panel-actions";
import { claimedMetric } from "../../lib/workspace/doc";
import { useVisibleRuns } from "../../lib/run-view";
import type { SequenceMeta } from "../../api/types";

interface Props {
  rendered: RenderedPanel;
  /** The workspace's bound runs, in order. */
  runIds: readonly string[];
  settingsKey: CardSettingsKey;
  onRemove?: () => void;
  autoOpenSettings?: boolean;
}

export default function PanelCard({ rendered, runIds, settingsKey, onRemove, autoOpenSettings }: Props) {
  const { panel, metrics, label } = rendered;
  const visible = useVisibleRuns(useMemo(() => [...runIds], [runIds]));

  const series = useMemo<ComparisonSeriesRef[]>(() => {
    const out: ComparisonSeriesRef[] = [];
    for (const m of metrics) for (const runId of visible) if (m.runIds.includes(runId)) out.push({ runId, name: m.name });
    return out;
  }, [metrics, visible]);

  if (isMultiRunCardType(panel.type)) {
    const need = minRunsFor(panel.type);
    if (visible.length < need) {
      return (
        <PanelPlaceholder
          title={label}
          settingsKey={settingsKey}
          onRemove={onRemove}
          message={`Needs ${need}+ runs — this panel compares runs. Open it in a comparison, or add runs.`}
        />
      );
    }
    return (
      <LazyPanel type={panel.type} settingsKey={settingsKey} title={label} eager={autoOpenSettings}>
        <CardRenderer
          kind="multi-run"
          cardType={panel.type}
          runIds={visible}
          settingsKey={settingsKey}
          onRemove={onRemove}
          autoOpenSettings={autoOpenSettings}
        />
      </LazyPanel>
    );
  }

  const primary = series[0];
  if (!primary) {
    return (
      <PanelPlaceholder
        title={label}
        settingsKey={settingsKey}
        onRemove={onRemove}
        message={
          runIds.length === 0
            ? "No runs."
            : visible.length === 0
              ? "Every run is hidden."
              : runIds.length === 1
                ? "This run does not log this metric."
                : "None of these runs logs this metric."
        }
      />
    );
  }

  const first = metrics.find((m) => m.name === primary.name)!;
  const single = series.length === 1;
  const seed: SequenceMeta = {
    name: primary.name,
    object_type: panel.type,
    min_step: 0,
    max_step: 0,
    // The single-run, single-metric scalar with one point renders as a value.
    count: single ? first.count : 0,
  };
  const valueCard = panel.type === "scalar" && seed.count === 1;
  return (
    <LazyPanel type={panel.type} settingsKey={settingsKey} title={label} valueCard={valueCard} eager={autoOpenSettings}>
    <PanelTitleContext.Provider value={claimedMetric(panel) == null ? label : null}>
    <CardRenderer
      runId={primary.runId}
      metric={seed}
      extraSeries={single ? undefined : series.slice(1)}
      controlledSeries={!single}
      settingsKeyOverride={settingsKey}
      onRemove={onRemove}
      autoOpenSettings={autoOpenSettings}
    />
    </PanelTitleContext.Provider>
    </LazyPanel>
  );
}

/** A panel with nothing to draw: its header (title, edit, remove) and why. */
function PanelPlaceholder({
  title,
  message,
  settingsKey,
  onRemove,
}: {
  title: string;
  message: string;
  settingsKey: CardSettingsKey;
  onRemove?: () => void;
}) {
  const mutable = useContext(CardMutationContext);
  // Keep the panel's size, so the grid does not reflow while flipping runs.
  const settings = useCardOverridesReader()(settingsKey) ?? {};
  const span = typeof settings.colSpan === "number" ? settings.colSpan : 3;
  const height = typeof settings.height === "number" && !settings.collapsed ? settings.height : undefined;
  return (
    <div
      data-cairn-card
      data-cairn-empty-panel
      className="card flex min-w-0 flex-col p-4"
      style={{ gridColumn: `span ${span}`, height }}
    >
      <CardHeader title={title} onRemove={mutable ? onRemove : undefined} />
      <p className="py-6 text-center text-sm text-fg-muted">{message}</p>
    </div>
  );
}
