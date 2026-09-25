/**
 * Shared shell for the stepped media cards (markdown, HTML, audio, video):
 * one artifact per step, a step slider over the union of every series' steps,
 * and a side-by-side pane grid with a chip strip once the card holds more
 * than one series. Each card supplies only its own settings, its settings
 * panel, and how one artifact renders.
 */

import { useMemo, useRef, useState, type ReactNode } from "react";
import { useQueries } from "@tanstack/react-query";
import { useSequence } from "../../api/hooks";
import { api } from "../../api/client";
import { qk } from "../../api/query-keys";
import { downloadArtifact, artifactFilename } from "../../lib/download";
import { type CardSettingsKey, type SettingsController } from "../../lib/card-settings";
import { useCardDrop } from "../../lib/use-series-drop";
import type { ComparisonSeriesRef } from "../../lib/comparisons";
import { shortRunLabel, useRunMetadataVersion } from "../../lib/run-label";
import { seriesKey } from "../../lib/series-utils";
import type { SequenceMeta, SequencePoint, SequenceResponse } from "../../api/types";
import { useCardSeries, useStepSlider, resolveAtStep, useRunInfo, MultiPaneGrid } from "../card-kit";
import { steppedMediaInstanceDefaults, type SteppedMediaSettings } from "../cards-settings/stepped-media";
import type { SeriesRef } from "../card-kit/use-card-series";
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
  /** True when this is the card's only pane (it fills the card); false for one pane of the grid. */
  single: boolean;
  inModal: boolean;
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
  settingsPanel: (ctl: SettingsController<S>) => ReactNode;
  renderArtifact: (view: MediaView<S>) => ReactNode;
}

function useArtifactPoints(runId: string, m: { name: string }) {
  const q = useSequence(runId, m.name);
  const points = useMemo(
    () => (q.data?.points ?? []).filter((p) => p.artifact_hash),
    [q.data],
  );
  return { points, isLoading: q.isLoading };
}

function Placeholder({ loading, noun }: { loading: boolean; noun: string }) {
  if (loading) return <div className="h-48 motion-safe:animate-pulse rounded bg-bg-hover" />;
  return <div className="text-sm text-fg-muted">no {noun} logged yet</div>;
}

