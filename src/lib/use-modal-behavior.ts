import { useEffect, useLayoutEffect, useRef } from "react";

/**
 * Open overlays (dialogs, popovers, sheets) that close on Escape, innermost
 * last. Only the innermost one reacts, so Escape inside a popover that sits in
 * a dialog closes the popover and leaves the dialog open.
 */
const escapeStack: object[] = [];

/**
 * Close on Escape while `active`, taking part in the innermost-first stack
 * above. Every layer listens on `window`; a layer that is not the innermost
 * one ignores the key. `onEscape` may change between renders without
 * re-registering the layer.
 */
export function useEscapeLayer(active: boolean, onEscape: () => void): void {
  const onEscapeRef = useRef(onEscape);
  useLayoutEffect(() => {
    onEscapeRef.current = onEscape;
  });

  useEffect(() => {
    if (!active) return;
    const token = {};
    escapeStack.push(token);
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (escapeStack[escapeStack.length - 1] !== token) return;
      e.stopPropagation();
      onEscapeRef.current();
    };
    window.addEventListener("keydown", handler);
    return () => {
      window.removeEventListener("keydown", handler);
      const idx = escapeStack.indexOf(token);
      if (idx >= 0) escapeStack.splice(idx, 1);
    };
  }, [active]);
}

/**
 * Shared modal behaviour: prevent body scroll and close on Escape.
 *
 * @param open    Whether the modal is currently visible.
 * @param onClose Called when the user presses Escape (and this modal is the
 *                innermost open overlay).
 */
export function useModalBehavior(open: boolean, onClose: () => void): void {
  useEscapeLayer(open, onClose);

  // Prevent body scroll while open. A layout effect, not a passive one:
  // hiding the body scrollbar changes the viewport width, so doing it after
  // the first paint reflows the modal once it is already on screen — and any
  // consumer that measures the modal's box on open (card-kit/use-overlay-slot)
  // would measure the pre-lock layout and then have to correct itself.
  useLayoutEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);
}
