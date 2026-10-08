/**
 * /p/:projectId/workspace — the project workspace: the project's runs in
 * a runs sidebar next to the cards, bound to the project's current view
 * (components/workspace-runs/RunsWorkspace.tsx).
 *
 * `?group=<group>` (a group's name in the Runs table or on the run page)
 * filters the workspace to that group first (visibility.ts
 * `filterToGroup`, written into the current view), then drops the param.
 */

import { useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import RunsWorkspace from "../components/workspace-runs/RunsWorkspace";
import { useProjectId } from "../lib/project-context";
import { focusGroupInWorkspace } from "../lib/workspace-runs/show-in-workspace";
import { refKey, viewRef } from "../lib/workspace/ref";
import { useViews } from "../lib/workspace/use-views";

export default function WorkspacePage() {
  const projectId = useProjectId();
  const current = useViews(projectId).data?.current ?? null;
  const wsRef = useMemo(() => (projectId && current ? viewRef(projectId, current) : null), [projectId, current]);
  const [params, setParams] = useSearchParams();
  const group = params.get("group");

  useEffect(() => {
    if (!projectId || group == null) return;
    let live = true;
    void focusGroupInWorkspace(projectId, group).finally(() => {
      if (live) setParams((p) => (p.delete("group"), p), { replace: true });
    });
    return () => {
      live = false;
    };
  }, [projectId, group, setParams]);

  // The group filter first: the workspace mounts with it written.
  if (!wsRef || group != null) return null;
  // Switching views is navigation: the new view mounts fresh.
  return <RunsWorkspace key={refKey(wsRef)} wsRef={wsRef} />;
}
