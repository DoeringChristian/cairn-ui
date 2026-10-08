/**
 * /p/:projectId/workspace — the project workspace: the project's runs in
 * a runs sidebar next to the cards, bound to the project's current view
 * (components/workspace-runs/RunsWorkspace.tsx). A group page
 * (pages/GroupPage.tsx) renders the same workspace over a group's runs.
 */

import { useMemo } from "react";
import RunsWorkspace from "../components/workspace-runs/RunsWorkspace";
import { useProjectId } from "../lib/project-context";
import { refKey, viewRef } from "../lib/workspace/ref";
import { useViews } from "../lib/workspace/use-views";

export default function WorkspacePage() {
  const projectId = useProjectId();
  const current = useViews(projectId).data?.current ?? null;
  const wsRef = useMemo(() => (projectId && current ? viewRef(projectId, current) : null), [projectId, current]);
  if (!wsRef) return null;
  // Switching views is navigation: the new view mounts fresh.
  return <RunsWorkspace key={refKey(wsRef)} wsRef={wsRef} />;
}
