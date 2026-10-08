/**
 * The workspace page's grouping, for cards that aggregate runs (the scalar
 * card, the Summary cards): grouped, each run's innermost group line
 * (`group: exp-44, jobType: train`, lib/runs-table/group.ts
 * `groupLineLabel`), so a card draws one line per innermost group (mean over
 * its runs, min–max band, the colour `colorOf(line)` the sidebar's dot
 * shows) labelled with that path.
 *
 * `undefined` (no provider: the run page, reports): the card's own grouping
 * settings apply. `null` (the workspace, not grouped): no grouping,
 * one line per run. A card's explicit `groupMode` (off / by key) wins over
 * either (lib/plot-utils/scalar-grouping.ts).
 */

import { createContext } from "react";

export interface WorkspaceGrouping {
  /** run id → its innermost group line; runs not in it stay their own lines. */
  groupOf: ReadonlyMap<string, string>;
  /** Each innermost group line's colour (lib/run-color.ts `groupLineColors`). */
  colorOf: ReadonlyMap<string, string>;
}

export const WorkspaceGroupingContext = createContext<WorkspaceGrouping | null | undefined>(undefined);
