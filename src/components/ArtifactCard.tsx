/**
 * Artifact card — a `pickle` series (`run.track(cairn.Pickle(...))`) or the
 * versions of an artifact the run logged (`run.log_artifact`), with download
 * links. Shows file metadata (name, size, MIME type) and a step slider; a
 * version sits at its logged `step` (its version number when it has none).
 */

import { useMemo, useRef, useState } from "react";
import { useSequence, useRunOutputArtifacts } from "../api/hooks";
import { api } from "../api/client";
import { formatBytes, safeJsonParse } from "../lib/format";
import { downloadArtifact, artifactFilename } from "../lib/download";
import { useCardSettings, type CardSettingsKey } from "../lib/card-settings";
import type { ArtifactSettings } from "./cards-settings/artifact";
import type { ArtifactEntryInfo, ArtifactVersionInfo, SequenceMeta } from "../api/types";
import CardShell from "./CardShell";
import StepSlider from "./StepSlider";
import ArtifactSettingsPanel from "./settings-panels/ArtifactSettingsPanel";
import { useStepSlider, resolveAtStep } from "./card-kit";
import { viewerKind } from "../lib/viewers/kind";
import { hashSource } from "../lib/viewers/source";
import ContentViewer from "./viewers/ContentViewer";

interface Props {
  runId: string;
  metric: SequenceMeta;
  settingsKeyOverride?: CardSettingsKey;
  onRemove?: () => void;
  autoOpenSettings?: boolean;
}

interface ArtifactPoint {
  step: number;
  wall_time: string;
  artifact_hash: string | null;
  artifact_mime?: string | null;
  artifact_size?: number | null;
  artifact_metadata?: string | null;
  object_type: string;
  /** A one-file version's file name. */
  filename?: string;
  /** The logged version this point stands for; null for a series point. */
  version: ArtifactVersionInfo | null;
}

/** A version's zip download (uploaded entries; references are listed, not fetched). */
const versionZipName = (version: ArtifactVersionInfo) => `${version.name}-v${version.version}.zip`;

