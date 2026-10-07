import { useState, useMemo, useRef } from "react";
import ArtifactMark from "./media/ArtifactMark";
import { useQueryClient } from "@tanstack/react-query";
import { useSequence } from "../api/hooks";
import { useCardSettings, type CardSettingsKey } from "../lib/card-settings";
import type { TextSettings } from "./cards-settings/text";
import type { SequenceMeta } from "../api/types";
import CardShell from "./CardShell";
import TextSettingsPanel from "./settings-panels/TextSettingsPanel";
import StepSlider from "./StepSlider";
import GalleryView from "./media/GalleryView";
import { artifactTextQuery } from "../lib/viewers/source";
import { isGalleryPoint } from "../lib/media/gallery";
import TextViewer, { TextView } from "./viewers/TextViewer";
import { useSummarySeries } from "./card-kit/use-summary-series";

interface Props {
  runId: string;
  metric: SequenceMeta;
  settingsKeyOverride?: CardSettingsKey;
  onRemove?: () => void;
  autoOpenSettings?: boolean;
}

export default function TextViewerCard({ runId, metric, settingsKeyOverride, onRemove, autoOpenSettings }: Props) {
  const q = useSequence(runId, metric.name);
  const points = useMemo(() => q.data?.points ?? [], [q.data]);
  const [idx, setIdx] = useState(0);
  const safeIdx = Math.min(Math.max(0, idx), Math.max(0, points.length - 1));
  const current = points[safeIdx];
  const qc = useQueryClient();
  const ownSeries = useMemo(() => [{ runId, name: metric.name }], [runId, metric.name]);
  // A summary media value has one stepless value: no slider.
  const summary = useSummarySeries(ownSeries);

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



  const subtitle = summary
    ? "summary"
    : points.length > 0
      ? `step ${current?.step ?? "\u2014"}`
      : `${metric.count} pts`;

  const textView = { wrap: settings.wordWrap, fontSize: settings.fontSize };

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
              <TextViewer source={{ hash: item.artifact_hash!, size: item.artifact_size ?? null }} {...textView} className="max-h-64" />
            )}
          />
        </div>
      ) : current?.artifact_hash ? (
        <ArtifactMark hash={current.artifact_hash} name={metric.name} step={current.step} mime="text/plain">
          <TextViewer source={{ hash: current.artifact_hash, size: current.artifact_size ?? null }} {...textView} className="flex-1 min-h-0" />
        </ArtifactMark>
      ) : (
        <TextView text="" {...textView} className="flex-1 min-h-0" />
      )}
      <StepSlider
        points={summary ? [] : points}
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
      subtitleCollapsedOnly={points.length > 1}
      defaultHeight={250}
      onSettings={() => setExpanded(true)}
      onRemove={onRemove}
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
