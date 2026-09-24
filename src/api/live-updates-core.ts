/**
 * Pure core of the live-updates poller — no React, no react-query.
 *
 * Re-downloading each card's whole sequence on an interval would be dozens
 * of megabytes a minute on a compare page over a running run. Instead the app
 * polls ONE cursor-based endpoint per live run (`GET /api/runs/{id}/updates?since=<cursor>`) and appends the delta into
 * the sequences react-query already holds.
 *
 * Everything here is a pure function or the module-level cursor map, so it is
 * testable under `node --test` (`live-updates.test.ts`); the React glue lives
 * in `live-updates.tsx`.
 */

import type { SequencePoint, UpdatePoint } from "./types";

/** How many `more` pages one run may drain in a single poll cycle. */
export const MAX_PAGES_PER_CYCLE = 20;

// ---------------------------------------------------------------------------
// Cursor map — app-wide, keyed by run id, surviving route changes.
// ---------------------------------------------------------------------------

const cursorByRun = new Map<string, number>();

/**
 * Seed a run's cursor from a full sequence response.
 *
 * Only the FIRST sighting counts. A sequence fetched later returns the max
 * rowid of *its own* series, which can sit ahead of the poller's cursor —
 * adopting it would skip rows belonging to other, already-cached series. The
 * poller owns the cursor from then on; the worst case of an early seed is one
 * catch-up poll whose already-known points dedupe away.
 */
export function seedRunCursor(runId: string, cursor: number): void {
  if (!runId || !Number.isFinite(cursor)) return;
  if (!cursorByRun.has(runId)) cursorByRun.set(runId, cursor);
}

/** The cursor to resume from, or undefined when the run has never been read. */
export function getRunCursor(runId: string): number | undefined {
  return cursorByRun.get(runId);
}

/** Advance a run's cursor (monotonic — a stale response can never rewind it). */
export function setRunCursor(runId: string, cursor: number): void {
  const current = cursorByRun.get(runId);
  if (current === undefined || cursor > current) cursorByRun.set(runId, cursor);
}

/**
 * Forget a run's cursor. `setRunCursor` only moves forward, but a rewound run
 * reuses rowids below the old cursor, so after a data-epoch change the cursor
 * is dropped outright; the refetched sequences seed a fresh one.
 */
export function resetRunCursor(runId: string): void {
  cursorByRun.delete(runId);
}

// ---------------------------------------------------------------------------
// Data epoch — bumped server-side when a run's history is rewritten (rewind).
// ---------------------------------------------------------------------------

const epochByRun = new Map<string, number>();

/** Record the epoch a full sequence read was made in (first sighting only,
 * like `seedRunCursor`). */
export function seedRunEpoch(runId: string, epoch: number | undefined): void {
  if (!runId || typeof epoch !== "number") return;
  if (!epochByRun.has(runId)) epochByRun.set(runId, epoch);
}

/**
 * Fold the epoch an `/updates` response reports. True when it differs from
 * the one the cached points and cursor belong to: the caller must reset the
 * run's cursor and refetch its sequences, because points were deleted and
 * their rowids may be reused.
 */
export function noteRunEpoch(runId: string, epoch: number | undefined): boolean {
  if (typeof epoch !== "number") return false;
  const prev = epochByRun.get(runId);
  epochByRun.set(runId, epoch);
  return prev !== undefined && prev !== epoch;
}

/** Test-only: drop all cursors and epochs. */
export function resetRunCursors(): void {
  cursorByRun.clear();
  epochByRun.clear();
}

// ---------------------------------------------------------------------------
// Cursor advancement
// ---------------------------------------------------------------------------

export interface CursorStep {
  cursor: number;
  /** True when the server had no more rows — stop paging this cycle. */
  done: boolean;
}

/**
 * Fold one `/updates` response into the run's cursor. `more` means the
 * server's LIMIT was hit and another page should be pulled immediately.
 */
