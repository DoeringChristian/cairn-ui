import { useState, useMemo, useRef } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSequence } from "../api/hooks";
import { useCardSettings, type CardSettingsKey } from "../lib/card-settings";
import type { TextSettings } from "./cards-settings/text";
import { downloadArtifact, artifactFilename } from "../lib/download";
import { api } from "../api/client";
import type { SequenceMeta } from "../api/types";
import AddToReportButton from "./AddToReportButton";
import CardShell from "./CardShell";
import TextSettingsPanel from "./settings-panels/TextSettingsPanel";
import StepSlider from "./StepSlider";
import GalleryView from "./media/GalleryView";
import { artifactTextQuery } from "../lib/media/artifact-text";
import { isGalleryPoint } from "../lib/media/gallery";

interface Props {
  runId: string;
  metric: SequenceMeta;
  settingsKeyOverride?: CardSettingsKey;
  onRemove?: () => void;
  autoOpenSettings?: boolean;
}

const FONT_SIZE_CLASS: Record<TextSettings["fontSize"], string> = {
  xs: "text-xs",
  sm: "text-sm",
  base: "text-base",
};

/**
 * One text artifact. The previous step's text stays while the next one
 * loads (no empty flash).
 */
function TextBody({ hash, className }: { hash: string; className: string }) {
  const q = useQuery({ ...artifactTextQuery(hash), placeholderData: keepPreviousData });
  const content = q.isError && !q.isPlaceholderData ? `<fetch error: ${(q.error as Error).message}>` : q.data ?? "";
  return <pre className={className}>{content}</pre>;
}

export default function TextViewerCard({ runId, metric, settingsKeyOverride, onRemove, autoOpenSettings }: Props) {
  const q = useSequence(runId, metric.name);
  const points = useMemo(() => q.data?.points ?? [], [q.data]);
  const [idx, setIdx] = useState(0);
  const safeIdx = Math.min(Math.max(0, idx), Math.max(0, points.length - 1));
  const current = points[safeIdx];
  const qc = useQueryClient();

  const settingsKey = useMemo(
    () => settingsKeyOverride ?? {
      runId,
      metricName: metric.name,
    },
    [settingsKeyOverride, runId, metric.name],
  );
  const ctl = useCardSettings<TextSettings>(settingsKey, "text");
  const settings = ctl.value;

  const [expanded, setExpanded] = useState(autoOpenSettings ?? false);

  const compSeries = useMemo(
    () => [{ runId, name: metric.name }],
    [runId, metric.name],
  );


  const subtitle =
    points.length > 0
      ? `step ${current?.step ?? "\u2014"}`
      : `${metric.count} pts`;

  const wrapClass = settings.wordWrap
    ? "whitespace-pre-wrap break-all"
    : "whitespace-pre overflow-x-auto";

  const textClass = `mono overflow-auto ${wrapClass} rounded bg-bg p-3 ${FONT_SIZE_CLASS[settings.fontSize]} text-fg-muted`;

  const cardRef = useRef<HTMLDivElement>(null);

  const renderContent = () => (
    <>
      {current && isGalleryPoint(current) ? (
        <div className="min-h-0 flex-1 overflow-auto">
          <GalleryView
            point={current}
            prefetchItem={(p) => qc.prefetchQuery(artifactTextQuery(p.artifact_hash!))}
            peekItem={(p) => qc.getQueryData(artifactTextQuery(p.artifact_hash!).queryKey) !== undefined}
            renderItem={(item) => (
              <TextBody hash={item.artifact_hash!} className={`${textClass} max-h-64`} />
            )}
          />
        </div>
      ) : current?.artifact_hash ? (
        <TextBody hash={current.artifact_hash} className={`${textClass} flex-1 min-h-0`} />
      ) : (
        <pre className={`${textClass} flex-1 min-h-0`} />
      )}
      <StepSlider
        points={points}
        currentIndex={safeIdx}
        onChange={setIdx}
        xAxis={settings.xAxis}
        onXAxisChange={(m) => ctl.set({ xAxis: m })}
        className="mt-3"
      />
    </>
  );

  return (
    <CardShell cardKind="text"
      cardRef={cardRef}
      settings={settings}
      updateSettings={ctl.set}
      title={metric.name}
      subtitle={subtitle}
      defaultHeight={250}
      onSettings={() => setExpanded(true)}
      onRemove={onRemove}
      onDownload={current?.artifact_hash ? () => downloadArtifact(api.artifactUrl(current.artifact_hash!), artifactFilename(metric.name, current?.step ?? 0, "text/plain")) : undefined}
      addToReportSlot={<AddToReportButton cardType="text" series={compSeries} settingsKey={settingsKey} />}
      settingsPanel={<TextSettingsPanel ctl={ctl} mode="card" />}
      modalOpen={expanded}
      onModalClose={() => setExpanded(false)}
      modalContent={<div className="flex h-full flex-col">{renderContent()}</div>}
      scrollIntoViewOnMount={autoOpenSettings}
    >
      <>{renderContent()}</>
    </CardShell>
  );
}
