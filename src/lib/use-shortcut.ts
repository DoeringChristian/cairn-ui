import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { detectMac, isTypingTarget, matchesShortcut, parseShortcut, type TargetLike } from "./shortcuts";

/** Whether this browser uses ⌘ as its primary modifier. */
export const IS_MAC = typeof navigator !== "undefined" && detectMac(navigator.platform || navigator.userAgent);

export interface UseShortcutOptions {
  /** Listen only while true (default true). */
  enabled?: boolean;
  /** Also fire while a text field has focus (default false). */
  allowInInputs?: boolean;
}

/**
 * Bind a keyboard shortcut (`"mod+z"`, see lib/shortcuts.ts) on `window`
 * while `enabled`. Like `useEscapeLayer` (lib/use-modal-behavior.ts), the
 * handler may change between renders without re-registering, and a matched
 * key is consumed (`preventDefault` + `stopPropagation`). Keys typed into a
 * text field are left alone unless `allowInInputs`.
 */
export function useShortcut(
  shortcut: string,
  handler: (e: KeyboardEvent) => void,
  { enabled = true, allowInInputs = false }: UseShortcutOptions = {},
): void {
  const handlerRef = useRef(handler);
  useLayoutEffect(() => {
    handlerRef.current = handler;
  });
  const parsed = useMemo(() => parseShortcut(shortcut), [shortcut]);

  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (!matchesShortcut(e, parsed, IS_MAC)) return;
      if (!allowInInputs && isTypingTarget(e.target as TargetLike | null)) return;
      e.preventDefault();
      e.stopPropagation();
      handlerRef.current(e);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, allowInInputs, parsed]);
}
