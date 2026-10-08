/**
 * Which listed entries (groups and ungrouped names with Group by group,
 * runs with Group by none) are visible (pure). An explicit eye wins;
 * otherwise the `DEFAULT_VISIBLE` newest entries are visible and the rest
 * hidden, so a new run shows up on its own while old ones drop out.
 */

/** How many of the newest entries are visible by default. */
export const DEFAULT_VISIBLE = 10;

export interface Ranked {
  key: string;
  /** The entry's newest run (ISO time). */
  newest: string;
}

/** The visible keys among `entries`. */
export function visibleKeys(entries: readonly Ranked[], eyes: Readonly<Record<string, boolean>>): Set<string> {
  const ranked = [...entries].sort((a, b) => b.newest.localeCompare(a.newest) || (a.key < b.key ? -1 : 1));
  const out = new Set<string>();
  ranked.forEach((e, rank) => {
    const explicit = eyes[e.key];
    if (explicit ?? rank < DEFAULT_VISIBLE) out.add(e.key);
  });
  return out;
}
