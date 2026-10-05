/**
 * Manage cards: every card of a workspace — shown, hidden, automatic,
 * removed and (with unlisted metrics off) not shown — by section, with show
 * / hide, edit (the card's gear), duplicate and delete.
 *
 * The cards and sections are arranged by drag & drop: drag a card's grip
 * onto another card (before or after it, by the half it is dropped on) or
 * onto a section (its end), and drag a section's grip onto another section.
 * The keyboard does the same: Alt+↑ / Alt+↓ on a grip moves the card one
 * place (across into the neighbouring section at either end), or the
 * section one place. Every move applies to the workspace at once, as an
 * undoable op (lib/workspace/reorder.ts).
 */

import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import Dialog from "../ui/Dialog";
import { builderTypeLabel, type CardStatus, type CatalogueEntry } from "../../lib/workspace/card-builder";
import { dropBeforeId, isSameSpot, keyboardMove, sectionDropBefore, sectionKeyboardBefore, type CardColumn, type CardSpot } from "../../lib/workspace/reorder";

export interface ManageActions {
  /** Show a hidden / removed / not-shown card, or hide a shown one. */
  toggle: (e: CatalogueEntry) => void;
  duplicate: (e: CatalogueEntry) => void;
  remove: (e: CatalogueEntry) => void;
  /** Open a card's editor (its gear). */
  edit: (e: CatalogueEntry) => void;
  moveCard: (id: string, spot: CardSpot) => void;
  moveSection: (name: string, beforeName: string | null) => void;
}

interface Props {
  onClose: () => void;
  catalogue: readonly CatalogueEntry[];
  /** The sections the page renders, in order: the ones cards and sections move among. */
  sections: readonly string[];
  autoPanels: boolean;
  onToggleAutoPanels: () => void;
  manage: ManageActions;
}

const STATUS_LABEL: Record<CardStatus, string> = {
  listed: "shown",
  hidden: "hidden",
  auto: "automatic",
  removed: "removed",
  unlisted: "not shown",
};
const STATUS_TITLE: Record<CardStatus, string> = {
  listed: "A card of this workspace's layout",
  hidden: "Kept in the layout, not shown",
  auto: "Shown automatically for a series no card claims",
  removed: "An automatic card that was removed",
  unlisted: "Unlisted metrics are off: this series has no card",
};
const ICON =
  "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-fg-muted hover:bg-bg-hover hover:text-fg touch:h-10 touch:w-10";
const GRIP = `${ICON} cursor-grab active:cursor-grabbing focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent`;
const KIND_BADGE = "shrink-0 rounded bg-bg-hover px-1.5 py-0.5 text-[10px] text-fg-muted";

const CARD_MIME = "application/x-cairn-manage-card";
const SECTION_MIME = "application/x-cairn-manage-section";

/** Where a drag would land, for the insertion mark. */
type Over =
  | { kind: "card"; id: string; after: boolean }
  | { kind: "section-end"; name: string }
  | { kind: "section"; name: string; after: boolean };

const movable = (e: CatalogueEntry) => e.status === "listed" || e.status === "hidden" || e.status === "auto";
const lowerHalf = (ev: DragEvent<HTMLElement>) => {
  const r = ev.currentTarget.getBoundingClientRect();
  return ev.clientY > r.top + r.height / 2;
};

