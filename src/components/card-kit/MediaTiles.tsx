/**
 * The tile layer every list-capable media card shares (wandb's media panel):
 * the Index bar over the media, and the gallery / grid / compare layouts of
 * tiles planned by lib/media/media-plan.ts. A card supplies how ONE tile
 * renders (a run's point at a value, showing some of its list items), and
 * its own per-run pane layout for the gallery's Run content.
 */

import { useMemo, type ReactNode } from "react";
import type { SequencePoint } from "../../api/types";
import { formatNum } from "../../lib/plot-utils/format";
import { galleryCount, isGalleryPoint } from "../../lib/media/gallery";
import { normalizeSlots, type CompareSlot } from "../../lib/media/panel-layout";
import {
  limitTiles,
  maxCount,
  planGallery,
  planGrid,
  resolveSlot,
  stepIndex,
  type AxisCell,
  type GalleryPlan,
  type GridPlan,
  type IndexMode,
  type PlanData,
  type TileRef,
} from "../../lib/media/media-plan";
import { STEP_KEY } from "../../lib/media/slider-key";
import { useCompactLayout } from "../../lib/use-media-query";
import type { MediaLayoutSettings } from "../cards-settings/media";
import ComparePanes, { type ComparePaneOption } from "./ComparePanes";
import GridPanes, { type GridHeader } from "./GridPanes";
import { LabelledPane } from "./pane-label";
import { resolveAtStep } from "./resolve-at-step";

/** A planned tile with the point it shows. */
export interface LayoutTile extends TileRef {
  point: SequencePoint | null;
}

export interface MediaLayout {
  mode: MediaLayoutSettings["panelMode"];
  /** The card holds lists: the Index applies. */
  lists: boolean;
  /** Items of the widest list at the slider's value (the Index stepper's `n`). */
  listCount: number;
  gallery: GalleryPlan | null;
  grid: GridPlan | null;
  compare: { slots: CompareSlot[] } | null;
  /** Every tile on screen (after the media limit), with its point. */
  tiles: LayoutTile[];
  byId: Map<string, LayoutTile>;
}

/**
 * Plan the card's tiles for its mode. `nearest`: a run reaching the slider's
 * value later than its neighbours shows its first media (gallery, compare);
 * the grid never does, so its columns stay truthful.
 */
export function useMediaLayout({
  settings,
  values,
  currentValue,
  stepFor,
  seriesPoints,
  paneKeys,
  nearest,
}: {
  settings: MediaLayoutSettings;
  values: readonly number[];
  currentValue: number;
  stepFor: (i: number, value?: number, opts?: { nearest?: boolean }) => number | null;
  seriesPoints: ReadonlyArray<readonly SequencePoint[]>;
  paneKeys: readonly string[];
  nearest: boolean;
}): MediaLayout {
  const lists = useMemo(() => seriesPoints.some((pts) => pts.some(isGalleryPoint)), [seriesPoints]);
  const s = settings;
  return useMemo(() => {
    const pointAt = (run: number, value: number, near: boolean): SequencePoint | null => {
      const step = stepFor(run, value, { nearest: near });
      return step == null ? null : resolveAtStep((seriesPoints[run] ?? []) as SequencePoint[], step, { nearest: near });
    };
    const near = s.panelMode !== "grid" && nearest;
    const data: PlanData = {
      runs: paneKeys.length,
      values,
      current: currentValue,
      lists,
      countAt: (run, value) => galleryCount(pointAt(run, value, near)),
    };
    const limit = s.limitMedia ? s.mediaLimit : null;
    const withPoint = (t: TileRef): LayoutTile => ({ ...t, point: t.run < 0 ? null : pointAt(t.run, t.value, near) });
    let gallery: GalleryPlan | null = null;
    let grid: GridPlan | null = null;
    let compare: MediaLayout["compare"] = null;
    let tiles: LayoutTile[];
    if (s.panelMode === "grid") {
      grid = planGrid(data, s, {
        x: s.gridX,
        y: s.gridY,
        stepFrom: s.gridStepFrom,
        stepTo: s.gridStepTo,
        columns: s.columns,
        rows: s.gridRows,
        limit,
      });
      tiles = grid.cells.flat().map(withPoint);
    } else if (s.panelMode === "compare") {
      const slots = normalizeSlots(s.compareSlots, paneKeys);
      compare = { slots };
      tiles = limitTiles(slots.map((slot, i) => withPoint(resolveSlot(slot, i, s, paneKeys, data, s))), limit);
    } else {
      gallery = planGallery(data, s, s.galleryContent, s.columns);
      gallery = { ...gallery, tiles: limitTiles(gallery.tiles, limit) };
      tiles = gallery.tiles.map(withPoint);
    }
    return {
      mode: s.panelMode,
      lists,
      listCount: maxCount(data, [currentValue]),
      gallery,
      grid,
      compare,
      tiles,
      byId: new Map(tiles.map((t) => [t.id, t])),
    };
  }, [
    s.panelMode, s.galleryContent, s.columns, s.gridX, s.gridY, s.gridStepFrom, s.gridStepTo, s.gridRows,
    s.compareSlots, s.compareRun, s.compareStep, s.compareIndex, s.limitMedia, s.mediaLimit,
    s.indexMode, s.indexOne, s.indexFrom, s.indexTo, s.indexFirst,
    values, currentValue, stepFor, seriesPoints, paneKeys, nearest, lists,
  ]);
}

