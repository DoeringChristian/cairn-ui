/**
 * The runs table's "Show in workspace": write `showOnly` (visibility.ts)
 * into the project's current view, so the workspace opens with exactly the
 * ticked runs visible. On a group page's Runs tab (`group`) it is that
 * group page's run state.
 */

import { api } from "../../api/client";
import { ops } from "../workspace/doc";
import { viewRef } from "../workspace/ref";
import { fetchWorkspace, flushWorkspace, updateWorkspace } from "../workspace/sync";
import { editGroup, editProject } from "./state";
import { showOnly } from "./visibility";

export async function showInWorkspace(projectId: string, ticked: ReadonlySet<string>, group?: string): Promise<void> {
  const [{ current }, { runs }] = await Promise.all([
    api.views(projectId),
    api.runs({ project: projectId, ...(group != null ? { group } : {}), archived: "false", limit: 1000, include: ["params", "stats"] }),
  ]);
  const ref = viewRef(projectId, current);
  await fetchWorkspace(ref, { force: true });
  const fn = (s: Parameters<typeof showOnly>[0]) => showOnly(s, runs, ticked);
  updateWorkspace(ref, ops.updateRunState(group != null ? editGroup(group, fn) : editProject(fn)));
  await flushWorkspace(ref);
}
