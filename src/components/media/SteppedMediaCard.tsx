/**
 * Shared shell for the stepped media cards (markdown, HTML, audio, video):
 * one artifact per step, a step slider over the union of every series' steps,
 * and a side-by-side pane grid with a chip strip once the card holds more
 * than one series. Each card supplies only its own settings, its settings
 * panel, and how one artifact renders.
 */

import { useMemo, useRef, useState, type ReactNode } from "react";
import { useSequencesForRuns } from "../../api/hooks";
import { api } from "../../api/client";
import { downloadArtifact, artifactFilename } from "../../lib/download";
import { cardOverridesStorageKey, type CardSettingsKey, type SettingsController } from "../../lib/card-settings";
import { useCardDrop } from "../../lib/use-series-drop";
import type { ComparisonSeriesRef } from "../../lib/comparisons";
import { gridValues, normalizeSlots, slotValue } from "../../lib/media/panel-layout";
import { STEP_KEY, formatKeyValue } from "../../lib/media/slider-key";
import type { SequenceMeta, SequencePoint } from "../../api/types";
import { useCardSeries, useStepSlider, resolveAtStep, MultiPaneGrid } from "../card-kit";
import ComparePanes from "../card-kit/ComparePanes";
import GridPanes from "../card-kit/GridPanes";
import { useMediaPanes, useScalarMetricNames } from "../card-kit/use-media-panes";
import { steppedMediaInstanceDefaults, type SteppedMediaSettings } from "../cards-settings/stepped-media";
import type { MediaPanelCtx } from "../settings-panels/media-panel-kit";
import AddToComparisonButton from "../AddToComparisonButton";
import CardShell from "../CardShell";
import SeriesChipStrip from "../SeriesChipStrip";
import StepSlider from "../StepSlider";

/** Props every stepped media card receives from CardRenderer. */
export interface SteppedMediaCardProps {
  runId: string;
  metric: SequenceMeta;
  extraSeries?: ComparisonSeriesRef[];
  controlledSeries?: boolean;
  settingsKeyOverride?: CardSettingsKey;
  onRemove?: () => void;
  autoOpenSettings?: boolean;
}

/** One resolved artifact handed to the card's renderer. */
export interface MediaView<S> {
  point: SequencePoint;
  /** `point.artifact_hash`, known non-null. */
  hash: string;
  /** Series name of the pane. */
  name: string;
  settings: S;
  /** True when this is the card's only pane (it fills the card); false for one pane of a grid. */
  single: boolean;
  inModal: boolean;
  /** Stable id of the pane (per series and layout slot). */
  paneId: string;
  /** How many panes the card shows at once. */
  paneCount: number;
  /** The card follows a section media sync right now. */
  following: boolean;
}

/** Runtime info a stepped media settings panel gets. */
export interface SteppedMediaPanelCtx extends MediaPanelCtx {
  paneKeys: readonly string[];
}

interface Props<S extends SteppedMediaSettings> extends SteppedMediaCardProps {
  /** Card kind, used for CardShell sizing and as the comparison card type. */
  kind: "markdown" | "html" | "audio" | "video";
  /** Word in the empty state: "no {noun} logged yet". */
  noun: string;
  /** MIME type for the download filename when the point carries none. */
  defaultMime: string;
  defaultHeight?: number;
  /**
   * How a grid pane whose series starts logging after the current step
   * resolves: true shows that series' first artifact, false shows the empty
   * state (see resolveAtStep's `nearest`).
   */
  nearest: boolean;
  settingsPanel: (ctl: SettingsController<S>, ctx: SteppedMediaPanelCtx) => ReactNode;
  renderArtifact: (view: MediaView<S>) => ReactNode;
  /** Extra controls between the panes and the slider (the video transport). */
  footer?: (args: { settings: S; paneCount: number; following: boolean }) => ReactNode;
}

function Placeholder({ loading, noun }: { loading: boolean; noun: string }) {
  if (loading) return <div className="h-48 motion-safe:animate-pulse rounded bg-bg-hover" />;
  return <div className="text-sm text-fg-muted">no {noun} logged yet</div>;
}

