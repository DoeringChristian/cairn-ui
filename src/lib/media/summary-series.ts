/**
 * Summary media series. `run.summary(fig=cairn.Figure(f))` stores ONE
 * stepless value per summary key; the run's catalogue (`/sequences`) lists it
 * as a series named by the key's dotted path, with one point at step 0, and
 * flags it `summary: true`. A card showing only such series has no step
 * slider and does not join its section's shared slider.
 *
 * Pure: runs under `node --test`.
 */

/** The catalogue fields read here (`SequenceMeta`). */
export interface CatalogueEntry {
  name: string;
  summary?: boolean;
}

export interface SeriesRef {
  runId: string;
  name: string;
}

/** Whether `name` is a summary media value in a run's catalogue. */
export function isSummarySeries(catalogue: readonly CatalogueEntry[] | undefined, name: string): boolean {
  return catalogue?.some((s) => s.name === name && s.summary === true) ?? false;
}

/**
 * Whether a card's series are ALL summary media values: the card then shows
 * no step slider. False for no series, and while a run's catalogue has not
 * loaded (the slider stays until it is known; a summary series has one point,
 * so the slider is empty anyway).
 */
export function allSummarySeries(
  catalogueOf: (runId: string) => readonly CatalogueEntry[] | undefined,
  series: readonly SeriesRef[],
): boolean {
  return series.length > 0 && series.every((s) => isSummarySeries(catalogueOf(s.runId), s.name));
}

/** The distinct run ids of `series`, in order. */
export function seriesRuns(series: readonly SeriesRef[]): string[] {
  return [...new Set(series.map((s) => s.runId).filter(Boolean))];
}
