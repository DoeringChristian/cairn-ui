/**
 * Custom viewer card (`custom`): custom data (`cairn.Data`), or a built-in
 * kind a viewer takes over, shown by one of the project's custom viewers
 * (lib/custom/) — each pane a sandboxed frame (ViewerFrame).
 *
 * The stepped media shell gives it the step slider, section media sync,
 * galleries (one frame per item), the gallery/grid/compare panel modes, the
 * reference tag and neighbour prefetch. A `compare` viewer gets each pane's
 * value and its reference together as inputs [A, B]; any other viewer shows
 * the reference as a second frame beside A. The panes' view (a camera)
 * travels live between frames through a bus and is stored on the card when
 * a gesture ends.
 *
 * The viewer: `settings.viewer` (pinned to `viewer_version`), else the
 * project's viewer that accepts the data most specifically.
 */

import { useMemo } from "react";
import { useSequences } from "../../api/hooks";
import type { SequencePoint } from "../../api/types";
import { parseCustomMeta } from "../../lib/custom/data";
import { artifactBytesQuery, useViewer, useViewerList, useViewerProject } from "../../lib/custom/hooks";
import { settingValues, type SeriesKind } from "../../lib/custom/manifest";
import { viewersFor } from "../../lib/custom/viewers";
import { ZoomViewSync } from "../../lib/media/zoom-view-sync";
import type { CustomSettings } from "../cards-settings/custom";
import SteppedMediaCard, { type MediaView, type SteppedMediaCardProps } from "../media/SteppedMediaCard";
import CustomSettingsPanel from "../settings-panels/CustomSettingsPanel";
import ViewerFrame, { type FrameInput } from "./ViewerFrame";

/** What a point is, for picking viewers. */
export function seriesKindOf(point: SequencePoint | null | undefined, fallback: SeriesKind): SeriesKind {
  if (!point) return fallback;
  const meta = parseCustomMeta(point.artifact_metadata);
  return { object_type: point.object_type || fallback.object_type, kind: meta?.kind ?? fallback.kind ?? null };
}

function Message({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full min-h-24 items-center justify-center p-3 text-center text-xs text-fg-muted">{children}</div>;
}

export default function CustomCard(props: SteppedMediaCardProps) {
  const { runId, metric } = props;
  const project = useViewerProject(runId);
  const seqs = useSequences(runId);
  // The series as listed: a viewer may take over a built-in kind (the card's metric then says "custom").
  const listed = seqs.data?.sequences.find((s) => s.name === metric.name);
  const listedKind = listed?.kind ?? metric.kind ?? null;
  const objectType = listed?.object_type ?? (metric.object_type || "custom");
  const series = useMemo<SeriesKind[]>(() => [{ object_type: objectType, kind: listedKind }], [objectType, listedKind]);
  const list = useViewerList(project).data;
  const bus = useMemo(() => new ZoomViewSync<unknown>(), []);

  return (
    <SteppedMediaCard<CustomSettings>
      {...props}
      kind="custom"
      noun="data"
      defaultMime="application/octet-stream"
      defaultHeight={360}
      nearest
      settingsPanel={(ctl, ctx) => <CustomSettingsPanel ctl={ctl} ctx={{ ...ctx, series }} mode="card" />}
      prefetch={(qc, point) => qc.prefetchQuery(artifactBytesQuery(point.artifact_hash!))}
      peek={(qc, point) => qc.getQueryData(artifactBytesQuery(point.artifact_hash!).queryKey) !== undefined}
      reference={(s) => (s.reference ? { name: s.reference.name, step: s.referenceStep } : null)}
      renderArtifact={(view) => (
        <CustomPane view={view} project={project} auto={list ? viewersFor(list, [seriesKindOf(view.point, series[0]!)])[0]?.name ?? null : null} bus={bus} />
      )}
    />
  );
}

/** One pane: the viewer resolved, its frame (or A and B frames), sized for where it sits. */
function CustomPane({
  view,
  project,
  auto,
  bus,
}: {
  view: MediaView<CustomSettings>;
  project: string | null;
  auto: string | null;
  bus: ZoomViewSync<unknown>;
}) {
  const { settings, point, reference, name, single, inModal, runId } = view;
  const viewerName = settings.viewer ?? auto;
  const { viewer, loading, error } = useViewer(project, viewerName, settings.viewer_version ?? null);
  const manifest = viewer?.manifest ?? null;
  const values = useMemo(() => (manifest ? settingValues(manifest.settings, settings.viewerSettings) : {}), [manifest, settings.viewerSettings]);
  const height = single ? undefined : inModal ? 360 : view.paneId.includes("#") ? 180 : 240;
  const wrap = (node: React.ReactNode) =>
    single ? <div className="flex min-h-0 flex-1 flex-col">{node}</div> : <div style={{ height }}>{node}</div>;

  if (!project) return wrap(<Message>loading…</Message>);
  if (!viewerName) {
    return wrap(
      <Message>
        No custom viewer accepts this data. Publish one with <code className="mono">cairn viewer publish ./viewers/&lt;name&gt; --project …</code>
      </Message>,
    );
  }
  if (!viewer) return wrap(<Message>{loading ? "loading viewer…" : (error ?? "no viewer")}</Message>);

  const a: FrameInput = { point, run: runId, name, label: name };
  const b: FrameInput | null = reference?.artifact_hash ? { point: reference, run: runId, name: view.referenceName ?? "reference", label: view.referenceName ?? "reference" } : null;
  const common = {
    project,
    viewer,
    step: point.step,
    settings: values,
    view: manifest?.view ? settings.view : undefined,
    bus: manifest?.view ? bus : undefined,
    onViewCommit: manifest?.view ? (v: unknown) => view.update({ view: v } as Partial<CustomSettings>, { mergeKey: "view" }) : undefined,
    height: single ? undefined : height,
  };
  if (!b || manifest?.inputs === "compare") {
    return wrap(<ViewerFrame {...common} inputs={b ? [a, b] : [a]} title={`${viewer.info.title || viewer.info.name}: ${name}`} />);
  }
  // A single-input viewer with a reference: A and B side by side.
  return wrap(
    <div className="grid h-full min-h-0 flex-1 grid-cols-2 gap-1">
      <ViewerFrame {...common} inputs={[a]} title={`${viewer.info.title || viewer.info.name}: ${name}`} />
      <ViewerFrame {...common} inputs={[b]} title={`${viewer.info.title || viewer.info.name}: ${b.label}`} />
    </div>,
  );
}
