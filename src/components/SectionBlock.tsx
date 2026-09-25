/**
 * A titled, collapsible section of cards (the run page and comparisons).
 *
 * The header's actions edit the project workspace (lib/workspace): section
 * defaults (the gear), pin to top, sort A–Z; plus "send to report" when the
 * caller supplies it. The section's defaults reach its cards through
 * `SectionDefaultsProvider`. Read-only surfaces show no actions.
 */

import { useContext, useRef, useState, type ReactNode } from "react";
import { CardMutationContext } from "../lib/card-settings";
import type { CardType } from "../lib/cards/card-spec";
import { useProjectId } from "../lib/project-context";
import { SectionDefaultsProvider, type CardDefaults } from "../lib/settings-scope";
import { ops } from "../lib/workspace/doc";
import { useWorkspace } from "../lib/workspace/use-workspace";
import { HeaderToggle } from "./card-header";
import { ICON_BTN } from "./card-header/icon-btn";
import Popover from "./ui/Popover";
import DefaultsEditor from "./DefaultsEditor";

const NO_DEFAULTS: CardDefaults = Object.freeze({}) as CardDefaults;

export interface SectionBlockProps {
  sectionName: string;
  itemCount: number;
  collapsed: boolean;
  onToggleCollapse: () => void;
  /** Card types in the section; the defaults gear offers these first. */
  cardTypes?: readonly CardType[];
  /** Copy the section's cards into a new report. */
  onSendToReport?: () => Promise<void> | void;
  /** Extra header actions, left of the built-in ones. */
  actions?: ReactNode;
  children: ReactNode;
}

export default function SectionBlock({
  sectionName,
  itemCount,
  collapsed,
  onToggleCollapse,
  cardTypes,
  onSendToReport,
  actions,
  children,
}: SectionBlockProps) {
  const projectId = useProjectId();
  const { doc, readOnly, update } = useWorkspace(projectId);
  const mutable = useContext(CardMutationContext);
  const editable = mutable && !readOnly && projectId != null;
  const defaults = doc.sectionDefaults[sectionName] ?? NO_DEFAULTS;
  const pinned = doc.sections.pinned.includes(sectionName);
  const sorted = doc.sections.sort.includes(sectionName);
  const hasDefaults = Object.keys(defaults).length > 0;

  const gearRef = useRef<HTMLButtonElement>(null);
  const [defaultsOpen, setDefaultsOpen] = useState(false);
  const [sending, setSending] = useState(false);

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
      {/* MERGER: MediaSyncProvider (card-kit/media-sync.tsx) wraps this section, with SectionMediaBar in `actions`/below the header. */}
      <section data-cairn-section={sectionName}>
        <header
          className="mb-3 flex items-center justify-between gap-2 border-b border-border pb-1 cursor-pointer select-none"
          onClick={onToggleCollapse}
        >
          <div className="flex min-w-0 items-baseline gap-1.5">
            <span
              className="text-fg-subtle text-xs leading-none transition-transform"
              style={{ transform: collapsed ? "rotate(-90deg)" : undefined, display: "inline-block" }}
              aria-hidden="true"
            >
              {"▼"}
            </span>
            <h2 className="truncate text-sm font-semibold uppercase tracking-wide text-fg-muted">
              {sectionName}
            </h2>
            {pinned && <i className="fa-solid fa-thumbtack text-[10px] text-fg-subtle" aria-label="Pinned" />}
          </div>
          <div className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
            {actions}
            {editable && (
              <>
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
                <HeaderToggle
                  icon="fa-arrow-down-a-z"
                  label={sorted ? "Sorted A–Z (click for manual order)" : "Sort cards A–Z"}
                  pressed={sorted}
                  onToggle={() => update(ops.toggleSorted(sectionName), { label: sorted ? "Unsort section" : "Sort section A–Z" })}
                />
                <HeaderToggle
                  icon="fa-thumbtack"
                  label={pinned ? "Unpin section" : "Pin section to top"}
                  pressed={pinned}
                  onToggle={() => update(ops.togglePinned(sectionName), { label: pinned ? "Unpin section" : "Pin section" })}
                />
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
              </>
            )}
            <span className="ml-1 text-xs text-fg-subtle">
              {collapsed ? `${itemCount} card(s) hidden` : `${itemCount} card(s)`}
            </span>
          </div>
        </header>
        {!collapsed && children}
        {editable && projectId && (
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
            <DefaultsEditor projectId={projectId} where={{ level: "section", section: sectionName }} types={cardTypes} />
          </Popover>
        )}
      </section>
    </SectionDefaultsProvider>
  );
}
