# Card implementation style guide

Conventions for adding or changing a card type in the viewer. When this guide
and the code disagree, follow the newest code.

## 1. Data model (cairn-track side)

- One `object_type` string per loggable type: lowercase, singular, no
  punctuation (`table`, `html`, `pointcloud`). It is opaque to the server.
- Blob size cap 10MB (`TensorHandler` shows the pattern). Anything bigger must
  downsample at log time and record that in metadata.
- Metadata carries whatever the card needs for its header without fetching the
  blob (counts, dims, dtype, duration…), like `AudioHandler` (peaks/duration)
  and `ImageHandler` (thumbnail `preview`, canonical `encoding`).
- The wrapper lives in cairn-track's `cairn/sdk/wrappers.py`, the handler in
  `cairn/sdk/handlers/<type>.py` (registered in `handlers/__init__.py`), with a
  pytest under `tests/unit/`. See that repo for the handler conventions.

## 2. Card component (`src/components/<Type>Card.tsx`)

- Props: the series-card contract — `{ runId, metric: SequenceMeta,
  extraSeries?, controlledSeries?, settingsKeyOverride?, onRemove?,
  autoOpenSettings? }`. Multi-run cards instead extend the `CardDescriptor`
  `kind: "multi-run"` union in `CardRenderer.tsx`; mirror how
  `parallel`/`scatter` are wired (CardRenderer → ComparePage descriptor →
  AddCardModal `AddCardSelection`).
- Settings: one interface extending `BaseCardSettings` (card-kit) with
  `version: 1`, persisted only through `useCardSeries` (series cards) or
  `useCardSettings`. Never build storage keys by hand; new non-card keys go
  through `lib/storage.ts`.
- Plumbing hooks — use, don't reimplement: `useCardSeries`, `useStepSlider` +
  `resolveAtStep` (stepped media), `useRunInfo`, `MultiPaneGrid` (one pane per
  run), `useSequencesForRuns`, `useOverlaySlot` (keep an expensive viewport
  mounted while the settings modal is open).
- Chrome: render through `CardShell` (`settingsPanel` / `modalContent` /
  `selectionPanel` slots, `headerActions`, `dropProps` from `useCardDrop`).
- Heavy cards are lazy in `CardRenderer.tsx`
  (`const XCard = lazy(() => import("./XCard"))` + the Suspense fallback).
- Run labels via `shortRunLabel` / `seriesLabel`, and subscribe
  `useRunMetadataVersion()` in any memo that computes labels.

## 3. Drawing

Use the established libraries; don't write a renderer.

| What | Use | Where |
|---|---|---|
| Scalar lines (many runs, many points) | uPlot | `src/charts/ScalarChart.tsx` |
| Everything else chart-like (bar, scatter, histogram, heatmap, parallel coordinates, user figures) | Plotly | `src/charts/PlotlyChart.tsx` + the per-kind wrappers in `src/charts/` |
| Images | `<img>` in react-zoom-pan-pinch | `src/components/image/ImagePane.tsx` |
| 3D | three.js | `src/components/viewer3d/` |
| Anything the browser can't decode | thumbnail + download | `src/components/UnsupportedArtifact.tsx` |

- Components are self-contained: they own their resize (ResizeObserver on
  their own box), zoom and pan. No external hook may be needed to make them
  behave.
- Pure data helpers (smoothing, x-axis mapping, histogram, pareto, figure
  merge) live in `src/lib/plot-utils/` and carry node unit tests.
- Colors: `SERIES_COLORS` / `seriesColor` (`lib/plot-utils/types.ts`),
  colormaps from `src/charts/colormaps.ts`, chart chrome from the theme tokens
  via `readChartTheme` (`src/charts/theme.ts`). UI chrome uses the Tailwind
  tokens (`text-fg-muted`, `bg-bg-elevated`, `border-border`, `text-accent`) —
  no hardcoded hex. Identifiers and values render in the `mono` class.
- Images: only browser-native encodings are drawn (`isBrowserDisplayable`,
  `lib/artifact-format.ts`); the only comparison is the A/B divider against a
  reference tag.

## 4. Registration checklist

1. `CardRenderer.tsx` switch case (lazy if heavy).
2. `AddCardModal.tsx`: `TYPE_ORDER` + `TYPE_LABELS` (series types) or the
   `AddCardSelection` union (multi-run types).
3. `CARD_TYPES` in `src/lib/cards/card-spec.ts`, then
   `npm run gen:card-schema` (writes `docs/schemas/cairn-card-spec.schema.json`)
   and the Python mirror in `cairn_ui/cards/spec.py`.
4. If the type can appear in comparisons, check it through ComparePage's
   CardRenderer path with `controlledSeries`.

## 5. Dependencies

Current drawing stack: `uplot`, `plotly.js-dist-min`, `react-zoom-pan-pinch`,
`three`; `react-markdown` + `remark-gfm` for markdown. Anything new needs a
reason in the change description. No second chart library.

## 6. Verification

- `npm run typecheck` (the CI gate, `tsc -b`), `npm run test:unit`,
  `npm run check:card-schema`, `npm run build` — and commit `cairn_ui/_dist`.
- Seed demo data with cairn-track's `examples/demo_<type>.py`, then serve this
  bundle: `CAIRN_UI_DIST=$PWD/cairn_ui/_dist cairn ui --repo <repo> --no-auth`.
  `cairn ui` caches `index.html` at startup — restart it after every build.
