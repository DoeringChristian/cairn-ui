/**
 * A report as a notebook: a column of cells, always editable (Jupyter-style).
 *
 * Markdown cells render until clicked; then the whole cell is one textarea,
 * committed on Shift+Enter, Cmd/Ctrl+Enter, Escape or blur. A new (empty)
 * markdown cell opens in edit mode. Images pasted or dropped into a markdown
 * cell upload to the report and are referenced as `cairn-asset:<hash>`.
 * Cards cells (```cairn fences) are always live: reorder and card settings
 * work in place; the cell's runs and "Add card" sit in its toolbar.
 *
 * Structure edits sit on the cells: a toolbar (move up/down, comment,
 * delete) floating on the top border of the hovered or focused cell, and
 * "+ Markdown / + Cards" in the gap between any two cells (on hover; always
 * shown on touch) and below the last one.
 *
 * Headings: the markdown cells' headings form the report's outline
 * (lib/reports/outline.ts). They get anchor ids, a table of contents
 * (`ReportToc`) and a collapse chevron; a collapsed heading hides the cells
 * of its section. Collapsed state is per browser (localStorage), never part
 * of the document, so viewers can collapse too.
 *
 * Comments (editable reports only): cells and cards show open-thread counts
 * and open their threads in a popover; selecting text in a rendered markdown
 * cell offers "Comment" on that quote; `commentsOpen` shows the report-level
 * panel (ReportCommentsPanel).
 *
 * `blocks[]` order is document order; ReportEditorPage serializes it to the
 * canonical markdown `source` on save.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Run } from "../../api/types";
import { useReportComments } from "../../api/hooks";
import Markdown, { AssetUrlContext, HeadingControlsContext, type HeadingControls } from "../../lib/markdown";
import {
  isCardsBlock,
  isMarkdownBlock,
  newId,
  type CardsBlock,
  type MarkdownBlock,
  type ReportBlock,
} from "../../lib/reports";
import {
  buildOutline,
  collapsedAncestors,
  headingSlugsByLine,
  hiddenBlocks,
  isCollapsible,
  type OutlineHeading,
} from "../../lib/reports/outline";
import { cellAnchor, groupThreads, locateAnchor, quoteAnchor, type CommentAnchor } from "../../lib/reports/comment-anchors";
import { loadJson, saveJson, storageKeys } from "../../lib/storage";
import { useReportExporting } from "../../lib/reports/export-context";
import ReportCardsBlock from "./ReportCardsBlock";
import ReportToc from "./ReportToc";
import ReportCommentsPanel from "./ReportCommentsPanel";
import { CommentsPopover } from "./CommentThread";
import { ReportCommentsContext, type CommentTarget, type CommentThreadData, type ReportCommentsApi } from "./comments-context";
import { imageFiles, useImageUpload, type UploadStatus } from "./use-image-upload";
import { CELL_TOOLBAR_BTN } from "./cell-toolbar";

type CellType = ReportBlock["type"];

interface Props {
  projectId: string;
  reportId: string;
  blocks: ReportBlock[];
  allProjectRuns: Run[];
  onUpdateBlock: (id: string, next: ReportBlock) => void;
  onMoveBlock: (id: string, dir: -1 | 1) => void;
  onDeleteBlock: (id: string) => void;
  /** Insert a new cell of `type` at position `index` (0 = top, blocks.length = end). */
  onInsertBlock: (index: number, type: CellType) => void;
  /** View mode: no structure edits, uploads or comments; markdown renders only, cards explore without saving. */
  readOnly?: boolean;
  /** Show the report-level comments panel (editable reports only). */
  commentsOpen?: boolean;
  onCommentsOpenChange?: (open: boolean) => void;
}

/** A report's collapsed heading slugs, kept in localStorage. */
function useCollapsedHeadings(reportId: string) {
  const key = storageKeys.reportCollapsed(reportId);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(loadJson<string[]>(localStorage, key) ?? []));
  useEffect(() => {
    setCollapsed(new Set(loadJson<string[]>(localStorage, key) ?? []));
  }, [key]);
  const update = useCallback(
    (fn: (prev: Set<string>) => Set<string>) =>
      setCollapsed((prev) => {
        const next = fn(prev);
        try {
          if (next.size === 0) localStorage.removeItem(key);
          else saveJson(localStorage, key, [...next]);
        } catch {
          /* disabled storage: collapse for this visit only */
        }
        return next;
      }),
    [key],
  );
  return [collapsed, update] as const;
}

