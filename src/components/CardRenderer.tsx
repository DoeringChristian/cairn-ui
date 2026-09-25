/**
 * Shared card renderer used by both the Metrics & Media tab (CardGrid)
 * and the Comparison view (ComparePage). One code path for all card types.
 */

import { Suspense, lazy, useMemo } from "react";
import type { SequenceMeta } from "../api/types";
import type { ComparisonSeriesRef, MultiRunCardType } from "../lib/comparisons";
import type { CardType } from "../lib/cards/card-spec";
import type { CardSettingsKey } from "../lib/card-settings";
import { useSequence } from "../api/hooks";
import { api } from "../api/client";
import { downloadArtifact, artifactFilename } from "../lib/download";
import ImageCard from "./ImageCard";
import AudioPlayerCard from "./AudioPlayerCard";
import VideoPlayerCard from "./VideoPlayerCard";
import HistogramCard from "./HistogramCard";
import TensorCard from "./TensorCard";
import TextViewerCard from "./TextViewerCard";
import ArtifactCard from "./ArtifactCard";

const FigureInteractiveCard = lazy(
  () => import("./FigureInteractiveCard"),
);
const ScalarPlotCard = lazy(() => import("./ScalarPlotCard"));


const ParallelCoordsCard = lazy(() => import("./ParallelCoordsCard"));

const ScatterPlotCard = lazy(() => import("./ScatterPlotCard"));

const TableCard = lazy(() => import("./TableCard"));

const HtmlCard = lazy(() => import("./HtmlCard"));

const MarkdownCard = lazy(() => import("./MarkdownCard"));

const BarChartCard = lazy(() => import("./BarChartCard"));

const ImportanceCard = lazy(() => import("./ImportanceCard"));
const RunCompareCard = lazy(() => import("./RunCompareCard"));
const CodeDiffCard = lazy(() => import("./CodeDiffCard"));
const ScalarTileCard = lazy(() => import("./ScalarTileCard"));
const ScalarValueCard = lazy(() => import("./ScalarValueCard"));
const PointCloudCard = lazy(() => import("./PointCloudCard"));
const MeshCard = lazy(() => import("./MeshCard"));
const Boxes3DCard = lazy(() => import("./Boxes3DCard"));
const VolumeCard = lazy(() => import("./VolumeCard"));
const PresetCard = lazy(() => import("./PresetCard"));


/**
 * Descriptor for the card CardRenderer should render.
 *
 * Two shapes:
 * - `series` (default): a single metric's card, optionally overlaid with
 *   extra cross-run series. This covers every per-metric card type.
 * - `multi-run`: the workspace-level cards (`MULTI_RUN_CARD_TYPES` in
 *   lib/comparisons/types.ts: parallel coordinates, scatter, bar, tile,
 *   importance, run comparer, code diff), which take a set of run IDs rather
 *   than a single metric.
 *
 * `kind` is optional on the series variant so the common call sites
 * (`<CardRenderer runId=… metric=… />`) stay terse; it defaults to "series".
 */
export type CardDescriptor =
  | {
      kind?: "series";
      runId: string;
      metric: SequenceMeta;
      /** Extra series for cross-run overlays. */
      extraSeries?: ComparisonSeriesRef[];
      /** When true, ignore persisted metrics — always use props. */
      controlledSeries?: boolean;
      /** Override the settings localStorage key (used in comparisons). */
      settingsKeyOverride?: CardSettingsKey;
      /** Show a remove button in the card header. */
      onRemove?: () => void;
      /** Open the settings modal and scroll into view once on mount (e.g. just-added card). */
      autoOpenSettings?: boolean;
    }
  | {
      kind: "multi-run";
      cardType: MultiRunCardType;
      runIds: string[];
      /** Settings storage key. */
      settingsKey: CardSettingsKey;
      onRemove?: () => void;
      /** Open the settings modal and scroll into view once on mount (e.g. just-added card). */
      autoOpenSettings?: boolean;
    };

/**
 * The per-metric ("series") card types: every canonical `CardType`
 * (lib/cards/card-spec.ts) that is not a multi-run card
 * (`MULTI_RUN_CARD_TYPES`), derived so `CARD_TYPES` stays the one list.
 *
 * The `switch` below casts `metric.object_type` to this union and its
 * `default` branch asserts the residual type is `never`, so a missing or
 * stray `case` is a compile error at the switch. The cast is erased at
 * runtime: an unknown `object_type` still reaches `default` and renders
 * `UnknownTypeCard`.
 */
type SeriesCardType = Exclude<CardType, MultiRunCardType>;

/** Loading placeholder shared by the lazily-loaded card variants. */
function LazyCardFallback({ label }: { label: string }) {
  return (
    <div data-cairn-card className="card p-4">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="mono text-sm font-semibold">{" "}</h3>
        <span className="text-xs text-fg-subtle">{label}</span>
      </div>
      <div className="h-48 motion-safe:animate-pulse rounded bg-bg-hover" />
    </div>
  );
}

