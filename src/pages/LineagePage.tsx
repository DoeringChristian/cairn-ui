import { lazy, Suspense } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useArtifactFamilies } from "../api/artifact-hooks";

const LineageView = lazy(() => import("../components/lineage/LineageView"));

/** The project's whole lineage graph (`?artifact=<family id>`: one artifact's versions). */
export default function LineagePage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [params, setParams] = useSearchParams();
  const familyId = params.get("artifact");
  const families = useArtifactFamilies(projectId!);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="mono min-w-0 break-all text-xl font-semibold">{projectId} / lineage</h1>
        <label className="ml-auto flex items-center gap-1.5 text-xs text-fg-muted">
          Artifact
          <select
            className="input py-1 text-xs md:text-xs"
            value={familyId ?? ""}
            onChange={(e) =>
              setParams((p) => {
                const n = new URLSearchParams(p);
                if (e.target.value) n.set("artifact", e.target.value);
                else n.delete("artifact");
                return n;
              })
            }
            aria-label="only this artifact"
          >
            <option value="">All artifacts</option>
            {(families.data?.families ?? [])
              .slice()
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name} ({f.type})
                </option>
              ))}
          </select>
        </label>
      </div>
      <div className="h-[calc(100vh-var(--header-h)-9rem)] min-h-[480px] overflow-hidden rounded-lg border border-border">
        <Suspense fallback={<p className="p-4 text-sm text-fg-muted">Loading graph…</p>}>
          <LineageView key={familyId ?? "all"} projectId={projectId!} familyId={familyId} />
        </Suspense>
      </div>
    </div>
  );
}