/** Run `fn` once React has committed a state change (a timer, not rAF: rAF stalls in background tabs). */
function afterLayout(fn: () => void) {
  window.setTimeout(fn, 30);
}

function flash(el: Element | null) {
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.animate?.([{ outline: "2px solid rgb(var(--color-accent-rgb))" }, { outline: "2px solid transparent" }], {
    duration: 1600,
  });
}

export default function ReportNotebook({
  projectId,
  reportId,
  blocks,
  allProjectRuns,
  onUpdateBlock,
  onMoveBlock,
  onDeleteBlock,
  onInsertBlock,
  readOnly = false,
  commentsOpen = false,
  onCommentsOpenChange,
}: Props) {
  // ── Outline, TOC and collapsing ────────────────────────────────────────
  const outline = useMemo(() => buildOutline(blocks), [blocks]);
  const [storedCollapsed, setCollapsed] = useCollapsedHeadings(reportId);
  // A report export renders every section expanded (nothing is saved).
  const exporting = useReportExporting();
  const collapsed = useMemo(() => (exporting ? new Set<string>() : storedCollapsed), [exporting, storedCollapsed]);
  const hidden = useMemo(() => hiddenBlocks(outline, collapsed), [outline, collapsed]);
  const slugsByBlock = useMemo(() => {
    const m = new Map<string, Map<number, string>>();
    for (const b of blocks) if (isMarkdownBlock(b)) m.set(b.id, headingSlugsByLine(outline, b.id));
    return m;
  }, [blocks, outline]);
  const headingControls = useMemo<HeadingControls>(() => {
    const collapsible = new Set(outline.filter(isCollapsible).map((h) => h.slug));
    return {
      isCollapsible: (slug) => collapsible.has(slug),
      isCollapsed: (slug) => collapsed.has(slug),
      toggle: (slug) =>
        setCollapsed((prev) => {
          const next = new Set(prev);
          if (next.has(slug)) next.delete(slug);
          else next.add(slug);
          return next;
        }),
    };
  }, [outline, collapsed, setCollapsed]);

  /** Expand whatever hides cell `index`, then run `then` once it has rendered. */
  const reveal = useCallback(
    (index: number, then: () => void) => {
      const hiders = collapsedAncestors(outline, collapsed, index);
      if (hiders.length > 0) {
        setCollapsed((prev) => {
          const next = new Set(prev);
          for (const s of hiders) next.delete(s);
          return next;
        });
      }
      afterLayout(then);
    },
    [outline, collapsed, setCollapsed],
  );
  const navigateToHeading = useCallback(
    (h: OutlineHeading) =>
      reveal(h.blockIndex, () => {
        document.getElementById(h.slug)?.scrollIntoView({ behavior: "smooth", block: "start" });
        history.replaceState(history.state, "", `#${h.slug}`);
      }),
    [reveal],
  );

  // Open on a `#slug` link once the heading exists.
  const hashDone = useRef(false);
  useEffect(() => {
    if (hashDone.current || outline.length === 0) return;
    hashDone.current = true;
    const slug = decodeURIComponent(window.location.hash.slice(1));
    const h = outline.find((o) => o.slug === slug);
    if (h) navigateToHeading(h);
  }, [outline, navigateToHeading]);

  const resolveAsset = useCallback((hash: string) => `/api/reports/${reportId}/assets/${hash}`, [reportId]);

  // ── Comments ───────────────────────────────────────────────────────────
  const commentsQ = useReportComments(projectId, reportId, !readOnly);
  const threads = useMemo(() => groupThreads(commentsQ.data?.comments ?? []), [commentsQ.data]);
  const locations = useMemo(() => {
    const m = new Map<string, number | null>();
    for (const t of threads) m.set(t.root.id, locateAnchor(blocks, t.root, outline));
    return m;
  }, [threads, blocks, outline]);

  const [popover, setPopover] = useState<{ target: CommentTarget; anchor: CommentAnchor; title: string } | null>(null);
  const popoverAnchorRef = useRef<HTMLElement | null>(null);

  const threadsFor = useCallback(
    (target: CommentTarget): CommentThreadData[] => {
      if (target.kind === "card") {
        return threads.filter((t) => t.root.anchor_kind === "card" && t.root.anchor_id === target.cardId);
      }
      if (target.kind === "cell") {
        return threads.filter(
          (t) => t.root.anchor_kind !== "card" && t.root.anchor_kind !== "report" && locations.get(t.root.id) === target.index,
        );
      }
      const a = target.anchor;
      return threads.filter((t) => t.root.anchor_kind === "quote" && t.root.anchor_id === a.anchor_id && t.root.quote === a.quote);
    },
    [threads, locations],
  );

  const commentsApi = useMemo<ReportCommentsApi | null>(() => {
    if (readOnly) return null;
    const byCard = new Map<string, number>();
    const byCell = new Map<number, number>();
    for (const t of threads) {
      if (t.root.resolved_at != null) continue;
      if (t.root.anchor_kind === "card" && t.root.anchor_id) {
        byCard.set(t.root.anchor_id, (byCard.get(t.root.anchor_id) ?? 0) + 1);
      } else if (t.root.anchor_kind !== "report") {
        const at = locations.get(t.root.id);
        if (at != null) byCell.set(at, (byCell.get(at) ?? 0) + 1);
      }
    }
    return {
      openCountByCard: byCard,
      openCountByCell: byCell,
      open: (target, el) => {
        popoverAnchorRef.current = el;
        const anchor: CommentAnchor =
          target.kind === "card"
            ? { anchor_kind: "card", anchor_id: target.cardId, quote: null }
            : target.kind === "cell"
              ? cellAnchor(blocks, target.index, outline)
              : target.anchor;
        const title = target.kind === "card" ? "Card comments" : target.kind === "cell" ? "Cell comments" : "Comment on text";
        setPopover({ target, anchor, title });
      },
    };
  }, [readOnly, threads, locations, blocks, outline]);

  // Selecting text in a rendered markdown cell offers "Comment".
  const [selection, setSelection] = useState<{ index: number; text: string; rect: DOMRect } | null>(null);
  const quotePinned = popover?.target.kind === "quote";
  useEffect(() => {
    if (readOnly) return;
    const onChange = () => {
      if (quotePinned) return;
      const sel = window.getSelection();
      const text = sel?.toString() ?? "";
      if (!sel || sel.isCollapsed || !text.trim() || sel.rangeCount === 0) {
        setSelection(null);
        return;
      }
      const node = sel.anchorNode instanceof Element ? sel.anchorNode : sel.anchorNode?.parentElement;
      const cell = node?.closest<HTMLElement>("[data-md-cell-index]");
      if (!cell || !cell.contains(sel.focusNode)) {
        setSelection(null);
        return;
      }
      setSelection({ index: Number(cell.dataset.mdCellIndex), text, rect: sel.getRangeAt(0).getBoundingClientRect() });
    };
    document.addEventListener("selectionchange", onChange);
    return () => document.removeEventListener("selectionchange", onChange);
  }, [readOnly, quotePinned]);

  const scrollToThread = useCallback(
    (threadId: string) => {
      const t = threads.find((x) => x.root.id === threadId);
      const at = locations.get(threadId);
      if (!t || at == null) return;
      reveal(at, () => {
        const target =
          t.root.anchor_kind === "card"
            ? document.querySelector(`[data-comment-card="${CSS.escape(t.root.anchor_id ?? "")}"]`)?.closest("[data-cairn-card]")
            : document.querySelector(`[data-report-cell-index="${at}"]`);
        flash(target ?? null);
      });
    },
    [threads, locations, reveal],
  );

  const visible = blocks.map((b, idx) => ({ b, idx })).filter(({ idx }) => !hidden.has(idx));

  const cells = (
    <div className="min-w-0 flex-1">
      {!readOnly && <InsertGap onInsert={(type) => onInsertBlock(0, type)} />}
      {visible.map(({ b: block, idx }) => {
        const cellCount = commentsApi?.openCountByCell.get(idx) ?? 0;
        const commentBtn = commentsApi && (
          <button
            type="button"
            className={CELL_TOOLBAR_BTN}
            onClick={(e) => commentsApi.open({ kind: "cell", index: idx }, e.currentTarget)}
            title="Comment on this cell"
            aria-label="Comment on this cell"
          >
            <i className="fa-regular fa-comment" aria-hidden="true" />
          </button>
        );
        const toolbar = (label: string, extra?: ReactNode) => (
          <CellToolbar
            label={label}
            first={idx === 0}
            last={idx === blocks.length - 1}
            onMove={(dir) => onMoveBlock(block.id, dir)}
            onDelete={() => onDeleteBlock(block.id)}
            extra={
              <>
                {extra}
                {commentBtn}
              </>
            }
          />
        );
        return (
          <div key={block.id}>
            <div
              data-report-cell-index={idx}
              className="group/cell relative scroll-mt-4 rounded-lg border border-transparent p-2 transition-colors hover:border-border-subtle focus-within:border-accent/40"
            >
              {cellCount > 0 && commentsApi && (
                <button
                  type="button"
                  onClick={(e) => commentsApi.open({ kind: "cell", index: idx }, e.currentTarget)}
                  className="absolute left-2 -top-3 z-10 print:hidden inline-flex h-5 touch:h-8 items-center gap-1 rounded-full border border-accent/50 bg-bg-elevated px-1.5 text-[10px] text-accent shadow-sm hover:border-accent"
                  title={`${cellCount} open comment thread${cellCount === 1 ? "" : "s"}`}
                  aria-label={`${cellCount} open comment threads on this cell`}
                >
                  <i className="fa-solid fa-comment" aria-hidden="true" />
                  {cellCount}
                </button>
              )}
              {isMarkdownBlock(block) ? (
                readOnly ? (
                  <div className="px-1 text-sm">
                    {block.text.trim() ? <Markdown headingSlugs={slugsByBlock.get(block.id)}>{block.text}</Markdown> : null}
                  </div>
                ) : (
                  <>
                    {toolbar("Markdown")}
                    <MarkdownCell
                      projectId={projectId}
                      reportId={reportId}
                      index={idx}
                      block={block}
                      headingSlugs={slugsByBlock.get(block.id)}
                      onChange={(text) => onUpdateBlock(block.id, { ...block, text })}
                    />
                  </>
                )
              ) : isCardsBlock(block) ? (
                <ReportCardsBlock
                  projectId={projectId}
                  reportId={reportId}
                  block={block}
                  allProjectRuns={allProjectRuns}
                  onChange={(next) => onUpdateBlock(block.id, next)}
                  readOnly={readOnly}
                  toolbar={(extra) => toolbar("Cards", extra)}
                />
              ) : null}
            </div>
            {!readOnly && (
              <InsertGap onInsert={(type) => onInsertBlock(idx + 1, type)} persistent={idx === blocks.length - 1} />
            )}
          </div>
        );
      })}
      {blocks.length === 0 && (
        <p className="px-2 py-6 text-center text-sm text-fg-subtle">Empty report — add a cell to start.</p>
      )}
    </div>
  );

  return (
    <AssetUrlContext.Provider value={resolveAsset}>
      <HeadingControlsContext.Provider value={headingControls}>
        <ReportCommentsContext.Provider value={commentsApi}>
          <div className="lg:flex lg:gap-6">
            <ReportToc outline={outline} onNavigate={navigateToHeading} />
            {cells}
          </div>

          {commentsApi && popover && (
            <CommentsPopover
              open
              onClose={() => {
                setPopover(null);
                setSelection(null);
              }}
              anchorRef={popoverAnchorRef}
              title={popover.title}
              threads={threadsFor(popover.target)}
              anchor={popover.anchor}
              projectId={projectId}
              reportId={reportId}
            />
          )}

          {commentsApi && selection && (
            <button
              type="button"
              // Keep the selection: pressing the button must not collapse it.
              onMouseDown={(e) => e.preventDefault()}
              onPointerDown={(e) => e.preventDefault()}
              onClick={(e) => {
                const anchor = quoteAnchor(blocks, selection.index, selection.text, outline);
                commentsApi.open({ kind: "quote", anchor }, e.currentTarget);
              }}
              className="fixed z-[65] print:hidden inline-flex h-7 touch:h-10 items-center gap-1 rounded-full border border-border bg-bg-elevated px-2.5 text-xs text-fg shadow-md hover:border-accent"
              style={{
                top: Math.min(selection.rect.bottom + 6, window.innerHeight - 48),
                left: Math.max(8, Math.min(selection.rect.right - 60, window.innerWidth - 110)),
              }}
            >
              <i className="fa-regular fa-comment" aria-hidden="true" /> Comment
            </button>
          )}

          {commentsApi && commentsOpen && (
            <ReportCommentsPanel
              projectId={projectId}
              reportId={reportId}
              blocks={blocks}
              outline={outline}
              threads={threads}
              locations={locations}
              onClose={() => onCommentsOpenChange?.(false)}
              onLocate={scrollToThread}
            />
          )}
        </ReportCommentsContext.Provider>
      </HeadingControlsContext.Provider>
    </AssetUrlContext.Provider>
  );
}

