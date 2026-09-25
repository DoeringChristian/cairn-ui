/**
 * Where a report comment thread sits.
 *
 * A thread's root carries its anchor (server `comments.anchor_kind`):
 * - `report`: the report as a whole (no cell).
 * - `card`: a card, by its id (card ids are stable in the ```cairn fence).
 * - `block`: a cell. A cards cell by its block id (stable, `id:` in the
 *   fence); a markdown cell by `#<slug>` of its first heading, because
 *   markdown cell ids regenerate on every parse. A markdown cell without a
 *   heading is anchored by a quote of its first line instead.
 * - `quote`: text inside a markdown cell. `anchor_id` is `#<slug>` of the
 *   heading whose section the text is in, or `#` when it's above every
 *   heading; `quote` is the text.
 *
 * `locateAnchor` finds the cell a thread belongs to now; a thread whose
 * cell, card, heading or quote is gone is "detached" (`null`) and listed
 * apart.
 */

import { inlinePlainText } from "../markdown/headings.ts";
import { buildOutline, type OutlineHeading } from "./outline.ts";
import type { ReportBlock } from "./types";

export type AnchorKind = "report" | "block" | "card" | "quote";

export interface CommentAnchor {
  anchor_kind: AnchorKind;
  anchor_id: string | null;
  quote: string | null;
}

/** Collapse whitespace so a selection matches its source across line breaks. */
export function normalizeText(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** A markdown cell's text as it roughly reads rendered: block markers and inline markup dropped. */
export function markdownPlainText(md: string): string {
  return normalizeText(
    md
      .split("\n")
      .map((l) =>
        inlinePlainText(
          l.replace(/^ {0,3}(#{1,6}[ \t]+|>[ \t]?|[-*+][ \t]+(\[[ xX]\][ \t]+)?|\d+[.)][ \t]+)/, ""),
        ),
      )
      .join("\n"),
  );
}

function containsQuote(block: ReportBlock, quote: string): boolean {
  return block.type === "markdown" && markdownPlainText(block.text).includes(normalizeText(quote));
}

/** Index of the block the anchor points at, or null when it can't be placed (or is report-level). */
export function locateAnchor(
  blocks: readonly ReportBlock[],
  anchor: CommentAnchor,
  outline: readonly OutlineHeading[] = buildOutline(blocks),
): number | null {
  const id = anchor.anchor_id;
  switch (anchor.anchor_kind) {
    case "report":
      return null;
    case "card": {
      const i = blocks.findIndex((b) => b.type === "cards" && b.cards.some((c) => c.id === id));
      return i >= 0 ? i : null;
    }
    case "block": {
      if (!id) return null;
      if (id.startsWith("#")) {
        const h = outline.find((o) => o.slug === id.slice(1));
        return h ? h.blockIndex : null;
      }
      const i = blocks.findIndex((b) => b.id === id);
      return i >= 0 ? i : null;
    }
    case "quote": {
      const quote = anchor.quote ?? "";
      if (!normalizeText(quote)) return null;
      // Prefer a match inside the anchored section; else anywhere.
      const slug = id?.startsWith("#") ? id.slice(1) : "";
      const h = slug ? outline.find((o) => o.slug === slug) : undefined;
      if (h) {
        const end = sectionEnd(outline, h, blocks.length);
        for (let i = h.blockIndex; i < end; i++) if (containsQuote(blocks[i]!, quote)) return i;
      }
      const i = blocks.findIndex((b) => containsQuote(b, quote));
      return i >= 0 ? i : null;
    }
  }
}

/** One past the last cell of `h`'s section (the cell of the next same-or-higher heading, inclusive). */
function sectionEnd(outline: readonly OutlineHeading[], h: OutlineHeading, nBlocks: number): number {
  const next = outline.slice(outline.indexOf(h) + 1).find((n) => n.level <= h.level);
  return next ? next.blockIndex + 1 : nBlocks;
}

/** The anchor for a comment on cell `index` as a whole. */
export function cellAnchor(
  blocks: readonly ReportBlock[],
  index: number,
  outline: readonly OutlineHeading[] = buildOutline(blocks),
): CommentAnchor {
  const b = blocks[index]!;
  if (b.type === "cards") return { anchor_kind: "block", anchor_id: b.id, quote: null };
  const first = outline.find((h) => h.blockIndex === index);
  if (first) return { anchor_kind: "block", anchor_id: `#${first.slug}`, quote: null };
  const line = b.text.split("\n").map(markdownPlainText).find((l) => l !== "") ?? "";
  return quoteAnchor(blocks, index, line.slice(0, 200), outline);
}

/** The anchor for `quote`, selected in markdown cell `index`. */
export function quoteAnchor(
  blocks: readonly ReportBlock[],
  index: number,
  quote: string,
  outline: readonly OutlineHeading[] = buildOutline(blocks),
): CommentAnchor {
  const b = blocks[index]!;
  const q = normalizeText(quote);
  // The heading above the quote: the last one in this cell above its line,
  // else the last one in an earlier cell.
  let section: OutlineHeading | undefined;
  if (b.type === "markdown") {
    const lines = b.text.split("\n");
    let quoteLine = lines.findIndex((l) => markdownPlainText(l).includes(q.slice(0, 40)));
    if (quoteLine < 0) quoteLine = lines.length;
    for (const h of outline) {
      if (h.blockIndex < index || (h.blockIndex === index && h.line <= quoteLine)) section = h;
    }
  }
  return { anchor_kind: "quote", anchor_id: section ? `#${section.slug}` : "#", quote: q };
}

/** A stable key for "the same place": threads with equal keys share a badge. */
export function anchorKey(a: CommentAnchor): string {
  return a.anchor_kind === "quote" ? `quote:${a.anchor_id ?? ""}:${a.quote ?? ""}` : `${a.anchor_kind}:${a.anchor_id ?? ""}`;
}

export interface ThreadLike {
  id: string;
  parent_id: string | null;
  created_at: string;
}

/** Group comments into threads: each root with its replies, oldest first. Orphan replies are dropped. */
export function groupThreads<C extends ThreadLike>(comments: readonly C[]): Array<{ root: C; replies: C[] }> {
  const byOrder = [...comments].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  const threads = new Map<string, { root: C; replies: C[] }>();
  for (const c of byOrder) if (c.parent_id == null) threads.set(c.id, { root: c, replies: [] });
  for (const c of byOrder) if (c.parent_id != null) threads.get(c.parent_id)?.replies.push(c);
  return [...threads.values()];
}
