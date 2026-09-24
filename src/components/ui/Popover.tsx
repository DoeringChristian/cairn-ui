import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import type { PointerEvent as ReactPointerEvent, ReactNode, RefObject } from "react";
import { createPortal } from "react-dom";
import { useClickOutside } from "../../lib/use-click-outside";
import { computePlacement } from "./placement";
import { useCompactViewport } from "./use-compact-viewport";

/**
 * Above `Dialog` / `CardDetailModal` (z-50) and the content `use-overlay-slot`
 * promotes into the card modal (z-60), so a popover opened from inside either
 * paints on top. Nested popovers share it and stack by DOM order (later wins).
 */
const POPOVER_Z = "z-[70]";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Popover panels a pointerdown passed through, keyed by the native event.
 * React bubbles synthetic events along the component tree, not the DOM tree,
 * so a press inside a nested popover (its own portal) reaches every enclosing
 * popover's panel handler — each marks the event and none of them close.
 */
const pressedInside = new WeakMap<Event, Set<object>>();

export interface PopoverProps {
  open: boolean;
  onClose: () => void;
  /** The trigger. Presses on it do not count as outside (it toggles instead). */
  anchorRef: RefObject<HTMLElement | null>;
  children: ReactNode;
  /** Accessible label; the sheet's header, and the anchored panel's heading when `titleAnchored`. */
  title?: string;
  /** Show `title` as a heading in the anchored panel too (the sheet always shows it). */
  titleAnchored?: boolean;
  /** Anchored panel width in px, or `"anchor"` to match the anchor (at least `minWidth`). */
  width?: number | "anchor";
  minWidth?: number;
  /** Which anchor edge the anchored panel lines up with. */
  align?: "start" | "end";
  /**
   * Layout on phone-sized viewports: a bottom sheet with a backdrop, or the
   * anchored panel (for suggestion lists under a focused input, where a sheet
   * would sit behind the on-screen keyboard).
   */
  compact?: "sheet" | "anchored";
  /** Move focus into the panel on open (the first focusable; the sheet itself on phones). */
  initialFocus?: boolean;
  role?: "dialog" | "listbox" | "menu";
  /** Classes for the content box inside the scrolling body (padding, gaps). */
  bodyClassName?: string;
}

/**
 * A panel anchored to a trigger, portaled to `document.body` so no ancestor's
 * `overflow` clips it. On desktop it opens below the anchor (above when only
 * that fits), clamped to the viewport, and scrolls its body when taller than
 * the room it has. On phone-sized viewports it becomes a bottom sheet: full
 * width, at most the viewport height minus 16px, scrolling body, backdrop.
 * Closes on a press outside it and on Escape (innermost overlay first).
 *
 * The sheet uses no transforms: a live WebGL viewport may sit in a modal
 * underneath, and transformed ancestors change how fixed content composes.
 */
export default function Popover({
  open,
  onClose,
  anchorRef,
  children,
  title,
  titleAnchored = false,
  width = 320,
  minWidth = 0,
  align = "end",
  compact = "sheet",
  initialFocus = true,
  role = "dialog",
  bodyClassName = "",
}: PopoverProps) {
  const compactViewport = useCompactViewport();
  const sheet = compactViewport && compact === "sheet";
  const panelRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const token = useMemo(() => ({}), []);

  const excludeRefs = useMemo(() => [anchorRef], [anchorRef]);
  const isInside = useCallback(
    (e: PointerEvent) => pressedInside.get(e)?.has(token) ?? false,
    [token],
  );
  useClickOutside(panelRef, onClose, open, excludeRefs, isInside);

  const markInside = (e: ReactPointerEvent) => {
    let set = pressedInside.get(e.nativeEvent);
    if (!set) {
      set = new Set();
      pressedInside.set(e.nativeEvent, set);
    }
    set.add(token);
  };

  // Anchored placement. Styles are written straight to the panel: placement
  // re-runs on every scroll/resize and must not re-render the children.
  useLayoutEffect(() => {
    if (!open || sheet) return;
    const panel = panelRef.current;
    const content = contentRef.current;
    const anchor = anchorRef.current;
    if (!panel || !content || !anchor) return;

    const place = () => {
      const rect = anchor.getBoundingClientRect();
      const vw = document.documentElement.clientWidth;
      const vh = window.innerHeight;
      const requested = width === "anchor" ? Math.max(rect.width, minWidth) : width;
      const p0 = computePlacement({
        anchor: rect, viewportWidth: vw, viewportHeight: vh,
        width: requested, naturalHeight: 0, align,
      });
      // Natural height at the final width (wrapping depends on it).
      panel.style.width = `${p0.width}px`;
      panel.style.maxHeight = "none";
      const p = computePlacement({
        anchor: rect, viewportWidth: vw, viewportHeight: vh,
        width: requested, naturalHeight: panel.offsetHeight, align,
      });
      panel.style.top = `${p.top}px`;
      panel.style.left = `${p.left}px`;
      panel.style.maxHeight = `${p.maxHeight}px`;
      panel.style.visibility = "visible";
    };

    place();
    const ro = new ResizeObserver(place);
    ro.observe(content);
    ro.observe(anchor);
    const onScroll = (e: Event) => {
      if (e.target instanceof Node && panel.contains(e.target)) return;
      place();
    };
    window.addEventListener("resize", place);
    // Capture phase: scrolls of any ancestor move the anchor.
    window.addEventListener("scroll", onScroll, true);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open, sheet, anchorRef, width, minWidth, align]);

  useEffect(() => {
    if (!open || !initialFocus) return;
    const panel = panelRef.current;
    if (!panel) return;
    if (sheet) {
      // Focus the sheet, not its first input: that would raise the keyboard.
      panel.focus({ preventScroll: true });
    } else {
      panel.querySelector<HTMLElement>(FOCUSABLE)?.focus({ preventScroll: true });
    }
  }, [open, sheet, initialFocus]);

  if (!open) return null;

  const body = (
    <div className="min-h-0 overflow-y-auto overscroll-contain">
      <div ref={contentRef} className={bodyClassName}>
        {title && titleAnchored && !sheet && (
          <h3 className="mb-3 text-xs uppercase tracking-wide text-fg-muted">{title}</h3>
        )}
        {children}
      </div>
    </div>
  );

  if (sheet) {
    return createPortal(
      <div className={`fixed inset-0 ${POPOVER_Z}`} onPointerDown={markInside}>
        <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
        <div
          ref={panelRef}
          role={role}
          aria-label={title}
          tabIndex={-1}
          className="absolute inset-x-0 bottom-0 flex max-h-[calc(100dvh-16px)] flex-col rounded-t-xl border-t border-border bg-bg-elevated pb-[env(safe-area-inset-bottom)] shadow-lg outline-none"
        >
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border-subtle pl-4 pr-1">
            <h3 className="truncate text-xs uppercase tracking-wide text-fg-muted">{title}</h3>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded text-lg text-fg-muted hover:bg-bg-hover hover:text-fg"
            >
              {"×"}
            </button>
          </div>
          {body}
        </div>
      </div>,
      document.body,
    );
  }

  return createPortal(
    <div
      ref={panelRef}
      role={role}
      aria-label={title}
      onPointerDown={markInside}
      className={`invisible fixed left-0 top-0 ${POPOVER_Z} flex flex-col overflow-hidden rounded-lg border border-border bg-bg-elevated shadow-lg`}
    >
      {body}
    </div>,
    document.body,
  );
}
