import { shortRunLabel } from "./run-label";

export function seriesKey(m: { runId?: string; name: string }): string {
  return `${m.runId ?? ""}::${m.name}`;
}

export function seriesLabel(
  name: string,
  runId: string | undefined,
  includeRun: boolean,
  siblingRunIds?: string[],
): string {
  if (includeRun && runId) return shortRunLabel(runId, siblingRunIds);
  return name;
}
