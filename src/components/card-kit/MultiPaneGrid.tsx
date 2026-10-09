import { Fragment, type ReactNode } from "react";
import SplitPane from "../SplitPane";
import { LabelledPane } from "./pane-label";
import { useCompactLayout } from "../../lib/use-media-query";
import { galleryColumns, type Columns } from "../../lib/media/panel-layout";

interface Props {
  /** Explicit height of every grid row (e.g. "320px"); absent = fill the container. */
  rowHeight?: string;
  /** One key per pane (series), used for React keys and to look up labels. */
  paneKeys: string[];
  /** Run label badge per pane key. Panes without an entry render no badge. */
  labels: Map<string, string>;
  /** Run colour per pane key, shown as a swatch in the run label. */
  colors?: Map<string, string>;
  /** Modal → SplitPane (draggable split view). Card → wrapping grid. */
  inModal: boolean;
  /** Fraction widths for the modal SplitPane; defaults to equal split. */
  paneWidths?: number[];
  /** Persists SplitPane drag results (modal only). */
  onPaneWidthsChange: (widths: number[]) => void;
  /** Renders the content for one pane, given its key and index. */
  renderPane: (key: string, index: number) => ReactNode;
  /** Grid columns in a card: `auto` (default: up to two) or a fixed count. Phones always stack. */
  columns?: Columns;
}

/**
 * Shared multi-pane layout for comparison cards (figure/audio/video).
 *
 * In a modal, panes are laid out with the draggable `SplitPane`. In a card,
 * panes are laid out in a wrapping grid (`columns`, auto: up to 2; one on phones) with
 * a run chip (swatch + run label) over the top-left corner of each pane —
 * or in the pane content's own header line, when it has one (see pane-label).
 */
export default function MultiPaneGrid({
  rowHeight,
  paneKeys,
  labels,
  colors,
  inModal,
  paneWidths,
  onPaneWidthsChange,
  renderPane,
  columns = "auto",
}: Props) {
  const compact = useCompactLayout();
  if (inModal) {
    return (
      <SplitPane
        widths={paneWidths ?? Array(paneKeys.length).fill(1 / paneKeys.length)}
        onWidthsChange={onPaneWidthsChange}
      >
        {paneKeys.map((key, i) => <Fragment key={key}>{renderPane(key, i)}</Fragment>)}
      </SplitPane>
    );
  }

  return (
    <div
      className="grid gap-1 flex-1 min-h-0 overflow-auto"
      // Rows need a DEFINITE height: a pane's content (a Plotly figure, an
      // image surface) sizes itself to its pane with `h-full`, and a
      // percentage height inside an auto-sized grid row collapses to 0 — the
      // pane then shows nothing. Either the caller supplies a row height (the
      // auto-height card path) or the grid fills its container and splits it
      // evenly (the explicit-card-height path).
      // Phones stack the panes in one column; each keeps a usable minimum
      // height and the grid scrolls when they don't all fit.
      style={{
        gridTemplateColumns: `repeat(${galleryColumns(columns, paneKeys.length, compact)}, minmax(0, 1fr))`,
        gridAutoRows: rowHeight ?? (compact ? "minmax(180px, 1fr)" : "minmax(0, 1fr)"),
        height: rowHeight ? undefined : "100%",
      }}
    >
      {paneKeys.map((key, i) => (
        <div key={key} className="relative overflow-hidden">
          <LabelledPane label={labels.get(key)} color={colors?.get(key)}>
            {renderPane(key, i)}
          </LabelledPane>
        </div>
      ))}
    </div>
  );
}