/**
 * Cell type + cell actions + move/delete. It floats on the cell's top border
 * (outside the content, so it never covers a card's own toolbar) and is
 * revealed on hover/focus (always shown on touch). `extra` holds the cell
 * type's own actions (cards cells: add card, runs; every cell: comment).
 */
export function CellToolbar({
  label, first, last, onMove, onDelete, extra,
}: {
  label: string;
  first: boolean;
  last: boolean;
  onMove: (dir: -1 | 1) => void;
  onDelete: () => void;
  extra?: ReactNode;
}) {
  const btn = CELL_TOOLBAR_BTN;
  return (
    <div className="absolute right-2 -top-3.5 touch:-top-5 z-10 print:hidden flex items-center gap-0.5 rounded border border-border-subtle bg-bg-elevated px-1 shadow-sm transition-opacity can-hover:opacity-0 can-hover:group-hover/cell:opacity-100 can-hover:group-focus-within/cell:opacity-100">
      <span className="px-1 text-[10px] uppercase tracking-wide text-fg-subtle">{label}</span>
      {extra}
      <button type="button" className={btn} disabled={first} onClick={() => onMove(-1)} title="Move up" aria-label="Move cell up">
        <i className="fa-solid fa-arrow-up" aria-hidden="true" />
      </button>
      <button type="button" className={btn} disabled={last} onClick={() => onMove(1)} title="Move down" aria-label="Move cell down">
        <i className="fa-solid fa-arrow-down" aria-hidden="true" />
      </button>
      <button type="button" className={`${btn} hover:text-status-failed`} onClick={onDelete} title="Delete cell" aria-label="Delete cell">
        <i className="fa-solid fa-trash-can" aria-hidden="true" />
      </button>
    </div>
  );
}

