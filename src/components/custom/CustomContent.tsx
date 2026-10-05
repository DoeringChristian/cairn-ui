/**
 * Stored content in a custom viewer, outside a card: an artifact version's
 * file or a table cell (ContentViewer). Custom data opens in the default
 * viewer of its kind (or `viewer`); without one it falls back to
 * its arrays (npz), JSON tree, or a download.
 */

import { lazy, Suspense } from "react";
import type { SequencePoint } from "../../api/types";
import { parseCustomMeta } from "../../lib/custom/data";
import { useViewer, useViewerDefaults, useViewerList } from "../../lib/custom/hooks";
import { settingValues } from "../../lib/custom/manifest";
import { defaultViewerName, viewersFor } from "../../lib/custom/viewers";
import { useProjectId } from "../../lib/project-context";
import type { ViewerSource } from "../../lib/viewers/source";
import UnsupportedArtifact from "../UnsupportedArtifact";
import { ViewerLoading } from "../viewers/use-viewer-text";
import ViewerFrame from "./ViewerFrame";

const NpzViewer = lazy(() => import("../viewers/NpzViewer"));
const JsonViewer = lazy(() => import("../viewers/JsonViewer"));

/** The viewers of this project that accept `source` (most specific first) and its kind's default viewer. */
export function useAcceptingViewers(source: Pick<ViewerSource, "objectType" | "meta">) {
  const project = useProjectId();
  const list = useViewerList(source.objectType ? project : null).data ?? [];
  const defaults = useViewerDefaults(source.objectType ? project : null).data;
  const kind = parseCustomMeta(source.meta)?.kind ?? null;
  const series = source.objectType ? { object_type: source.objectType, kind } : null;
  return {
    project,
    viewers: series ? viewersFor(list, [series]) : [],
    defaultName: series ? defaultViewerName(defaults, list, series) : null,
  };
}

export default function CustomContent({ source, viewer: forced, fill }: { source: ViewerSource; viewer?: string; fill?: boolean }) {
  const { project, defaultName } = useAcceptingViewers(source);
  const name = forced ?? defaultName;
  const { viewer, loading } = useViewer(project, name);
  const meta = parseCustomMeta(source.meta);
  const box = fill ? "h-full min-h-0 w-full" : "h-[60vh] min-h-[16rem] w-full";
  if (viewer?.manifest && project) {
    const point: SequencePoint = {
      step: 0, wall_time: "", scalar_value: null, artifact_hash: source.hash, artifact_mime: source.mime,
      artifact_size: source.size, artifact_metadata: source.meta ? JSON.stringify(source.meta) : null,
      object_type: source.objectType ?? "custom", metadata: null,
    };
    return (
      <div className={box}>
        <ViewerFrame
          project={project}
          viewer={viewer}
          inputs={[{ point, url: source.url, run: "", name: source.name, label: source.name }]}
          step={0}
          settings={settingValues(viewer.manifest.settings, {})}
          title={`${viewer.info.title || viewer.info.name}: ${source.name}`}
        />
      </div>
    );
  }
  if (name && loading) return <ViewerLoading className="h-48" />;
  // No viewer: what the bytes are.
  if (meta?.format === "npz") return <Suspense fallback={<ViewerLoading className="h-48" />}><NpzViewer source={source} /></Suspense>;
  if (meta?.format === "json") return <Suspense fallback={<ViewerLoading className="h-48" />}><JsonViewer source={source} /></Suspense>;
  return (
    <div className="h-48">
      <UnsupportedArtifact
        label={meta ? `No viewer for ${meta.kind} in this project` : "No preview for this file type"}
        detail={meta ? "Publish one with cairn viewer publish ./viewers/<name> --project …" : undefined}
        downloadUrl={source.url}
        filename={source.name}
      />
    </div>
  );
}
