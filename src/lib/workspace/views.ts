/**
 * Workspace views (pure): a project's list of named layouts. The run page
 * always shows one of them, the project's current view (kept on the server,
 * so the same on every browser), and every edit there is saved into it.
 * Switching views is navigation, not an edit. A comparison keeps its own
 * layout: picking a view there copies that view's layout in (an undoable
 * edit), and "+ New view" saves the comparison's layout as a new view.
 *
 * The list is in creation order (oldest first) and never empty: the server
 * refuses to delete the last view.
 */

import type { WorkspaceViewDoc, WorkspaceViews } from "../../api/types.ts";
import { EMPTY_WORKSPACE, layoutOf, normalizeWorkspace, type WorkspaceDoc, type WorkspaceLayout } from "./doc.ts";

/** A view's layout from its stored payload (null: a first view not stored yet). */
export function viewLayout(payload: unknown): WorkspaceLayout {
  return layoutOf(normalizeWorkspace(payload));
}

/** What a view stores: the layout of `doc` (a comparison's runs are not part of it). */
export function layoutPayload(doc: WorkspaceDoc | WorkspaceLayout): Record<string, unknown> {
  return layoutOf({ ...doc, runs: null }) as unknown as Record<string, unknown>;
}

/** "Empty (automatic panels only)": a new view's layout with nothing listed. */
export const EMPTY_VIEW_LAYOUT: WorkspaceLayout = layoutOf(EMPTY_WORKSPACE);

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