export default function SteppedMediaCard<S extends SteppedMediaSettings>({
  runId,
  metric,
  extraSeries,
  controlledSeries,
  settingsKeyOverride,
  onRemove,
  autoOpenSettings,
  kind,
  noun,
  defaultMime,
  defaultHeight,
  nearest,
  settingsPanel,
  renderArtifact,
  footer,
}: Props<S>) {
  const { ctl, effectiveMetrics, allRunIds } =
    useCardSeries<S>({
      runId,
      metric,
      extraSeries,
      controlledSeries,
      settingsKeyOverride,
      type: kind,
      instanceDefaults: steppedMediaInstanceDefaults as (seed: { name: string }) => Partial<S>,
    });
  const settings = ctl.value;
  const cardId = cardOverridesStorageKey(settingsKeyOverride ?? { runId, metricName: metric.name });

  // Patches of the shell-owned fields; generic S can't prove they are Partial<S>.
  const updateShared = ctl.set as unknown as (patch: Partial<SteppedMediaSettings>, opts?: { mergeKey?: string }) => void;

  const { highlight: dropHighlight, dropProps } = useCardDrop(effectiveMetrics, updateShared);

  const panes = useMediaPanes(effectiveMetrics, runId, settings.maxRuns);
  const shown = panes.shown;
  const paneKeys = panes.keys;
  const queries = useSequencesForRuns(shown.map((m, i) => ({ runId: panes.runIds[i]!, name: m.name })));
  const dataKey = queries.map((q) => q.dataUpdatedAt).join("|");
  const seriesPoints = useMemo(
    () => queries.map((q) => (q.data?.points ?? []).filter((p) => p.artifact_hash)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dataKey, shown.length],
  );
  const loadingAt = (i: number) => queries[i]?.isLoading ?? false;

  const slider = useStepSlider({
    seriesPoints,
    persistedIdx: settings.sliderStep,
    updateSettings: updateShared,
    sliderKey: settings.sliderKey,
    seriesRunIds: panes.runIds,
    sync: { cardId, follow: settings.followSection },
  });
  const { values, safeIdx, currentValue, keyName, stepFor } = slider;
  const following = slider.sync != null;
  const scalarMetrics = useScalarMetricNames(runId);

  const pointAt = (i: number, value: number, near: boolean): SequencePoint | null => {
    const step = stepFor(i, value, { nearest: near });
    return step == null ? null : resolveAtStep(seriesPoints[i] ?? [], step, { nearest: near });
  };
  // The first pane's artifact drives the header download.
  const current = pointAt(0, currentValue, false);

  const [expanded, setExpanded] = useState(autoOpenSettings ?? false);

  const compSeries = useMemo(
    () => [{ runId, name: metric.name }],
    [runId, metric.name],
  );

  const subtitle =
    values.length > 0
      ? `${keyName === STEP_KEY ? "step" : keyName} ${formatKeyValue(currentValue)} (${safeIdx + 1}/${values.length})`
      : `${metric.count} pts`;

  const cardRef = useRef<HTMLDivElement>(null);

  const mode = settings.panelMode;
  const paneOptions = useMemo(
    () => paneKeys.map((k, i) => ({
      key: k,
      label: panes.labels.get(k) ?? shown[i]!.name,
      color: panes.multiRun ? panes.colors.get(panes.runIds[i]!) : undefined,
    })),
    [paneKeys, panes, shown],
  );
  const compareSlots = useMemo(() => normalizeSlots(settings.compareSlots, paneKeys), [settings.compareSlots, paneKeys]);
  const gridCols = mode === "grid" ? gridValues(values, settings.columns) : [];
  const paneCount = mode === "grid"
    ? shown.length * gridCols.length
    : mode === "compare" ? compareSlots.length : shown.length;

  const view = (i: number, point: SequencePoint | null, paneId: string, single: boolean, inModal: boolean) => {
    if (!point?.artifact_hash) return <Placeholder loading={loadingAt(i)} noun={noun} />;
    return renderArtifact({
      point,
      hash: point.artifact_hash,
      name: shown[i]?.name ?? metric.name,
      settings,
      single,
      inModal,
      paneId,
      paneCount,
      following,
    });
  };

  const renderPanes = (inModal: boolean) => {
    if (mode === "grid") {
      return (
        <GridPanes
          rows={paneOptions}
          columns={gridCols.map((v) => ({ value: v, label: `${keyName} ${formatKeyValue(v)}` }))}
          current={currentValue}
          onColumnClick={slider.setValue}
          rowHeight={inModal ? 220 : 140}
          renderCell={(row, col) => (
            <div className="h-full overflow-auto">
              {view(row, pointAt(row, gridCols[col]!, false), `grid:${row}:${col}`, false, inModal)}
            </div>
          )}
        />
      );
    }
    if (mode === "compare") {
      return (
        <ComparePanes
          slots={compareSlots}
          onSlotsChange={(slots) => updateShared({ compareSlots: slots })}
          linked={settings.compareLinked}
          onLinkedChange={(linked, slots) => updateShared({ compareLinked: linked, compareSlots: slots })}
          panes={paneOptions}
          values={values}
          keyName={keyName}
          current={currentValue}
          columns={settings.columns}
          renderSlot={(slot, _value, i) => {
            const idx = paneKeys.indexOf(slot.pane);
            if (idx < 0) return null;
            const v = slotValue(slot, settings.compareLinked, currentValue);
            return <div className="h-full overflow-auto">{view(idx, pointAt(idx, v, nearest), `compare:${i}`, false, inModal)}</div>;
          }}
        />
      );
    }
    if (shown.length <= 1) {
      return view(0, pointAt(0, currentValue, false), paneKeys[0] ?? "single", true, inModal);
    }
    return (
      <MultiPaneGrid
        paneKeys={paneKeys}
        labels={panes.labels}
        inModal={inModal}
        columns={settings.columns}
        paneWidths={settings.paneWidths}
        onPaneWidthsChange={(w) => updateShared({ paneWidths: w })}
        renderPane={(key, i) => view(i, pointAt(i, currentValue, nearest), key, false, inModal)}
      />
    );
  };

  const renderContent = (inModal: boolean) => (
    <>
      {renderPanes(inModal)}
      {footer?.({ settings, paneCount, following })}
      <StepSlider
        points={slider.sliderPoints}
        currentIndex={safeIdx}
        onChange={slider.onSliderChange}
        xAxis={settings.xAxis}
        onXAxisChange={(m) => updateShared({ xAxis: m })}
        keyName={keyName}
        className="mt-3"
      />
      {effectiveMetrics.length > 1 && (
        <SeriesChipStrip
          metrics={effectiveMetrics}
          controlledSeries={controlledSeries}
          runId={runId}
          allRunIds={allRunIds}
          onMetricsChange={(next) => updateShared({ metrics: next })}
        />
      )}
    </>
  );

  return (
    <CardShell cardKind={kind}
      cardRef={cardRef}
      settings={settings}
      updateSettings={updateShared}
      title={metric.name}
      subtitle={subtitle}
      defaultHeight={defaultHeight}
      onSettings={() => setExpanded(true)}
      onRemove={onRemove}
      onDownload={current?.artifact_hash ? () => downloadArtifact(api.artifactUrl(current.artifact_hash!), artifactFilename(metric.name, current.step, current.artifact_mime ?? defaultMime)) : undefined}
      addToComparisonSlot={<AddToComparisonButton cardType={kind} series={compSeries} />}
      dropHighlight={dropHighlight}
      dropProps={dropProps}
      settingsPanel={settingsPanel(ctl, {
        paneKeys,
        multi: shown.length > 1,
        following,
        scalarMetrics,
      })}
      modalOpen={expanded}
      onModalClose={() => setExpanded(false)}
      modalContent={<div className="flex flex-col h-full">{renderContent(true)}</div>}
      scrollIntoViewOnMount={autoOpenSettings}
    >
      {renderContent(false)}
    </CardShell>
  );
}
