import { useCallback, useSyncExternalStore } from "react";

/** Live `matchMedia(query).matches`; false where `matchMedia` is unavailable. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window === "undefined" || !window.matchMedia) return () => {};
      const media = window.matchMedia(query);
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    },
    [query],
  );
  const read = () =>
    typeof window !== "undefined" && !!window.matchMedia && window.matchMedia(query).matches;
  return useSyncExternalStore(subscribe, read, () => false);
}

/** Phones and tablets: the primary pointer is a finger. */
export function useCoarsePointer(): boolean {
  return useMediaQuery("(pointer: coarse)");
}

/** Below Tailwind's `md` breakpoint (the single-column card grid). */
export function useCompactLayout(): boolean {
  return useMediaQuery("(max-width: 767px)");
}
