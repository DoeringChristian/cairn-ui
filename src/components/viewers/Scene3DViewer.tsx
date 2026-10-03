/**
 * The 3D viewer every surface shares: a logged point cloud, mesh or 3D boxes
 * (the 3D handlers' `.npz` / `.npy` layouts) in one orbit viewport
 * (Viewer3D: drag to orbit, wheel to zoom, double-click re-frames).
 */

import { useEffect, useMemo, type ReactNode } from "react";
import type * as THREE from "three";
import type { ViewerSource } from "../../lib/viewers/source";
import { CameraLink } from "../viewer3d/camera-link";
import { disposeObject, useArtifactArrays, type ArtifactArrays, type Scene3DMeta } from "../viewer3d/artifact-arrays";
import { SCENE_SPECS } from "../viewer3d/specs";
import Viewer3D from "../viewer3d/Viewer3D";

/** What differs between the pointcloud / mesh / boxes3d viewers (and their cards). */
export interface Scene3DKind<V extends object, M extends Scene3DMeta> {
  kind: "pointcloud" | "mesh" | "boxes3d";
  /** Noun for the empty state ("no point cloud logged yet"). */
  noun: string;
  defaultView: V;
  build: (arrays: ArtifactArrays, view: V) => THREE.Object3D;
  caption: (meta: M) => string;
  viewSettings: (args: {
    view: V;
    setView: (patch: Partial<V>) => void;
    meta: M | null;
    properties: string[];
  }) => ReactNode;
}

/** One 3D artifact (by hash) in one viewport: a card pane, a gallery item, a file. */
export function SceneView<V extends object, M extends Scene3DMeta>({
  spec,
  hash,
  meta,
  view,
  link,
  resetKey,
  overlay,
}: {
  spec: Scene3DKind<V, M>;
  hash: string;
  /** The handler's metadata (the caption's facts); null for a plain file. */
  meta: M | null;
  view: V;
  link: CameraLink | null;
  resetKey: number;
  overlay?: ReactNode;
}) {
  const q = useArtifactArrays(hash);
  const built = useMemo(() => {
    if (!q.data) return { objects: [] as THREE.Object3D[], error: null };
    try {
      return { objects: [spec.build(q.data, view)], error: null };
    } catch (err) {
      return { objects: [] as THREE.Object3D[], error: err instanceof Error ? err.message : String(err) };
    }
  }, [spec, q.data, view]);
  useEffect(() => () => built.objects.forEach(disposeObject), [built]);

  const error = q.error ? String(q.error) : built.error;
  return (
    <div className="relative h-full w-full overflow-hidden rounded bg-bg" data-viewer={spec.kind}>
      <Viewer3D objects={built.objects} link={link} resetKey={resetKey} />
      {error ? (
        <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-xs text-red-500">{error}</div>
      ) : q.isFetching ? (
        <div className="absolute right-1 top-1 rounded bg-bg/80 px-1.5 py-0.5 text-[10px] text-fg-muted">loading…</div>
      ) : null}
      {overlay}
      {meta && (
        <div className="mono pointer-events-none absolute bottom-1 left-1 rounded bg-bg/80 px-1.5 py-0.5 text-[10px] text-fg-subtle">
          {spec.caption(meta)}
        </div>
      )}
    </div>
  );
}

/** The count field each 3D handler records: its metadata is the handler's only when this is a number. */
const COUNT_FIELD: Record<Scene3DKind<object, Scene3DMeta>["kind"], string> = {
  pointcloud: "n_points",
  mesh: "n_vertices",
  boxes3d: "n_boxes",
};

/** One point cloud / mesh / boxes source on its own, drawn as its card draws it by default. */
export default function Scene3DViewer({ source, kind }: { source: Pick<ViewerSource, "hash" | "meta">; kind: Scene3DKind<object, Scene3DMeta>["kind"] }) {
  const spec = SCENE_SPECS[kind] as Scene3DKind<object, Scene3DMeta>;
  // A plain `.npz` (or one carrying user metadata) has no handler facts to caption.
  const meta = typeof source.meta?.[COUNT_FIELD[kind]] === "number" ? (source.meta as Scene3DMeta) : null;
  return <SceneView spec={spec} hash={source.hash} meta={meta} view={spec.defaultView} link={null} resetKey={0} />;
}
