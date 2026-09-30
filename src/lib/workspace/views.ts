/**
 * Saved views (pure): a named snapshot of a workspace's layout (the document
 * minus its run set). A view applies to either kind of workspace — the
 * project workspace or a comparison — replacing its layout and keeping its
 * runs.
 */

import { layoutOf, normalizeWorkspace, type WorkspaceDoc, type WorkspaceLayout } from "./doc.ts";

export interface SavedViewPayload {
  layout: WorkspaceLayout;
}

export function viewPayload(doc: WorkspaceDoc): SavedViewPayload {
  return { layout: layoutOf(doc) };
}

export function parseViewPayload(raw: unknown): WorkspaceLayout {
  const p = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return layoutOf(normalizeWorkspace(p.layout));
}