const INDEX_LABELS: Record<IndexMode, string> = { all: "All", one: "One", range: "Range", first: "First N" };

const BAR_BTN =
  "inline-flex h-5 w-5 items-center justify-center rounded text-fg-muted hover:bg-bg-hover hover:text-fg disabled:cursor-not-allowed disabled:opacity-40";

/** The Index over a list card's media: the selection, and `‹ i / n ›` while one index is picked. */
export function IndexBar({
  settings,
  count,
  update,
}: {
  settings: MediaLayoutSettings;
  /** Items of the widest list shown. */
  count: number;
  update: (patch: Partial<MediaLayoutSettings>) => void;
}) {
  const one = settings.indexMode === "one";
  const i = Math.min(settings.indexOne, Math.max(0, count - 1));
  return (
    <div className="flex shrink-0 items-center gap-2 pb-1 text-[11px] text-fg-muted" data-index-bar>
      <label className="inline-flex items-center gap-1">
        <span>Index</span>
        <select
          aria-label="Index"
          className="input py-0 text-[11px]"
          value={settings.indexMode}
          onChange={(e) => update({ indexMode: e.target.value as IndexMode })}
        >
          {(Object.keys(INDEX_LABELS) as IndexMode[]).map((m) => (
            <option key={m} value={m}>{INDEX_LABELS[m]}</option>
          ))}
        </select>
      </label>
      {one && (
        <span className="inline-flex items-center gap-0.5" data-index-stepper>
          <button type="button" className={BAR_BTN} aria-label="Previous index" disabled={i <= 0}
            onClick={() => update({ indexOne: stepIndex(i, -1, count) })}>
            <i className="fa-solid fa-chevron-left text-[9px]" aria-hidden="true" />
          </button>
          <span className="mono tabular-nums">{i} / {count}</span>
          <button type="button" className={BAR_BTN} aria-label="Next index" disabled={i >= count - 1}
            onClick={() => update({ indexOne: stepIndex(i, 1, count) })}>
            <i className="fa-solid fa-chevron-right text-[9px]" aria-hidden="true" />
          </button>
        </span>
      )}
    </div>
  );
}

/** How one tile renders. `single`: the card's only tile (it fills the card). */
export type RenderTile = (tile: LayoutTile, opts: { single: boolean }) => ReactNode;

interface Props {
  layout: MediaLayout;
  settings: MediaLayoutSettings;
  update: (patch: Partial<MediaLayoutSettings>) => void;
  /** Run label / colour per pane (series), in pane order. */
  panes: readonly ComparePaneOption[];
  multiRun: boolean;
  keyName: string;
  values: readonly number[];
  currentValue: number;
  /** Move the card's slider (a step column's header). */
  onValue: (value: number) => void;
  renderTile: RenderTile;
  /** The gallery's per-run panes (Run content): the card's own pane layout. */
  renderPanes: (tiles: readonly LayoutTile[]) => ReactNode;
  inModal: boolean;
  /** Grid row height in the card (the modal's is larger). */
  gridRowHeight?: number;
}

