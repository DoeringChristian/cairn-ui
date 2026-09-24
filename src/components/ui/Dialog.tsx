import { useId } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { useModalBehavior } from "../../lib/use-modal-behavior";
import { useCompactViewport } from "../../lib/use-media-query";

const MAX_WIDTH = {
  md: "max-w-md",
  "2xl": "max-w-2xl",
  "3xl": "max-w-3xl",
} as const;

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  /**
   * The panel's content below the header. The panel is a flex column that
   * never scrolls itself: wrap the scrolling part in `DialogBody` (or give
   * your own region `flex-1 min-h-0 overflow-y-auto`) and put fixed rows
   * (tabs, search, `DialogFooter`) around it.
   */
  children: ReactNode;
  /** Desktop max width. */
  size?: keyof typeof MAX_WIDTH;
  /** Desktop: take the full viewport height (minus margins) instead of fitting the content. */
  fill?: boolean;
}

/**
 * A modal dialog portaled to `document.body`. Desktop: a centered panel of at
 * most `size` width over a backdrop. Phone-sized viewports: a full-screen
 * sheet with the header (title + 44px close button) pinned at the top.
 * Locks body scroll and closes on Escape (innermost overlay first) and on
 * backdrop click. No transforms or transform animations: a live WebGL viewport
 * may be slotted inside.
 */
export default function Dialog({
  open,
  onClose,
  title,
  children,
  size = "2xl",
  fill = false,
}: DialogProps) {
  const compact = useCompactViewport();
  const titleId = useId();
  useModalBehavior(open, onClose);

  if (!open) return null;

  const panel = compact
    ? "h-[100dvh] w-full pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]"
    : `${fill ? "h-full" : "max-h-full"} w-full ${MAX_WIDTH[size]} rounded-lg border border-border shadow-lg`;

  return createPortal(
    <div className={`fixed inset-0 z-50 flex items-center justify-center ${compact ? "" : "p-8"}`}>
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`relative flex flex-col overflow-hidden bg-bg ${panel}`}
      >
        <div className={`flex shrink-0 items-center justify-between gap-2 border-b border-border pl-4 ${compact ? "py-1 pr-1" : "py-2 pr-3"}`}>
          <h2 id={titleId} className="min-w-0 truncate text-sm font-semibold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className={`inline-flex shrink-0 items-center justify-center rounded text-lg text-fg-muted hover:bg-bg-hover hover:text-fg ${
              compact ? "h-11 w-11" : "h-7 w-7 touch:h-11 touch:w-11"
            }`}
          >
            {"×"}
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

/** The dialog's scrolling region. */
export function DialogBody({ children, className = "px-4 py-3" }: { children: ReactNode; className?: string }) {
  return <div className={`min-h-0 flex-1 overflow-y-auto overscroll-contain ${className}`}>{children}</div>;
}

/** A footer row pinned below the scrolling region. */
export function DialogFooter({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3 ${className}`}>
      {children}
    </div>
  );
}
