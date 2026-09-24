/**
 * Call `resize` whenever the page switches between screen and print layout
 * (`beforeprint`/`afterprint`, plus the `print` media query, which is what
 * fires once the print layout is actually applied). Charts that size their
 * canvas from their box re-measure here; a ResizeObserver alone doesn't run
 * before the browser snapshots the page for printing. Returns the unsubscribe.
 */
export function onPrintLayout(resize: () => void): () => void {
  const media = window.matchMedia("print");
  window.addEventListener("beforeprint", resize);
  window.addEventListener("afterprint", resize);
  media.addEventListener("change", resize);
  return () => {
    window.removeEventListener("beforeprint", resize);
    window.removeEventListener("afterprint", resize);
    media.removeEventListener("change", resize);
  };
}
