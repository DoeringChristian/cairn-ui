/**
 * One gallery point (a tracked list of media of one kind, see
 * lib/media/gallery.ts) as a grid of its items: the point's caption on top
 * (sharing its line with the pane's run chip in a multi-run card), each item
 * with its own caption — a chip over its top-right corner for pictures
 * (`captionOverlay`: video, audio), else one small line above it (text and
 * charts, whose corners hold content) — each rendered by the card's own
 * renderer for a plain point of its kind.
 *
 * Stepping never blanks or mixes steps: the grid swaps to a new step's
 * items in one commit, once its manifest is in and every item is warm
 * (`prefetchItem`; `peekItem` says synchronously that an item already is),
 * and until then keeps showing the previous step's items (see
 * lib/media/use-settled-frame.ts). Items are keyed by position, so a step
 * change reuses each item's renderer.
 */

import type { ReactNode } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { SequencePoint } from "../../api/types";
import { pointCaption } from "../../lib/caption";
import { galleryGridColumns, isGalleryPoint } from "../../lib/media/gallery";
import { loadGalleryItems, peekGalleryItems, type GalleryFrame } from "../../lib/media/gallery-query";
import { useSettledFrame } from "../../lib/media/use-settled-frame";
import { ItemCaption, RunChip, usePaneLabelInline } from "../card-kit/pane-label";

export interface GalleryItemLoaders {
  /** Warm what rendering one item needs; omitted: items need nothing ahead. */
  prefetchItem?: (item: SequencePoint, signal: AbortSignal) => Promise<unknown>;
  /** The item is warm already (checked before loading). Omitted: always. */
  peekItem?: (item: SequencePoint) => boolean;
}

async function loadFrame(qc: QueryClient, point: SequencePoint, prefetchItem: GalleryItemLoaders["prefetchItem"], signal: AbortSignal) {
  const frame = await loadGalleryItems(qc, point);
  if (prefetchItem) await Promise.allSettled(frame.itemPoints.map((p) => prefetchItem(p, signal)));
  return frame;
}

function peekFrame(qc: QueryClient, point: SequencePoint, peekItem: GalleryItemLoaders["peekItem"]) {
  const frame = peekGalleryItems(qc, point);
  if (!frame) return undefined;
  if (peekItem && !frame.itemPoints.every(peekItem)) return undefined;
  return frame;
}

/**
 * The gallery frame `point` shows: its items once all are warm, the previous
 * frame while they load, null before the first (and for a null point).
 */
export function useGalleryFrame(point: SequencePoint | null, { prefetchItem, peekItem }: GalleryItemLoaders = {}): GalleryFrame | null {
  const qc = useQueryClient();
  return useSettledFrame<GalleryFrame>(
    point?.artifact_hash ?? null,
    () => peekFrame(qc, point!, peekItem),
    (signal) => loadFrame(qc, point!, prefetchItem, signal),
  ).frame;
}

/**
 * Every gallery pane of a card, settled TOGETHER: panes side by side (runs
 * compared) swap to a new step in one commit, once every pane's gallery is
 * warm, so they never show different steps. `requests` lists the card's
 * panes by a stable id; the result maps each gallery pane's id to the frame
 * it shows (held while the next ones load), null before the first. Hand a
 * pane's frame to its `GalleryView` as `frame`.
 */
export function useSettledGalleries(
  requests: ReadonlyArray<{ id: string; point: SequencePoint | null | undefined }>,
  { prefetchItem, peekItem }: GalleryItemLoaders = {},
): Map<string, GalleryFrame> | null {
  const qc = useQueryClient();
  const galleries = requests.filter((r): r is { id: string; point: SequencePoint } => !!r.point && isGalleryPoint(r.point));
  const key = galleries.length ? galleries.map((r) => `${r.id}=${r.point.artifact_hash}`).join(" ") : null;
  return useSettledFrame<Map<string, GalleryFrame>>(
    key,
    () => {
      const out = new Map<string, GalleryFrame>();
      for (const r of galleries) {
        const frame = peekFrame(qc, r.point, peekItem);
        if (!frame) return undefined;
        out.set(r.id, frame);
      }
      return out;
    },
    async (signal) => new Map(await Promise.all(galleries.map(async (r) =>
      [r.id, await loadFrame(qc, r.point, prefetchItem, signal)] as const))),
  ).frame;
}

interface Props extends GalleryItemLoaders {
  point: SequencePoint;
  /**
   * The frame to show, settled by the card for all its panes together
   * (`useSettledGalleries`); omitted (or not yet known): the view settles
   * `point` on its own.
   */
  frame?: GalleryFrame;
  renderItem: (item: SequencePoint, index: number, count: number) => ReactNode;
  /** Grid columns: a count, or "auto" (near-square). */
  columns?: number | "auto";
  /**
   * Fill the parent's height, splitting it between equal rows (figures,
   * images); otherwise every item takes its natural height (text, players).
   */
  fill?: boolean;
  /**
   * With `fill`: rows never shrink below this (px); a gallery that needs more
   * room than its pane scrolls instead of squashing charts unreadably.
   */
  minItemHeight?: number;
  /** Item captions as chips over the items' corner (pictures), not a line above them. */
  captionOverlay?: boolean;
}

export default function GalleryView({ point, frame: given, renderItem, columns = "auto", fill = false, minItemHeight = 0, captionOverlay = false, prefetchItem, peekItem }: Props) {
  const own = useGalleryFrame(given ? null : point, { prefetchItem, peekItem });
  const frame = given ?? own;
  const caption = frame ? pointCaption(frame.point.metadata) : null;
  const run = usePaneLabelInline(!!caption);
  if (!frame) return <div className={`${fill ? "h-full" : "h-32"} motion-safe:animate-pulse rounded bg-bg-hover`} />;
  if (frame.items.length === 0) {
    return <div className="text-xs text-fg-subtle">empty gallery</div>;
  }
  const count = frame.items.length;
  const cols = galleryGridColumns(count, columns);
  return (
    <div
      className={`flex min-w-0 flex-col${fill ? " h-full min-h-0" : ""}`}
      data-gallery-step={frame.point.step}
      data-gallery-count={count}
    >
      {caption && (
        <div className="flex min-w-0 items-center gap-2 px-1 pb-1 text-xs text-fg-muted" data-pane-header>
          {run && <RunChip {...run} className="shrink-0" />}
          <span className="min-w-0 flex-1 truncate text-center" title={caption}>{caption}</span>
          {/* Balances the chip so the caption stays centred over the grid. */}
          {run && <span aria-hidden="true" className="invisible shrink-0"><RunChip {...run} /></span>}
        </div>
      )}
      <div
        className={`grid gap-2${fill ? " min-h-0 flex-1" : ""}`}
        style={{
          gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
          gridAutoRows: fill ? `minmax(${minItemHeight}px, 1fr)` : undefined,
        }}
      >
        {frame.itemPoints.map((item, i) => {
          const itemCaption = frame.items[i]!.caption;
          return (
            <div key={i} className="group/item relative flex min-h-0 min-w-0 flex-col" data-gallery-item={i}>
              {itemCaption && !captionOverlay && (
                <div className="truncate px-1 text-center text-[10px] leading-[14px] text-fg-muted" title={itemCaption} data-item-caption>
                  {itemCaption}
                </div>
              )}
              <div className={fill ? "flex min-h-0 flex-1 flex-col" : "flex min-w-0 flex-col"}>
                {renderItem(item, i, count)}
              </div>
              {itemCaption && captionOverlay && <ItemCaption text={itemCaption} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}
