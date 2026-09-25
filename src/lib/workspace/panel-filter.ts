/**
 * Card search and hide patterns (pure).
 *
 * A query is a case-insensitive regular expression matched anywhere in a
 * card's name (`val\.` finds `val.loss`). A query that is not a valid regex
 * is matched as plain text instead, so typing `loss(` never blanks the page;
 * `error` says why.
 */

export interface PanelFilter {
  /** The trimmed query; empty matches everything. */
  query: string;
  test: (name: string) => boolean;
  /** Why the query is not a regex (it then matches as plain text). */
  error: string | null;
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function compilePanelFilter(query: string): PanelFilter {
  const q = query.trim();
  if (!q) return { query: q, test: () => true, error: null };
  try {
    const re = new RegExp(q, "i");
    return { query: q, test: (name) => re.test(name), error: null };
  } catch (e) {
    const re = new RegExp(escapeRegex(q), "i");
    return { query: q, test: (name) => re.test(name), error: (e as Error).message };
  }
}

/** Whether `name` is hidden by any of the (panel-filter syntax) patterns. */
export function matchesAnyPattern(name: string, patterns: readonly string[]): boolean {
  return patterns.some((p) => {
    const f = compilePanelFilter(p);
    return f.query !== "" && f.test(name);
  });
}

/**
 * The items that stay visible: not explicitly hidden, not matching a hide
 * pattern, and matching the search query.
 */
export function filterPanels<T>(
  items: readonly T[],
  nameOf: (item: T) => string,
  opts: { query?: string; hidePatterns?: readonly string[]; hidden?: ReadonlySet<string>; keyOf?: (item: T) => string },
): T[] {
  const search = compilePanelFilter(opts.query ?? "");
  const hide = (opts.hidePatterns ?? []).map(compilePanelFilter).filter((f) => f.query !== "");
  return items.filter((item) => {
    const name = nameOf(item);
    if (opts.hidden?.has(opts.keyOf ? opts.keyOf(item) : name)) return false;
    if (hide.some((f) => f.test(name))) return false;
    return search.test(name);
  });
}
