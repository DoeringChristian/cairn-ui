/**
 * Undo for comparison edits: snapshot the comparison before and after a
 * mutation (any store call: rename, add/remove/reorder cards, runs,
 * selector, delete) and push one undo entry that restores either snapshot.
 *
 * Restoring a deleted comparison re-creates it; its server copy was deleted,
 * so it syncs up as a new one.
 */

import { useCallback } from "react";
import { usePushUndo } from "../undo-context";
import type { Comparison } from "./types";
import { deleteComparison, loadComparisons, saveComparisons, updateComparison } from "./store";
import { syncComparisonToServer } from "./sync";

function restore(projectId: string, id: string, snap: Comparison | undefined): void {
  const list = loadComparisons(projectId);
  const current = list.find((c) => c.id === id);
  if (!snap) {
    if (current) deleteComparison(projectId, id);
    return;
  }
  if (current) {
    updateComparison(projectId, id, () => ({ ...snap, serverId: current.serverId }));
    return;
  }
  const revived: Comparison = { ...snap, serverId: undefined };
  saveComparisons(projectId, [...list, revived]);
  syncComparisonToServer(projectId, revived);
}

/** `track(label, comparisonId, mutate)`: run `mutate` and record it as one undo step. */
export function useComparisonUndo(projectId: string | undefined): (label: string, comparisonId: string, mutate: () => void) => void {
  const pushUndo = usePushUndo();
  return useCallback(
    (label, comparisonId, mutate) => {
      if (!projectId) {
        mutate();
        return;
      }
      const find = () => loadComparisons(projectId).find((c) => c.id === comparisonId);
      const before = find();
      mutate();
      const after = find();
      const strip = (c: Comparison | undefined) => (c ? JSON.stringify({ ...c, serverId: undefined }) : "");
      if (strip(before) === strip(after)) return;
      pushUndo({
        label,
        undo: () => restore(projectId, comparisonId, before),
        redo: () => restore(projectId, comparisonId, after),
      });
    },
    [projectId, pushUndo],
  );
}
