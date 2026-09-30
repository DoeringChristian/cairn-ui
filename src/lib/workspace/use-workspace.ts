/**
 * A workspace document for components: `doc` re-renders on every change
 * (this tab's edits, a fetch, a rebase after a 409), and `update` applies an
 * op, schedules the server write and pushes an undo entry that restores only
 * the fields the op changed.
 *
 * Read-only surfaces (`CardMutationContext` false) and components outside a
 * workspace read the document but `update` does nothing.
 */

import { useCallback, useContext, useEffect, useMemo, useSyncExternalStore } from "react";
import { CardMutationContext } from "../card-settings";
import { usePushUndo } from "../undo-context";
import { EMPTY_WORKSPACE, changedFields, restoreFields, type WorkspaceDoc, type WorkspaceOp } from "./doc";
import { refKey, useWorkspaceRef, type WorkspaceRef } from "./ref";
import { getWorkspace, subscribeWorkspace } from "./store";
import { fetchWorkspace, updateWorkspace } from "./sync";

export interface WorkspaceUpdateOptions {
  /** Undo entry label. */
  label?: string;
  /** Consecutive updates sharing a merge key within 600 ms are one undo step. */
  mergeKey?: string;
  /** Don't push an undo entry (the caller keeps its own). */
  noUndo?: boolean;
}

export interface UseWorkspace {
  ref: WorkspaceRef | null;
  doc: WorkspaceDoc;
  /** No workspace, or a read-only surface: `update` is a no-op. */
  readOnly: boolean;
  update: (op: WorkspaceOp, opts?: WorkspaceUpdateOptions) => void;
}

const noopSubscribe = () => () => {};
const empty = () => EMPTY_WORKSPACE;

export function useWorkspace(ref: WorkspaceRef | null): UseWorkspace {
  const mutable = useContext(CardMutationContext);
  const pushUndo = usePushUndo();
  const key = ref ? refKey(ref) : null;
  // Stable across renders while the key is the same.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stableRef = useMemo(() => ref, [key]);

  const sub = useCallback((fn: () => void) => (key ? subscribeWorkspace(key, fn) : noopSubscribe()), [key]);
  const read = useCallback(() => (key ? getWorkspace(key) : EMPTY_WORKSPACE), [key]);
  const doc = useSyncExternalStore(sub, key ? read : empty);

  useEffect(() => {
    if (stableRef) void fetchWorkspace(stableRef);
  }, [stableRef]);

  const readOnly = !mutable || !stableRef;
  const update = useCallback(
    (op: WorkspaceOp, opts?: WorkspaceUpdateOptions) => {
      if (!stableRef || !mutable) return;
      const k = refKey(stableRef);
      const before = getWorkspace(k);
      updateWorkspace(stableRef, op);
      if (opts?.noUndo) return;
      const after = getWorkspace(k);
      const fields = changedFields(before, after);
      if (fields.length === 0) return;
      pushUndo({
        label: opts?.label ?? "Change workspace",
        undo: () => updateWorkspace(stableRef, restoreFields(before, fields)),
        redo: () => updateWorkspace(stableRef, restoreFields(after, fields)),
        mergeKey: opts?.mergeKey !== undefined ? `workspace|${k}|${opts.mergeKey}` : undefined,
      });
    },
    [stableRef, mutable, pushUndo],
  );

  return useMemo(() => ({ ref: stableRef, doc, readOnly, update }), [stableRef, doc, readOnly, update]);
}

/** The workspace of the enclosing view (`WorkspaceRefContext`). */
export function useCurrentWorkspace(): UseWorkspace {
  return useWorkspace(useWorkspaceRef());
}