const keyLabel = (keyName: string, v: number) => `${keyName === STEP_KEY ? "step" : keyName} ${formatNum(v)}`;

/** The Index bar (lists only) and the card's tiles in its mode. */
export default function MediaTiles(props: Props) {
  const { layout, settings, update } = props;
  return (
    <>
      {layout.lists && <IndexBar settings={settings} count={layout.listCount} update={update} />}
      <TilesBody {...props} />
    </>
  );
}

function TilesBody({
  layout, settings, update, panes, multiRun, keyName, values, currentValue, onValue, renderTile, renderPanes, inModal, gridRowHeight = 140,
}: Props) {
  const compact = useCompactLayout();
  if (layout.grid) {
    const g = layout.grid;
    const header = (c: AxisCell, key: string, run?: number): GridHeader => {
      const runPrefix = run != null && multiRun ? `${panes[run]?.label ?? run} · ` : "";
      if (c.axis === "run") return { key, label: panes[c.run]?.label ?? String(c.run), color: multiRun ? panes[c.run]?.color : undefined };
      if (c.axis === "index") {
        return { key, label: `${runPrefix}#${c.index}`, color: run != null && multiRun ? panes[run]?.color : undefined };
      }
      return {
        key,
        label: `${runPrefix}${keyLabel(keyName, c.value)}`,
        color: run != null && multiRun ? panes[run]?.color : undefined,
        active: c.value === currentValue,
        onClick: () => onValue(c.value),
      };
    };
    return (
      <GridPanes
        rows={g.rows.map((r, i) => header(r.y, `r${i}`, r.run))}
        columns={g.columns.map((c, i) => header(c, `c${i}`))}
        rowHeight={inModal ? Math.round(gridRowHeight * 1.6) : gridRowHeight}
        renderCell={(row, col) => {
          const t = layout.byId.get(g.cells[row]![col]!.id);
          return t ? <div className="h-full overflow-auto">{renderTile(t, { single: false })}</div> : null;
        }}
      />
    );
  }
  if (layout.compare) {
    return (
      <ComparePanes
        slots={layout.compare.slots}
        tiles={layout.tiles}
        onSlotsChange={(slots) => update({ compareSlots: slots })}
        links={settings}
        panes={panes}
        values={values}
        keyName={keyName === STEP_KEY ? "step" : keyName}
        lists={layout.lists}
        listCount={layout.listCount}
        columns={settings.columns}
        renderSlot={(tile) => {
          const t = layout.byId.get(tile.id);
          return t ? <div className="h-full overflow-auto">{renderTile(t, { single: false })}</div> : null;
        }}
      />
    );
  }
  const gallery = layout.gallery!;
  if (gallery.layout === "panes") return <>{renderPanes(layout.tiles)}</>;
  const cols = compact ? Math.min(2, gallery.columns) : gallery.columns;
  return (
    <div
      className="grid min-h-0 flex-1 gap-1 overflow-auto"
      style={{
        gridTemplateColumns: `repeat(${Math.max(1, cols)}, minmax(0, 1fr))`,
        gridAutoRows: `minmax(${inModal ? 220 : 120}px, 1fr)`,
        height: "100%",
      }}
      data-media-tiles={gallery.content}
    >
      {layout.tiles.map((t) => (
        <div key={t.id} className="relative min-h-0 min-w-0 overflow-hidden" data-tile={t.id}>
          <LabelledPane label={multiRun ? panes[t.run]?.label : undefined} color={panes[t.run]?.color}>
            <div className="h-full overflow-auto">{renderTile(t, { single: false })}</div>
          </LabelledPane>
          {gallery.content === "step" && (
            <span className="mono pointer-events-none absolute bottom-1 left-1 z-10 rounded bg-bg/80 px-1.5 py-0.5 text-[10px] leading-none text-fg-muted">
              {keyLabel(keyName, t.value)}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
