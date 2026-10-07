import type { RunProgress, RunStatus } from "../api/types";
import { formatCounts, progressDisplay, runningText } from "../lib/run-progress";

/** The bar's fill per status (the status colour tokens of RunStatusBadge). */
const fill: Record<RunStatus, string> = {
  running: "bg-status-running",
  completed: "bg-status-completed",
  failed: "bg-status-failed",
  crashed: "bg-status-crashed",
  killed: "bg-status-killed",
  stopped: "bg-status-stopped",
};
const track: Record<RunStatus, string> = {
  running: "bg-status-running/15",
  completed: "bg-status-completed/15",
  failed: "bg-status-failed/15",
  crashed: "bg-status-crashed/15",
  killed: "bg-status-killed/15",
  stopped: "bg-status-stopped/15",
};

function Bar({ status, fraction, className }: { status: RunStatus; fraction: number; className: string }) {
  const pct = Math.min(1, Math.max(0, fraction)) * 100;
  return (
    <div className={`h-1 overflow-hidden rounded-full ${track[status]} ${className}`}>
      <div className={`h-full rounded-full ${fill[status]}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

type Props = { status: RunStatus; progress: RunProgress | null | undefined };

/** Runs table STATUS cell, under the badge: bar + "58% · ~9 min left" (running only). */
export function RunProgressLine({ status, progress }: Props) {
  const d = progressDisplay(status, progress);
  if (!d || d.kind !== "running" || !progress) return null;
  return (
    <div className="mt-1 flex items-center gap-2">
      <Bar status={status} fraction={progress.fraction} className="w-20 shrink-0" />
      <span className="mono num whitespace-nowrap text-xs text-fg-muted">{runningText(d.pct, d.eta)}</span>
    </div>
  );
}

/** Runs table STATUS cell, right of the badge: "100%" (ended runs only). */
export function RunProgressPct({ status, progress }: Props) {
  const d = progressDisplay(status, progress);
  if (!d || d.kind !== "ended") return null;
  return <span className="mono num ml-2 text-xs text-fg-muted">{d.pct}</span>;
}

/** Run page header: a full-width line with the counts (bar + ETA while running). */
export function RunProgressHeader({ status, progress }: Props) {
  const d = progressDisplay(status, progress);
  if (!d || !progress) return null;
  const counts = formatCounts(progress);
  return (
    <div className="-mt-2 mb-4 flex items-center gap-3">
      {d.kind === "running" ? (
        <>
          <Bar status={status} fraction={progress.fraction} className="min-w-0 flex-1" />
          <span className="mono num whitespace-nowrap text-xs text-fg-muted">
            {counts} · {runningText(d.pct, d.eta)}
          </span>
        </>
      ) : (
        <span className="mono num whitespace-nowrap text-xs text-fg-muted">
          {counts} · {d.pct}
        </span>
      )}
    </div>
  );
}

/** Comparison run card: the value of its "Progress" row. */
export function RunProgressCompact({ status, progress }: Props) {
  const d = progressDisplay(status, progress);
  if (!d || !progress) return null;
  if (d.kind === "ended") return <span className="mono num text-fg">{d.pct}</span>;
  return (
    <span className="flex items-center gap-2">
      <Bar status={status} fraction={progress.fraction} className="w-16 shrink-0" />
      <span className="mono num whitespace-nowrap text-fg">{runningText(d.pct, d.eta, true)}</span>
    </span>
  );
}
