/** Alert-bell bookkeeping: which alerts are new since the user last looked. */
import type { Alert } from "../api/types.ts";

/** Alerts created after ``lastSeen`` (all of them when never opened). */
export function unseenCount(alerts: readonly Alert[], lastSeen: string | null): number {
  if (!lastSeen) return alerts.length;
  const seen = Date.parse(lastSeen);
  return alerts.filter((a) => Date.parse(a.created_at) > seen).length;
}

/** The newest ``created_at`` among ``alerts`` (what "seen up to" becomes). */
export function newestCreatedAt(alerts: readonly Alert[]): string | null {
  let best: string | null = null;
  for (const a of alerts) {
    if (best === null || Date.parse(a.created_at) > Date.parse(best)) best = a.created_at;
  }
  return best;
}
