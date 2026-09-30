/**
 * Which workspace a view edits: the project workspace (the run page) or one
 * comparison. Both are the same document type behind the same store, sync
 * and undo; they differ only in where the server keeps them.
 */

import { createContext, useContext } from "react";

export type WorkspaceRef =
  | { kind: "project"; projectId: string }
  | { kind: "comparison"; projectId: string; id: string };

/** The store key: `project:<pid>` or `comparison:<pid>:<id>`. */
export function refKey(ref: WorkspaceRef): string {
  return ref.kind === "project" ? `project:${ref.projectId}` : `comparison:${ref.projectId}:${ref.id}`;
}

/** The server URL of a workspace document. */
export function refUrl(ref: WorkspaceRef): string {
  return ref.kind === "project"
    ? `/api/projects/${ref.projectId}/workspace`
    : `/api/projects/${ref.projectId}/comparisons/${ref.id}`;
}

export const projectRef = (projectId: string): WorkspaceRef => ({ kind: "project", projectId });

/**
 * The workspace the enclosing view renders; section headers, the toolbar and
 * the defaults editor edit this one. Null outside a workspace view.
 */
export const WorkspaceRefContext = createContext<WorkspaceRef | null>(null);

export function useWorkspaceRef(): WorkspaceRef | null {
  return useContext(WorkspaceRefContext);
}