/** Fallback card for unknown object types — shows type info + download button. */
function UnknownTypeCard({ runId, metric }: { runId: string; metric: SequenceMeta }) {
  const q = useSequence(runId, metric.name);
  const point = useMemo(() => (q.data?.points ?? [])[0], [q.data]);

  return (
    <div data-cairn-card className="card p-4 text-sm text-fg-muted">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <div className="mono font-semibold">{metric.name}</div>
        <div className="flex items-center gap-1 text-xs">
          <span className="rounded bg-bg-hover px-1.5 py-0.5 text-[10px]">{metric.object_type}</span>
          {point?.artifact_hash && (
            <button
              type="button"
              onClick={() => downloadArtifact(api.artifactUrl(point.artifact_hash!), artifactFilename(metric.name, point.step, point.artifact_mime))}
              className="h-5 w-5 inline-flex items-center justify-center rounded hover:bg-bg-hover text-fg-muted hover:text-fg"
              title="Download"
            >
              {"\u2193"}
            </button>
          )}
        </div>
      </div>
      <div>{metric.count} point{metric.count !== 1 ? "s" : ""} logged</div>
    </div>
  );
}

export default function CardRenderer(props: CardDescriptor) {
  if (props.kind === "multi-run") {
    const { cardType, runIds, settingsKey, onRemove, autoOpenSettings } = props;
    if (cardType === "parallel") {
      return (
        <Suspense fallback={<LazyCardFallback label="loading parallel coords…" />}>
          <ParallelCoordsCard runIds={runIds} settingsKey={settingsKey} onRemove={onRemove} autoOpenSettings={autoOpenSettings} />
        </Suspense>
      );
    }
    if (cardType === "bar") {
      return (
        <Suspense fallback={<LazyCardFallback label="loading bar chart…" />}>
          <BarChartCard runIds={runIds} settingsKey={settingsKey} onRemove={onRemove} autoOpenSettings={autoOpenSettings} />
        </Suspense>
      );
    }
    if (cardType === "importance") {
      return (
        <Suspense fallback={<LazyCardFallback label="loading importance…" />}>
          <ImportanceCard runIds={runIds} settingsKey={settingsKey} onRemove={onRemove} autoOpenSettings={autoOpenSettings} />
        </Suspense>
      );
    }
    if (cardType === "run-compare") {
      return (
        <Suspense fallback={<LazyCardFallback label="loading run comparer…" />}>
          <RunCompareCard runIds={runIds} settingsKey={settingsKey} onRemove={onRemove} autoOpenSettings={autoOpenSettings} />
        </Suspense>
      );
    }
    if (cardType === "code-diff") {
      return (
        <Suspense fallback={<LazyCardFallback label="loading code diff…" />}>
          <CodeDiffCard runIds={runIds} settingsKey={settingsKey} onRemove={onRemove} autoOpenSettings={autoOpenSettings} />
        </Suspense>
      );
    }
    if (cardType === "tile") {
      return (
        <Suspense fallback={<LazyCardFallback label="loading tile…" />}>
          <ScalarTileCard runIds={runIds} settingsKey={settingsKey} onRemove={onRemove} autoOpenSettings={autoOpenSettings} />
        </Suspense>
      );
    }
    return (
      <Suspense fallback={<LazyCardFallback label="loading scatter…" />}>
        <ScatterPlotCard runIds={runIds} settingsKey={settingsKey} onRemove={onRemove} autoOpenSettings={autoOpenSettings} />
      </Suspense>
    );
  }

  const {
    runId,
    metric,
    extraSeries,
    settingsKeyOverride,
    onRemove,
    controlledSeries,
    autoOpenSettings,
  } = props;
  const baseProps = { runId, metric, autoOpenSettings };

  // Cast the runtime `object_type` (typed `string`) to the closed
  // `SeriesCardType` union so the `default` branch below can assert
  // exhaustiveness with a `never` guard tied to these exact `case`s. The
  // cast is compile-time only — unknown strings still fall through to
  // `UnknownTypeCard` at runtime, so behavior is identical.
  const objectType = metric.object_type as SeriesCardType;
  switch (objectType) {
    case "scalar":
      // One point is a value, not a curve — a component that recorded a
      // property through track() instead of config() lands here. Decided on
      // the CURRENT count, so the card becomes a plot as soon as the series
      // grows; a real metric looks like this only between its first and
      // second step. Multi-series cards keep the plot: the comparison is the
      // point even when each run contributed one value.
      if (metric.count === 1 && !extraSeries?.length && !controlledSeries) {
        return (
          <Suspense fallback={<LazyCardFallback label="loading value…" />}>
            <ScalarValueCard {...baseProps} settingsKeyOverride={settingsKeyOverride} onRemove={onRemove} />
          </Suspense>
        );
      }
      return (
        <Suspense fallback={<LazyCardFallback label="loading scalar plot…" />}>
          <ScalarPlotCard {...baseProps} extraSeries={extraSeries} controlledSeries={controlledSeries} settingsKeyOverride={settingsKeyOverride} onRemove={onRemove} />
        </Suspense>
      );
    case "image":
      return <ImageCard {...baseProps} extraSeries={extraSeries} settingsKeyOverride={settingsKeyOverride} onRemove={onRemove} />;
    case "figure":
      return (
        <Suspense
          fallback={
            <div data-cairn-card className="card p-4">
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <h3 className="mono text-sm font-semibold">{metric.name}</h3>
                <span className="text-xs text-fg-subtle">loading plotly…</span>
              </div>
              <div className="h-48 motion-safe:animate-pulse rounded bg-bg-hover" />
            </div>
          }
        >
          <FigureInteractiveCard {...baseProps} extraSeries={extraSeries} controlledSeries={controlledSeries} onRemove={onRemove} settingsKeyOverride={settingsKeyOverride} />
        </Suspense>
      );
    case "audio":
      return <AudioPlayerCard {...baseProps} extraSeries={extraSeries} controlledSeries={controlledSeries} onRemove={onRemove} settingsKeyOverride={settingsKeyOverride} />;
    case "video":
      return <VideoPlayerCard {...baseProps} extraSeries={extraSeries} controlledSeries={controlledSeries} onRemove={onRemove} settingsKeyOverride={settingsKeyOverride} />;
    case "histogram":
      return <HistogramCard {...baseProps} onRemove={onRemove} settingsKeyOverride={settingsKeyOverride} />;
    case "tensor":
      return <TensorCard {...baseProps} onRemove={onRemove} settingsKeyOverride={settingsKeyOverride} />;
    case "text":
      return <TextViewerCard {...baseProps} onRemove={onRemove} settingsKeyOverride={settingsKeyOverride} />;
    case "table":
      return (
        <Suspense fallback={<LazyCardFallback label="loading table…" />}>
          <TableCard {...baseProps} extraSeries={extraSeries} controlledSeries={controlledSeries} onRemove={onRemove} settingsKeyOverride={settingsKeyOverride} />
        </Suspense>
      );
    case "html":
      return (
        <Suspense
          fallback={<LazyCardFallback label="loading html…" />}
        >
          <HtmlCard {...baseProps} extraSeries={extraSeries} controlledSeries={controlledSeries} onRemove={onRemove} settingsKeyOverride={settingsKeyOverride} />
        </Suspense>
      );
    case "markdown":
      return (
        <Suspense
          fallback={<LazyCardFallback label="loading markdown…" />}
        >
          <MarkdownCard {...baseProps} extraSeries={extraSeries} controlledSeries={controlledSeries} onRemove={onRemove} settingsKeyOverride={settingsKeyOverride} />
        </Suspense>
      );
    case "artifact":
      return <ArtifactCard {...baseProps} onRemove={onRemove} settingsKeyOverride={settingsKeyOverride} />;
    case "pointcloud":
      return (
        <Suspense fallback={<LazyCardFallback label="loading point cloud…" />}>
          <PointCloudCard {...baseProps} extraSeries={extraSeries} controlledSeries={controlledSeries} settingsKeyOverride={settingsKeyOverride} onRemove={onRemove} />
        </Suspense>
      );
    case "mesh":
      return (
        <Suspense fallback={<LazyCardFallback label="loading mesh…" />}>
          <MeshCard {...baseProps} extraSeries={extraSeries} controlledSeries={controlledSeries} settingsKeyOverride={settingsKeyOverride} onRemove={onRemove} />
        </Suspense>
      );
    case "boxes3d":
      return (
        <Suspense fallback={<LazyCardFallback label="loading boxes…" />}>
          <Boxes3DCard {...baseProps} extraSeries={extraSeries} controlledSeries={controlledSeries} settingsKeyOverride={settingsKeyOverride} onRemove={onRemove} />
        </Suspense>
      );
    case "volume":
      return (
        <Suspense fallback={<LazyCardFallback label="loading volume…" />}>
          <VolumeCard {...baseProps} extraSeries={extraSeries} controlledSeries={controlledSeries} settingsKeyOverride={settingsKeyOverride} onRemove={onRemove} />
        </Suspense>
      );
    case "preset":
      return (
        <Suspense fallback={<LazyCardFallback label="loading chart…" />}>
          <PresetCard {...baseProps} extraSeries={extraSeries} controlledSeries={controlledSeries} settingsKeyOverride={settingsKeyOverride} onRemove={onRemove} />
        </Suspense>
      );
    default: {
      // Exhaustiveness guard tied to the actual switch: if a `SeriesCardType`
      // case above is removed/renamed (or a new `CardType` is added without a
      // matching case), `objectType` is not narrowed to `never` here and this
      // assignment fails to compile. No runtime effect — genuinely-unknown
      // `object_type` strings still render `UnknownTypeCard`.
      const _exhaustive: never = objectType;
      void _exhaustive;
      return <UnknownTypeCard {...baseProps} />;
    }
  }
}
