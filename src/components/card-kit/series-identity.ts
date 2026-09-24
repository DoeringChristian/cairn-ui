import { shortRunLabel } from "../../lib/run-label";

/** Chip/pane label for one series — run-scoped in a multi-run card, else
 *  its name. Shared so every per-kind media card labels panes identically. */
export function seriesLabel(
  m: { runId?: string; name: string },
  fallbackRunId: string,
  multiRun: boolean,
  siblingRunIds?: string[],
): string {
  if (multiRun) {
    return shortRunLabel(m.runId ?? fallbackRunId, siblingRunIds);
  }
  return m.name;
}

/** Stable React key for one series row. */
export function seriesKey(m: { runId?: string; name: string }): string {
  return `${m.runId ?? ""}::${m.name}`;
}
