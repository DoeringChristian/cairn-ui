import {
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSequencesForRuns } from "../api/hooks";
import type { CardSettingsKey } from "../lib/card-settings";
import type { ComparisonSeriesRef } from "../lib/comparisons";
import { useCardDrop } from "../lib/use-series-drop";
import { useCardSeries, useRunInfo, type BaseCardSettings } from "./card-kit";
import type {
  SequenceMeta,
  SequencePoint,
  SequenceResponse,
} from "../api/types";
import SeriesChipStrip from "./SeriesChipStrip";
import AddToComparisonButton from "./AddToComparisonButton";
import CardShell from "./CardShell";
import MetricChips from "./settings/MetricChips";
import NumberInput from "./settings/NumberInput";
import Select from "./settings/Select";
import Slider from "./settings/Slider";
import Toggle from "./settings/Toggle";
import SettingsSection from "./settings/SettingsSection";
import { plotCardPolicy } from "./card-kit/plot-card-policy";
import { shortRunLabel, useRunMetadataVersion } from "../lib/run-label";
import { seriesKey, seriesLabel } from "../lib/series-utils";
import { downloadCsv, exportChartPng, safeName } from "../lib/download";
import ScalarChart from "../charts/ScalarChart";
import { mapToXAxis, type AxisSource } from "../lib/plot-utils/x-axis";
import { SERIES_COLORS, type AxisScale, type Series } from "../lib/plot-utils/types";
import { SMOOTHING_KINDS, formatSmoothing, type SmoothingKind } from "../lib/plot-utils/smooth";

const SCALAR_POLICY = plotCardPolicy("scalar");

// -----------------------------------------------------------------------------
// Settings shape
// -----------------------------------------------------------------------------

interface ScalarSettings extends BaseCardSettings {
  metrics: Array<{ runId?: string; name: string; context_hash: string }>;
  xAxis: AxisSource;
  xScale: AxisScale;
  yScale: AxisScale;
  xRange: [number | null, number | null];
  yRange: [number | null, number | null];
  smoothing: number;
  smoothingKind: SmoothingKind;
  outlierPct: [number, number];
  lineType: "linear" | "monotone" | "step" | "stepBefore" | "stepAfter";
  showLegend: boolean;
  tooltip: { showContext: boolean; showWallTime: boolean };
  viewport: {
    xMin: number | null;
    xMax: number | null;
    yMin: number | null;
    yMax: number | null;
  };
}

const DEFAULT_SCALAR_SETTINGS = (seed: {
  name: string;
  context_hash: string;
}): ScalarSettings => ({
  version: 1,
  colSpan: SCALAR_POLICY.colSpan,
  metrics: [seed],
  xAxis: "step",
  xScale: "linear",
  yScale: "linear",
  xRange: [null, null],
  yRange: [null, null],
  smoothing: 0,
  smoothingKind: "ema",
  outlierPct: [0, 100],
  lineType: "linear",
  showLegend: true,
  tooltip: { showContext: true, showWallTime: true },
  viewport: { xMin: null, xMax: null, yMin: null, yMax: null },
});

// -----------------------------------------------------------------------------
// Palette & helpers
// -----------------------------------------------------------------------------

function viewportIsAuto(v: ScalarSettings["viewport"]): boolean {
  return (
    v.xMin === null && v.xMax === null && v.yMin === null && v.yMax === null
  );
}

// -----------------------------------------------------------------------------
// Component
// -----------------------------------------------------------------------------

interface Props {
  runId: string;
  metric: SequenceMeta;
  extraSeries?: ComparisonSeriesRef[];
  controlledSeries?: boolean;
  onRemove?: () => void;
  settingsKeyOverride?: CardSettingsKey;
  autoOpenSettings?: boolean;
}

