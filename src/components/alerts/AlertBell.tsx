import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAlerts } from "../../api/hooks";
import { newestCreatedAt, unseenCount } from "../../lib/alerts";
import { formatRelative } from "../../lib/format";
import { loadJson, saveJson, storageKeys } from "../../lib/storage";
import { useClickOutside } from "../../lib/use-click-outside";
import { AlertLevelDot } from "./AlertLevel";

/** The project header's bell: a count of alerts since the user last opened
 * it, and a dropdown of the newest ones linking to their runs. */
export default function AlertBell({ projectId }: { projectId: string }) {
  const q = useAlerts(projectId, { limit: 20 });
  const alerts = q.data?.alerts ?? [];
  const key = storageKeys.alertsSeen(projectId);
  const [lastSeen, setLastSeen] = useState<string | null>(() => loadJson<string>(localStorage, key));
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  useClickOutside(panelRef, () => setOpen(false), open, [buttonRef]);

  const unseen = unseenCount(alerts, lastSeen);
  const toggle = () => {
    if (!open) {
      const newest = newestCreatedAt(alerts);
      if (newest) {
        saveJson(localStorage, key, newest);
        setLastSeen(newest);
      }
    }
    setOpen((v) => !v);
  };

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        className="relative flex h-7 w-7 items-center justify-center rounded text-fg-muted hover:bg-bg-hover hover:text-fg"
        aria-label={unseen > 0 ? `${unseen} new alert(s)` : "alerts"}
        title="Alerts"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 11V7a4 4 0 0 1 8 0v4l1.2 1.5H2.8z" />
          <path d="M6.5 14a1.6 1.6 0 0 0 3 0" />
        </svg>
        {unseen > 0 && (
          <span className="num absolute -right-1 -top-1 min-w-[16px] rounded-full bg-status-failed px-1 text-center text-[10px] font-semibold leading-4 text-white">
            {unseen >= alerts.length && alerts.length >= 20 ? "20+" : unseen}
          </span>
        )}
      </button>
      {open && (
        <div
          ref={panelRef}
          className="card absolute right-0 top-8 z-30 max-h-[60vh] w-80 max-w-[calc(100vw-2rem)] overflow-y-auto p-2 shadow-lg"
        >
          {alerts.length === 0 ? (
            <p className="p-2 text-sm text-fg-subtle">No alerts.</p>
          ) : (
            <ul className="flex flex-col">
              {alerts.map((a) => (
                <li key={a.id} className="border-b border-border-subtle last:border-0">
                  <Link
                    to={`/p/${projectId}/r/${a.run_id}`}
                    onClick={() => setOpen(false)}
                    className="flex gap-2 rounded px-2 py-1.5 hover:bg-bg-hover"
                  >
                    <AlertLevelDot level={a.level} className="mt-1.5" />
                    <span className="min-w-0 flex-1">
                      <span className="block break-words text-sm text-fg">{a.title}</span>
                      {a.text && (
                        <span className="block break-words text-xs text-fg-muted">{a.text}</span>
                      )}
                      <span className="mono block text-[10px] text-fg-subtle">
                        {a.run_name ?? a.run_id.slice(0, 8)} · {formatRelative(a.created_at)}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
