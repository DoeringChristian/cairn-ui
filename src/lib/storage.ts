/**
 * Central registry of every `cairn:*` web-storage key used by the UI.
 *
 * Centralizing key construction here means renaming or adding a storage key
 * only ever touches this file, and prevents typo drift between call sites
 * that must agree on the same key.
 *
 * Changing a key's shape orphans whatever is already stored under it.
 */

export const storageKeys = {
  /**
   * A report cell's / embed's card settings overrides, its localStorage
   * working copy (see lib/card-settings.ts). Workspace panels keep theirs in
   * the workspace document instead.
   */
  cardOverrides: (scope: string, cardId: string) =>
    `cairn:card-overrides:${scope}:${cardId}`,
  /** A workspace document's last server-confirmed copy (`refKey`) — see lib/workspace/store.ts. */
  workspace: (key: string) => `cairn:workspace:${key}`,
  /** The runs table's filter chips and group-by — see lib/run-filter.ts. */
  /** The project's run view (hidden, pinned, baseline) — see lib/run-view-store.ts. */
  runView: (projectId: string) => `cairn:run-view:${projectId}`,
  reportTemplates: (projectId: string) => `cairn:report-templates:${projectId}`,
  /** Newest alert created_at the user has seen in the bell — see lib/alerts.ts. */
  alertsSeen: (projectId: string) => `cairn:alerts-seen:${projectId}`,
  streamMode: "cairn:stream-mode",
  scroll: (key: string) => `cairn:scroll:${key}`, // sessionStorage
  /** The workspace sidebar's toggled (collapsed / expanded) groups — see components/runs-table/use-runs-table.ts. */
  // --- media (wave 2, agent C) ---
  /** A section's media sync value and key — see components/card-kit/media-sync.tsx. */
  mediaSync: (scopeKey: string) => `cairn:media-sync:${scopeKey}`,
  // --- reports (wave 3, agent H) ---
  /** A report's collapsed headings (slugs), per browser — see components/reports/ReportNotebook.tsx. */
  reportCollapsed: (reportId: string) => `cairn:report-collapsed:${reportId}`,
} as const;

/** Parse JSON from a `Storage` (localStorage/sessionStorage), swallowing errors. */
export function loadJson<T>(storage: Storage, key: string): T | null {
  try {
    const raw = storage.getItem(key);
    if (raw == null) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** Serialize a value to a `Storage`, swallowing quota/disabled-storage errors. */
export function saveJson(storage: Storage, key: string, value: unknown): void {
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota exceeded or disabled storage; silently drop */
  }
}