/**
 * The gap between cells: a thin line that shows "+ Markdown / + Cards" on
 * hover (always on touch). `persistent` keeps it visible — used below the
 * last cell so there is always a way to append.
 */
function InsertGap({ onInsert, persistent = false }: { onInsert: (type: CellType) => void; persistent?: boolean }) {
  const btn =
    "inline-flex items-center gap-1 rounded-full border border-border bg-bg-elevated px-2.5 py-0.5 text-[11px] text-fg-muted hover:border-accent hover:text-fg touch:min-h-10 touch:px-3";
  return (
    <div
      className={`group/gap relative flex print:hidden h-7 touch:h-12 items-center justify-center ${
        persistent ? "" : "can-hover:opacity-0 can-hover:hover:opacity-100 focus-within:opacity-100"
      } transition-opacity`}
    >
      <div className="absolute inset-x-2 top-1/2 h-px bg-border-subtle" aria-hidden="true" />
      <div className="relative flex gap-2">
        <button type="button" className={btn} onClick={() => onInsert("markdown")}>
          <i className="fa-solid fa-plus text-[9px]" aria-hidden="true" /> Markdown
        </button>
        <button type="button" className={btn} onClick={() => onInsert("cards")}>
          <i className="fa-solid fa-plus text-[9px]" aria-hidden="true" /> Cards
        </button>
      </div>
    </div>
  );
}

