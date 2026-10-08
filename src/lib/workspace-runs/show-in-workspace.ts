/**
 * The runs table's "Show in workspace": write `showOnly` (visibility.ts)
 * into the project's current view, so the workspace opens with only the
 * ticked runs' groups (or, not grouped, the ticked runs) visible.
 */

import { api } from "../../api/client";
import { ops } from "../workspace/doc";
import { viewRef } from "../workspace/ref";
import { fetchWorkspace, flushWorkspace, updateWorkspace } from "../workspace/sync";
import { editProject } from "./state";
import { showOnly } from "./visibility";

export async function showInWorkspace(projectId: string, ticked: ReadonlySet<string>): Promise<void> {
  const [{ current }, { runs }] = await Promise.all([
    api.views(projectId),
    api.runs({ project: projectId, archived: "false", limit: 1000, include: ["params", "stats"] }),
  ]);
  const ref = viewRef(projectId, current);
  await fetchWorkspace(ref, { force: true });
  updateWorkspace(ref, ops.updateRunState(editProject((s) => showOnly(s, runs, ticked))));
  await flushWorkspace(ref);
}
