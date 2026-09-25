import { useState, useCallback, useContext, useRef, useEffect, type ReactNode } from "react";
import { useDraggableCard } from "./DraggableCard";
import { CardMutationContext } from "../lib/card-settings";
import { useClickOutside } from "../lib/use-click-outside";
import { useCoarsePointer, useCompactLayout } from "../lib/use-media-query";
import { ICON_BTN } from "./card-header/icon-btn";
import { CardCommentsContext } from "./reports/comments-context";

interface Props {
  /** Metric name, e.g. "train.loss". */
  title: string;
  /** Subtle text shown after the title in the left section. */
  subtitle?: ReactNode;
  /**
   * Card-specific action buttons rendered to the LEFT of the standard
   * buttons (settings, download, remove). When present a 1px divider
   * separates them from the standard group.
   */
  cardActions?: ReactNode;
  /** If provided, the title becomes editable. */
  onTitleChange?: (newTitle: string) => void;
  /** Whether the card body is collapsed (only header visible). */
  collapsed?: boolean;
  /** Toggle collapse state. When provided, a chevron is rendered. */
  onToggleCollapse?: () => void;
  /** Opens the card settings modal / popover. Renders gear button. */
  onSettings?: () => void;
  /**
   * Reset the card's interactive view (camera/zoom/pan/etc.) to its default.
   * Renders a home-icon button to the LEFT of download, shown only when
   * `viewModified` is true.
   */
  onResetView?: () => void;
  /** Whether the view has been changed from its default; gates the reset button. */
  viewModified?: boolean;
  /** Download/export. Renders download button. */
  onDownload?: () => void;
  /** Screenshot/export-as-image. Renders camera button. */
  onScreenshot?: () => void;
  /** Slot for AddToComparisonButton in the standard cluster. */
  addToComparisonSlot?: ReactNode;
  /** Slot for AddToReportButton, next to the comparison slot. */
  addToReportSlot?: ReactNode;
  /** Remove the card. Renders close button in upper-right. */
  onRemove?: () => void;
  /**
   * Touch devices: the tap-to-interact toggle (see lib/use-interact). Renders
   * a hand button; while `on`, the card's content captures gestures.
   */
  interact?: { on: boolean; onToggle: () => void };
}


interface MenuItem {
  icon: string;
  label: string;
  onClick: () => void;
}

export default function CardHeader({
  title,
  subtitle,
  cardActions,
  onTitleChange: onTitleChangeProp,
  collapsed,
  onToggleCollapse,
  onSettings,
  onResetView,
  viewModified,
  onDownload,
  onScreenshot,
  addToComparisonSlot: addToComparisonSlotProp,
  addToReportSlot: addToReportSlotProp,
  onRemove: onRemoveProp,
  interact,
}: Props) {
  // Read-only cards (report viewers, embeds) can't be renamed, removed,
  // added elsewhere or dragged.
  const mutable = useContext(CardMutationContext);
  const onTitleChange = mutable ? onTitleChangeProp : undefined;
  const addToComparisonSlot = mutable ? addToComparisonSlotProp : undefined;
  const addToReportSlot = mutable ? addToReportSlotProp : undefined;
  // A report card's comment threads (provided in editable reports only).
  const comments = useContext(CardCommentsContext);
  const onRemove = mutable ? onRemoveProp : undefined;
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

  const showResetView = !!(onResetView && viewModified);
  const hasStandardActions = !!(
    showResetView || onDownload || onScreenshot || addToComparisonSlot || addToReportSlot || comments || onSettings || onRemove
  );

  const menuItems: MenuItem[] = [];
  if (compact) {
    if (showResetView) menuItems.push({ icon: "fa-house", label: "Reset view", onClick: onResetView! });
    if (onDownload) menuItems.push({ icon: "fa-arrow-down", label: "Save", onClick: onDownload });
    if (onScreenshot) menuItems.push({ icon: "fa-camera", label: "Screenshot", onClick: onScreenshot });
    if (onSettings) menuItems.push({ icon: "fa-gear", label: "Settings", onClick: onSettings });
  }
  if (compact || coarse) {
    if (drag?.onMoveUp) menuItems.push({ icon: "fa-arrow-up-long", label: "Move up", onClick: drag.onMoveUp });
    if (drag?.onMoveDown) menuItems.push({ icon: "fa-arrow-down-long", label: "Move down", onClick: drag.onMoveDown });
  }
  if (compact && onRemove) menuItems.push({ icon: "fa-xmark", label: "Remove card", onClick: onRemove });

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
    <div className="group mb-2 flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
      {/* Left section: collapse chevron, drag grip, title, edit, subtitle */}
      <div className="flex flex-1 basis-32 items-baseline gap-1.5 min-w-0">
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
        {subtitle && (
          <span className="min-w-0 shrink-[10000] truncate text-xs text-fg-subtle">{subtitle}</span>
        )}
      </div>

      {/* Right section: card-specific actions | divider | standard actions.
          Wraps under the title when both don't fit on one line. */}
      <div className="ml-auto flex items-center gap-1 text-xs text-fg-subtle shrink-0">
        {/* Card-specific actions */}
        {cardActions}

        {/* Standard buttons: download, settings, remove */}
        {(hasStandardActions || interactButton || menuItems.length > 0) && (
          <div className={cardActions ? "border-l border-border pl-1.5 flex items-center gap-1" : "flex items-center gap-1"}>
            {interactButton}
            {!compact && showResetView && (
              <button type="button" onClick={onResetView} className={ICON_BTN} aria-label="Reset view" title="Reset view">
                <i className="fa-solid fa-house" aria-hidden="true" />
              </button>
            )}
            {!compact && onDownload && (
              <button type="button" onClick={onDownload} className={ICON_BTN} aria-label="Save" title="Save">
                <i className="fa-solid fa-arrow-down" aria-hidden="true" />
              </button>
            )}
            {!compact && onScreenshot && (
              <button type="button" onClick={onScreenshot} className={ICON_BTN} aria-label="Screenshot" title="Screenshot">
                <i className="fa-solid fa-camera" aria-hidden="true" />
              </button>
            )}
            {addToComparisonSlot}
            {addToReportSlot}
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
            {!compact && onSettings && (
              <button type="button" onClick={onSettings} className={ICON_BTN} aria-label="Settings" title="Settings">
                <i className="fa-solid fa-gear" aria-hidden="true" />
              </button>
            )}
            {menuItems.length > 0 && <OverflowMenu items={menuItems} />}
            {!compact && onRemove && (
              <button type="button" onClick={onRemove} className={ICON_BTN} aria-label="Remove card" title="Remove card">
                <i className="fa-solid fa-xmark" aria-hidden="true" />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * "⋯" button with a small action list, right-aligned under it so it opens
 * towards the card's interior (the button sits at the card's right edge).
 */
function OverflowMenu({ items }: { items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useClickOutside(wrapRef, close, open);

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={ICON_BTN}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="More actions"
        title="More actions"
      >
        <i className="fa-solid fa-ellipsis" aria-hidden="true" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-30 mt-1 min-w-[11rem] max-w-[calc(100vw-2rem)] rounded-md border border-border bg-bg py-1 text-sm text-fg shadow-lg"
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                item.onClick();
              }}
              className="flex w-full items-center gap-2.5 px-3 py-1.5 touch:py-3 text-left hover:bg-bg-hover"
            >
              <i className={`fa-solid ${item.icon} w-4 text-center text-fg-muted`} aria-hidden="true" />
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
