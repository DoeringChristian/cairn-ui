/**
 * A report's outline: the headings of its markdown cells in document order,
 * slugged together (unique across the report), each with the range of cells
 * its section spans.
 *
 * A heading's section runs to the next heading of the same or a higher level
 * (a lower or equal `#` count), wherever that is. Collapsing works on whole
 * cells: a collapsed heading hides the cells after its own one, up to (not
 * including) the cell holding that next heading. A heading whose section ends
 * inside its own cell hides nothing and isn't collapsible.
 */

import { createSlugger, extractHeadings, type MdHeading } from "../markdown/headings.ts";
import type { ReportBlock } from "./types";

export interface OutlineHeading extends MdHeading {
  /** Index of the markdown cell the heading is in. */
  blockIndex: number;
  blockId: string;
  /** Cells `[hideStart, hideEnd)` a collapse hides; empty when not collapsible. */
  hideStart: number;
  hideEnd: number;
}

export function buildOutline(blocks: readonly ReportBlock[]): OutlineHeading[] {
  const slugger = createSlugger();
  const flat: OutlineHeading[] = [];
  blocks.forEach((b, blockIndex) => {
    if (b.type !== "markdown") return;
    for (const h of extractHeadings(b.text, slugger)) {
      flat.push({ ...h, blockIndex, blockId: b.id, hideStart: blockIndex + 1, hideEnd: blocks.length });
    }
  });
  for (let i = 0; i < flat.length; i++) {
    const h = flat[i]!;
    const next = flat.slice(i + 1).find((n) => n.level <= h.level);
    if (next) h.hideEnd = Math.max(h.hideStart, next.blockIndex);
  }
  return flat;
}

export function isCollapsible(h: OutlineHeading): boolean {
  return h.hideEnd > h.hideStart;
}

/** Indices of the cells hidden by the collapsed headings (by slug). */
export function hiddenBlocks(outline: readonly OutlineHeading[], collapsed: ReadonlySet<string>): Set<number> {
  const out = new Set<number>();
  for (const h of outline) {
    if (!collapsed.has(h.slug)) continue;
    for (let i = h.hideStart; i < h.hideEnd; i++) out.add(i);
  }
  return out;
}

/** The collapsed headings whose sections hide cell `blockIndex` (expand them to reveal it). */
export function collapsedAncestors(
  outline: readonly OutlineHeading[],
  collapsed: ReadonlySet<string>,
  blockIndex: number,
): string[] {
  return outline
    .filter((h) => collapsed.has(h.slug) && blockIndex >= h.hideStart && blockIndex < h.hideEnd)
    .map((h) => h.slug);
}

/** line → slug of one cell's headings, for `remarkHeadingIds`. */
export function headingSlugsByLine(outline: readonly OutlineHeading[], blockId: string): Map<number, string> {
  return new Map(outline.filter((h) => h.blockId === blockId).map((h) => [h.line, h.slug]));
}

/** The heading whose section cell `blockIndex` starts in: the last heading in an earlier-or-same cell. */
export function sectionHeadingAt(outline: readonly OutlineHeading[], blockIndex: number): OutlineHeading | undefined {
  let found: OutlineHeading | undefined;
  for (const h of outline) {
    if (h.blockIndex > blockIndex) break;
    found = h;
  }
  return found;
}
