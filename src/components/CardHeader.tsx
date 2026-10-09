import { useState, useCallback, useContext, useRef, useEffect, type ReactNode } from "react";
import { useDraggableCard } from "./DraggableCard";
import { CardMutationContext } from "../lib/card-settings";
import { useCoarsePointer, useCompactLayout } from "../lib/use-media-query";
import { ICON_BTN } from "./card-header/icon-btn";
import CardHeaderActions, { OverflowMenu, type CardActionHandlers, type MenuItem } from "./card-header/CardHeaderActions";
import { CardCommentsContext } from "./reports/comments-context";

interface Props {
  /** Metric name, e.g. "train.loss". */
  title: string;
  /** Subtle text shown after the title in the left section. */
  subtitle?: ReactNode;
  /** Part of the title after its text, kept whole (a picker: `Parameter importance for [eval/mse ▾]`). */
  titleAddon?: ReactNode;
  /** Card-specific controls, left of the bar (log scale, badges, …). */
  cardActions?: ReactNode;
  /** If provided, the title becomes editable. */
  onTitleChange?: (newTitle: string) => void;
  /** Whether the card body is collapsed (only header visible). */
  collapsed?: boolean;
  /** Toggle collapse state. When provided, a chevron is rendered. */
  onToggleCollapse?: () => void;
  /**
   * The shared actions right of the bar (components/card-header/CardHeaderActions):
   * the same seven, in the same order, on every card; read-only cards get four.
   */
  actions: CardActionHandlers;
  /**
   * Touch devices: the tap-to-interact toggle (see lib/use-interact). Renders
   * a hand button; while `on`, the card's content captures gestures.
   */
  interact?: { on: boolean; onToggle: () => void };
}



