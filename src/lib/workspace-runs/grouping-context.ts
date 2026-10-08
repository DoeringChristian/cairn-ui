/**
 * The workspace page's grouping, for cards that aggregate runs (the scalar
 * card): grouped, each run's top-level group, so a card draws one line per
 * group (mean over its runs, min–max band, the group's colour).
 *
 * `undefined` (no provider: the run page, reports): the card's own grouping
 * settings apply. `null` (the workspace, not grouped): no grouping,
 * one line per run. A card's explicit `groupMode` (off / by key) wins over
 * either (lib/plot-utils/scalar-grouping.ts).
 */

import { createContext } from "react";

export interface WorkspaceGrouping {
  /** run id → group; runs not in it (ungrouped) stay their own lines. */
  groupOf: ReadonlyMap<string, string>;
}

export const WorkspaceGroupingContext = createContext<WorkspaceGrouping | null | undefined>(undefined);
