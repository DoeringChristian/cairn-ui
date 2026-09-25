/**
 * Which runs every chart shows, and in what colour: hidden runs, pinned runs
 * and a baseline, per scope (the project's workspace on the run page and runs
 * table, a comparison, a report cell). Cards read it through the hooks below;
 * the scope that owns the state provides `RunViewContext`.
 *
 * Colours come from `lib/run-color.ts` (derived from run ids, never stored).
 */

import { createContext, useContext, useMemo } from "react";
import { assignRunColors } from "./run-color.ts";
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

/** The colour of each of `runIds`, distinct within the set. */
export function useRunColors(runIds: readonly string[]): Map<string, string> {
  const version = useRunMetadataVersion();
  const key = runIds.join("|");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => assignRunColors(runIds, createdAtMs), [key, version]);
}

/** `runIds` minus hidden runs, pinned runs first (their relative order kept). */
export function useVisibleRuns(runIds: readonly string[]): string[] {
  const { view } = useRunView();
  const key = runIds.join("|");
  return useMemo(() => {
    const hidden = new Set(view.hidden);
    const pinned = new Set(view.pinned);
    const shown = runIds.filter((id) => !hidden.has(id));
    return [...shown.filter((id) => pinned.has(id)), ...shown.filter((id) => !pinned.has(id))];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, view]);
}
