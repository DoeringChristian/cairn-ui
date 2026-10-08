import { useMemo } from "react";
import { useParams } from "react-router-dom";
import WorkspaceView from "../components/workspace/WorkspaceView";
import { isSystemMetric } from "../lib/metric-defs";
import { useProjectId } from "../lib/project-context";
import { shortRunLabel } from "../lib/run-label";
import { refKey, viewRef } from "../lib/workspace/ref";
import { useViews } from "../lib/workspace/use-views";

const notSystem = (name: string) => !isSystemMetric(name);

/**
 * The run page's Workspace tab: the project's current workspace view bound
 * to this run, without its `system.*` series (the System tab's). Every
 * layout edit here is saved into that view and applies to every run of the
 * project; the toolbar's view switcher changes which view is current (for
 * every browser). Cards showing nothing this run logs, and sections left
 * without cards, are not shown (as wandb's run page).
 */
export default function RunWorkspaceTab() {
  return <RunView metricFilter={notSystem} emptyText="No metrics logged yet." />;
}

/** The run page's System tab: the same view over the run's `system.*` series only. */
export function RunSystemTab() {
  return <RunView metricFilter={isSystemMetric} emptyText="No system metrics logged." />;
}

function RunView({ metricFilter, emptyText }: { metricFilter: (name: string) => boolean; emptyText: string }) {
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
      metricFilter={metricFilter}
      hideEmpty
      emptyText={emptyText}
    />
  );
}
