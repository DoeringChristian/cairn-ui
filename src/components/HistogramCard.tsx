import { useContext, useMemo, useRef, useState } from "react";
import { keepPreviousData, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSequencesForRuns } from "../api/hooks";
import { safeJsonParse } from "../lib/format";
import { downloadArtifact, artifactFilename } from "../lib/download";
import { api } from "../api/client";
import { useCardSettings, type CardSettingsKey } from "../lib/card-settings";
import type { ComparisonSeriesRef } from "../lib/comparisons";
import type { HistogramSettings } from "./cards-settings/histogram";
import type { MediaLayoutSettings } from "./cards-settings/media";
import type { SequenceMeta, SequencePoint } from "../api/types";
import type { HistogramData } from "../lib/plot-utils/histogram";
import { buildStrips, planStrips, type RunHistogram } from "../lib/plot-utils/histogram-strips";
import { HistogramBars } from "../charts/HistogramChart";
import { HistogramStripBars, HistogramStrips } from "../charts/HistogramStrips";
import { parseNpz } from "../lib/parse-npz";
import { shortRunLabel, useRunMetadataVersion } from "../lib/run-label";
import { useRunColors, useVisibleRuns } from "../lib/run-view";
import { WorkspaceGroupingContext } from "../lib/workspace-runs/grouping-context";
import { galleryCount, isGalleryPoint, type GalleryItem } from "../lib/media/gallery";
import { galleryQuery } from "../lib/media/gallery-query";
import { primaryIndex } from "../lib/media/media-plan";
import CardShell from "./CardShell";
import StepSlider from "./StepSlider";
import HistogramSettingsPanel from "./settings-panels/HistogramSettingsPanel";
import { useStepSlider, resolveAtStep, useRunInfo } from "./card-kit";
import { IndexBar } from "./card-kit/MediaTiles";
import GalleryView from "./media/GalleryView";

interface Props {
  runId: string;
  metric: SequenceMeta;
  /** The card's other runs (the workspace panel's data, a comparison). */
  extraSeries?: ComparisonSeriesRef[];
  settingsKeyOverride?: CardSettingsKey;
  onRemove?: () => void;
  autoOpenSettings?: boolean;
}

interface HistogramMeta {
  num_bins: number;
  min: number;
  max: number;
  count: number;
  mean: number;
}

type Npz = Record<string, { data: Float64Array }>;

async function fetchNpz(hash: string): Promise<Npz> {
  const res = await fetch(api.artifactUrl(hash));
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return parseNpz(await res.arrayBuffer());
}

const npzQuery = (hash: string) => ({
  queryKey: ["cairn-npz", hash],
  queryFn: () => fetchNpz(hash),
  staleTime: Infinity,
});

function toHistogram(npz: Npz | undefined): HistogramData | null {
  if (!npz?.counts || !npz?.edges) return null;
  return { counts: Array.from(npz.counts.data), edges: Array.from(npz.edges.data) };
}

/** One histogram artifact's bars (a gallery item). */
function HistogramItem({ hash, logY }: { hash: string; logY: boolean }) {
  const q = useQuery({ ...npzQuery(hash), placeholderData: keepPreviousData });
  const data = useMemo(() => toHistogram(q.data), [q.data]);
  if (q.isLoading) return <div className="h-full motion-safe:animate-pulse rounded bg-bg-hover" />;
  if (!data) return <div className="text-xs text-fg-muted">could not read histogram blob</div>;
  return <HistogramBars counts={data.counts} edges={data.edges} logY={logY} />;
}

/** A point to read, the step it stands for (bars: the slider's), and its run. */
interface Need {
  runId: string;
  point: SequencePoint;
  step: number;
}

