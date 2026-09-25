/**
 * The project-scoped run view (hidden, pinned, baseline) used by the runs
 * table and the run page, plus the pure edits every scope shares.
 *
 * Per browser for now: it lives in localStorage under
 * `storageKeys.runView(projectId)`, and is not part of the server workspace
 * doc. Comparisons keep theirs in `Comparison.runView`, report cells in the
 * ```cairn fence (`runs: {hidden, pinned, baseline}`).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { loadJson, saveJson, storageKeys } from "./storage.ts";
import type { RunView, RunViewContextValue } from "./run-view.tsx";

const EMPTY: RunView = { hidden: [], pinned: [], baseline: null };

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** A stored run view, anything malformed dropped. */
export function parseRunView(raw: unknown): RunView {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return EMPTY;
  const o = raw as Record<string, unknown>;
  return {
    hidden: [...new Set(strings(o.hidden))],
    pinned: [...new Set(strings(o.pinned))],
    baseline: typeof o.baseline === "string" && o.baseline ? o.baseline : null,
  };
}

export function isEmptyRunView(v: RunView): boolean {
  return v.hidden.length === 0 && v.pinned.length === 0 && v.baseline === null;
}

export function toggleRunHidden(view: RunView, runId: string): RunView {
  const hidden = view.hidden.includes(runId) ? view.hidden.filter((x) => x !== runId) : [...view.hidden, runId];
  return { ...view, hidden };
}

export function toggleRunPinned(view: RunView, runId: string): RunView {
  const pinned = view.pinned.includes(runId) ? view.pinned.filter((x) => x !== runId) : [...view.pinned, runId];
  return { ...view, pinned };
}

/** Make `runId` the baseline, or clear it when it already is. */
export function toggleRunBaseline(view: RunView, runId: string): RunView {
  return { ...view, baseline: view.baseline === runId ? null : runId };
}

/** `runIds` minus hidden runs, pinned runs first (their relative order kept). */
export function applyRunView(runIds: readonly string[], view: RunView): string[] {
  const hidden = new Set(view.hidden);
  const pinned = new Set(view.pinned);
  const shown = runIds.filter((id) => !hidden.has(id));
  return [...shown.filter((id) => pinned.has(id)), ...shown.filter((id) => !pinned.has(id))];
}

// ---------------------------------------------------------------------------
// The project store
// ---------------------------------------------------------------------------

const changed = new EventTarget();

export function loadProjectRunView(projectId: string): RunView {
  if (typeof localStorage === "undefined") return EMPTY;
  return parseRunView(loadJson<unknown>(localStorage, storageKeys.runView(projectId)));
}

export function saveProjectRunView(projectId: string, view: RunView): void {
  saveJson(localStorage, storageKeys.runView(projectId), view);
  changed.dispatchEvent(new CustomEvent("change", { detail: projectId }));
}

/**
 * The project's run view and its setter, shared by every consumer in the
 * tab (and across tabs via the storage event). Provide it with
 * `<RunViewContext.Provider value={useProjectRunView(projectId)}>`.
 */
export function useProjectRunView(projectId: string | undefined): RunViewContextValue {
  const [entry, setEntry] = useState(() => ({ projectId, view: projectId ? loadProjectRunView(projectId) : EMPTY }));
  let current = entry;
  if (entry.projectId !== projectId) {
    current = { projectId, view: projectId ? loadProjectRunView(projectId) : EMPTY };
    setEntry(current);
  }

  useEffect(() => {
    if (!projectId) return;
    const reload = () => setEntry({ projectId, view: loadProjectRunView(projectId) });
    const onChange = (e: Event) => {
      if ((e as CustomEvent).detail === projectId) reload();
    };
    const key = storageKeys.runView(projectId);
    const onStorage = (e: StorageEvent) => {
      if (e.key === key) reload();
    };
    changed.addEventListener("change", onChange);
    window.addEventListener("storage", onStorage);
    return () => {
      changed.removeEventListener("change", onChange);
      window.removeEventListener("storage", onStorage);
    };
  }, [projectId]);

  const set = useCallback(
    (next: RunView) => {
      if (projectId) saveProjectRunView(projectId, next);
      else setEntry({ projectId, view: next });
    },
    [projectId],
  );
  const view = current.view;
  return useMemo(() => ({ view, set }), [view, set]);
}
