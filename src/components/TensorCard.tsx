/**
 * Tensor card — `cairn.Tensor` blobs, one per step, on the stepped media
 * shell (slider, Index, gallery / grid / compare, media limit, several
 * runs); each tile a TensorView (stats, histogram or heatmap).
 */

import { useQuery } from "@tanstack/react-query";
import type { SequencePoint } from "../api/types";
import { safeJsonParse } from "../lib/format";
import type { SettingsController } from "../lib/card-settings";
import { isGalleryPoint } from "../lib/media/gallery";
import { galleryQuery } from "../lib/media/gallery-query";
import type { TensorSettings } from "./cards-settings/tensor";
import SteppedMediaCard, { type SteppedMediaCardProps, type SteppedMediaPanelCtx } from "./media/SteppedMediaCard";
import TensorSettingsPanel from "./settings-panels/TensorSettingsPanel";
import { StatsGrid, TensorView, npyQueryOf, tensorFacts, type TensorMeta } from "./viewers/TensorViewer";

/** A point's tensor facts: its own metadata, or a gallery's first item's. */
function usePointMeta(point: SequencePoint | null): { meta: TensorMeta | null; count: number | null } {
  const gallery = isGalleryPoint(point);
  const items = useQuery({ ...galleryQuery(point?.artifact_hash ?? ""), enabled: gallery });
  if (!gallery) return { meta: safeJsonParse<TensorMeta>(point?.artifact_metadata), count: null };
  return { meta: (items.data?.[0]?.metadata ?? null) as TensorMeta | null, count: items.data?.length ?? null };
}

/** `[n × ]shape · dtype` of the shown tensor, for the subtitle. */
function TensorSubtitle({ point }: { point: SequencePoint }) {
  const { meta, count } = usePointMeta(point);
  const shape = meta?.shape ?? [];
  return <>{isGalleryPoint(point) ? `${count ?? "…"} × ` : ""}{shape.length > 0 ? shape.join("×") : "scalar"} · {meta?.dtype ?? "?"}</>;
}

/** The settings panel with the shown tensor's facts (slice sliders, stats). */
function TensorPanel({ ctl, ctx }: { ctl: SettingsController<TensorSettings>; ctx: SteppedMediaPanelCtx }) {
  const { meta } = usePointMeta(ctx.currentPoint);
  const { ndim, shapeLabel, leadingDims } = tensorFacts(meta, ctl.value);
  return (
    <TensorSettingsPanel
      ctl={ctl}
      mode="card"
      ctx={{ ...ctx, leadingDims, below2d: ndim < 2, stats: meta && <StatsGrid meta={meta} shapeLabel={shapeLabel} /> }}
    />
  );
}

/** The tensor viewer reads blobs up to 10 MB (TensorViewer's SIZE_CAP). */
const PREFETCH_CAP = 10 * 1024 * 1024;

export default function TensorCard(props: SteppedMediaCardProps) {
  return (
    <SteppedMediaCard<TensorSettings>
      {...props}
      kind="tensor"
      noun="tensor"
      defaultMime="application/octet-stream"
      defaultHeight={300}
      nearest
      galleryFill={150}
      subtitleDetail={(point) => (point ? <TensorSubtitle point={point} /> : null)}
      settingsPanel={(ctl, ctx) => <TensorPanel ctl={ctl} ctx={ctx} />}
      // Blobs past the viewer's read cap show stats only: nothing to warm.
      prefetch={(qc, point) => ((point.artifact_size ?? 0) > PREFETCH_CAP ? Promise.resolve() : qc.prefetchQuery(npyQueryOf(point.artifact_hash!)))}
      peek={(qc, point) => (point.artifact_size ?? 0) > PREFETCH_CAP || qc.getQueryData(npyQueryOf(point.artifact_hash!).queryKey) !== undefined}
      renderArtifact={({ point, hash, settings, single }) => {
        const view = (
          <TensorView hash={hash} meta={safeJsonParse<TensorMeta>(point.artifact_metadata)} size={point.artifact_size ?? null} settings={settings} />
        );
        return single ? <div className="flex min-h-0 flex-1 flex-col">{view}</div> : <div className="flex h-full min-h-[150px] flex-col">{view}</div>;
      }}
    />
  );
}
