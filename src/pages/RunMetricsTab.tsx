import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import WorkspaceView from "../components/workspace/WorkspaceView";
import { useProjectId } from "../lib/project-context";
import { shortRunLabel } from "../lib/run-label";
import { createComparison } from "../lib/workspace/comparisons";
import { projectRef } from "../lib/workspace/ref";

/**
 * The run page's Metrics & Media tab: the project workspace bound to this
 * run. Every layout edit here applies to every run of the project.
 */
export default function RunMetricsTab() {
  const { runId } = useParams<{ runId: string }>();
  const projectId = useProjectId();
  const navigate = useNavigate();
  const wsRef = useMemo(() => (projectId ? projectRef(projectId) : null), [projectId]);
  const runIds = useMemo(() => (runId ? [runId] : []), [runId]);
  const [creating, setCreating] = useState(false);
  if (!wsRef || !runId) return null;

  const newComparison = async () => {
    setCreating(true);
    try {
      const id = await createComparison(wsRef.projectId, `Comparison · ${shortRunLabel(runId)}`, [runId]);
      navigate(`/p/${wsRef.projectId}/compare?c=${encodeURIComponent(id)}&tab=metrics`);
    } finally {
      setCreating(false);
    }
  };

  return (
    <WorkspaceView
      wsRef={wsRef}
      runIds={runIds}
      reportLabel={`run ${shortRunLabel(runId)}`}
      toolbarActions={
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded border border-border px-2.5 py-1 text-xs text-fg-muted transition-colors hover:border-accent hover:text-fg touch:min-h-10 disabled:opacity-50"
          onClick={() => void newComparison()}
          disabled={creating}
          title="New comparison with this run and a copy of this workspace's layout"
        >
          <i className="fa-solid fa-code-compare" aria-hidden="true" /> New comparison
        </button>
      }
    />
  );
}
