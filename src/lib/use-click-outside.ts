import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import { useEscapeLayer } from "./use-modal-behavior";

/**
 * Close a dropdown/popover when the user presses outside it or presses Escape.
 *
 * @param ref         The element that should be considered "inside".
 * @param onClose     Called when an outside pointerdown or Escape is detected.
 * @param active      Only listen when true (default: true).
 * @param excludeRefs Additional elements that count as "inside" (e.g. the
 *                    anchor button that toggles the popover).
 * @param isInside    Extra inside test for presses that land outside `ref` in
 *                    the DOM but belong to it, e.g. a nested popover portaled
 *                    to `document.body`.
 */
export function useClickOutside(
  ref: RefObject<HTMLElement | null>,
  onClose: () => void,
  active?: boolean,
  excludeRefs?: RefObject<HTMLElement | null>[],
  isInside?: (e: PointerEvent) => boolean,
): void {
  const enabled = active !== false;
  const onCloseRef = useRef(onClose);
  const isInsideRef = useRef(isInside);
  useEffect(() => {
    onCloseRef.current = onClose;
    isInsideRef.current = isInside;
  });

  useEscapeLayer(enabled, onClose);

  useEffect(() => {
    if (!enabled) return;

    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (ref.current?.contains(target)) return;
      if (excludeRefs) {
        for (const ex of excludeRefs) {
          if (ex.current?.contains(target)) return;
        }
      }
      if (isInsideRef.current?.(e)) return;
      onCloseRef.current();
    };

    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [ref, enabled, excludeRefs]);
}
