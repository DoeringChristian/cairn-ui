// plotly.js-dist-min ships no types; the runtime API is plotly.js.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PlotlyApi = any;

/**
 * Plotly, once loaded (a live binding: importers see it appear). It is
 * ~4.6 MB of script, so it loads on first use (the first plot drawn, or an
 * export) rather than with the app: pages without a Plotly plot never parse
 * it.
 *
 * This module is tiny and imported statically by everything that needs
 * Plotly (PlotlyChart, the card screenshot, downloads); only Plotly itself is
 * imported dynamically, so it stays in a chunk of its own.
 */
export let plotly: PlotlyApi | null = null;
let plotlyLoading: Promise<PlotlyApi> | null = null;

/** Load Plotly (once); resolves to its API. */
export function loadPlotly(): Promise<PlotlyApi> {
  plotlyLoading ??= import(
    // @ts-expect-error - no types (see PlotlyApi)
    "plotly.js-dist-min"
  ).then((m: { default: PlotlyApi }) => (plotly = m.default));
  return plotlyLoading;
}
