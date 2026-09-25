/**
 * The active colour-by of a scope (the run page's grid, a comparison):
 * `RunColorByProvider` (components/RunColorByProvider.tsx) provides it,
 * `useRunColors` (lib/run-view.tsx) reads it before the id-hash colours, and
 * the workspace toolbar edits it and shows its legend. Null outside a
 * provider (reports, the runs table).
 */

import { createContext, useContext } from "react";
import type { ColorByLegendEntry } from "./run-color-by.ts";
import type { ColorBy } from "./workspace/doc.ts";

export interface RunColorByValue {
  /** The scope's runs (the toolbar's field picker lists their params and metrics). */
  runIds: readonly string[];
  /** The workspace's colour-by, or null (colours by run id). */
  colorBy: ColorBy | null;
  /** Run id → colour, for every run of the scope once their values loaded; empty when inactive. */
  colors: Map<string, string>;
  legend: ColorByLegendEntry[];
  /** The expression's compile error or first evaluation error. */
  error: string | null;
  loading: boolean;
}

export const RunColorByContext = createContext<RunColorByValue | null>(null);

export function useRunColorBy(): RunColorByValue | null {
  return useContext(RunColorByContext);
}
