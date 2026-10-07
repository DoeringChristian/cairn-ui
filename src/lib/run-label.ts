/**
 * Shared run label formatting.
 *
 * Displays run name + version (or timestamp) instead of raw hash IDs.
 * Falls back to short hash when no metadata is available.
 *
 * The cache is a module-global Map. Components that depend on label output
 * should include `runMetadataVersion` (from `useRunMetadataVersion()`) in
 * their useMemo deps so they recompute when the cache is populated.
 */

import { useSyncExternalStore } from "react";
import type { Run } from "../api/types";

/** Map of runId → Run for label lookup. */
let runMetadataCache = new Map<string, Run>();

/** Monotonic version counter — bumped on every cache mutation. */
let _version = 0;
const _listeners = new Set<() => void>();

function _notify() {
  _version++;
  for (const l of _listeners) l();
}

/** Subscribe to cache changes (for useSyncExternalStore). */
function _subscribe(cb: () => void) {
  _listeners.add(cb);
  return () => { _listeners.delete(cb); };
}

function _getVersion() { return _version; }

/** The cached run row, if any (see `useRunMetadataVersion`). */
export function getRunMetadata(runId: string): Run | undefined {
  return runMetadataCache.get(runId);
}

/**
 * React hook: returns a version number that increments whenever the run
 * metadata cache changes. Include this in useMemo deps to recompute labels.
 */
export function useRunMetadataVersion(): number {
  return useSyncExternalStore(_subscribe, _getVersion, _getVersion);
}

/** Shallow field comparison — Run is a flat record of primitives. */
function _runEquals(a: Run, b: Run): boolean {
  if (a === b) return true;
  const keys = Object.keys(a) as Array<keyof Run>;
  for (const k of keys) {
    if (a[k] !== b[k]) return false;
  }
  return true;
}

/**
 * Seed the cache with a batch of runs. Callers (e.g. api hooks) may call
 * this on every fetch/poll — writes and version bumps only happen for runs
 * that are new or whose fields actually changed, so polling with unchanged
 * data does not re-render `useRunMetadataVersion` subscribers.
 */
export function setRunMetadata(runs: Run[]): void {
  let changed = false;
  for (const r of runs) {
    const existing = runMetadataCache.get(r.id);
    if (!existing || !_runEquals(existing, r)) {
      runMetadataCache.set(r.id, r);
      changed = true;
    }
  }
  if (changed) _notify();
}

export function addRunMetadata(run: Run): void {
  const existing = runMetadataCache.get(run.id);
  if (existing && _runEquals(existing, run)) return;
  runMetadataCache.set(run.id, run);
  _notify();
}

/** The 6-character id prefix shown when a run has no display name. */
export function shortRunId(runId: string): string {
  return runId.slice(0, 6);
}

/**
 * Generate minimal disambiguating labels for a set of runs.
 *
 * Returns a map of `runId → label` where each label is the shortest form
 * that uniquely identifies the run within the input set. The strategy
 * (per group of runs sharing a name):
 *
 *   1. Just the name        — when the name is unique across the input.
 *   2. `name v<version>`    — when ≥2 runs share a name: the run's
 *                             server-assigned number in its series.
 *   3. `name v<n> · <group>` — when `name v<n>` still collides (the same
 *                             name and number in different groups).
 *   4. Runs lacking a version (unnamed, or no metadata) fall back to the
 *      time: `name HH:MM:SS` (all on one day), `name MMM dd HH:MM:SS`
 *      (across days), `name … (abc123)` when even that collides, and
 *      `abc123` (6-char hash) when no metadata is available.
 *
 * Each name-group is independent: singleton groups always get the bare name,
 * even if other groups need versions.
 */
