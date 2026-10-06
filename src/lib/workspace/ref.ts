/**
 * Which workspace a view edits: one of the project's workspace views (the
 * run page shows the current one) or one comparison. Both are the same
 * document type behind the same store, sync and undo; they differ only in
 * where the server keeps them.
 */

import { createContext, useContext } from "react";

export type WorkspaceRef =
  | { kind: "view"; projectId: string; id: string }
  | { kind: "comparison"; projectId: string; id: string };

/** The store key: `view:<pid>:<id>` or `comparison:<pid>:<id>`. */
export function refKey(ref: WorkspaceRef): string {
  return `${ref.kind}:${ref.projectId}:${ref.id}`;
}

/** The server URL of a workspace document. */
export function refUrl(ref: WorkspaceRef): string {
  return ref.kind === "view"
    ? `/api/projects/${ref.projectId}/views/${ref.id}`
    : `/api/projects/${ref.projectId}/comparisons/${ref.id}`;
}

export const viewRef = (projectId: string, id: string): WorkspaceRef => ({ kind: "view", projectId, id });

/**
 * The workspace the enclosing view renders; section headers, the toolbar and
 * the defaults editor edit this one. Null outside a workspace view.
 */
export const WorkspaceRefContext = createContext<WorkspaceRef | null>(null);

export function useWorkspaceRef(): WorkspaceRef | null {
  return useContext(WorkspaceRefContext);
}
