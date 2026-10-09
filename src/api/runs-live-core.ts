/**
 * Pure core of the runs list's live poll — no React, no react-query.
 *
 * The runs table loads its runs in pages (an infinite query: 100, then 500). While
 * some of them are running, their values, stats and status must stay live.
 * Refetching every loaded page for that would re-read every run on screen
 * every few seconds, finished runs included. Instead each tick asks for:
 *
 * - `head`: the list's first run and total (`limit=1`), to notice a run
 *   created or deleted since the pages were loaded. Pages are offset-based,
 *   so either shifts every page after it; only then are all pages refetched.
 * - `live`: exactly the running runs (`ids=`), with the same `include=`,
 *   whose rows replace the cached ones.
 *
 * Testable under `node --test` (`runs-live.test.ts`).
 */

import type { Run, RunsListResponse } from "./types";

/** More running runs than this on screen: refetch the pages instead (the
 * `ids=` list would make an unwieldy URL). */
export const MAX_LIVE_IDS = 200;

/** The shape react-query keeps for an infinite query. */
export interface RunsPages {
  pages: RunsListResponse[];
  pageParams: unknown[];
}

/** Ids of the loaded runs that are still running, in list order. */
export function runningIds(pages: readonly RunsListResponse[] | undefined): string[] {
  if (!pages) return [];
  const ids: string[] = [];
  for (const page of pages) {
    for (const r of page.runs) if (r.status === "running") ids.push(r.id);
  }
  return ids;
}

/**
 * Merge a poll into the cached pages.
 *
 * Returns the new pages (row objects of runs not in `live` are kept as-is,
 * so their renders stay memoized), or `null` when the pages themselves are
 * stale and must be refetched: the list's head or total changed, or a polled
 * run vanished (deleted, or no longer matching the list's filters).
 */
export function mergeLiveRuns(
  data: RunsPages,
  head: RunsListResponse,
  live: RunsListResponse,
  polled: readonly string[],
): RunsPages | null {
  const first = data.pages[0];
  if (!first) return null;
  if (head.total !== first.total) return null;
  if ((head.runs[0]?.id ?? null) !== (first.runs[0]?.id ?? null)) return null;

  const byId = new Map<string, Run>(live.runs.map((r) => [r.id, r]));
  if (polled.some((id) => !byId.has(id))) return null;

  let changed = false;
  const pages = data.pages.map((page) => {
    let pageChanged = false;
    const runs = page.runs.map((r) => {
      const fresh = byId.get(r.id);
      if (!fresh) return r;
      pageChanged = true;
      return fresh;
    });
    if (!pageChanged) return page;
    changed = true;
    return { ...page, runs };
  });
  return changed ? { ...data, pages } : data;
}
