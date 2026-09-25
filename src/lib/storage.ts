/**
 * Central registry of every `cairn:*` web-storage key used by the UI.
 *
 * Centralizing key construction here means renaming or adding a storage key
 * only ever touches this file, and prevents typo drift between call sites
 * that must agree on the same key (e.g. card-overrides keys are built both
 * in `card-settings.ts` and, for `compare:`/`report:`-scoped pseudo runs, in
 * `comparisons.ts`/`reports.ts`).
 *
 * Changing a key's shape orphans whatever is already stored under it.
 */

export const storageKeys = {
  /** A card's settings overrides (see lib/card-settings.ts). */
  cardOverrides: (runId: string, metricName: string) =>
    `cairn:card-overrides:${runId}:${metricName}`,
  runLayout: (runId: string) => `cairn:run-layout:${runId}`,
  collapsedSections: (scope: string) => `cairn:collapsed-sections:${scope}`,
  comparisons: (projectId: string) => `cairn:comparisons:${projectId}`,
  /** The project workspace document's last server-confirmed copy — see lib/workspace/store.ts. */
  workspace: (projectId: string) => `cairn:workspace:${projectId}`,
  /** The runs table's filter chips and group-by — see lib/run-filter.ts. */
  runsFilter: (projectId: string) => `cairn:runs-filter:${projectId}`,
  /** The project's run view (hidden, pinned, baseline) — see lib/run-view-store.ts. */
  runView: (projectId: string) => `cairn:run-view:${projectId}`,
  comparisonTemplates: (projectId: string) => `cairn:comparison-templates:${projectId}`,
  reportTemplates: (projectId: string) => `cairn:report-templates:${projectId}`,
  /** Newest alert created_at the user has seen in the bell — see lib/alerts.ts. */
  alertsSeen: (projectId: string) => `cairn:alerts-seen:${projectId}`,
  streamMode: "cairn:stream-mode",
  scroll: (key: string) => `cairn:scroll:${key}`, // sessionStorage
  lastComparison: (projectId: string) => `cairn:last-comparison:${projectId}`, // sessionStorage
  // --- media (wave 2, agent C) ---
  /** A section's media sync value and key — see components/card-kit/media-sync.tsx. */
  mediaSync: (scopeKey: string) => `cairn:media-sync:${scopeKey}`,
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

// ---------------------------------------------------------------------------
// Run-scoped key garbage collection.
// ---------------------------------------------------------------------------

/** Prefixes of localStorage keys that are scoped to a runId. */
const RUN_SCOPED_PREFIXES = [
  "cairn:card-overrides:",
  "cairn:run-layout:",
  "cairn:collapsed-sections:",
] as const;

/** Pseudo-run id prefixes that are never real runs — see compareRunId/reportRunId. */
const PSEUDO_SCOPE_PREFIXES = ["compare:", "report:"] as const;

/**
 * Extract the runId segment from a run-scoped key given its prefix.
 *
 * Returns `null` when the key doesn't start with `prefix`, or when the
 * segment is a `compare:`/`report:`-prefixed pseudo-run id — comparisons and
 * reports are not runs and their card settings must never be swept by run-id
 * membership checks.
 */
function extractRunScopedId(key: string, prefix: string): string | null {
  if (!key.startsWith(prefix)) return null;
  const rest = key.slice(prefix.length);
  if (PSEUDO_SCOPE_PREFIXES.some((p) => rest.startsWith(p))) return null;
  const sep = rest.indexOf(":");
  return sep === -1 ? rest : rest.slice(0, sep);
}

/** Remove every run-scoped localStorage key whose runId satisfies `shouldRemove`. */
function gcByPredicate(shouldRemove: (runId: string) => boolean): void {
  const toRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key) continue;
    for (const prefix of RUN_SCOPED_PREFIXES) {
      const runId = extractRunScopedId(key, prefix);
      if (runId !== null) {
        if (shouldRemove(runId)) toRemove.push(key);
        break;
      }
    }
  }
  for (const key of toRemove) localStorage.removeItem(key);
}

/**
 * Remove per-run keys (card-overrides/run-layout/collapsed-sections) for runs
 * in `deletedRunIds`. `compare:`/`report:`-scoped pseudo-run ids are never
 * touched.
 *
 * Safe to call with a partial view of the run set (e.g. from a paginated
 * table), since it only ever removes keys for ids explicitly known to have
 * been deleted.
 */
export function gcDeletedRunKeys(deletedRunIds: Set<string>): void {
  gcByPredicate((runId) => deletedRunIds.has(runId));
}