export default function ScalarPlotCard({
  runId,
  metric,
  extraSeries = [],
  controlledSeries = false,
  onRemove,
  settingsKeyOverride,
  autoOpenSettings,
}: Props) {
  const {
    settings,
    updateSettings: rawUpdateSettings,
    effectiveMetrics,
    allRunIds,
    multipleRuns,
  } = useCardSeries<ScalarSettings>({
    runId,
    metric,
    extraSeries,
    controlledSeries,
    settingsKeyOverride,
    makeDefaults: (seed, metrics) => ({
      ...DEFAULT_SCALAR_SETTINGS(seed),
      metrics,
    }),
  });

  const updateSettings = useCallback(
    (patch: Partial<ScalarSettings>) => {
      if (patch.metrics) {
        patch = {
          ...patch,
          metrics: [...patch.metrics].sort((a, b) =>
            seriesKey(a).localeCompare(seriesKey(b)),
          ),
        };
      }
      rawUpdateSettings(patch);
    },
    [rawUpdateSettings],
  );

  // -------------------------------------------------------------------------
  // Run meta
  // -------------------------------------------------------------------------
  const { runCreatedAtByRunId } = useRunInfo(allRunIds);

  // -------------------------------------------------------------------------
  // Data fetch
  // -------------------------------------------------------------------------
  const sequenceSpecs = useMemo(
    () =>
      effectiveMetrics.map((m) => ({
        runId: m.runId ?? runId,
        name: m.name,
        contextHash: m.context_hash,
      })),
    [effectiveMetrics, runId],
  );
  const queries = useSequencesForRuns(sequenceSpecs);

  // -------------------------------------------------------------------------
  // Build series
  // -------------------------------------------------------------------------
  const runMetaVersion = useRunMetadataVersion();

  const { series, isLoading } = useMemo(() => {
    const anyLoading = queries.some((q) => q.isLoading);

    const built: Series[] = effectiveMetrics.map((m, idx) => {
      const k = seriesKey(m);
      const resp = queries[idx]?.data as SequenceResponse | undefined;
      const raw: SequencePoint[] = resp?.points ?? [];
      const rid = m.runId ?? runId;

      const mapped = mapToXAxis(raw, settings.xAxis, runCreatedAtByRunId.get(rid));

      return {
        key: k,
        label: seriesLabel(m.name, m.context_hash, rid, multipleRuns, allRunIds),
        color: SERIES_COLORS[idx % SERIES_COLORS.length]!,
        points: mapped,
      };
    });

    return { series: built, isLoading: anyLoading };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    effectiveMetrics,
    settings.xAxis,
    multipleRuns,
    runId,
    runCreatedAtByRunId,
    runMetaVersion,
    queries.map((q) => q.dataUpdatedAt).join("|"),
  ]);

  // -------------------------------------------------------------------------
  // Viewport state flags
  // -------------------------------------------------------------------------
  const viewportModified =
    !viewportIsAuto(settings.viewport) ||
    settings.xRange[0] != null ||
    settings.xRange[1] != null ||
    settings.yRange[0] != null ||
    settings.yRange[1] != null;

  const { highlight: dropHighlight, dropProps } = useCardDrop(effectiveMetrics, updateSettings);

  // -------------------------------------------------------------------------
  // Selection / run info
  // -------------------------------------------------------------------------
  const [expanded, setExpanded] = useState(autoOpenSettings ?? false);

  const compSeries = useMemo((): ComparisonSeriesRef[] => {
    return effectiveMetrics.map((m) => ({
      runId: m.runId ?? runId,
      name: m.name,
      context_hash: m.context_hash,
    }));
  }, [runId, effectiveMetrics]);

  const flipYScale = () =>
    updateSettings({ yScale: settings.yScale === "log" ? "linear" : "log" });

  const resetViewport = () =>
    updateSettings({
      viewport: { xMin: null, xMax: null, yMin: null, yMax: null },
      xRange: [null, null],
      yRange: [null, null],
    });

  const totalPoints = useMemo(() => {
    let n = 0;
    for (const q of queries) n += q.data?.points.length ?? 0;
    return n;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queries.map((q) => q.dataUpdatedAt).join("|")]);

  const subtitle = `${series.length} series${
    totalPoints > 0 ? ` · ${totalPoints} pts` : ""
  }`;

  const tagPickerRunIds = useMemo(() => {
    const ids = new Set<string>();
    for (const m of effectiveMetrics) ids.add(m.runId ?? runId);
    return Array.from(ids);
  }, [effectiveMetrics, runId]);

  // -------------------------------------------------------------------------
  // Settings panel
  // -------------------------------------------------------------------------
  const settingsPanel = (
    <>
      <SettingsSection title={controlledSeries ? "Tags" : "Content"} first />
      {controlledSeries ? (
        <div className="mb-2">
          <MetricChips
            runId={runId}
            runIds={tagPickerRunIds}
            tagMode
            objectType="scalar"
            value={effectiveMetrics.map((m) => ({
              name: m.name,
              context_hash: m.context_hash,
            }))}
            onChange={(v) => {
              const keepNames = new Set(v.map((c) => c.name));
              const next = effectiveMetrics.filter((m) => keepNames.has(m.name));
              updateSettings({ metrics: next });
            }}
            onAddTag={(_tagName, runs) => {
              const newEntries = runs.map((r) => ({
                runId: r.runId,
                name: _tagName,
                context_hash: r.context_hash,
              }));
              updateSettings({ metrics: [...effectiveMetrics, ...newEntries] });
            }}
          />
          <p className="text-[10px] text-fg-subtle mt-1">
            Each tag shows one line per visible run.
          </p>
        </div>
      ) : multipleRuns ? (
        <div className="flex flex-col gap-1 mb-2">
          {effectiveMetrics.map((m) => {
            const rid = m.runId ?? runId;
            const key = seriesKey(m);
            return (
              <div
                key={key}
                className="mono flex items-center justify-between gap-2 rounded border border-border-subtle bg-bg px-2 py-1 text-xs text-fg-muted"
              >
                <span className="truncate">
                  {m.name}
                  {m.context_hash ? ` · ${m.context_hash.slice(0, 6)}` : ""}
                  {` · ${shortRunLabel(rid, allRunIds)}`}
                </span>
                <button
                  type="button"
                  aria-label={`Remove ${m.name}`}
                  className="text-fg-subtle hover:text-fg"
                  onClick={() =>
                    updateSettings({
                      metrics: effectiveMetrics.filter(
                        (x) => seriesKey(x) !== key,
                      ),
                    })
                  }
                >
                  <i className="fa-solid fa-xmark" aria-hidden="true" />
                </button>
              </div>
            );
          })}
          <p className="text-[10px] text-fg-subtle">
            Multi-run overlay — use the Runs list or the comparison page to
            add series from other runs.
          </p>
        </div>
      ) : (
        <MetricChips
          runId={runId}
          value={effectiveMetrics.map((m) => ({
            name: m.name,
            context_hash: m.context_hash,
          }))}
          onChange={(v) =>
            updateSettings({
              metrics: v.map((m) => ({
                name: m.name,
                context_hash: m.context_hash,
              })),
            })
          }
        />
      )}

      <SettingsSection title="Axes" />
      <Select
        label="X axis"
        value={settings.xAxis}
        onChange={(v) => updateSettings({ xAxis: v })}
        options={[
          { value: "step", label: "Step" },
          { value: "relative_time", label: "Relative time (s)" },
          { value: "wall_time", label: "Wall time" },
        ]}
      />
      <Select
        label="X scale"
        value={settings.xScale}
        onChange={(v) => updateSettings({ xScale: v })}
        options={[
          { value: "linear", label: "Linear" },
          { value: "log", label: "Log" },
        ]}
      />
      <Select
        label="Y scale"
        value={settings.yScale}
        onChange={(v) => updateSettings({ yScale: v })}
        options={[
          { value: "linear", label: "Linear" },
          { value: "log", label: "Log" },
        ]}
      />
      <div className="grid grid-cols-2 gap-2">
        <NumberInput
          label="X min"
          value={settings.viewport.xMin ?? settings.xRange[0]}
          onChange={(v) =>
            updateSettings({ xRange: [v, settings.xRange[1]] })
          }
        />
        <NumberInput
          label="X max"
          value={settings.viewport.xMax ?? settings.xRange[1]}
          onChange={(v) =>
            updateSettings({ xRange: [settings.xRange[0], v] })
          }
        />
        <NumberInput
          label="Y min"
          value={settings.viewport.yMin ?? settings.yRange[0]}
          onChange={(v) =>
            updateSettings({ yRange: [v, settings.yRange[1]] })
          }
        />
        <NumberInput
          label="Y max"
          value={settings.viewport.yMax ?? settings.yRange[1]}
          onChange={(v) =>
            updateSettings({ yRange: [settings.yRange[0], v] })
          }
        />
      </div>

      <Select
        label="Line type"
        value={settings.lineType ?? "linear"}
        onChange={(v) => updateSettings({ lineType: v })}
        options={[
          { value: "linear" as const, label: "Linear" },
          { value: "monotone" as const, label: "Monotone (smooth)" },
          { value: "step" as const, label: "Step" },
          { value: "stepBefore" as const, label: "Step before" },
          { value: "stepAfter" as const, label: "Step after" },
        ]}
      />

      <SettingsSection title="Smoothing" />
      <Select
        label="Kind"
        value={settings.smoothingKind}
        onChange={(kind) => {
          const info = SMOOTHING_KINDS[kind];
          const v = settings.smoothing;
          // Values don't carry across kinds (a 0.6 EMA weight is not a
          // 0.6-point window); keep "off" off, otherwise start at the kind's default.
          updateSettings({
            smoothingKind: kind,
            smoothing: v > 0 ? info.defaultValue : 0,
          });
        }}
        options={(Object.keys(SMOOTHING_KINDS) as SmoothingKind[]).map((k) => ({
          value: k,
          label: SMOOTHING_KINDS[k].label,
        }))}
      />
      <Slider
        label={SMOOTHING_KINDS[settings.smoothingKind].short}
        value={settings.smoothing}
        onChange={(v) => updateSettings({ smoothing: v })}
        min={SMOOTHING_KINDS[settings.smoothingKind].min}
        max={SMOOTHING_KINDS[settings.smoothingKind].max}
        step={SMOOTHING_KINDS[settings.smoothingKind].step}
        format={(v) => formatSmoothing(settings.smoothingKind, v)}
        description={`${SMOOTHING_KINDS[settings.smoothingKind].description}; 0 is off`}
      />

      <SettingsSection title="Outliers" />
      <Slider
        label="Low percentile"
        value={settings.outlierPct[0]}
        onChange={(v) =>
          updateSettings({ outlierPct: [v, settings.outlierPct[1]] })
        }
        min={0}
        max={100}
        step={0.5}
        format={(v) => `${v.toFixed(1)}%`}
      />
      <Slider
        label="High percentile"
        value={settings.outlierPct[1]}
        onChange={(v) =>
          updateSettings({ outlierPct: [settings.outlierPct[0], v] })
        }
        min={0}
        max={100}
        step={0.5}
        format={(v) => `${v.toFixed(1)}%`}
      />
      <p className="text-xs text-fg-muted">Set [0, 100] to disable.</p>

      <SettingsSection title="Display" />
      <Toggle
        label="Show legend"
        checked={settings.showLegend}
        onChange={(v) => updateSettings({ showLegend: v })}
      />
      <Toggle
        label="Tooltip: context"
        checked={settings.tooltip.showContext}
        onChange={(v) =>
          updateSettings({
            tooltip: { ...settings.tooltip, showContext: v },
          })
        }
      />
      <Toggle
        label="Tooltip: wall time"
        checked={settings.tooltip.showWallTime}
        onChange={(v) =>
          updateSettings({
            tooltip: { ...settings.tooltip, showWallTime: v },
          })
        }
      />
    </>
  );

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  const cardRef = useRef<HTMLDivElement>(null);

  const hasData = series.some((s) => s.points.length > 0);


  const plotProps = {
    series,
    xAxis: settings.xAxis,
    xScale: settings.xScale,
    yScale: settings.yScale,
    xRange: settings.xRange,
    yRange: settings.yRange,
    view: settings.viewport,
    onViewChange: (v: ScalarSettings["viewport"]) =>
      updateSettings({ viewport: v }),
    smoothing: settings.smoothing,
    smoothingKind: settings.smoothingKind,
    outlierPct: settings.outlierPct,
    lineType: settings.lineType,
    showLegend: settings.showLegend,
    tooltip: settings.tooltip,
  };

  return (
    <CardShell cardKind="scalar"
      cardRef={cardRef}
      settings={settings}
      updateSettings={updateSettings}
      title={metric.name}
      subtitle={subtitle}
      defaultHeight={SCALAR_POLICY.defaultHeight}
      onSettings={() => setExpanded(true)}
      onDownload={() => {
        const headers = ["series", "x", "y", "wall_time"];
        const rows: (string | number)[][] = [];
        for (const s of series) {
          for (const p of s.points) {
            rows.push([s.label, p.x, p.y, p.wallTime ?? ""]);
          }
        }
        downloadCsv(headers, rows, safeName(settings.title ?? metric.name) + ".csv");
      }}
      onScreenshot={() => { if (cardRef.current) exportChartPng(cardRef.current, safeName(settings.title ?? metric.name)); }}
      addToComparisonSlot={<AddToComparisonButton cardType="scalar" series={compSeries} />}
      onRemove={onRemove}
      onResetView={resetViewport}
      viewModified={viewportModified}
      headerActions={<>
        {settings.smoothing > 0 && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="h-5 touch:h-10 touch:min-w-[40px] inline-flex items-center justify-center rounded px-1.5 text-[10px] text-accent hover:bg-bg-hover"
            title="Smoothing active — click to open settings"
          >
            {SMOOTHING_KINDS[settings.smoothingKind].short} {formatSmoothing(settings.smoothingKind, settings.smoothing)}
          </button>
        )}
        <button
          type="button"
          onClick={flipYScale}
          className={`h-5 touch:h-10 touch:min-w-[40px] inline-flex items-center justify-center rounded px-1.5 text-[10px] hover:bg-bg-hover ${
            settings.yScale === "log"
              ? "text-accent"
              : "text-fg-muted hover:text-fg"
          }`}
          title={
            settings.yScale === "log" ? "Y: log (click for linear)" : "Y: linear (click for log)"
          }
        >
          {settings.yScale === "log" ? "lin" : "log"}
        </button>
      </>}
      dropHighlight={dropHighlight}
      dropProps={dropProps}
      settingsPanel={settingsPanel}
      modalOpen={expanded}
      onModalClose={() => setExpanded(false)}
      scrollIntoViewOnMount={autoOpenSettings}
      modalContent={
        <div className="flex flex-col h-[calc(100vh-12rem)]">
          <div className="flex-1 min-h-0">
            <ScalarChart {...plotProps} className="h-full" />
          </div>
        </div>
      }
    >
      <>
      {isLoading && !hasData ? (
        <div className="flex-1 motion-safe:animate-pulse rounded bg-bg-hover" />
      ) : (
        <ScalarChart {...plotProps} className="flex-1 min-h-0" />
      )}

      <SeriesChipStrip
        metrics={effectiveMetrics}
        controlledSeries={controlledSeries}
        runId={runId}
        allRunIds={allRunIds}
        onMetricsChange={(next) => updateSettings({ metrics: next })}
        className={series.length > 12 ? "max-h-24 overflow-y-auto" : undefined}
      />
      </>
    </CardShell>
  );
}