/** Upload progress and errors under a markdown cell. */
function UploadList({ uploads, onDismiss }: { uploads: UploadStatus[]; onDismiss: (id: number) => void }) {
  if (uploads.length === 0) return null;
  return (
    <ul className="mt-1 flex flex-col gap-1 text-[11px]" aria-live="polite">
      {uploads.map((u) => (
        <li key={u.id} className="flex items-center gap-2">
          {u.error ? (
            <>
              <i className="fa-solid fa-circle-exclamation text-status-failed" aria-hidden="true" />
              <span className="text-status-failed">
                {u.name}: {u.error}
              </span>
              <button type="button" className="text-fg-subtle hover:text-fg" onClick={() => onDismiss(u.id)} aria-label="Dismiss">
                {"×"}
              </button>
            </>
          ) : (
            <>
              <span className="text-fg-muted">Uploading {u.name}</span>
              <span className="h-1 w-24 overflow-hidden rounded bg-bg-hover">
                <span className="block h-full bg-accent transition-[width]" style={{ width: `${Math.round(u.progress * 100)}%` }} />
              </span>
              <span className="mono text-fg-subtle">{Math.round(u.progress * 100)}%</span>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

/** A markdown cell: rendered, or (after a click) the whole cell as one textarea. */
function MarkdownCell({
  projectId,
  reportId,
  index,
  block,
  headingSlugs,
  onChange,
}: {
  projectId: string;
  reportId: string;
  index: number;
  block: MarkdownBlock;
  headingSlugs?: ReadonlyMap<number, string>;
  onChange: (text: string) => void;
}) {
  const [editing, setEditing] = useState(block.text.trim() === "");
  const [draft, setDraft] = useState(block.text);
  const [dragOver, setDragOver] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  // Latest values for upload completions, which land after any number of edits.
  const live = useRef({ editing, draft, text: block.text, onChange });
  live.current = { editing, draft, text: block.text, onChange };
  const { uploads, start, dismiss } = useImageUpload({
    projectId,
    reportId,
    replaceText: (placeholder, next) => {
      const cur = live.current;
      if (cur.editing && cur.draft.includes(placeholder)) {
        setDraft((d) => d.replace(placeholder, next));
      } else if (cur.text.includes(placeholder)) {
        cur.onChange(cur.text.replace(placeholder, next));
      }
    },
  });

  useEffect(() => {
    if (!editing) return;
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [editing]);

  // Grow with the content.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [draft, editing]);

  const startEditing = () => {
    setDraft(block.text);
    setEditing(true);
  };
  const commit = () => {
    setEditing(false);
    if (draft !== block.text) onChange(draft);
  };

  /** Insert placeholders for `files` at the caret (editing) or at the end (rendered). */
  const insertImages = (files: File[]) => {
    const text = start(files);
    const el = ref.current;
    if (editing && el) {
      const a = el.selectionStart;
      const b = el.selectionEnd;
      setDraft((d) => d.slice(0, a) + text + d.slice(b));
    } else {
      const base = block.text;
      onChange(base + (base === "" || base.endsWith("\n") ? "" : "\n\n") + text);
    }
  };
  const dropProps = {
    onDragOver: (e: React.DragEvent) => {
      if (!Array.from(e.dataTransfer.items).some((i) => i.kind === "file")) return;
      e.preventDefault();
      setDragOver(true);
    },
    onDragLeave: () => setDragOver(false),
    onDrop: (e: React.DragEvent) => {
      setDragOver(false);
      const files = imageFiles(e.dataTransfer);
      if (files.length === 0) return;
      e.preventDefault();
      insertImages(files);
    },
  };
  const dropRing = dragOver ? " outline outline-2 outline-dashed outline-accent" : "";

  if (editing) {
    return (
      <>
        <textarea
          ref={ref}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onPaste={(e) => {
            const files = imageFiles(e.clipboardData);
            if (files.length === 0) return;
            e.preventDefault();
            insertImages(files);
          }}
          {...dropProps}
          onKeyDown={(e) => {
            if (e.key === "Escape" || (e.key === "Enter" && (e.shiftKey || e.metaKey || e.ctrlKey))) {
              e.preventDefault();
              e.stopPropagation();
              commit();
            }
          }}
          placeholder="Markdown — Shift+Enter to render · paste or drop images"
          rows={2}
          spellCheck={false}
          className={`input block w-full resize-none overflow-hidden font-mono text-sm leading-relaxed${dropRing}`}
        />
        <UploadList uploads={uploads} onDismiss={dismiss} />
      </>
    );
  }
  return (
    <>
      <div
        role="button"
        tabIndex={0}
        data-md-cell-index={index}
        onClick={() => {
          // A text selection (to comment on it) is not a click to edit.
          if (window.getSelection()?.toString().trim()) return;
          startEditing();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && e.target === e.currentTarget) {
            e.preventDefault();
            startEditing();
          }
        }}
        {...dropProps}
        className={`cursor-text rounded px-1 text-sm${dropRing}`}
        title="Click to edit"
      >
        {block.text.trim() ? (
          <Markdown headingSlugs={headingSlugs}>{block.text}</Markdown>
        ) : (
          <p className="text-fg-subtle">Empty markdown cell</p>
        )}
      </div>
      <UploadList uploads={uploads} onDismiss={dismiss} />
    </>
  );
}

export function makeEmptyBlock(type: CellType): ReportBlock {
  return type === "markdown"
    ? ({ id: newId(), type: "markdown", text: "" } satisfies MarkdownBlock)
    : ({ id: newId(), type: "cards", runIds: [], cards: [] } satisfies CardsBlock);
}
