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

import { useMemo } from "react";
import CardRenderer from "../CardRenderer";
import LazyPanel from "./LazyPanel";
import EmptyCard from "../card-kit/EmptyCard";
import type { CardSettingsKey } from "../../lib/card-settings";
import { isMultiRunCardType, minRunsFor, type ComparisonSeriesRef } from "../../lib/comparisons/types";
import type { RenderedPanel } from "../../lib/workspace/layout";
import { PanelTitleContext } from "../../lib/workspace/panel-actions";
import { CardReportContext, type CardReportCopy } from "../../lib/card-report-context";
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

export default function PanelCard(props: Props) {
  const { rendered, runIds, settingsKey } = props;
  const { panel, label } = rendered;
  const visible = useVisibleRuns(useMemo(() => [...runIds], [runIds]));
  // What "add to report" copies: the panel's series (by name for one not logged yet), or its runs for a run-level card.
  const copy = useMemo<CardReportCopy>(() => {
    const names = rendered.metrics.length > 0 ? rendered.metrics.map((m) => m.name) : "names" in panel.selector ? panel.selector.names : [];
    const series = isMultiRunCardType(panel.type)
      ? visible.map((runId) => ({ runId, name: label }))
      : names.flatMap((name) => visible.filter((r) => rendered.metrics.find((m) => m.name === name)?.runIds.includes(r) ?? true).map((runId) => ({ runId, name })));
    return { cardType: panel.type, series, settingsKey };
  }, [rendered.metrics, panel, label, visible, settingsKey]);
  return (
    <CardReportContext.Provider value={copy}>
      <PanelCardBody {...props} />
    </CardReportContext.Provider>
  );
}

function PanelCardBody({ rendered, runIds, settingsKey, onRemove, autoOpenSettings }: Props) {
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
        <EmptyCard
          type={panel.type}
          autoOpen={autoOpenSettings}
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
  // A custom viewer card keeps its whole card (header, Settings) without data: its body says so.
  const seedName = "names" in panel.selector ? panel.selector.names[0] : undefined;
  if (!primary && panel.type === "custom" && visible.length > 0 && seedName) {
    const seed: SequenceMeta = { name: seedName, object_type: "custom", min_step: 0, max_step: 0, count: 0 };
    return (
      <LazyPanel type={panel.type} settingsKey={settingsKey} title={label} eager={autoOpenSettings}>
        <PanelTitleContext.Provider value={claimedMetric(panel) == null ? label : null}>
          <CardRenderer runId={visible[0]!} metric={seed} settingsKeyOverride={settingsKey} onRemove={onRemove} autoOpenSettings={autoOpenSettings} />
        </PanelTitleContext.Provider>
      </LazyPanel>
    );
  }
  if (!primary) {
    return (
      <EmptyCard
        type={panel.type}
        autoOpen={autoOpenSettings}
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
