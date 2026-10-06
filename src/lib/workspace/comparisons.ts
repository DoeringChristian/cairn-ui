/**
 * Comparisons are workspaces with a run set (doc.ts `runs`). Creating one
 * copies the layout of the project's current view (the run page's) —
 * sections, panels and their settings, hidden and removed panels, "include
 * unlisted metrics", hide patterns, defaults, prefs — and binds the given
 * runs; afterwards the two documents are independent.
 */

import { api } from "../../api/client";
import type { RunSelector } from "../run-selector";
import { layoutOf, type WorkspaceDoc } from "./doc";
import { refKey, viewRef } from "./ref";
import { dropWorkspace, getWorkspace } from "./store";
import { fetchWorkspace, flushWorkspace } from "./sync";

export async function createComparison(
  projectId: string,
  name: string,
  runIds: readonly string[],
  selector: RunSelector | null = null,
): Promise<string> {
  const { current } = await api.views(projectId);
  const ref = viewRef(projectId, current);
  // Copy what the server has plus this tab's unsaved edits.
  await fetchWorkspace(ref, { force: true });
  await flushWorkspace(ref);
  const payload: WorkspaceDoc = {
    ...layoutOf(getWorkspace(refKey(ref))),
    runs: { ids: [...runIds], selector, view: { hidden: [], pinned: [], baseline: null } },
  };
  const res = await api.createComparison(projectId, name || "Untitled comparison", payload as unknown as Record<string, unknown>);
  return res.id;
}

export async function deleteComparison(projectId: string, id: string): Promise<void> {
  await api.deleteComparison(projectId, id);
  dropWorkspace(refKey({ kind: "comparison", projectId, id }));
}
