import type { RunStatus } from "../api/types";

const colors: Record<RunStatus, string> = {
  running: "bg-status-running/15 text-status-running",
  completed: "bg-status-completed/15 text-status-completed",
  failed: "bg-status-failed/15 text-status-failed",
  crashed: "bg-status-crashed/15 text-status-crashed",
  killed: "bg-status-killed/15 text-status-killed",
  stopped: "bg-status-stopped/15 text-status-stopped",
};

/** The run's status, plus an "archived" mark when the run is archived
 * (archiving is a flag beside the status, never a status of its own). */
export default function RunStatusBadge({ status, archived = false }: { status: RunStatus; archived?: boolean }) {
  const badge = (
    <span
      className={`mono inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs ${colors[status]}`}
    >
      {status === "running" ? (
        <span className="inline-block h-1.5 w-1.5 motion-safe:animate-pulse rounded-full bg-current" />
      ) : null}
      {status}
    </span>
  );
  if (!archived) return badge;
  return (
    <span className="inline-flex items-center gap-1">
      {badge}
      <span className="mono inline-flex items-center rounded px-1.5 py-0.5 text-xs bg-fg-subtle/15 text-fg-subtle">
        archived
      </span>
    </span>
  );
}
