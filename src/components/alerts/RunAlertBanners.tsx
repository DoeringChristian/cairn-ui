import { useAlerts } from "../../api/hooks";
import { formatRelative } from "../../lib/format";
import { ALERT_LEVEL_CLASSES, AlertLevelDot } from "./AlertLevel";

/** A run's alerts as banners above its tabs, newest first. */
export default function RunAlertBanners({ projectId, runId }: { projectId: string; runId: string }) {
  const q = useAlerts(projectId, { runId, limit: 50 });
  const alerts = q.data?.alerts ?? [];
  if (alerts.length === 0) return null;
  return (
    <div className="mb-4 flex flex-col gap-2 print:hidden">
      {alerts.map((a) => (
        <div
          key={a.id}
          role={a.level === "error" ? "alert" : "status"}
          className={`flex items-start gap-2 rounded border px-3 py-2 text-sm ${ALERT_LEVEL_CLASSES[a.level]?.banner ?? "border-border"}`}
        >
          <AlertLevelDot level={a.level} className="mt-1.5" />
          <div className="min-w-0 flex-1">
            <span className="break-words font-medium text-fg">{a.title}</span>
            {a.text && <span className="ml-2 break-words text-fg-muted">{a.text}</span>}
          </div>
          <span className="shrink-0 text-xs text-fg-subtle" title={a.created_at}>
            {formatRelative(a.created_at)}
          </span>
        </div>
      ))}
    </div>
  );
}
