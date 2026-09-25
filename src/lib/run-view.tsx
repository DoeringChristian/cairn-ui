/**
 * Which runs every chart shows, and in what colour: hidden runs, pinned runs
 * and a baseline, per scope (the project's workspace on the run page and runs
 * table, a comparison, a report cell). Cards read it through the hooks below;
 * the scope that owns the state provides `RunViewContext`.
 *
 * Colours come from `lib/run-color.ts` (derived from run ids, never stored),
 * unless a colour-by is active in scope (`RunColorByContext`,
 * lib/run-color-by.ts): then each run's colour is its value's bucket.
 * The pure edits (`toggleRunHidden`, `toggleRunPinned`, `toggleRunBaseline`,
 * `applyRunView`) and the project store (`useProjectRunView`) live in
 * `lib/run-view-store.ts`.
 */

import { createContext, useContext, useMemo } from "react";
import { assignRunColors } from "./run-color.ts";
import { RunColorByContext } from "./run-color-by-context.ts";
import { applyRunView } from "./run-view-store.ts";
import { getRunMetadata, useRunMetadataVersion } from "./run-label";

export interface RunView {
  hidden: string[];
  pinned: string[];
  baseline: string | null;
}

export const EMPTY_RUN_VIEW: RunView = { hidden: [], pinned: [], baseline: null };

export interface RunViewContextValue {
  view: RunView;
  /** Updates the owning scope's run view; absent where it is read-only. */
  set?: (next: RunView) => void;
}

export const RunViewContext = createContext<RunViewContextValue>({ view: EMPTY_RUN_VIEW });

export function useRunView(): RunViewContextValue {
  return useContext(RunViewContext);
}

function createdAtMs(id: string): number | undefined {
  const c = getRunMetadata(id)?.created_at;
  const t = c ? Date.parse(c) : NaN;
  return Number.isFinite(t) ? t : undefined;
}

/**
 * The colour of each of `runIds`: its colour-by bucket when one is active
 * (and the run's value is known), else distinct within the set by id.
 */
export function useRunColors(runIds: readonly string[]): Map<string, string> {
  const version = useRunMetadataVersion();
  const colorBy = useContext(RunColorByContext);
  const key = runIds.join("|");
  const byId = useMemo(
    () => assignRunColors(runIds, createdAtMs),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, version],
  );
  const byValue = colorBy?.colors;
  return useMemo(() => {
    if (!byValue || byValue.size === 0) return byId;
    return new Map([...byId].map(([id, c]) => [id, byValue.get(id) ?? c]));
  }, [byId, byValue]);
}

/** `runIds` minus hidden runs, pinned runs first (their relative order kept). */
export function useVisibleRuns(runIds: readonly string[]): string[] {
  const { view } = useRunView();
  const key = runIds.join("|");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => applyRunView(runIds, view), [key, view]);
}

/** The baseline run of the current scope, or null. */
export function useBaselineRun(): string | null {
  return useRunView().view.baseline;
}
