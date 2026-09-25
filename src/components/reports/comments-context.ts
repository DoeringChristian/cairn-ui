/**
 * Report comment wiring shared by the notebook, its cells and the cards in
 * them. Both contexts are only provided in an editable report; read-only
 * views (viewers, share links) show no comment UI at all.
 */

import { createContext } from "react";
import type { ReportComment } from "../../api/types";
import type { CommentAnchor } from "../../lib/reports/comment-anchors";

export interface CommentThreadData {
  root: ReportComment;
  replies: ReportComment[];
}

/** What a comment popover is about. */
export type CommentTarget =
  | { kind: "card"; cardId: string }
  | { kind: "cell"; index: number }
  | { kind: "quote"; anchor: CommentAnchor };

export interface ReportCommentsApi {
  /** Open threads (unresolved) per card id. */
  openCountByCard: ReadonlyMap<string, number>;
  /** Open threads per cell index (block and quote anchors). */
  openCountByCell: ReadonlyMap<number, number>;
  /** Open the comment popover for `target`, anchored to `el`. */
  open: (target: CommentTarget, el: HTMLElement) => void;
}

export const ReportCommentsContext = createContext<ReportCommentsApi | null>(null);

/**
 * One card's comments, provided around each card of a report's cards cell;
 * CardHeader shows a count badge that opens the card's threads.
 */
export interface CardComments {
  cardId: string;
  count: number;
  open: (el: HTMLElement) => void;
}

export const CardCommentsContext = createContext<CardComments | null>(null);
