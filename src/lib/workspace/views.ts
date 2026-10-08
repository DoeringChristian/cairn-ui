/**
 * Workspace views (pure): a project's list of named workspace documents
 * (layout + the workspace page's run state). The run page and the workspace
 * page always show one of them, the project's current view (kept on the
 * server, so the same on every browser), and every edit there is saved into
 * it. Switching views is navigation, not an edit.
 *
 * The list is in creation order (oldest first) and never empty: the server
 * refuses to delete the last view.
 */

import type { WorkspaceViewDoc, WorkspaceViews } from "../../api/types.ts";
import { EMPTY_WORKSPACE, type WorkspaceDoc } from "./doc.ts";

/** What a view stores: its document. */
export function viewPayload(doc: WorkspaceDoc): Record<string, unknown> {
  return doc as unknown as Record<string, unknown>;
}

/** "Empty (automatic panels only)": a new view with nothing listed and the default run state. */
export const EMPTY_VIEW: WorkspaceDoc = EMPTY_WORKSPACE;

/** The name ⧉ gives a view's copy. */
export const duplicateName = (name: string) => `${name} copy`;

/** The last view cannot be deleted. */
export const canDeleteView = (views: readonly unknown[]) => views.length > 1;

/** The view that becomes current when `deleted` goes: the first remaining one in list order. */
export function viewAfterDelete(views: readonly Pick<WorkspaceViewDoc, "id">[], deleted: string): string | null {
  return views.find((v) => v.id !== deleted)?.id ?? null;
}

/** A tile's second footer line. */
export function viewSummary(cards: number, autoPanels: boolean): string {
  return `${cards} ${cards === 1 ? "card" : "cards"} · ${autoPanels ? "unlisted on" : "listed only"}`;
}

// --- list ops (optimistic updates of the cached list) -----------------------

export function withCurrent(list: WorkspaceViews, id: string): WorkspaceViews {
  return list.current === id ? list : { ...list, current: id };
}

export function withRenamed(list: WorkspaceViews, id: string, name: string): WorkspaceViews {
  return { ...list, views: list.views.map((v) => (v.id === id ? { ...v, name } : v)) };
}

/** `view` appended (creation order); a virtual first view counts as stored now. */
export function withAdded(list: WorkspaceViews, view: WorkspaceViewDoc): WorkspaceViews {
  return { ...list, views: [...list.views, view] };
}

/** `id` removed; the current view moves to the first remaining one when it was `id`. Never empties the list. */
export function withRemoved(list: WorkspaceViews, id: string): WorkspaceViews {
  if (!canDeleteView(list.views) || !list.views.some((v) => v.id === id)) return list;
  const views = list.views.filter((v) => v.id !== id);
  return { views, current: list.current === id ? views[0]!.id : list.current };
}
