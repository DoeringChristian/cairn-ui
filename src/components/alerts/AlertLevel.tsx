import type { AlertLevel } from "../../api/types";

/** Per-level colours, shared by the bell and the run-page banners. */
export const ALERT_LEVEL_CLASSES: Record<AlertLevel, { dot: string; banner: string }> = {
  info: { dot: "bg-accent", banner: "border-accent/40 bg-accent/10" },
  warn: { dot: "bg-status-running", banner: "border-status-running/40 bg-status-running/10" },
  error: { dot: "bg-status-failed", banner: "border-status-failed/40 bg-status-failed/10" },
};

export function AlertLevelDot({ level, className = "" }: { level: AlertLevel; className?: string }) {
  return (
    <span
      className={`inline-block h-2 w-2 shrink-0 rounded-full ${ALERT_LEVEL_CLASSES[level]?.dot ?? "bg-fg-subtle"} ${className}`}
      aria-label={level}
    />
  );
}
