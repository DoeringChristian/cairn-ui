/**
 * A report as a notebook: a column of cells, always editable (Jupyter-style).
 *
 * Markdown cells render until clicked; then the whole cell is one textarea,
 * committed on Shift+Enter, Cmd/Ctrl+Enter, Escape or blur. A new (empty)
 * markdown cell opens in edit mode. Cards cells (```cairn fences) are always
 * live: reorder and card settings work in place; the cell's runs and "Add
 * card" sit in its toolbar.
 *
 * Structure edits sit on the cells: a toolbar (move up/down, delete) floating
 * on the top border of the hovered or focused cell, and "+ Markdown / + Cards" in the gap between any
 * two cells (on hover; always shown on touch) and below the last one.
 *
 * `blocks[]` order is document order; ReportEditorPage serializes it to the
 * canonical markdown `source` on save.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Run } from "../../api/types";
import Markdown from "../../lib/markdown";
import {
  isCardsBlock,
  isMarkdownBlock,
  newId,
  type CardsBlock,
  type MarkdownBlock,
  type ReportBlock,
} from "../../lib/reports";
import ReportCardsBlock from "./ReportCardsBlock";
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
}: Props) {
  return (
    <div>
      <InsertGap onInsert={(type) => onInsertBlock(0, type)} />
      {blocks.map((block, idx) => (
        <div key={block.id}>
          <div className="group/cell relative rounded-lg border border-transparent p-2 transition-colors hover:border-border-subtle focus-within:border-accent/40">
            {isMarkdownBlock(block) ? (
              <>
                <CellToolbar
                  label="Markdown"
                  first={idx === 0}
                  last={idx === blocks.length - 1}
                  onMove={(dir) => onMoveBlock(block.id, dir)}
                  onDelete={() => onDeleteBlock(block.id)}
                />
                <MarkdownCell block={block} onChange={(text) => onUpdateBlock(block.id, { ...block, text })} />
              </>
            ) : isCardsBlock(block) ? (
              <ReportCardsBlock
                projectId={projectId}
                reportId={reportId}
                block={block}
                allProjectRuns={allProjectRuns}
                onChange={(next) => onUpdateBlock(block.id, next)}
                toolbar={(extra) => (
                  <CellToolbar
                    label="Cards"
                    first={idx === 0}
                    last={idx === blocks.length - 1}
                    onMove={(dir) => onMoveBlock(block.id, dir)}
                    onDelete={() => onDeleteBlock(block.id)}
                    extra={extra}
                  />
                )}
              />
            ) : null}
          </div>
          <InsertGap onInsert={(type) => onInsertBlock(idx + 1, type)} persistent={idx === blocks.length - 1} />
        </div>
      ))}
      {blocks.length === 0 && (
        <p className="px-2 py-6 text-center text-sm text-fg-subtle">Empty report — add a cell to start.</p>
      )}
    </div>
  );
}

/**
 * Cell type + cell actions + move/delete. It floats on the cell's top border
 * (outside the content, so it never covers a card's own toolbar) and is
 * revealed on hover/focus (always shown on touch). `extra` holds the cell
 * type's own actions (cards cells: add card, runs).
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

/** A markdown cell: rendered, or (after a click) the whole cell as one textarea. */
function MarkdownCell({ block, onChange }: { block: MarkdownBlock; onChange: (text: string) => void }) {
  const [editing, setEditing] = useState(block.text.trim() === "");
  const [draft, setDraft] = useState(block.text);
  const ref = useRef<HTMLTextAreaElement>(null);

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

  if (editing) {
    return (
      <textarea
        ref={ref}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Escape" || (e.key === "Enter" && (e.shiftKey || e.metaKey || e.ctrlKey))) {
            e.preventDefault();
            e.stopPropagation();
            commit();
          }
        }}
        placeholder="Markdown — Shift+Enter to render"
        rows={2}
        spellCheck={false}
        className="input block w-full resize-none overflow-hidden font-mono text-sm leading-relaxed"
      />
    );
  }
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={startEditing}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          startEditing();
        }
      }}
      className="cursor-text rounded px-1 text-sm"
      title="Click to edit"
    >
      {block.text.trim() ? <Markdown>{block.text}</Markdown> : <p className="text-fg-subtle">Empty markdown cell</p>}
    </div>
  );
}

export function makeEmptyBlock(type: CellType): ReportBlock {
  return type === "markdown"
    ? ({ id: newId(), type: "markdown", text: "" } satisfies MarkdownBlock)
    : ({ id: newId(), type: "cards", runIds: [], cards: [] } satisfies CardsBlock);
}