export function advanceCursor(
  since: number,
  res: { cursor: number; more?: boolean },
): CursorStep {
  const cursor = Number.isFinite(res.cursor) && res.cursor > since ? res.cursor : since;
  return { cursor, done: !res.more };
}

// ---------------------------------------------------------------------------
// Run selection
// ---------------------------------------------------------------------------

export interface RunCandidate {
  runId: string;
  /** At least one mounted component is observing a sequence of this run. */
  hasActiveSequenceObserver: boolean;
  /** Latest known run status; null/undefined when nothing has told us yet. */
  status: string | null | undefined;
  /** Resume cursor, or undefined when no sequence of this run was ever read. */
  cursor: number | undefined;
}

/**
 * Poll a run only when something on screen is showing its sequences, it is
 * (or might still be) running, and we know where to resume from. An unknown
 * status counts as live: the run detail query may simply not have landed yet,
 * and the first `/updates` response tells us the truth.
 */
export function shouldPollRun(c: RunCandidate): boolean {
  if (!c.runId) return false;
  if (!c.hasActiveSequenceObserver) return false;
  if (c.cursor === undefined) return false;
  return c.status == null || c.status === "running";
}

export function selectRunsToPoll(candidates: readonly RunCandidate[]): string[] {
  return candidates.filter(shouldPollRun).map((c) => c.runId);
}

// ---------------------------------------------------------------------------
// Query-key routing
// ---------------------------------------------------------------------------

/**
 * The series a cached `["sequence", runId, name]` query key belongs to, if
 * any: its name. A key with any extra slot is not a plain sequence read and
 * is left alone.
 */
export function seriesKeyOfQueryKey(queryKey: readonly unknown[]): string | null {
  if (queryKey.length !== 3) return null;
  const name = queryKey[2];
  return typeof name === "string" ? name : null;
}

/** Group a `/updates` payload by the series (name) each point belongs to. */
export function groupPointsBySeries(
  points: readonly UpdatePoint[],
): Map<string, UpdatePoint[]> {
  const out = new Map<string, UpdatePoint[]>();
  for (const p of points) {
    const bucket = out.get(p.name);
    if (bucket) bucket.push(p);
    else out.set(p.name, [p]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Point merging
// ---------------------------------------------------------------------------

/** Drop the routing fields so a cached point keeps the sequence-endpoint shape. */
function toSequencePoint(p: UpdatePoint): SequencePoint {
  const { name: _name, ...point } = p;
  return point;
}

/**
 * Append `incoming` to `points`, deduped by step and kept sorted by step.
 * Returns `points` UNCHANGED (same reference) when the point is already
 * there, so callers can skip a cache write and the re-render it would cause.
 *
 * Within one cached sequence the name is fixed by the query key, so step is
 * exactly the server's (run, name, step) key restricted to that series.
 */
export function appendDedup(
  points: readonly SequencePoint[],
  incoming: UpdatePoint | SequencePoint,
): SequencePoint[] {
  const point = "name" in incoming
    ? toSequencePoint(incoming as UpdatePoint)
    : (incoming as SequencePoint);

  const last = points[points.length - 1];
  // The common case by far: a live run appends strictly increasing steps.
  if (last === undefined || point.step > last.step) return [...points, point];

  // Out-of-order or backfilled delta: walk back to the insertion point,
  // landing right after the last smaller step.
  let insertAt = 0;
  for (let i = points.length - 1; i >= 0; i--) {
    const p = points[i]!;
    if (p.step > point.step) continue;
    if (p.step === point.step) return points as SequencePoint[]; // already have it
    insertAt = i + 1;
    break;
  }
  const next = points.slice();
  next.splice(insertAt, 0, point);
  return next;
}

/** Fold a whole batch in, returning `points` unchanged when nothing is new. */
export function appendAllDedup(
  points: readonly SequencePoint[],
  incoming: readonly UpdatePoint[],
): SequencePoint[] {
  let out = points;
  for (const p of incoming) out = appendDedup(out, p);
  return out as SequencePoint[];
}
