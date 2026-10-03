import { useEffect, useState, type ReactNode } from "react";
import Dialog, { DialogBody, DialogFooter } from "../ui/Dialog";

/**
 * An in-app confirmation (never `window.confirm`). `requireText`: the
 * confirm button stays disabled until that exact text is typed (deleting a
 * whole artifact). `error` shows under the body; `extraAction` adds a second
 * destructive button (e.g. "Delete anyway" after a 409).
 */
export default function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  onConfirm,
  onClose,
  pending = false,
  error,
  requireText,
  extraAction,
  danger = true,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
  pending?: boolean;
  error?: ReactNode;
  requireText?: string;
  extraAction?: { label: string; onClick: () => void };
  danger?: boolean;
}) {
  const [typed, setTyped] = useState("");
  useEffect(() => {
    if (open) setTyped("");
  }, [open]);
  const blocked = requireText !== undefined && typed !== requireText;
  const dangerCls = "border-status-failed/60 text-status-failed hover:border-status-failed hover:bg-status-failed/10";
  return (
    <Dialog open={open} onClose={onClose} title={title} size="md">
      <DialogBody>
        <div className="flex flex-col gap-3 text-sm">
          {children}
          {requireText !== undefined && (
            <label className="flex flex-col gap-1 text-xs text-fg-muted">
              <span>
                Type <span className="mono font-semibold text-fg">{requireText}</span> to confirm
              </span>
              <input
                autoFocus
                className="input mono"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                aria-label="confirmation text"
              />
            </label>
          )}
          {error && (
            <div className="rounded border border-status-failed/40 bg-status-failed/5 px-3 py-2 text-xs text-status-failed" role="alert">
              {error}
            </div>
          )}
        </div>
      </DialogBody>
      <DialogFooter>
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
        <div className="flex gap-2">
          {extraAction && (
            <button type="button" className={`btn ${dangerCls}`} disabled={pending} onClick={extraAction.onClick}>
              {extraAction.label}
            </button>
          )}
          <button
            type="button"
            className={`btn ${danger ? dangerCls : ""}`}
            disabled={pending || blocked}
            onClick={onConfirm}
          >
            {pending ? "Working…" : confirmLabel}
          </button>
        </div>
      </DialogFooter>
    </Dialog>
  );
}
