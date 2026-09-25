/**
 * The project workspace document for components: `doc` re-renders on every
 * change (this tab's edits, a fetch, a rebase after a 409), and `update`
 * applies an op, schedules the server write and pushes an undo entry that
 * restores only the fields the op changed.
 *
 * Read-only surfaces (`CardMutationContext` false) and components outside a
 * project read the document but `update` does nothing.
 */

import { useCallback, useContext, useEffect, useMemo, useSyncExternalStore } from "react";
import { CardMutationContext } from "../card-settings";
import { usePushUndo } from "../undo-context";
import { EMPTY_WORKSPACE, changedFields, restoreFields, type WorkspaceDoc, type WorkspaceOp } from "./doc";
import { getWorkspace, subscribeWorkspace } from "./store";
import { fetchWorkspace, updateWorkspace } from "./sync";

export interface WorkspaceUpdateOptions {
  /** Undo entry label. */
  label?: string;
  /** Consecutive updates sharing a merge key within 600 ms are one undo step. */
  mergeKey?: string;
}

export interface UseWorkspace {
  doc: WorkspaceDoc;
  /** No project, or a read-only surface: `update` is a no-op. */
  readOnly: boolean;
  update: (op: WorkspaceOp, opts?: WorkspaceUpdateOptions) => void;
}

const noopSubscribe = () => () => {};
const empty = () => EMPTY_WORKSPACE;

export function useWorkspace(projectId: string | null): UseWorkspace {
  const mutable = useContext(CardMutationContext);
  const pushUndo = usePushUndo();

  const sub = useCallback(
    (fn: () => void) => (projectId ? subscribeWorkspace(projectId, fn) : noopSubscribe()),
    [projectId],
  );
  const read = useCallback(() => (projectId ? getWorkspace(projectId) : EMPTY_WORKSPACE), [projectId]);
  const doc = useSyncExternalStore(sub, projectId ? read : empty);

  useEffect(() => {
    if (projectId) void fetchWorkspace(projectId);
  }, [projectId]);

  const readOnly = !mutable || !projectId;
  const update = useCallback(
    (op: WorkspaceOp, opts?: WorkspaceUpdateOptions) => {
      if (!projectId || !mutable) return;
      const before = getWorkspace(projectId);
      updateWorkspace(projectId, op);
      const after = getWorkspace(projectId);
      const fields = changedFields(before, after);
      if (fields.length === 0) return;
      pushUndo({
        label: opts?.label ?? "Change workspace",
        undo: () => updateWorkspace(projectId, restoreFields(before, fields)),
        redo: () => updateWorkspace(projectId, restoreFields(after, fields)),
        mergeKey: opts?.mergeKey !== undefined ? `workspace|${opts.mergeKey}` : undefined,
      });
    },
    [projectId, mutable, pushUndo],
  );

  return useMemo(() => ({ doc, readOnly, update }), [doc, readOnly, update]);
}
