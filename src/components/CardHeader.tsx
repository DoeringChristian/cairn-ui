import { useState, useCallback, useContext, useRef, useEffect, type ReactNode } from "react";
import { useDraggableCard } from "./DraggableCard";
import { CardMutationContext } from "../lib/card-settings";
import { useCoarsePointer, useCompactLayout } from "../lib/use-media-query";
import CardHeaderActions, { type CardActionHandlers, type MenuItem } from "./card-header/CardHeaderActions";
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
   * Screenshot and Settings stay visible; all other actions live in the overflow.
   */
  actions: CardActionHandlers;
  /** Surface-specific actions, e.g. a captured card's source reference. */
  extraMenu?: MenuItem[];
  /**
   * Touch devices: the tap-to-interact toggle (see lib/use-interact). Renders
   * an overflow action; while `on`, the card's content captures gestures.
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
  extraMenu = [],
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
  // Touch screens (no HTML5 drag) get move up / down in the overflow.
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

  const moveMenu: MenuItem[] = [...extraMenu];
  if (compact || coarse) {
    if (drag?.onMoveUp) moveMenu.push({ icon: "fa-arrow-up-long", label: "Move up", onClick: drag.onMoveUp });
    if (drag?.onMoveDown) moveMenu.push({ icon: "fa-arrow-down-long", label: "Move down", onClick: drag.onMoveDown });
  }

  if (onToggleCollapse) moveMenu.push({icon: "fa-chevron-down", label: collapsed ? "Expand card" : "Collapse card", onClick: onToggleCollapse});
  if (onTitleChange) moveMenu.push({icon: "fa-pencil", label: "Edit title", onClick: startEditing});
  if (interact) moveMenu.push({icon: "fa-hand-pointer", label: interact.on ? "Stop interacting" : "Interact with content", onClick: interact.onToggle});
  if (comments) moveMenu.push({icon: "fa-comment", label: "Comments", onClick: () => comments.open(document.activeElement as HTMLElement)});

  return (
    <div data-cairn-card-header className="group mb-2 flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
      {/* Left section: collapse chevron, drag grip, title, edit, subtitle */}
      {/* With a title addon the title stays whole: the actions wrap under it first.
          On a phone the card can be narrower than title + addon (min-width
          beats max-width), so there the addon wraps under the title instead. */}
      <div className={`flex flex-1 basis-32 items-baseline gap-1.5 ${titleAddon ? "min-w-0 max-w-full flex-wrap sm:min-w-fit sm:flex-nowrap" : "min-w-0"}`}>
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
        <CardHeaderActions actions={actions} compact={compact} extraMenu={moveMenu} extraContent={cardActions} />
      </div>
    </div>
  );
}
