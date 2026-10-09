/**
 * The workspace page's grouping, for cards that aggregate runs (the scalar
 * card, the Summary cards): grouped, each run's innermost group line
 * (`group: exp-44, jobType: train`, lib/runs-table/group.ts
 * `groupLineLabel`), so a card draws one line per innermost group (mean over
 * its runs, min–max band, the colour `colorOf(line)` the sidebar's dot
 * shows) labelled with that path.
 *
 * A report cell provides its run sets' grouping the same way (lib/run-sets.ts
 * `runSetsGrouping`: each set's own group-by, lines of different sets kept
 * apart), so "Workspace" there means "follow the run set".
 *
 * `undefined` (no provider: the run page): the card's own grouping
 * settings apply. `null` (the workspace or a report cell, not grouped): no
 * grouping, one line per run. A card's explicit `groupMode` (off / by key) wins over
 * either (lib/plot-utils/scalar-grouping.ts).
 */

import { createContext } from "react";

export interface WorkspaceGrouping {
  /** run id → its innermost group line; runs not in it stay their own lines. */
  groupOf: ReadonlyMap<string, string>;
  /** Each innermost group line's colour (the page's colours: lib/run-color.ts `assignPageColors`). */
  colorOf: ReadonlyMap<string, string>;
}

export const WorkspaceGroupingContext = createContext<WorkspaceGrouping | null | undefined>(undefined);

/** Who provides the grouping: the workspace sidebar or a report cell's run sets (the card editor's wording). */
export const GroupingSourceContext = createContext<"workspace" | "report">("workspace");
