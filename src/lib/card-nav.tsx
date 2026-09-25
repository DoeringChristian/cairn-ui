/**
 * ←/→ between cards in the full-screen detail modal.
 *
 * `CardNavProvider` collects the rendered order of every
 * `ReorderableCardGrid` below it (a grid without an enclosing provider makes
 * its own), and each `CardShell` that can open a detail modal registers its
 * opener. Stepping closes the current card's modal and opens the neighbour's
 * (its own `onSettings`), so each card keeps owning its modal state.
 * Order logic: lib/card-nav-order.ts.
 */

import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, type ReactNode, type RefObject } from "react";
import { flattenNavOrder, navId, navNeighbours, type NavGrid } from "./card-nav-order";

interface CardNavValue {
  registerGrid: (gridId: string, grid: NavGrid<HTMLElement>) => () => void;
  registerCard: (id: string, open: () => void) => () => void;
  neighbours: (id: string) => { prev: string | null; next: string | null };
  open: (id: string) => void;
}

const CardNavContext = createContext<CardNavValue | null>(null);
/** The nav id of the card being rendered (set per card by `ReorderableCardGrid`). */
const CardNavIdContext = createContext<string | null>(null);

const byPagePosition = (a: HTMLElement, b: HTMLElement) =>
  a === b ? 0 : a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;

export function CardNavProvider({ children }: { children: ReactNode }) {
  const grids = useRef(new Map<string, NavGrid<HTMLElement>>());
  const openers = useRef(new Map<string, () => void>());

  const value = useMemo<CardNavValue>(
    () => ({
      registerGrid: (gridId, grid) => {
        grids.current.set(gridId, grid);
        return () => {
          if (grids.current.get(gridId) === grid) grids.current.delete(gridId);
        };
      },
      registerCard: (id, open) => {
        openers.current.set(id, open);
        return () => {
          if (openers.current.get(id) === open) openers.current.delete(id);
        };
      },
      neighbours: (id) =>
        navNeighbours(flattenNavOrder(Array.from(grids.current.entries()), byPagePosition), id, (k) =>
          openers.current.has(k),
        ),
      open: (id) => openers.current.get(id)?.(),
    }),
    [],
  );
  return <CardNavContext.Provider value={value}>{children}</CardNavContext.Provider>;
}

/** Whether a `CardNavProvider` encloses this component. */
export function useHasCardNav(): boolean {
  return useContext(CardNavContext) != null;
}

/**
 * Register a grid's rendered card order. Returns the grid id; wrap each card
 * in `<CardNavItem gridId={…} cardKey={…}>`.
 */
export function useCardNavGrid(gridRef: RefObject<HTMLElement>, keys: readonly string[]): string {
  const nav = useContext(CardNavContext);
  const gridId = useId();
  const joined = keys.join("\u0001");
  useLayoutEffect(() => {
    if (!nav) return;
    return nav.registerGrid(gridId, { el: gridRef.current, keys: joined ? joined.split("\u0001") : [] });
  }, [nav, gridId, gridRef, joined]);
  return gridId;
}

export function CardNavItem({ gridId, cardKey, children }: { gridId: string; cardKey: string; children: ReactNode }) {
  return <CardNavIdContext.Provider value={navId(gridId, cardKey)}>{children}</CardNavIdContext.Provider>;
}

/**
 * For a card that can open a detail modal: register `open` while `enabled`,
 * and get prev/next steppers (undefined at either end, or outside a grid).
 * `current` re-reads the neighbours; call it while the modal is open.
 */
export function useCardNavEntry(
  open: (() => void) | undefined,
  enabled: boolean,
  modalOpen: boolean,
): { prev?: () => void; next?: () => void } {
  const nav = useContext(CardNavContext);
  const id = useContext(CardNavIdContext);
  const openRef = useRef(open);
  openRef.current = open;
  const canRegister = !!nav && !!id && enabled && !!open;
  useEffect(() => {
    if (!canRegister) return;
    return nav!.registerCard(id!, () => openRef.current?.());
  }, [canRegister, nav, id]);

  const go = useCallback((target: string) => nav?.open(target), [nav]);
  if (!nav || !id || !modalOpen) return {};
  const { prev, next } = nav.neighbours(id);
  return {
    prev: prev ? () => go(prev) : undefined,
    next: next ? () => go(next) : undefined,
  };
}