export default function ManageCards({ onClose, catalogue, sections, autoPanels, onToggleAutoPanels, manage }: Props) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<CardStatus | "all">("all");
  const [over, setOver] = useState<Over | null>(null);
  const dragging = useRef<{ kind: "card"; id: string } | { kind: "section"; name: string } | null>(null);
  // After a keyboard move the grip remounts (another list): focus follows it.
  const [refocus, setRefocus] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const q = query.trim().toLowerCase();
  const shown = catalogue.filter(
    (e) => (status === "all" || e.status === status) && (!q || e.label.toLowerCase().includes(q) || e.section.toLowerCase().includes(q)),
  );
  const counts = new Map<CardStatus, number>();
  for (const e of catalogue) counts.set(e.status, (counts.get(e.status) ?? 0) + 1);

  // Sections as the page renders them, then any others the catalogue names (removed cards' sections).
  const groups = useMemo(() => {
    const by = new Map<string, CatalogueEntry[]>(sections.map((s) => [s, []]));
    for (const e of shown) by.set(e.section, [...(by.get(e.section) ?? []), e]);
    return [...by.entries()].filter(([name, entries]) => entries.length > 0 || (!q && status === "all" && sections.includes(name)));
  }, [shown, sections, q, status]);
  const columns: CardColumn[] = useMemo(
    () => sections.map((name) => ({ name, ids: shown.filter((e) => e.section === name && movable(e)).map((e) => e.panel.id) })),
    [sections, shown],
  );

  useEffect(() => {
    if (!refocus) return;
    listRef.current?.querySelector<HTMLElement>(`[data-grip="${CSS.escape(refocus)}"]`)?.focus();
    setRefocus(null);
  }, [refocus, catalogue]);

  const moveCard = (id: string, spot: CardSpot) => {
    if (isSameSpot(columns, id, spot)) return;
    manage.moveCard(id, spot);
  };

  // --- drag & drop -------------------------------------------------------------
  const startDrag = (ev: DragEvent<HTMLElement>, what: { kind: "card"; id: string } | { kind: "section"; name: string }) => {
    dragging.current = what;
    ev.dataTransfer.effectAllowed = "move";
    ev.dataTransfer.setData(what.kind === "card" ? CARD_MIME : SECTION_MIME, what.kind === "card" ? what.id : what.name);
    const row = (ev.currentTarget as HTMLElement).closest("[data-drag-image]");
    if (row) ev.dataTransfer.setDragImage(row, 12, 12);
  };
  const endDrag = () => {
    dragging.current = null;
    setOver(null);
  };
  const accepts = (ev: DragEvent<HTMLElement>, kind: "card" | "section") =>
    ev.dataTransfer.types.includes(kind === "card" ? CARD_MIME : SECTION_MIME);
  const hover = (ev: DragEvent<HTMLElement>, next: Over) => {
    ev.preventDefault();
    ev.stopPropagation();
    ev.dataTransfer.dropEffect = "move";
    setOver((o) => (JSON.stringify(o) === JSON.stringify(next) ? o : next));
  };

  const cardRowDnd = (e: CatalogueEntry) =>
    movable(e)
      ? {
          onDragOver: (ev: DragEvent<HTMLElement>) => accepts(ev, "card") && hover(ev, { kind: "card", id: e.panel.id, after: lowerHalf(ev) }),
          onDrop: (ev: DragEvent<HTMLElement>) => {
            const id = ev.dataTransfer.getData(CARD_MIME);
            if (!id) return;
            ev.preventDefault();
            ev.stopPropagation();
            const ids = columns.find((c) => c.name === e.section)?.ids ?? [];
            if (id !== e.panel.id) moveCard(id, { section: e.section, beforeId: dropBeforeId(ids, id, e.panel.id, lowerHalf(ev)) });
            endDrag();
          },
        }
      : {};
  const sectionDnd = (name: string) =>
    sections.includes(name)
      ? {
          onDragOver: (ev: DragEvent<HTMLElement>) => {
            if (accepts(ev, "section")) hover(ev, { kind: "section", name, after: lowerHalf(ev) });
            else if (accepts(ev, "card")) hover(ev, { kind: "section-end", name });
          },
          onDrop: (ev: DragEvent<HTMLElement>) => {
            const card = ev.dataTransfer.getData(CARD_MIME);
            const sec = ev.dataTransfer.getData(SECTION_MIME);
            if (!card && !sec) return;
            ev.preventDefault();
            ev.stopPropagation();
            if (card) moveCard(card, { section: name, beforeId: null });
            else if (sec && sec !== name) manage.moveSection(sec, sectionDropBefore(sections, sec, name, lowerHalf(ev)));
            endDrag();
          },
        }
      : {};

  // --- keyboard ----------------------------------------------------------------
  const cardKey = (e: CatalogueEntry) => (ev: KeyboardEvent<HTMLElement>) => {
    if (!ev.altKey || (ev.key !== "ArrowUp" && ev.key !== "ArrowDown")) return;
    ev.preventDefault();
    const spot = keyboardMove(columns, e.panel.id, ev.key === "ArrowUp" ? -1 : 1);
    if (!spot) return;
    moveCard(e.panel.id, spot);
    setRefocus(e.panel.id);
  };
  const sectionKey = (name: string) => (ev: KeyboardEvent<HTMLElement>) => {
    if (!ev.altKey || (ev.key !== "ArrowUp" && ev.key !== "ArrowDown")) return;
    ev.preventDefault();
    const before = sectionKeyboardBefore(sections, name, ev.key === "ArrowUp" ? -1 : 1);
    if (before === undefined) return;
    manage.moveSection(name, before);
    setRefocus(`section:${name}`);
  };

  const mark = (on: boolean, edge: "top" | "bottom") =>
    on ? (edge === "top" ? "shadow-[inset_0_2px_0_0_var(--color-accent,#0969da)]" : "shadow-[inset_0_-2px_0_0_var(--color-accent,#0969da)]") : "";

  return (
    <Dialog open onClose={onClose} title="Manage cards" size="6xl" fill>
      <div className="flex min-h-0 flex-1 flex-col" data-testid="manage-cards-dialog">
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-2">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter cards…"
            aria-label="Filter cards"
            className="input min-w-[10rem] flex-1 py-1 text-sm"
          />
          {(["all", "listed", "auto", "hidden", "removed", "unlisted"] as const).map((s) =>
            s !== "all" && !counts.get(s) ? null : (
              <button
                key={s}
                type="button"
                onClick={() => setStatus(s)}
                aria-pressed={status === s}
                className={`rounded-full border px-2 py-0.5 text-xs touch:min-h-10 ${
                  status === s ? "border-accent text-fg" : "border-border text-fg-muted hover:text-fg"
                }`}
              >
                {s === "all" ? `all ${catalogue.length}` : `${STATUS_LABEL[s]} ${counts.get(s)}`}
              </button>
            ),
          )}
          <label className="ml-auto inline-flex items-center gap-1.5 text-xs text-fg-muted" title="Metrics no card shows get automatic cards">
            <input type="checkbox" checked={autoPanels} onChange={onToggleAutoPanels} data-testid="manage-auto-panels" />
            Include unlisted metrics
          </label>
        </div>
        <p className="shrink-0 border-b border-border-subtle px-4 py-1.5 text-[11px] text-fg-subtle">
          Drag a grip <i className="fa-solid fa-grip-vertical" aria-hidden="true" /> to move a card or a section, or focus it and press Alt+↑ / Alt+↓.
        </p>
        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto" data-testid="manage-cards" onDragEnd={endDrag}>
          {groups.length === 0 && <p className="p-4 text-sm text-fg-muted">No cards match.</p>}
          {groups.map(([section, entries]) => {
            const canMove = sections.includes(section);
            const o = over;
            return (
              <section
                key={section}
                aria-label={section}
                data-manage-section={section}
                {...sectionDnd(section)}
                className={`${o?.kind === "section-end" && o.name === section ? "bg-accent/5" : ""} ${mark(o?.kind === "section" && o.name === section && !o.after, "top")} ${mark(o?.kind === "section" && o.name === section && o.after, "bottom")}`}
              >
                <h4
                  className="sticky top-0 z-10 flex items-center gap-1 border-b border-border-subtle bg-bg-elevated px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-fg-muted"
                  data-drag-image
                >
                  {canMove ? (
                    <button
                      type="button"
                      className={GRIP}
                      draggable
                      onDragStart={(ev) => startDrag(ev, { kind: "section", name: section })}
                      onKeyDown={sectionKey(section)}
                      aria-label={`Move section ${section} (Alt+↑ / Alt+↓)`}
                      title="Drag to move the section, or Alt+↑ / Alt+↓"
                      data-grip={`section:${section}`}
                    >
                      <i className="fa-solid fa-grip-vertical" aria-hidden="true" />
                    </button>
                  ) : (
                    <span className="inline-block w-6" />
                  )}
                  {section}
                  <span className="font-normal normal-case tracking-normal text-fg-subtle">{entries.length}</span>
                </h4>
                <ul className="divide-y divide-border-subtle">
                  {entries.map((e) => (
                    <ManageRow
                      key={`${e.status === "removed" || e.status === "unlisted" ? e.status : "card"}:${e.panel.id}`}
                      entry={e}
                      manage={manage}
                      overMark={`${mark(o?.kind === "card" && o.id === e.panel.id && !o.after, "top")} ${mark(o?.kind === "card" && o.id === e.panel.id && o.after, "bottom")}`}
                      dnd={cardRowDnd(e)}
                      onGripDragStart={(ev) => startDrag(ev, { kind: "card", id: e.panel.id })}
                      onGripKeyDown={cardKey(e)}
                    />
                  ))}
                  {entries.length === 0 && <li className="px-4 py-2 text-xs text-fg-subtle">No cards — drop one here.</li>}
                </ul>
              </section>
            );
          })}
        </div>
      </div>
    </Dialog>
  );
}

