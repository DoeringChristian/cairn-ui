/**
 * Full-screen card navigation order (pure); lib/card-nav.tsx binds it.
 *
 * Every `ReorderableCardGrid` under a `CardNavProvider` reports its cards in
 * rendered order; grids are concatenated in page (DOM) order. ←/→ in a
 * card's detail modal step to the nearest card that can open one (a
 * collapsed card or one without a modal is skipped). No wrap-around.
 */

export interface NavGrid<E> {
  /** The grid's element, for page-order sorting. */
  el: E | null;
  /** Card keys in rendered order. */
  keys: readonly string[];
}

/** An entry id unique across grids. */
export const navId = (gridId: string, key: string) => `${gridId}\u0000${key}`;

/**
 * Flatten grids into one order. `compare(a, b)` orders two grid elements by
 * page position (negative when `a` comes first); grids without an element
 * keep their registration order after the placed ones.
 */
export function flattenNavOrder<E>(
  grids: ReadonlyArray<[gridId: string, grid: NavGrid<E>]>,
  compare: (a: E, b: E) => number,
): string[] {
  const placed = grids.filter(([, g]) => g.el != null);
  const unplaced = grids.filter(([, g]) => g.el == null);
  placed.sort(([, a], [, b]) => compare(a.el as E, b.el as E));
  return [...placed, ...unplaced].flatMap(([id, g]) => g.keys.map((k) => navId(id, k)));
}

/** The previous and next openable entries around `current`. */
export function navNeighbours(
  order: readonly string[],
  current: string,
  canOpen: (id: string) => boolean,
): { prev: string | null; next: string | null } {
  const i = order.indexOf(current);
  if (i < 0) return { prev: null, next: null };
  let prev: string | null = null;
  for (let j = i - 1; j >= 0; j--) {
    if (canOpen(order[j]!)) {
      prev = order[j]!;
      break;
    }
  }
  let next: string | null = null;
  for (let j = i + 1; j < order.length; j++) {
    if (canOpen(order[j]!)) {
      next = order[j]!;
      break;
    }
  }
  return { prev, next };
}
