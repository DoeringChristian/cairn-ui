import { useMemo, useRef, useState } from "react";
import { useCardSettings } from "../lib/card-settings";
import type { TileSettings } from "./cards-settings/tile";
import { formatNum } from "../lib/plot-utils/types";
import { shortRunLabel, useRunMetadataVersion } from "../lib/run-label";
import { useVisibleRuns } from "../lib/run-view";
import { useScalarExprs } from "../lib/use-scalar-exprs";
import { toNumber } from "../lib/scalar-exprs";
import CardShell from "./CardShell";
import TileSettingsPanel from "./settings-panels/TileSettingsPanel";

interface Props {
  runIds: string[];
  settingsKey: { runId: string; metricName: string };
  onRemove?: () => void;
  autoOpenSettings?: boolean;
}

interface PerRun {
  runId: string;
  value: number;
  createdAt: number;
}

export default function ScalarTileCard({
  runIds: allRunIds,
  settingsKey,
  onRemove,
  autoOpenSettings,
}: Props) {
  const runMetaVersion = useRunMetadataVersion();
  const ctl = useCardSettings<TileSettings>(settingsKey, "tile");
  const settings = ctl.value;
  const [expanded, setExpanded] = useState(autoOpenSettings ?? false);
  const runIds = useVisibleRuns(allRunIds);

  const metric = settings.metric;
  const srcs = useMemo(() => [metric?.src ?? ""], [metric]);
  const exprs = useScalarExprs(runIds, srcs);

  // Per-run value and creation time.
  const perRun = useMemo<PerRun[]>(() => {
    if (!metric) return [];
    const out: PerRun[] = [];
    for (const rid of runIds) {
      const value = toNumber(exprs.values[0]!.get(rid));
      if (value == null) continue;
      const created = exprs.details.get(rid)?.run.created_at;
      out.push({ runId: rid, value, createdAt: created ? new Date(created).getTime() : 0 });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metric, runIds, exprs, runMetaVersion]);

  // Reduce across runs to the single displayed tile value.
  const tile = useMemo(() => {
    if (!perRun.length) return null;
    if (settings.reduce === "mean") {
      const mean = perRun.reduce((a, b) => a + b.value, 0) / perRun.length;
      return { value: mean, runId: null as string | null, count: perRun.length };
    }
    const chosen = settings.reduce === "latest"
      ? perRun.reduce((a, b) => (b.createdAt > a.createdAt ? b : a))
      : perRun.reduce((a, b) => {
          if (settings.bestDir === "min") return b.value < a.value ? b : a;
          return b.value > a.value ? b : a;
        });
    return { value: chosen.value, runId: chosen.runId, count: perRun.length };
  }, [perRun, settings.reduce, settings.bestDir]);

  const error = metric ? exprs.errors[0] ?? null : null;
  const settingsPanel = <TileSettingsPanel ctl={ctl} mode="card" ctx={{ options: exprs.options, error }} />;

  const cardRef = useRef<HTMLDivElement>(null);

  const runLabel = tile?.runId
    ? shortRunLabel(tile.runId, runIds)
    : settings.reduce === "mean"
      ? `mean of ${tile?.count ?? 0} runs`
      : null;

  const body = (
    <div className="flex flex-1 min-h-0 flex-col justify-center gap-1 py-1">
      {!metric ? (
        <div className="text-sm text-fg-muted">Select a value in settings.</div>
      ) : error ? (
        <div className="text-sm text-status-failed">{error}</div>
      ) : !tile ? (
        <div className="text-sm text-fg-muted">{exprs.loading ? "Loading…" : "No values for this metric."}</div>
      ) : (
        <>
          <div className="mono text-3xl font-semibold leading-tight text-fg tabular-nums">
            {formatNum(tile.value)}
          </div>
          <div className="mono text-xs text-fg-muted truncate">{metric.src}</div>
          {runLabel && (
            <div className="mono text-[11px] text-fg-subtle truncate">{runLabel}</div>
          )}
        </>
      )}
    </div>
  );

  return (
    <CardShell cardKind="tile"
      cardRef={cardRef}
      settings={settings}
      updateSettings={ctl.set}
      title="Scalar Tile"
      subtitle={metric?.src}
      defaultHeight={170}
      onSettings={() => setExpanded(true)}
      onRemove={onRemove}
      settingsPanel={settingsPanel}
      modalOpen={expanded}
      onModalClose={() => setExpanded(false)}
      scrollIntoViewOnMount={autoOpenSettings}
      modalContent={<div className="flex h-64 flex-col">{body}</div>}
    >
      {body}
    </CardShell>
  );
}
