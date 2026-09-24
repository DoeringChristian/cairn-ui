/** Minimum gap between an anchored panel and the viewport edges. */
export const VIEWPORT_PADDING = 8;
/** Gap between the anchor and the panel. */
export const ANCHOR_GAP = 4;
/** Below this much room on either side the panel ignores the anchor and fits the viewport. */
const MIN_USABLE_HEIGHT = 120;

export interface AnchorRect {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface PlacementInput {
  anchor: AnchorRect;
  /** Viewport size (CSS px). */
  viewportWidth: number;
  viewportHeight: number;
  /** Requested panel width, already resolved from the anchor when needed. */
  width: number;
  /** Panel height with no max-height applied. */
  naturalHeight: number;
  /** Which anchor edge the panel lines up with horizontally. */
  align: "start" | "end";
}

export interface Placement {
  top: number;
  left: number;
  width: number;
  /** The panel scrolls its body past this height. */
  maxHeight: number;
  side: "below" | "above";
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), Math.max(lo, hi));
}

/**
 * Place a fixed-position panel next to its anchor: below it unless the panel
 * fits only above (or there is more room above), aligned to the anchor's start
 * or end edge, and clamped so no part leaves the viewport. A panel taller than
 * the room on its side gets that room as its max height and scrolls.
 */
export function computePlacement({
  anchor,
  viewportWidth: vw,
  viewportHeight: vh,
  width: requestedWidth,
  naturalHeight,
  align,
}: PlacementInput): Placement {
  const pad = VIEWPORT_PADDING;
  const width = Math.max(0, Math.min(requestedWidth, vw - pad * 2));
  const left = clamp(align === "end" ? anchor.right - width : anchor.left, pad, vw - pad - width);

  const roomBelow = vh - anchor.bottom - ANCHOR_GAP - pad;
  const roomAbove = anchor.top - ANCHOR_GAP - pad;
  const side = naturalHeight <= roomBelow || roomBelow >= roomAbove ? "below" : "above";
  const fullHeight = Math.max(0, vh - pad * 2);
  // An anchor hugging an edge leaves no usable room on either side: the panel
  // then gets the whole viewport height and overlaps the anchor.
  const room = Math.min(
    fullHeight,
    Math.max(side === "below" ? roomBelow : roomAbove, Math.min(naturalHeight, MIN_USABLE_HEIGHT)),
  );
  const height = Math.min(naturalHeight, room);
  const ideal = side === "below" ? anchor.bottom + ANCHOR_GAP : anchor.top - ANCHOR_GAP - height;
  // Clamping also keeps the panel on screen while its anchor scrolls away.
  const top = clamp(ideal, pad, vh - pad - height);
  return { top, left, width, maxHeight: room, side };
}
