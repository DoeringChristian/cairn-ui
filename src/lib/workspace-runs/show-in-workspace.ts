/**
 * `focusGroupInWorkspace`: the project's current view filtered to a group
 * (visibility.ts `filterToGroup`), for a group's name outside the workspace
 * (`/p/<project>/workspace?group=`).
 */

import { api } from "../../api/client";
import type { Run } from "../../api/types";
import { ops } from "../workspace/doc";
import { viewRef } from "../workspace/ref";
import { fetchWorkspace, flushWorkspace, updateWorkspace } from "../workspace/sync";
import type { RunState } from "./state";
import { filterToGroup } from "./visibility";

/** Edit the project's current view's run state, given the project's runs (archived too). */
async function editWorkspaceRuns(projectId: string, fn: (s: RunState, runs: Run[]) => RunState): Promise<void> {
  const [{ current }, { runs }] = await Promise.all([
    api.views(projectId),
    api.runs({ project: projectId, limit: 1000, include: ["params", "stats"] }),
  ]);
  const ref = viewRef(projectId, current);
  await fetchWorkspace(ref, { force: true });
  updateWorkspace(ref, ops.updateRunState((s) => fn(s, runs)));
  await flushWorkspace(ref);
}

export function focusGroupInWorkspace(projectId: string, group: string): Promise<void> {
  return editWorkspaceRuns(projectId, (s, runs) => filterToGroup(s, group, runs));
}
