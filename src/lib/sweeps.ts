/** Pure helpers for the sweep pages. */
import type { SweepTrial } from "../api/types";

/**
 * The space's parameters that actually vary, in the space's order: a bare
 * value or `{value: …}` is a constant, anything else is searched.
 */
export function searchedParams(space: Record<string, unknown>): string[] {
  return Object.entries(space)
    .filter(([, spec]) => spec !== null && typeof spec === "object" && !Array.isArray(spec) && !("value" in spec))
    .map(([k]) => k);
}

/** Whether a space parameter is searched on a log scale (so its axis should be too). */
export function isLogParam(space: Record<string, unknown>, key: string): boolean {
  const spec = space[key];
  return !!spec && typeof spec === "object" && (spec as { distribution?: unknown }).distribution === "log_uniform";
}

/** Every param key any trial carries, searched ones first. */
export function trialParamKeys(trials: SweepTrial[], searched: string[]): string[] {
  const keys = new Set(searched);
  for (const t of trials) for (const k of Object.keys(t.params)) keys.add(k);
  return [...keys];
}

/** A param value as the trials table shows it. */
export function formatParamValue(value: unknown): string {
  if (value === undefined) return "—";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : Number(value.toPrecision(4)).toString();
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

/** Trials best first by `goal` (unscored last, newest first among them). */
export function rankTrials(trials: SweepTrial[], goal: "minimize" | "maximize"): SweepTrial[] {
  const sign = goal === "maximize" ? -1 : 1;
  return [...trials].sort((a, b) => {
    if (a.value == null && b.value == null) return b.created_at.localeCompare(a.created_at);
    if (a.value == null) return 1;
    if (b.value == null) return -1;
    return sign * (a.value - b.value);
  });
}
