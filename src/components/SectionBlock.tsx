/**
 * A titled, collapsible section of a workspace (the run page and
 * comparisons render the same one, through components/workspace/).
 *
 * The header's actions are workspace edits the caller turns into document
 * ops: collapse, rename (double-click the name), move up / down, sort A–Z,
 * add a panel to this section (+), section defaults (the gear), send to a
 * report, delete an empty section. The section's defaults reach its cards
 * through `SectionDefaultsProvider`. Read-only surfaces show no actions.
 */

import { useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { CardMutationContext } from "../lib/card-settings";
import type { CardType } from "../lib/cards/card-spec";
import { SectionDefaultsProvider, type CardDefaults } from "../lib/settings-scope";
import { useWorkspaceRef } from "../lib/workspace/ref";
import { useWorkspace } from "../lib/workspace/use-workspace";
import { HeaderToggle } from "./card-header";
import { ICON_BTN } from "./card-header/icon-btn";
import { MediaSyncProvider, SectionMediaBar } from "./card-kit/media-sync";
import Popover from "./ui/Popover";
import DefaultsEditor from "./DefaultsEditor";

const NO_DEFAULTS: CardDefaults = Object.freeze({}) as CardDefaults;

export interface SectionActions {
  onToggleCollapse: () => void;
  onToggleSort?: () => void;
  onMove?: (delta: -1 | 1) => void;
  onRename?: (name: string) => void;
  onAddPanel?: () => void;
  onSendToReport?: () => Promise<void> | void;
  /** Only offered for an empty section. */
  onDelete?: () => void;
}

export interface SectionBlockProps extends SectionActions {
  sectionName: string;
  /** Where this section's shared media slider persists; unique per page (e.g. `run:<id>`). */
  scope?: string;
  itemCount: number;
  collapsed: boolean;
  sorted: boolean;
  /** First / last section: no move up / down. */
  first?: boolean;
  last?: boolean;
  /** Card types in the section; the defaults gear offers these first. */
  cardTypes?: readonly CardType[];
  children: ReactNode;
}

export default function SectionBlock({
  sectionName,
  scope,
  itemCount,
  collapsed,
  sorted,
  first,
  last,
  cardTypes,
  onToggleCollapse,
  onToggleSort,
  onMove,
  onRename,
  onAddPanel,
  onSendToReport,
  onDelete,
  children,
}: SectionBlockProps) {
  const wsRef = useWorkspaceRef();
  const { doc, readOnly } = useWorkspace(wsRef);
  const mutable = useContext(CardMutationContext);
  const editable = mutable && !readOnly && wsRef != null;
  const defaults = doc.sectionDefaults[sectionName] ?? NO_DEFAULTS;
  const hasDefaults = Object.keys(defaults).length > 0;

  const gearRef = useRef<HTMLButtonElement>(null);
  const [defaultsOpen, setDefaultsOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(sectionName);
  useEffect(() => {
    if (!editing) setDraft(sectionName);
  }, [sectionName, editing]);

  const commitRename = () => {
    setEditing(false);
    const t = draft.trim();
    if (t && t !== sectionName) onRename?.(t);
  };

  const send = async () => {
    if (!onSendToReport || sending) return;
    setSending(true);
    try {
      await onSendToReport();
    } finally {
      setSending(false);
    }
  };

  return (
    <SectionDefaultsProvider id={sectionName} defaults={defaults}>
      <MediaSyncProvider scopeKey={`${scope ?? "page"}:${sectionName}`}>
      <section data-cairn-section={sectionName}>
        <header
          className="mb-3 flex items-center justify-between gap-2 border-b border-border pb-1 cursor-pointer select-none"
          onClick={editing ? undefined : onToggleCollapse}
        >
          <div className="flex min-w-0 items-baseline gap-1.5">
            <span
              className="text-fg-subtle text-xs leading-none transition-transform"
              style={{ transform: collapsed ? "rotate(-90deg)" : undefined, display: "inline-block" }}
              aria-hidden="true"
            >
              {"▼"}
            </span>
            {editing ? (
              <input
                autoFocus
                className="input py-0 text-sm font-semibold"
                value={draft}
                aria-label="Section name"
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitRename();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    setEditing(false);
                  }
                }}
              />
            ) : (
              <h2
                className="truncate text-sm font-semibold uppercase tracking-wide text-fg-muted"
                title={editable && onRename ? "Double-click to rename" : undefined}
                onDoubleClick={(e) => {
                  if (!editable || !onRename) return;
                  e.stopPropagation();
                  setEditing(true);
                }}
              >
                {sectionName}
              </h2>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
            {editable && (
              <>
                {onAddPanel && (
                  <button
                    type="button"
                    onClick={onAddPanel}
                    className={ICON_BTN}
                    aria-label={`Add a card to ${sectionName}`}
                    title="Add a card to this section (card builder)"
                    data-testid="section-add-panel"
                  >
                    <i className="fa-solid fa-plus" aria-hidden="true" />
                  </button>
                )}
                <button
                  ref={gearRef}
                  type="button"
                  onClick={() => setDefaultsOpen((v) => !v)}
                  className={`${ICON_BTN}${hasDefaults ? " !text-accent" : ""}`}
                  aria-label="Section defaults"
                  title={hasDefaults ? "Section defaults (set)" : "Section defaults"}
                >
                  <i className="fa-solid fa-gear" aria-hidden="true" />
                </button>
                {onToggleSort && (
                  <HeaderToggle
                    icon="fa-arrow-down-a-z"
                    label={sorted ? "Sorted A–Z (click for manual order)" : "Sort cards A–Z"}
                    pressed={sorted}
                    onToggle={onToggleSort}
                  />
                )}
                {onMove && (
                  <>
                    <button
                      type="button"
                      onClick={() => onMove(-1)}
                      disabled={first}
                      className={`${ICON_BTN} disabled:opacity-30`}
                      aria-label="Move section up"
                      title="Move section up"
                    >
                      <i className="fa-solid fa-arrow-up" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onMove(1)}
                      disabled={last}
                      className={`${ICON_BTN} disabled:opacity-30`}
                      aria-label="Move section down"
                      title="Move section down"
                    >
                      <i className="fa-solid fa-arrow-down" aria-hidden="true" />
                    </button>
                  </>
                )}
                {onSendToReport && (
                  <button
                    type="button"
                    onClick={() => void send()}
                    disabled={sending}
                    className={`${ICON_BTN} disabled:opacity-40`}
                    aria-label="Send section to a new report"
                    title="Send section to a new report"
                  >
                    <i className={`fa-solid ${sending ? "fa-spinner fa-spin" : "fa-file-export"}`} aria-hidden="true" />
                  </button>
                )}
                {onDelete && (
                  <button
                    type="button"
                    onClick={onDelete}
                    className={ICON_BTN}
                    aria-label="Delete empty section"
                    title="Delete this empty section"
                  >
                    <i className="fa-solid fa-trash-can" aria-hidden="true" />
                  </button>
                )}
              </>
            )}
            <span className="ml-1 text-xs text-fg-subtle">
              {collapsed ? `${itemCount} card(s) hidden` : `${itemCount} card(s)`}
            </span>
          </div>
        </header>
        {!collapsed && <SectionMediaBar className="mb-3" />}
        {!collapsed && children}
        {editable && wsRef && (
          <Popover
            open={defaultsOpen}
            onClose={() => setDefaultsOpen(false)}
            anchorRef={gearRef}
            title={`Defaults for “${sectionName}”`}
            titleAnchored
            width={384}
            align="end"
            bodyClassName="p-4"
          >
            <DefaultsEditor wsRef={wsRef} where={{ level: "section", section: sectionName }} types={cardTypes} />
          </Popover>
        )}
      </section>
      </MediaSyncProvider>
    </SectionDefaultsProvider>
  );
}
