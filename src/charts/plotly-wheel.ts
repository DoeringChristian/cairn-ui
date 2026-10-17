interface WheelLayout {
  _replotting?: boolean;
  _enablescrollzoom?: boolean;
}

/**
 * Plotly 3.5's Cartesian wheel handler changes live axis ranges before committing
 * them to gd.layout. Axis tick drawing can trigger autoMargin -> _doPlot in that
 * interval, rebuilding from the old ranges and making wheel zoom jump backwards.
 *
 * Use the same margin guard as Plotly's Cartesian drag handler. Its own dragTail
 * clears _replotting before committing the final ranges, so normal margin sizing
 * still runs after the gesture. This must run in capture, before zoomWheel.
 * Keep the real-Plotly regression in test-fixtures/plotly-wheel.html when upgrading.
 */
export function guardCartesianWheel(graph: HTMLElement, event: WheelEvent): void {
  const plot = graph as HTMLElement & {
    _fullLayout?: WheelLayout;
    _context?: { staticPlot?: boolean; _scrollZoom?: { cartesian?: boolean } };
    _transitioningWithDuration?: boolean;
  };
  const layout = plot._fullLayout;
  if (!layout || plot._context?.staticPlot || plot._transitioningWithDuration) return;
  if (!plot._context?._scrollZoom?.cartesian && !layout._enablescrollzoom) return;
  if (!Number.isFinite(event.deltaY)) return;
  const target = event.target;
  if (!(target instanceof Element)) return;
  // Corners, modebar, legends, polar plots and 3D canvases have other handlers.
  const dragger = target.closest(".nsewdrag,.nsdrag,.ewdrag,.ndrag,.sdrag,.edrag,.wdrag");
  if (!dragger?.closest(".draglayer") || dragger.closest(".js-plotly-plot") !== graph) return;
  const previous = layout._replotting;
  layout._replotting = true;
  // If no native wheel handler consumed this event, there will be no dragTail.
  // Use a task: trusted browser events run microtasks BETWEEN capture and target
  // listeners. A microtask here would clear the guard before Plotly sees the wheel
  // (unlike synchronous dispatchEvent, which hides that race in synthetic tests).
  setTimeout(() => {
    if (!event.defaultPrevented && plot._fullLayout === layout) layout._replotting = previous;
  }, 0);
}
