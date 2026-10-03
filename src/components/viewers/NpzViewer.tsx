import { formatNum } from "../../lib/plot-utils/format";
import { npzSceneKind } from "../../lib/viewers/kind";
import type { ViewerSource } from "../../lib/viewers/source";
import { useArtifactArrays } from "../viewer3d/artifact-arrays";
import Scene3DViewer from "./Scene3DViewer";
import { arrayMeta } from "./TensorViewer";
import { ViewerError, ViewerLoading } from "./use-viewer-text";

/**
 * An `.npz` archive: in the 3D viewer when its members are a mesh, a point
 * cloud or 3D boxes (the 3D handlers' layouts), else a table of its arrays
 * (shape, dtype, range, mean).
 */
export default function NpzViewer({ source }: { source: Pick<ViewerSource, "hash" | "size" | "meta"> }) {
  const q = useArtifactArrays(source.hash);
  if (q.isLoading) return <ViewerLoading className="h-48" />;
  if (q.isError || !q.data) return <ViewerError error={q.error ?? "could not read the archive"} />;
  const scene = npzSceneKind(Object.keys(q.data));
  if (scene) {
    return (
      <div className="h-[60vh] min-h-[16rem]">
        <Scene3DViewer source={source} kind={scene} />
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-border" data-viewer="arrays">
      <table className="w-full text-xs">
        <thead className="bg-bg-elevated text-left uppercase tracking-wide text-fg-muted">
          <tr>
            <th className="px-3 py-1.5">Array</th>
            <th className="px-3 py-1.5">Shape</th>
            <th className="px-3 py-1.5">dtype</th>
            <th className="px-3 py-1.5 text-right">min</th>
            <th className="px-3 py-1.5 text-right">max</th>
            <th className="px-3 py-1.5 text-right">mean</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(q.data).map(([name, arr]) => {
            const m = arrayMeta(arr, null);
            return (
              <tr key={name} className="border-t border-border-subtle">
                <td className="mono px-3 py-1">{name}</td>
                <td className="mono num px-3 py-1">{m.shape.length ? m.shape.join("×") : "scalar"}</td>
                <td className="mono px-3 py-1">{m.dtype}</td>
                <td className="mono num px-3 py-1 text-right">{formatNum(m.min)}</td>
                <td className="mono num px-3 py-1 text-right">{formatNum(m.max)}</td>
                <td className="mono num px-3 py-1 text-right">{formatNum(m.mean)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