/** One series' pane in the multi-series grid, resolved at the card's step. */
function MediaPane<S extends SteppedMediaSettings>({
  runId,
  m,
  targetStep,
  nearest,
  noun,
  settings,
  inModal,
  renderArtifact,
}: {
  runId: string;
  m: SeriesRef;
  targetStep: number;
  nearest: boolean;
  noun: string;
  settings: S;
  inModal: boolean;
  renderArtifact: (view: MediaView<S>) => ReactNode;
}) {
  const { points, isLoading } = useArtifactPoints(m.runId ?? runId, m);
  const current = useMemo(
    () => resolveAtStep(points, targetStep, { nearest }),
    [points, targetStep, nearest],
  );
  if (isLoading || !current?.artifact_hash) return <Placeholder loading={isLoading} noun={noun} />;
  return renderArtifact({ point: current, hash: current.artifact_hash, name: m.name, settings, single: false, inModal });
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
}: Props<S>) {
  const { ctl, effectiveMetrics, allRunIds, multipleRuns } =
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

  // Patches of the shell-owned fields; generic S can't prove they are Partial<S>.
  const updateShared = ctl.set as unknown as (patch: Record<string, unknown>) => void;

  const { highlight: dropHighlight, dropProps } = useCardDrop(effectiveMetrics, updateShared);

  // The card's own series drives the slider track, the header download and the single-pane view.
  const { points, isLoading } = useArtifactPoints(runId, metric);

  // With several series, every series' steps join the slider.
  const isMulti = effectiveMetrics.length > 1;
  const multiQueries = useQueries({
    queries: isMulti
      ? effectiveMetrics.map((m) => {
          const rid = m.runId ?? runId;
          return {
            queryKey: qk.sequence(rid, m.name),
            queryFn: () => api.sequence(rid, m.name),
            refetchInterval: 2_000,
            staleTime: 2_000,
          };
        })
      : [],
  });

  const seriesPoints = useMemo(() => {
    const arr: Array<Array<{ step: number }>> = [points];
    if (isMulti) {
      for (const mq of multiQueries) {
        const pts = (mq.data as SequenceResponse | undefined)?.points ?? [];
        arr.push(pts.filter((p) => p.artifact_hash));
      }
    }
    return arr;
  }, [isMulti, points, multiQueries]);

  const { globalSteps, safeIdx, currentStep, onSliderChange } = useStepSlider({
    seriesPoints,
    persistedIdx: settings.sliderStep,
    updateSettings: updateShared,
  });

  const current = useMemo(() => resolveAtStep(points, currentStep), [points, currentStep]);

  const [expanded, setExpanded] = useState(autoOpenSettings ?? false);

  const compSeries = useMemo(
    () => [{ runId, name: metric.name }],
    [runId, metric.name],
  );

  const runMetaVersion = useRunMetadataVersion();
  useRunInfo(allRunIds);

  const subtitle =
    globalSteps.length > 0
      ? `step ${currentStep} (${safeIdx + 1}/${globalSteps.length})`
      : `${metric.count} pts`;

  const cardRef = useRef<HTMLDivElement>(null);

  const paneKeys = useMemo(() => effectiveMetrics.map(seriesKey), [effectiveMetrics]);
  const paneLabels = useMemo(() => {
    const map = new Map<string, string>();
    if (multipleRuns) {
      for (const m of effectiveMetrics) {
        map.set(seriesKey(m), shortRunLabel(m.runId ?? runId, allRunIds));
      }
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [multipleRuns, effectiveMetrics, allRunIds, runId, runMetaVersion]);

  const slider = (
    <StepSlider
      points={points}
      currentIndex={safeIdx}
      onChange={onSliderChange}
      xAxis={settings.xAxis}
      onXAxisChange={(m) => updateShared({ xAxis: m })}
      className="mt-3"
    />
  );

  const renderSingle = (inModal: boolean) => {
    if (isLoading || !current?.artifact_hash) return <Placeholder loading={isLoading} noun={noun} />;
    return (
      <>
        {renderArtifact({ point: current, hash: current.artifact_hash, name: metric.name, settings, single: true, inModal })}
        {slider}
      </>
    );
  };

  const renderMulti = (inModal: boolean) => (
    <>
      <MultiPaneGrid
        paneKeys={paneKeys}
        labels={paneLabels}
        inModal={inModal}
        paneWidths={settings.paneWidths}
        onPaneWidthsChange={(w) => updateShared({ paneWidths: w })}
        renderPane={(key, i) => (
          <MediaPane<S>
            key={key}
            runId={runId}
            m={effectiveMetrics[i]!}
            targetStep={currentStep}
            nearest={nearest}
            noun={noun}
            settings={settings}
            inModal={inModal}
            renderArtifact={renderArtifact}
          />
        )}
      />
      {slider}
      <SeriesChipStrip
        metrics={effectiveMetrics}
        controlledSeries={controlledSeries}
        runId={runId}
        allRunIds={allRunIds}
        onMetricsChange={(next) => updateShared({ metrics: next })}
      />
    </>
  );

  const renderContent = (inModal: boolean) => (isMulti ? renderMulti(inModal) : renderSingle(inModal));

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
      settingsPanel={settingsPanel(ctl)}
      modalOpen={expanded}
      onModalClose={() => setExpanded(false)}
      modalContent={<div className="flex flex-col h-full">{renderContent(true)}</div>}
      scrollIntoViewOnMount={autoOpenSettings}
    >
      {renderContent(false)}
    </CardShell>
  );
}