/** A version's entries, each a download link (references link nowhere), plus the whole version as a zip. */
function VersionFiles({ version }: { version: ArtifactVersionInfo }) {
  const files: ArtifactEntryInfo[] = version.files ?? [];
  const uploaded = files.filter((f) => f.digest).length;
  return (
    <div className="rounded border border-border bg-bg p-3 text-xs">
      <div className="mb-2 flex flex-wrap items-baseline gap-2">
        <span className="mono text-fg">{version.ref}</span>
        <span className="text-fg-subtle">{version.type}</span>
        {version.aliases.map((a) => (
          <span key={a} className="rounded border border-border px-1 text-[10px] text-fg-muted">{a}</span>
        ))}
        <span className="mono num text-fg-muted">{formatBytes(version.size)}</span>
        {uploaded > 0 && (
          <a
            href={api.artifactVersionDownloadUrl(version.id)}
            download={versionZipName(version)}
            className="ml-auto inline-flex items-center gap-1.5 rounded border border-accent px-2 py-0.5 text-accent hover:bg-accent/10"
            title={files.length > uploaded ? "References are not included in the zip" : undefined}
          >
            {"\u2913"} Download all (.zip)
          </a>
        )}
      </div>
      <ul className="flex flex-col gap-0.5">
        {files.map((f) => (
          <li key={f.path} className="flex items-baseline gap-2">
            {f.digest ? (
              <a
                className="mono text-accent hover:underline break-all"
                href={api.artifactVersionFileUrl(version.id, f.path)}
                download={f.path.split("/").pop()}
              >
                {f.path}
              </a>
            ) : (
              <span className="mono break-all text-fg-muted" title={f.uri ?? undefined}>{f.path} → {f.uri}</span>
            )}
            {f.size != null && <span className="mono num text-fg-subtle">{formatBytes(f.size)}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

interface ArtifactMeta {
  filename?: string;
  size_bytes?: number;
  mime_type?: string;
  python_type?: string;
  python_module?: string;
  [key: string]: unknown;
}

export default function ArtifactCard({ runId, metric, settingsKeyOverride, onRemove, autoOpenSettings }: Props) {
  const q = useSequence(runId, metric.name);
  // The versions of the artifact of this name the run logged.
  const outputsQ = useRunOutputArtifacts(runId);
  const points = useMemo<ArtifactPoint[]>(() => {
    const seqPoints = (q.data?.points ?? []).filter((p) => p.artifact_hash);
    if (seqPoints.length > 0) return seqPoints.map((p) => ({ ...p, version: null }));
    // Sorted by step so the slider goes 0 → max left-to-right.
    return (outputsQ.data?.outputs ?? [])
      .filter((v) => v.name === metric.name)
      .map((v) => {
        const single = v.files?.length === 1 ? v.files[0]! : null;
        return {
          step: v.step ?? v.version,
          wall_time: v.created_at,
          artifact_hash: single?.digest ?? null,
          artifact_mime: single?.mime ?? null,
          artifact_size: single ? single.size : v.size,
          artifact_metadata: JSON.stringify({ ...(single?.meta ?? {}), ...v.metadata }),
          object_type: single?.object_type ?? "artifact",
          filename: single ? single.path.slice(single.path.lastIndexOf("/") + 1) : undefined,
          version: v,
        };
      })
      .sort((a, b) => a.step - b.step);
  }, [q.data, outputsQ.data, metric.name]);

  const ctl = useCardSettings<ArtifactSettings>(
    settingsKeyOverride ?? { runId, metricName: metric.name },
    "artifact",
  );
  const settings = ctl.value;

  const seriesPoints = useMemo(() => [points], [points]);
  const ownSeries = useMemo(() => [{ runId, name: metric.name }], [runId, metric.name]);
  const { safeIdx, currentStep, onSliderChange, summary } = useStepSlider({
    seriesPoints,
    persistedIdx: settings.sliderStep,
    updateSettings: ctl.set,
    series: ownSeries,
  });
  const current = useMemo(() => resolveAtStep<ArtifactPoint>(points, currentStep), [points, currentStep]);
  const meta = useMemo(
    () => safeJsonParse<ArtifactMeta>(current?.artifact_metadata ?? null) ?? {},
    [current],
  );
  const mime = meta.mime_type ?? current?.artifact_mime ?? "";
  const ext = meta.filename
    ? meta.filename.replace(/^.*\./, ".")
    : mime === "application/python-pickle" || meta.python_type
      ? ".pkl"
      : "";
  const downloadName = current ? artifactFilename(metric.name, current.step, null, ext) : "";
  // The artifact in the viewer every surface shares (an image zooms, a table sorts, …).
  const source = useMemo(
    () => current?.artifact_hash
      ? hashSource(current.artifact_hash, {
          name: current.filename ?? meta.filename ?? downloadName,
          mime: mime || null,
          size: current.artifact_size ?? meta.size_bytes ?? null,
          objectType: current.object_type === "artifact" ? null : current.object_type,
          meta,
        })
      : null,
    [current, meta, mime, downloadName],
  );
  const kind = source ? viewerKind({ path: source.name, mime: source.mime, object_type: source.objectType }) : "binary";

  const subtitle = points.length > 0
    ? `${current?.version ? `${current.version.ref} · ` : ""}step ${current?.step ?? 0} (${safeIdx + 1}/${points.length})`
    : `${metric.count} pts`;

  const cardRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(autoOpenSettings ?? false);

  const renderContent = () => (
    <>
      {current?.version && !current.artifact_hash ? (
        <div className="flex-1 min-h-0 overflow-auto">
          <VersionFiles version={current.version} />
        </div>
      ) : current?.artifact_hash ? (
        <div className="flex-1 min-h-0 flex flex-col gap-2 overflow-auto">
          {kind !== "binary" && (
            <div className={kind === "pickle" || kind === "audio" ? "" : "min-h-[12rem] flex-1"}>
              <ContentViewer key={current.artifact_hash} source={source!} kind={kind} fill={kind !== "pickle" && kind !== "audio"} />
            </div>
          )}
          <div className="rounded border border-border bg-bg p-3 text-xs">
            <div className="flex flex-col gap-1">
              {meta.size_bytes != null && (
                <div className="flex items-baseline gap-2">
                  <span className="text-fg-subtle">Size:</span>
                  <span className="mono num text-fg">{formatBytes(meta.size_bytes)}</span>
                </div>
              )}
              {kind !== "pickle" && meta.python_type && (
                <div className="flex items-baseline gap-2">
                  <span className="text-fg-subtle">Type:</span>
                  <span className="mono text-fg">
                    {meta.python_module && meta.python_module !== "builtins" ? `${meta.python_module}.` : ""}{meta.python_type}
                  </span>
                </div>
              )}
              {(mime || ext) && (
                <div className="flex items-baseline gap-2">
                  <span className="text-fg-subtle">Format:</span>
                  <span className="mono text-fg">{mime || `pickle (${ext})`}</span>
                </div>
              )}
              <div className="flex items-baseline gap-2">
                <span className="text-fg-subtle">Hash:</span>
                <span className="mono text-fg-muted">{current.artifact_hash!.slice(0, 16)}...</span>
              </div>
              {/* Any other metadata keys (a pickle's are in its viewer). */}
              {kind !== "pickle" && Object.entries(meta).filter(([k]) => !["filename", "size_bytes", "mime_type", "python_type", "python_module"].includes(k)).map(([k, v]) => (
                <div key={k} className="flex items-baseline gap-2">
                  <span className="text-fg-subtle">{k}:</span>
                  <span className="mono text-fg">{String(v)}</span>
                </div>
              ))}
            </div>
            <a
              href={api.artifactUrl(current.artifact_hash!)}
              download={downloadName}
              className="inline-flex items-center gap-1.5 mt-3 px-3 py-1.5 rounded border border-accent text-accent hover:bg-accent/10 text-xs font-medium"
            >
              {"\u2913"} Download{ext ? ` ${ext}` : ""}
            </a>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-sm text-fg-muted">
          No artifact at this step
        </div>
      )}

      <StepSlider
        points={summary ? [] : points}
        currentIndex={safeIdx}
        onChange={onSliderChange}
        xAxis={settings.xAxis}
        onXAxisChange={(m) => ctl.set({ xAxis: m })}
        className="mt-3"
      />
    </>
  );

  return (
    <CardShell cardKind="artifact"
      cardRef={cardRef}
      settings={settings}
      updateSettings={ctl.set}
      title={metric.name}
      subtitle={subtitle}
      onRemove={onRemove}
      onDownload={
        current?.artifact_hash
          ? () => downloadArtifact(api.artifactUrl(current.artifact_hash!), downloadName)
          : current?.version && (current.version.files ?? []).some((f) => f.digest)
            ? () => downloadArtifact(api.artifactVersionDownloadUrl(current.version!.id), versionZipName(current.version!))
            : undefined
      }
      headerActions={
        <span className="inline-flex items-center rounded bg-bg-hover px-1.5 py-0.5 text-[10px] text-fg-muted">
          artifact
        </span>
      }
      onSettings={() => setExpanded(true)}
      settingsPanel={<ArtifactSettingsPanel ctl={ctl} mode="card" />}
      modalOpen={expanded}
      onModalClose={() => setExpanded(false)}
      modalContent={<div className="flex h-full flex-col">{renderContent()}</div>}
      scrollIntoViewOnMount={autoOpenSettings}
    >
      {renderContent()}
    </CardShell>
  );
}
