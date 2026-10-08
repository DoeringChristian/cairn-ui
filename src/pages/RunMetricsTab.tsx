import { useMemo } from "react";
import { useParams } from "react-router-dom";
import WorkspaceView from "../components/workspace/WorkspaceView";
import { useProjectId } from "../lib/project-context";
import { shortRunLabel } from "../lib/run-label";
import { refKey, viewRef } from "../lib/workspace/ref";
import { useViews } from "../lib/workspace/use-views";

/**
 * The run page's Metrics & Media tab: the project's current workspace view
 * bound to this run. Every layout edit here is saved into that view and
 * applies to every run of the project; the toolbar's view switcher changes
 * which view is current (for every browser).
 */
export default function RunMetricsTab() {
  const { runId } = useParams<{ runId: string }>();
  const projectId = useProjectId();
  const current = useViews(projectId ?? null).data?.current ?? null;
  const wsRef = useMemo(() => (projectId && current ? viewRef(projectId, current) : null), [projectId, current]);
  const runIds = useMemo(() => (runId ? [runId] : []), [runId]);
  if (!wsRef || !runId) return null;

  return (
    <WorkspaceView
      // Switching views is navigation: the new view mounts fresh.
      key={refKey(wsRef)}
      wsRef={wsRef}
      runIds={runIds}
      reportLabel={`run ${shortRunLabel(runId)}`}
    />
  );
}
