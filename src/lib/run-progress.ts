/**
 * Run progress display rules (pure): which state a run's progress shows in,
 * and how the percentage, ETA and counts are written.
 *
 * - No progress (the run has no total): nothing is shown.
 * - Running: a bar plus "<pct>% · ~<eta> left" ("<pct>% · —" without an ETA).
 * - Ended (any other status): no bar, only the percentage reached.
 *
 * Rounding: the percentage is the fraction × 100 rounded to the nearest
 * integer (0–100). The ETA is rounded to the nearest second; under 60 s it is
 * written in seconds, else rounded to the nearest minute, and from 60 minutes
 * on rounded to the nearest hour ("~40 s left", "~9 min left", "~2 h left";
 * short forms "~40s", "~9m", "~2h").
 */
import type { RunProgress, RunStatus } from "../api/types";

export type ProgressDisplay =
  | { kind: "running"; pct: string; eta: number | null }
  | { kind: "ended"; pct: string };

export function progressDisplay(
  status: RunStatus,
  progress: RunProgress | null | undefined,
): ProgressDisplay | null {
  if (!progress) return null;
  const pct = formatPct(progress.fraction);
  if (status === "running") return { kind: "running", pct, eta: progress.eta_seconds };
  return { kind: "ended", pct };
}

export function formatPct(fraction: number): string {
  const p = Math.round(Math.min(1, Math.max(0, fraction)) * 100);
  return `${p}%`;
}

/** [value, unit] of an ETA: seconds under a minute, minutes under an hour, else hours. */
function etaParts(seconds: number): [number, "s" | "min" | "h"] {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return [s, "s"];
  const m = Math.round(s / 60);
  if (m < 60) return [m, "min"];
  return [Math.round(s / 3600), "h"];
}

/** "~9 min left", "~2 h left", "~40 s left"; "—" without an ETA. */
export function formatEta(seconds: number | null): string {
  if (seconds == null) return "—";
  const [v, unit] = etaParts(seconds);
  return `~${v} ${unit} left`;
}

/** "~9m", "~2h", "~40s"; "—" without an ETA. */
export function formatEtaShort(seconds: number | null): string {
  if (seconds == null) return "—";
  const [v, unit] = etaParts(seconds);
  return `~${v}${unit === "min" ? "m" : unit}`;
}

/** "58% · ~9 min left" (long) or "58% · ~9m" (short). */
export function runningText(pct: string, eta: number | null, short = false): string {
  return `${pct} · ${short ? formatEtaShort(eta) : formatEta(eta)}`;
}

const nf = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

/** "step 5,800 / 10,000" for step progress, "3 / 10" for explicit progress. */
export function formatCounts(progress: RunProgress): string {
  const counts = `${nf.format(progress.current)} / ${nf.format(progress.total)}`;
  return progress.unit === "step" ? `step ${counts}` : counts;
}
