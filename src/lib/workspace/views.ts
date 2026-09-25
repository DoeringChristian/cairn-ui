/**
 * Saved views (pure): a named copy of the workspace document (minus its
 * version) and, from the run page, the run's card layout. Applying one
 * replaces the workspace document and, on a run page, that run's layout.
 */

import { normalizeRunLayout, type RunLayout } from "../run-layout.ts";
import { normalizeWorkspace, type WorkspaceDoc } from "./doc.ts";

export interface SavedViewPayload {
  workspace: Omit<WorkspaceDoc, "version">;
  runLayout?: RunLayout;
}

export function viewPayload(doc: WorkspaceDoc, runLayout?: RunLayout): SavedViewPayload {
  const { version: _version, ...workspace } = doc;
  return runLayout ? { workspace, runLayout } : { workspace };
}

export function parseViewPayload(raw: unknown): { workspace: WorkspaceDoc; runLayout: RunLayout | null } {
  const p = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    workspace: normalizeWorkspace(p.workspace),
    runLayout: p.runLayout != null ? normalizeRunLayout(p.runLayout) : null,
  };
}
