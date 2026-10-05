/**
 * Moving cards and sections (pure): the maths behind drag & drop in the
 * workspace grid and in Manage cards, and behind their keyboard moves
 * (Alt+↑ / Alt+↓). A move is "put card X in section S before card B" (B
 * null: at the end), or "put section S before section T".
 *
 * Moves materialize what they touch (lib/workspace/layout.ts): the
 * automatic panels of the source and target sections are written first, in
 * rendered order, so nothing else on the page moves.
 */

import { ops, type WorkspaceOp } from "./doc.ts";
import { sectionAutoPanels, type RenderedSection } from "./layout.ts";

/** Where a moved card goes. */
export interface CardSpot {
  section: string;
  /** The card it goes before; null: the end of the section. */
  beforeId: string | null;
}

/** A section's cards, in order (what a drop or a key press moves among). */
export interface CardColumn {
  name: string;
  ids: readonly string[];
}

/**
 * Dropping card `fromId` on card `toId` of the same list: it takes `toId`'s
 * place (after it when coming from before it, before it otherwise).
 * Returns the card it then sits before, null at the end.
 */
export function reorderBeforeId(ids: readonly string[], fromId: string, toId: string): string | null {
  const toIdx = ids.indexOf(toId);
  if (toIdx < 0) return null;
  const next = ids.filter((id) => id !== fromId);
  next.splice(toIdx, 0, fromId);
  return next[toIdx + 1] ?? null;
}

/** Dropping on card `targetId`'s first or second half (`after`): the card the dropped one goes before. */
export function dropBeforeId(ids: readonly string[], movingId: string, targetId: string, after: boolean): string | null {
  if (!after) return targetId;
  const rest = ids.filter((id) => id !== movingId);
  const at = rest.indexOf(targetId);
  return at < 0 ? null : (rest[at + 1] ?? null);
}

/**
 * One keyboard step of card `id` (`dir` −1 up / earlier, +1 down / later):
 * past its neighbour within the section; from a section's first place up
 * to the end of the previous section, from its last place down to the start
 * of the next. Null when there is nowhere to go.
 */
export function keyboardMove(columns: readonly CardColumn[], id: string, dir: -1 | 1): CardSpot | null {
  const ci = columns.findIndex((c) => c.ids.includes(id));
  if (ci < 0) return null;
  const ids = columns[ci]!.ids;
  const at = ids.indexOf(id);
  if (dir < 0) {
    if (at > 0) return { section: columns[ci]!.name, beforeId: ids[at - 1]! };
    const prev = columns[ci - 1];
    return prev ? { section: prev.name, beforeId: null } : null;
  }
  if (at < ids.length - 1) return { section: columns[ci]!.name, beforeId: ids[at + 2] ?? null };
  const next = columns[ci + 1];
  return next ? { section: next.name, beforeId: next.ids[0] ?? null } : null;
}

/** Whether a spot leaves card `id` where it is. */
export function isSameSpot(columns: readonly CardColumn[], id: string, spot: CardSpot): boolean {
  const col = columns.find((c) => c.ids.includes(id));
  if (!col || col.name !== spot.section) return false;
  const at = col.ids.indexOf(id);
  return spot.beforeId === id || (col.ids[at + 1] ?? null) === spot.beforeId;
}

/**
 * Move card `id` to `spot`. `sections` is what the page renders (its
 * automatic panels are materialized in the source and target sections),
 * so the order the user sees is the order written.
 */
export function moveCardOp(sections: readonly RenderedSection[], id: string, spot: CardSpot): WorkspaceOp {
  const source = sections.find((s) => s.panels.some((p) => p.panel.id === id));
  return ops.seq(
    ops.ensureSections(sections.map((s) => s.name)),
    ops.addPanels(spot.section, sectionAutoPanels(sections, spot.section)),
    source && source.name !== spot.section ? ops.addPanels(source.name, sectionAutoPanels(sections, source.name)) : (d) => d,
    ops.movePanel(id, spot.section, spot.beforeId),
  );
}

/** One keyboard step of a section: the section it then sits before (null: last), or undefined when it cannot move. */
export function sectionKeyboardBefore(names: readonly string[], name: string, dir: -1 | 1): string | null | undefined {
  const at = names.indexOf(name);
  if (at < 0) return undefined;
  if (dir < 0) return at > 0 ? names[at - 1]! : undefined;
  if (at >= names.length - 1) return undefined;
  return names[at + 2] ?? null;
}

/** Dropping section `name` on section `target`'s upper or lower half (`after`): the section it goes before. */
export function sectionDropBefore(names: readonly string[], name: string, target: string, after: boolean): string | null {
  return dropBeforeId(names, name, target, after);
}

/** Move a section before `beforeName` (null: last), every rendered section (`names`) getting its place first. */
export function moveSectionOp(names: readonly string[], name: string, beforeName: string | null): WorkspaceOp {
  return ops.seq(ops.ensureSections(names), ops.placeSection(name, beforeName));
}
