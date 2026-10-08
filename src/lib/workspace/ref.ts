/**
 * Which workspace document a page edits: one of the project's workspace
 * views (the run page and the workspace page show the current one).
 */

import { createContext, useContext } from "react";

export interface WorkspaceRef {
  kind: "view";
  projectId: string;
  id: string;
}

/** The store key: `view:<pid>:<id>`. */
export function refKey(ref: WorkspaceRef): string {
  return `${ref.kind}:${ref.projectId}:${ref.id}`;
}

/** The server URL of a workspace document. */
export function refUrl(ref: WorkspaceRef): string {
  return `/api/projects/${ref.projectId}/views/${ref.id}`;
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