export default function CardHeader({
  title,
  subtitle,
  titleAddon,
  cardActions,
  onTitleChange: onTitleChangeProp,
  collapsed,
  onToggleCollapse,
  actions: actionsProp,
  interact,
}: Props) {
  // Read-only cards (report viewers, embeds) can't be renamed, removed,
  // added elsewhere or dragged.
  const mutable = useContext(CardMutationContext);
  const onTitleChange = mutable ? onTitleChangeProp : undefined;

  // A report card's comment threads (provided in editable reports only).
  const comments = useContext(CardCommentsContext);
  // Adding to a report, duplicating and removing edit: not on read-only cards.
  const actions: CardActionHandlers = mutable
    ? actionsProp
    : { onScreenshot: actionsProp.onScreenshot, onDownload: actionsProp.onDownload, onResetView: actionsProp.onResetView, onSettings: actionsProp.onSettings };
  const dragCtx = useDraggableCard();
  const drag = mutable ? dragCtx : null;
  // Below `md` the standard actions fold into a "⋯" menu so the title keeps
  // its room; touch screens (no HTML5 drag) get move up / down there too.
  const compact = useCompactLayout();
  const coarse = useCoarsePointer();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) setDraft(title);
  }, [title, editing]);

  const commitEdit = useCallback(() => {
    setEditing(false);
    const trimmed = draft.trim();
    onTitleChange?.(trimmed || title);
  }, [draft, title, onTitleChange]);

  const cancelEdit = useCallback(() => {
    setEditing(false);
    setDraft(title);
  }, [title]);

  const startEditing = useCallback(() => {
    if (!onTitleChange) return;
    setDraft(title);
    setEditing(true);
  }, [onTitleChange, title]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        commitEdit();
      } else if (e.key === "Escape") {
        e.preventDefault();
        cancelEdit();
      }
    },
    [commitEdit, cancelEdit],
  );

  const moveMenu: MenuItem[] = [];
  if (compact || coarse) {
    if (drag?.onMoveUp) moveMenu.push({ icon: "fa-arrow-up-long", label: "Move up", onClick: drag.onMoveUp });
    if (drag?.onMoveDown) moveMenu.push({ icon: "fa-arrow-down-long", label: "Move down", onClick: drag.onMoveDown });
  }

  const interactButton = interact && (
    <button
      type="button"
      onClick={interact.onToggle}
      className={`${ICON_BTN}${interact.on ? " bg-accent/15 !text-accent" : ""}`}
      aria-pressed={interact.on}
      aria-label={interact.on ? "Stop interacting (scroll the page)" : "Interact with the content"}
      title={interact.on ? "Stop interacting" : "Interact"}
    >
      <i className="fa-solid fa-hand-pointer" aria-hidden="true" />
    </button>
  );

  return (
    <div data-cairn-card-header className="group mb-2 flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
      {/* Left section: collapse chevron, drag grip, title, edit, subtitle */}
      {/* With a title addon the title stays whole: the actions wrap under it first.
          On a phone the card can be narrower than title + addon (min-width
          beats max-width), so there the addon wraps under the title instead. */}
      <div className={`flex flex-1 basis-32 items-baseline gap-1.5 ${titleAddon ? "min-w-0 max-w-full flex-wrap sm:min-w-fit sm:flex-nowrap" : "min-w-0"}`}>
        {onToggleCollapse && (
          <button
            type="button"
            onClick={onToggleCollapse}
            className="h-[22px] min-w-[22px] touch:h-10 touch:min-w-[40px] inline-flex items-center justify-center select-none text-fg-subtle hover:text-fg text-xs leading-none transition-transform"
            style={{ transform: collapsed ? "rotate(-90deg)" : undefined }}
            aria-label={collapsed ? "Expand card" : "Collapse card"}
            title={collapsed ? "Expand card" : "Collapse card"}
          >
            <i className="fa-solid fa-chevron-down" aria-hidden="true" />
          </button>
        )}
        <span
          aria-hidden="true"
          draggable={!!drag}
          onDragStart={drag?.handleDragStart}
          onDragEnd={drag?.handleDragEnd}
          className={[
            "cairn-drag-grip select-none text-fg-subtle transition-opacity touch:hidden",
            drag ? "cursor-grab active:cursor-grabbing" : "",
            "opacity-0",
          ].join(" ")}
          title="Drag to reorder"
        >
          <i className="fa-solid fa-grip-vertical" aria-hidden="true" />
        </span>

        {editing ? (
          <input
            ref={inputRef}
            className="input mono text-sm font-semibold"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={handleKeyDown}
            autoFocus
          />
        ) : (
          <>
            <h3
              // The title keeps its width; the subtitle gives way first.
              className="mono text-sm font-semibold truncate min-w-0"
              onDoubleClick={startEditing}
            >
              {title}
            </h3>
            {onTitleChange && (
              <button
                type="button"
                onClick={startEditing}
                className="h-[22px] min-w-[22px] touch:h-10 touch:min-w-[40px] shrink-0 inline-flex items-center justify-center text-fg-subtle transition-opacity can-hover:opacity-0 can-hover:group-hover:opacity-100"
                title="Edit title"
                aria-label="Edit title"
              >
                <i className="fa-solid fa-pencil" aria-hidden="true" />
              </button>
            )}
          </>
        )}
        {titleAddon && <span className="shrink-0">{titleAddon}</span>}
        {subtitle && (
          <span className="min-w-0 shrink-[10000] truncate text-xs text-fg-subtle">{subtitle}</span>
        )}
      </div>

      {/* Right section: card-specific controls | bar | the shared actions.
          Wraps under the title when both don't fit on one line. */}
      <div className="ml-auto flex items-center gap-1 text-xs text-fg-subtle shrink-0">
        {cardActions}
        {interactButton}
        {comments && (
          <button
            type="button"
            data-comment-card={comments.cardId}
            onClick={(e) => comments.open(e.currentTarget)}
            className={comments.count > 0 ? `${ICON_BTN.replace("text-fg-muted", "text-accent")} gap-0.5 px-1` : ICON_BTN}
            aria-label={comments.count > 0 ? `${comments.count} open comment threads` : "Comment on this card"}
            title={comments.count > 0 ? `${comments.count} open comment thread${comments.count === 1 ? "" : "s"}` : "Comment"}
          >
            <i className={`${comments.count > 0 ? "fa-solid" : "fa-regular"} fa-comment`} aria-hidden="true" />
            {comments.count > 0 && <span className="text-[10px] leading-none">{comments.count}</span>}
          </button>
        )}
        {!compact && moveMenu.length > 0 && <OverflowMenu items={moveMenu} />}
        <div className="border-l border-border pl-1.5">
          <CardHeaderActions actions={actions} compact={compact} extraMenu={compact ? moveMenu : []} />
        </div>
      </div>
    </div>
  );
}
