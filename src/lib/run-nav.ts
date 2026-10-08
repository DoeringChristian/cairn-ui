/**
 * Run navigation as wandb's (pure): the run page opens on its Workspace tab
 * (`/p/<project>/r/<run>`, every link to a run lands there). A run opened
 * from the project workspace's runs sidebar carries `FROM_WORKSPACE` as its
 * history state, and its header then shows a "← Workspace" link back to the
 * workspace; the run page's own tabs pass the state on.
 */

/** The history state of a run opened from the workspace's runs sidebar. */
export const FROM_WORKSPACE = Object.freeze({ from: "workspace" }) as { readonly from: "workspace" };

/** Whether a location's history state is a run opened from the workspace. */
export function cameFromWorkspace(state: unknown): boolean {
  return state != null && typeof state === "object" && (state as { from?: unknown }).from === "workspace";
}

/** The project workspace. */
export const workspacePath = (projectId: string) => `/p/${projectId}/workspace`;

/**
 * Which groups the runs table toggled away from their default (collapsed or
 * expanded), as kept for a page (the workspace sidebar keeps them for the
 * session): only while the group-by they were toggled under is unchanged.
 */
export function restoredToggles(stored: unknown, groupByKey: string): Set<string> {
  if (stored == null || typeof stored !== "object") return new Set();
  const s = stored as { groupBy?: unknown; toggled?: unknown };
  if (s.groupBy !== groupByKey || !Array.isArray(s.toggled)) return new Set();
  return new Set(s.toggled.filter((t): t is string => typeof t === "string"));
}
