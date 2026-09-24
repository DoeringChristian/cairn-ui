import { useSyncExternalStore } from "react";

/**
 * Phone-sized viewports: narrower than Tailwind's `md` breakpoint, or too
 * short for an anchored panel (a phone in landscape). Overlays render as
 * bottom sheets / full-screen dialogs here.
 */
export const COMPACT_QUERY = "(max-width: 767.98px), (max-height: 499.98px)";

function subscribe(onChange: () => void): () => void {
  const mql = window.matchMedia(COMPACT_QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

function getSnapshot(): boolean {
  return window.matchMedia(COMPACT_QUERY).matches;
}

/** Whether the viewport is phone-sized (see `COMPACT_QUERY`); live across resizes. */
export function useCompactViewport(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