function ManageRow({
  entry: e,
  manage,
  overMark,
  dnd,
  onGripDragStart,
  onGripKeyDown,
}: {
  entry: CatalogueEntry;
  manage: ManageActions;
  overMark: string;
  dnd: Partial<Record<"onDragOver" | "onDrop", (ev: DragEvent<HTMLElement>) => void>>;
  onGripDragStart: (ev: DragEvent<HTMLElement>) => void;
  onGripKeyDown: (ev: KeyboardEvent<HTMLElement>) => void;
}) {
  const visible = e.status === "listed" || e.status === "auto";
  const inLayout = movable(e);
  return (
    <li
      className={`flex flex-wrap items-center gap-2 bg-bg-elevated px-2 py-1.5 text-sm ${overMark}`}
      data-card-entry={e.panel.id}
      data-status={e.status}
      data-drag-image
      {...dnd}
    >
      {inLayout ? (
        <button
          type="button"
          className={GRIP}
          draggable
          onDragStart={onGripDragStart}
          onKeyDown={onGripKeyDown}
          aria-label={`Move ${e.label} (Alt+↑ / Alt+↓)`}
          title="Drag to move the card, or Alt+↑ / Alt+↓"
          data-grip={e.panel.id}
        >
          <i className="fa-solid fa-grip-vertical" aria-hidden="true" />
        </button>
      ) : (
        <span className="inline-block w-6" />
      )}
      <button
        type="button"
        className={ICON}
        onClick={() => manage.toggle(e)}
        aria-label={visible ? `Hide ${e.label}` : `Show ${e.label}`}
        title={visible ? "Hide" : "Show"}
      >
        <i className={`fa-solid ${visible ? "fa-eye" : "fa-eye-slash"}`} aria-hidden="true" />
      </button>
      <span className={`mono min-w-0 flex-1 truncate ${visible ? "text-fg" : "text-fg-subtle"}`} title={e.label}>
        {e.label}
      </span>
      <span className={KIND_BADGE}>{builderTypeLabel(e.panel.type)}</span>
      <span className="w-20 shrink-0 text-[11px] text-fg-muted" title={STATUS_TITLE[e.status]}>
        {STATUS_LABEL[e.status]}
      </span>
      {e.patternHidden && (
        <span className="shrink-0 text-[11px] text-fg-subtle" title="A hide pattern of the toolbar hides it">
          <i className="fa-solid fa-filter" aria-hidden="true" /> pattern
        </span>
      )}
      {inLayout && (
        <>
          <button type="button" className={ICON} onClick={() => manage.edit(e)} aria-label={`Edit ${e.label}`} title="Edit (the card's gear)">
            <i className="fa-solid fa-pen-to-square" aria-hidden="true" />
          </button>
          <button type="button" className={ICON} onClick={() => manage.duplicate(e)} aria-label={`Duplicate ${e.label}`} title="Duplicate">
            <i className="fa-solid fa-clone" aria-hidden="true" />
          </button>
        </>
      )}
      {e.status === "listed" || e.status === "hidden" ? (
        <button
          type="button"
          className={`${ICON} hover:!text-status-failed`}
          onClick={() => manage.remove(e)}
          aria-label={`Delete ${e.label}`}
          title="Delete"
        >
          <i className="fa-solid fa-trash-can" aria-hidden="true" />
        </button>
      ) : (
        <span className="inline-block w-6" />
      )}
    </li>
  );
}