export function disambiguateRunLabels(runIds: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  if (runIds.length === 0) return result;

  // Resolve metadata for each run (use cached fallback for unknowns).
  type Resolved = {
    runId: string;
    name: string;
    date: Date | null;
    version: number | null;
    group: string | null;
  };
  const resolved: Resolved[] = runIds.map((runId) => {
    const run = runMetadataCache.get(runId);
    if (!run) {
      return { runId, name: shortRunId(runId), date: null, version: null, group: null };
    }
    let date: Date | null = null;
    try {
      const d = new Date(run.created_at);
      if (!Number.isNaN(d.getTime())) date = d;
    } catch { /* keep null */ }
    return {
      runId,
      name: run.display_name ?? shortRunId(runId),
      date,
      version: run.version ?? null,
      group: run.group ?? null,
    };
  });

  // Group by name.
  const byName = new Map<string, Resolved[]>();
  for (const r of resolved) {
    const arr = byName.get(r.name) ?? [];
    arr.push(r);
    byName.set(r.name, arr);
  }

  for (const [name, group] of byName) {
    if (group.length === 1) {
      result[group[0]!.runId] = name;
      continue;
    }
    Object.assign(
      result,
      versionLabels(name, group.filter((r) => r.version != null)),
      timeLabels(name, group.filter((r) => r.version == null)),
    );
  }

  return result;
}

/** Rules 2–3: `name v<n>`, then `name v<n> · <group>` where that collides. */
function versionLabels(
  name: string,
  runs: Array<{ runId: string; version: number | null; group: string | null }>,
): Record<string, string> {
  const out: Record<string, string> = {};
  const count = new Map<string, number>();
  for (const r of runs) {
    const label = `${name} v${r.version}`;
    out[r.runId] = label;
    count.set(label, (count.get(label) ?? 0) + 1);
  }
  for (const r of runs) {
    if (count.get(out[r.runId]!)! > 1 && r.group != null) {
      out[r.runId] = `${out[r.runId]} · ${r.group}`;
    }
  }
  return withHashOnCollision(runs, out);
}

/** Rule 4: the run's time, with the date when the runs span days. */
function timeLabels(
  name: string,
  runs: Array<{ runId: string; date: Date | null }>,
): Record<string, string> {
  const out: Record<string, string> = {};
  // Determine if the runs span multiple days (need date prefix).
  const dayKeys = new Set(runs.map((r) => (r.date ? r.date.toDateString() : "")));
  const spansDays = dayKeys.size > 1;
  for (const r of runs) {
    if (r.date) {
      const ts = r.date.toLocaleTimeString(undefined, {
        hour: "2-digit", minute: "2-digit", second: "2-digit",
      });
      if (spansDays) {
        const date = r.date.toLocaleDateString(undefined, {
          month: "short", day: "numeric",
        });
        out[r.runId] = `${name} ${date} ${ts}`;
      } else {
        out[r.runId] = `${name} ${ts}`;
      }
    } else {
      // No date metadata at all — fall back to hash suffix.
      out[r.runId] = `${name} (${shortRunId(r.runId)})`;
    }
  }
  return withHashOnCollision(runs, out);
}

/** Labels that still collide get the run's short id appended. */
function withHashOnCollision(
  runs: Array<{ runId: string }>,
  labels: Record<string, string>,
): Record<string, string> {
  const seen = new Set<string>();
  let hasCollision = false;
  for (const r of runs) {
    if (seen.has(labels[r.runId]!)) hasCollision = true;
    seen.add(labels[r.runId]!);
  }
  if (!hasCollision) return labels;
  const out: Record<string, string> = {};
  for (const r of runs) out[r.runId] = `${labels[r.runId]} (${shortRunId(r.runId)})`;
  return out;
}

/**
 * Short format: name, with timestamp only when needed for disambiguation.
 *
 * Pass `siblingRunIds` (other run IDs shown alongside this one) to enable
 * smart disambiguation. Returns the shortest unique label per the rules
 * documented in :func:`disambiguateRunLabels`.
 */
export function shortRunLabel(runId: string, siblingRunIds?: string[]): string {
  if (!siblingRunIds || siblingRunIds.length === 0) {
    return runName(runId);
  }
  const ids = siblingRunIds.includes(runId) ? siblingRunIds : [...siblingRunIds, runId];
  const labels = disambiguateRunLabels(ids);
  return labels[runId] ?? runName(runId);
}

/**
 * Just the name, no timestamp.
 */
export function runName(runId: string): string {
  const run = runMetadataCache.get(runId);
  return run?.display_name ?? shortRunId(runId);
}
