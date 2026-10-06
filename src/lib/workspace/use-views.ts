/**
 * A project's workspace views for components (lib/workspace/views.ts): the
 * list (oldest first, each with its layout), the current view (the run
 * page's, kept on the server) and the list's edits. Switching is
 * navigation: it records no undo entry.
 *
 * Listed layouts seed the workspace store (`seedWorkspace`) so a view
 * switched to paints at once; a view's latest layout is the store's copy,
 * which carries this tab's unsaved edits.
 */

import { useCallback, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { qk } from "../../api/query-keys";
import type { WorkspaceViews } from "../../api/types";
import { normalizeWorkspace, type WorkspaceDoc, type WorkspaceLayout } from "./doc";
import { refKey, viewRef } from "./ref";
import { dropWorkspace, getWorkspace, seedWorkspace, workspaceState } from "./store";
import { layoutPayload, viewAfterDelete, withAdded, withCurrent, withRemoved, withRenamed } from "./views";

export interface UseViews {
  data: WorkspaceViews | undefined;
  /** The latest layout of a listed view (this tab's unsaved edits included). */
  docOf: (id: string) => WorkspaceDoc;
  switchTo: (id: string) => Promise<void>;
  /** A new view, last in the list; returns its id. */
  create: (name: string, layout: WorkspaceLayout) => Promise<string>;
  rename: (id: string, name: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

export function useViews(projectId: string | null): UseViews {
  const qc = useQueryClient();
  const pid = projectId ?? "";
  const q = useQuery({ queryKey: qk.views(pid), queryFn: () => api.views(pid), enabled: !!projectId });

  useEffect(() => {
    for (const v of q.data?.views ?? []) seedWorkspace(refKey(viewRef(pid, v.id)), v.rev, v.payload);
  }, [q.data, pid]);

  const set = useCallback(
    (fn: (list: WorkspaceViews) => WorkspaceViews) =>
      qc.setQueryData<WorkspaceViews>(qk.views(pid), (old) => (old ? fn(old) : old)),
    [qc, pid],
  );
  const refetch = useCallback(() => qc.invalidateQueries({ queryKey: qk.views(pid) }), [qc, pid]);

  const docOf = useCallback(
    (id: string): WorkspaceDoc => {
      const k = refKey(viewRef(pid, id));
      const listed = q.data?.views.find((v) => v.id === id);
      return listed && listed.rev > workspaceState(k).rev ? normalizeWorkspace(listed.payload) : getWorkspace(k);
    },
    [pid, q.data],
  );

  const switchTo = useCallback(
    async (id: string) => {
      set((l) => withCurrent(l, id));
      try {
        await api.setCurrentView(pid, id);
      } finally {
        await refetch();
      }
    },
    [pid, set, refetch],
  );

  const create = useCallback(
    async (name: string, layout: WorkspaceLayout) => {
      const payload = layoutPayload(layout);
      const res = await api.createView(pid, name, payload);
      set((l) =>
        withAdded(l, { id: res.id, name: res.name, rev: res.rev, created_at: res.created_at, updated_at: res.created_at, payload }),
      );
      seedWorkspace(refKey(viewRef(pid, res.id)), res.rev, payload);
      await refetch();
      return res.id;
    },
    [pid, set, refetch],
  );

  const rename = useCallback(
    async (id: string, name: string) => {
      set((l) => withRenamed(l, id, name));
      try {
        await api.renameView(pid, id, name);
      } finally {
        await refetch();
      }
    },
    [pid, set, refetch],
  );

  const remove = useCallback(
    async (id: string) => {
      const list = qc.getQueryData<WorkspaceViews>(qk.views(pid));
      if (!list || list.views.length < 2) return;
      // The current view goes: switch to the first remaining one first.
      if (list.current === id) {
        const next = viewAfterDelete(list.views, id);
        if (next) await switchTo(next);
      }
      set((l) => withRemoved(l, id));
      try {
        await api.deleteView(pid, id);
        dropWorkspace(refKey(viewRef(pid, id)));
      } finally {
        await refetch();
      }
    },
    [qc, pid, set, switchTo, refetch],
  );

  return useMemo(
    () => ({ data: q.data, docOf, switchTo, create, rename, remove }),
    [q.data, docOf, switchTo, create, rename, remove],
  );
}