export default function HistogramCard({
  runId,
  metric,
  extraSeries = [],
  settingsKeyOverride,
  onRemove,
  autoOpenSettings,
}: Props) {
  const settingsKey = useMemo(
    () => settingsKeyOverride ?? { runId, metricName: metric.name },
    [settingsKeyOverride, runId, metric.name],
  );
  const ctl = useCardSettings<HistogramSettings>(settingsKey, "histogram");
  const settings = ctl.value;
  const heatmap = settings.viewMode !== "bars";
  const xAxis = settings.xAxis ?? "step";

  // The card's runs (one series per run), minus hidden ones.
  const extraKey = extraSeries.map((s) => `${s.runId}:${s.name}`).join("|");
  const allSeries = useMemo(() => {
    const seen = new Set<string>();
    return [{ runId, name: metric.name }, ...extraSeries.map((s) => ({ runId: s.runId, name: s.name }))].filter((s) => {
      if (seen.has(s.runId)) return false;
      seen.add(s.runId);
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, metric.name, extraKey]);
  const allRunIds = useMemo(() => allSeries.map((s) => s.runId), [allSeries]);
  const visibleRunIds = useVisibleRuns(allRunIds);
  const series = useMemo(() => {
    const v = new Set(visibleRunIds);
    return allSeries.filter((s) => v.has(s.runId));
  }, [allSeries, visibleRunIds]);
  const runColors = useRunColors(visibleRunIds);
  const { runCreatedAtByRunId } = useRunInfo(visibleRunIds);
  const runMetaVersion = useRunMetadataVersion();
  const wsGrouping = useContext(WorkspaceGroupingContext);

  const seqQueries = useSequencesForRuns(series);
  const seqKey = seqQueries.map((q) => q.dataUpdatedAt).join("|");
  const seqLoading = seqQueries.some((q) => q.isLoading);
  const pointsByRun = useMemo(
    () => series.map((_, i) => (seqQueries[i]?.data?.points ?? []).filter((p) => p.artifact_hash)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [series, seqKey],
  );

  // Lists (several histograms per step): one index at a time.
  const lists = pointsByRun.some((pts) => pts.some(isGalleryPoint));
  const listCount = useMemo(
    () => Math.max(0, ...pointsByRun.flatMap((pts) => pts.map(galleryCount))),
    [pointsByRun],
  );
  const index = primaryIndex(settings, listCount);

  const { safeIdx, currentStep, onSliderChange, summary } = useStepSlider({
    seriesPoints: pointsByRun,
    persistedIdx: settings.sliderStep,
    updateSettings: ctl.set,
    series,
  });

  // A single run's list in the bars view with no single index picked: its gallery.
  const primary = useMemo(
    () => resolveAtStep(pointsByRun[0] ?? [], currentStep, { nearest: true }) ?? undefined,
    [pointsByRun, currentStep],
  );
  const galleryBars = !heatmap && series.length === 1 && isGalleryPoint(primary) && settings.indexMode !== "one";

  // The points to read: every step (heatmap), or each run's at the slider (bars).
  const needs = useMemo<Need[]>(() => {
    if (galleryBars) return [];
    const out: Need[] = [];
    series.forEach((s, i) => {
      const pts = pointsByRun[i] ?? [];
      if (heatmap) for (const p of pts) out.push({ runId: s.runId, point: p, step: p.step });
      else {
        const p = resolveAtStep(pts, currentStep, { nearest: true });
        if (p) out.push({ runId: s.runId, point: p, step: currentStep });
      }
    });
    return out;
  }, [galleryBars, series, pointsByRun, heatmap, currentStep]);

  // Lists: each point's manifest, then the picked item.
  const manifestQueries = useQueries({
    queries: needs.map((n) => ({ ...galleryQuery(n.point.artifact_hash ?? ""), enabled: isGalleryPoint(n.point) })),
  });
  const manifestKey = manifestQueries.map((q) => q.dataUpdatedAt).join("|");
  const hashes = useMemo(
    () =>
      needs.map((n, i) => {
        if (!isGalleryPoint(n.point)) return n.point.artifact_hash ?? null;
        const items = manifestQueries[i]?.data as GalleryItem[] | undefined;
        return items?.[Math.min(index, items.length - 1)]?.hash ?? null;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [needs, manifestKey, index],
  );
  const npzQueries = useQueries({
    queries: hashes.map((h) => ({ ...npzQuery(h ?? ""), enabled: !!h })),
  });
  const npzKey = npzQueries.map((q) => q.dataUpdatedAt).join("|");
  const pending = needs.length > 0 && hashes.some((h, i) => !h || npzQueries[i]?.isLoading);

  const strips = useMemo(() => {
    const byRun = new Map<string, RunHistogram[]>();
    needs.forEach((n, i) => {
      const hist = toHistogram(npzQueries[i]?.data as Npz | undefined);
      if (!hist) return;
      const wall = n.point.wall_time ? Date.parse(n.point.wall_time) : NaN;
      const created = runCreatedAtByRunId.get(n.runId) ?? wall;
      const x = xAxis === "wall_time" ? wall : xAxis === "relative_time" ? (wall - created) / 1000 : n.step;
      if (!Number.isFinite(x)) return;
      let list = byRun.get(n.runId);
      if (!list) byRun.set(n.runId, (list = []));
      list.push({ step: n.step, x, hist });
    });
    const specs = planStrips(
      series.map((s) => s.runId).filter((id) => byRun.has(id)),
      {
        groupOf: wsGrouping?.groupOf,
        groupColor: (line) => wsGrouping?.colorOf.get(line),
        runColor: (id) => runColors.get(id) ?? "#1f77b4",
        runLabel: (id) => shortRunLabel(id, allRunIds),
      },
    );
    return buildStrips(specs, byRun);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needs, npzKey, series, wsGrouping, runColors, allRunIds, runMetaVersion, xAxis, runCreatedAtByRunId]);

  const meta = useMemo(() => safeJsonParse<HistogramMeta>(primary?.artifact_metadata), [primary]);

  const [expanded, setExpanded] = useState(autoOpenSettings ?? false);
  const qc = useQueryClient();
  const cardRef = useRef<HTMLDivElement>(null);

  const nStrips = strips.strips.length;
  const nSteps = new Set(pointsByRun.flatMap((pts) => pts.map((p) => p.step))).size;
  const stripsWord = wsGrouping ? (nStrips === 1 ? "line" : "lines") : nStrips === 1 ? "run" : "runs";
  const subtitle = summary
    ? "summary"
    : heatmap
      ? `${series.length > 1 ? `${nStrips} ${stripsWord} · ` : ""}${nSteps} step${nSteps === 1 ? "" : "s"}${lists ? ` · index ${index}` : ""}`
      : nSteps > 0
        ? `step ${currentStep} (${safeIdx + 1}/${nSteps})`
        : `${metric.count} pts`;

  const indexBar = lists && (
    <IndexBar
      settings={settings as unknown as MediaLayoutSettings}
      count={listCount}
      update={(patch) => ctl.set(patch as Partial<HistogramSettings>)}
    />
  );

  const renderContent = () => {
    if (seqLoading) return <div className="h-48 motion-safe:animate-pulse rounded bg-bg-hover" />;
    if (series.length === 0) return <div className="text-sm text-fg-muted">every run of this card is hidden</div>;
    if (pointsByRun.every((pts) => pts.length === 0)) {
      return <div className="text-sm text-fg-muted">no histogram logged yet</div>;
    }
    const waiting = (
      <div className="text-xs text-fg-muted motion-safe:animate-pulse">loading histograms…</div>
    );

    if (heatmap) {
      return (
        <>
          {indexBar}
          <div className="flex-1 min-h-0">
            {pending && nStrips === 0 ? waiting : nStrips > 0 ? (
              <HistogramStrips
                strips={strips.strips}
                edges={strips.edges}
                colormap={settings.colormap}
                logColor={settings.logY}
                xAxis={xAxis}
                labelled={nStrips > 1 || series.length > 1}
              />
            ) : (
              <div className="text-xs text-fg-muted">could not read the histograms</div>
            )}
          </div>
        </>
      );
    }

    return (
      <>
        {indexBar}
        <div className={`flex-1 min-h-0${galleryBars ? " overflow-auto" : ""}`}>
          {galleryBars ? (
            <GalleryView
              point={primary!}
              fill
              minItemHeight={150}
              prefetchItem={(p) => qc.prefetchQuery(npzQuery(p.artifact_hash!))}
              peekItem={(p) => qc.getQueryData(npzQuery(p.artifact_hash!).queryKey) !== undefined}
              renderItem={(item) => <HistogramItem hash={item.artifact_hash!} logY={settings.logY} />}
            />
          ) : pending && nStrips === 0 ? (
            waiting
          ) : nStrips > 0 ? (
            <HistogramStripBars
              edges={strips.edges}
              logY={settings.logY}
              bars={strips.strips.map((s) => ({ label: s.label, color: s.color, counts: s.counts[0] ?? [] }))}
            />
          ) : (
            <div className="text-xs text-fg-muted">could not read histogram blob</div>
          )}
        </div>
        <StepSlider
          points={summary ? [] : pointsByRun.find((p) => p.length > 0) ?? []}
          currentIndex={safeIdx}
          onChange={onSliderChange}
          xAxis={xAxis}
          onXAxisChange={(m) => ctl.set({ xAxis: m })}
          className="mt-3"
        />
      </>
    );
  };

  const settingsPanel = (
    <HistogramSettingsPanel ctl={ctl} mode="card" ctx={{ meta: isGalleryPoint(primary) ? null : meta ?? null, lists }} />
  );

  const downloadable = !heatmap && series.length === 1 && primary?.artifact_hash && !isGalleryPoint(primary) ? primary : null;

  return (
    <CardShell
      cardKind="histogram"
      cardRef={cardRef}
      settings={settings}
      updateSettings={ctl.set}
      title={metric.name}
      subtitle={subtitle}
      defaultHeight={320}
      onSettings={() => setExpanded(true)}
      onRemove={onRemove}
      onDownload={
        downloadable
          ? () =>
              downloadArtifact(
                api.artifactUrl(downloadable.artifact_hash!),
                artifactFilename(metric.name, downloadable.step, downloadable.artifact_mime, ".npz"),
              )
          : undefined
      }
      settingsPanel={settingsPanel}
      modalOpen={expanded}
      onModalClose={() => setExpanded(false)}
      modalContent={<div className="flex h-full flex-col">{renderContent()}</div>}
      scrollIntoViewOnMount={autoOpenSettings}
    >
      <>{renderContent()}</>
    </CardShell>
  );
}
