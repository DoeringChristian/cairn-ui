/**
 * The card editor: one modal for adding a card to a workspace section and
 * for editing one (the gear), on the run page and comparisons alike. It is
 * the card detail shell (CardDetailModal): the card's side on the left, the
 * editor's column on the right, which always starts with the **Card**
 * section — Data (CardDataPicker), then Card type (CardTypePicker).
 *
 * - **new** (the section's "Add card" ghost card, the one way to add): only
 *   the Card section. The left shows the picked data as a card of the first
 *   type that fits (every group's card, for groups) and, while the type is
 *   being chosen, every type as a live tile. Picking a type creates the
 *   card(s) at the end of the section, and the same editor turns into the
 *   new card's (the first one's, for several): its title and settings tabs
 *   appear under the Card section. Closing before a type is picked creates
 *   nothing.
 * - **edit** (the gear): the left shows the card enlarged (←/→ steps through
 *   the cards); Data starts collapsed, so the settings are not pushed down.
 *   Every change applies at once (card-builder `changedPanel`) and is
 *   undoable; while a new type is being chosen the left shows the tiles
 *   instead of the card.
 *
 * Cards own their content and settings panel (each card component builds
 * them), so the editor hosts them: a workspace card's CardShell portals its
 * enlarged content and settings panel into this editor's slots
 * (./card-editor-host.tsx `CardEditorSlots`) instead of opening a modal of its own. The editor
 * stays mounted while the card underneath it changes — a new card, a type
 * change remounting the card, ←/→ — and only the slots' contents swap.
 *
 * Read-only workspaces have no editor: their cards open the plain detail
 * modal with their (session-only) settings.
 */

import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { CardEditorHostContext, type CardEditorClaim, type Host, type Slots } from "./card-editor-host";
import CardDetailModal from "../CardDetailModal";
import CardPreview from "./CardPreview";
import CardDataPicker from "./CardDataPicker";
import CardTypePicker, { CardTypeTiles, Hint, MAX_PREVIEWS } from "./CardTypePicker";
import { TextInput } from "../settings/palette";
import { useViewerDefaults, useViewerList } from "../../lib/custom/hooks";
import { useProjectId } from "../../lib/project-context";
import {
  compatibleTypes,
  dataLabel,
  dataParts,
  dataReady,
  newCards,
  optionKey,
  panelData,
  seriesShownBy,
  type CardData,
  type NewCard,
  type PanelChange,
  type TypeOption,
} from "../../lib/workspace/card-builder";
import type { MetricInfo, RenderedPanel, RenderedSection } from "../../lib/workspace/layout";
import type { ViewerInfo } from "../../api/types";

/** How long the editor waits for a card to (re)open under it: a new card, a remount. */
const PENDING_MS = 5000;

/**
 * The workspace's card editor: provides the host its cards open in, and
 * renders the editor while adding (`adding`: the section) or while a card is
 * open in it.
 */
export function CardEditorHost({
  enabled,
  adding,
  onAddingDone,
  sections,
  metrics,
  runIds,
  onAdd,
  onChange,
  reopen,
  children,
}: {
  /** Off (a read-only workspace): cards open their own detail modal. */
  enabled: boolean;
  /** The section whose ghost card was pressed, else null. */
  adding: string | null;
  /** The add is over (cards created, or closed before). */
  onAddingDone: () => void;
  /** The rendered layout (unfiltered). */
  sections: readonly RenderedSection[];
  metrics: readonly MetricInfo[];
  runIds: readonly string[];
  /** Create the cards at the end of `section`; returns the first one's id. */
  onAdd: (section: string, cards: NewCard[]) => string | undefined;
  onChange: (id: string, change: PanelChange) => void;
  /** Mount card `id` again with its detail open (it unmounted while open: a type change). */
  reopen: (id: string) => void;
  children: ReactNode;
}) {
  const [claim, setClaim] = useState<{ id: string; info: MutableRefObject<CardEditorClaim> } | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [, touch] = useReducer((n: number) => n + 1, 0);
  const claimRef = useRef(claim);
  claimRef.current = claim;
  const reopenRef = useRef(reopen);
  reopenRef.current = reopen;
  /** ←/→ in progress: the card that closes hands over to its neighbour. */
  const stepping = useRef(false);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  const slots = useRef<Slots>({ card: null, settings: null });
  const slotSubs = useRef(new Set<() => void>());
  const setSlot = useCallback((k: keyof Slots, el: HTMLElement | null) => {
    if (slots.current[k] === el) return;
    slots.current = { ...slots.current, [k]: el };
    for (const fn of slotSubs.current) fn();
  }, []);

  const host = useMemo<Host>(
    () => ({
      claim: (id, info) => {
        stepping.current = false;
        setClaim({ id, info });
        setPending(null);
      },
      release: (id, how) => {
        if (claimRef.current?.id !== id || !alive.current) return;
        claimRef.current = null;
        setClaim(null);
        if (how === "unmount") {
          // A type change remounts the card: it opens again under the editor.
          setPending(id);
          reopenRef.current(id);
        } else if (stepping.current) {
          setPending(id);
        }
      },
      touch,
      getSlots: () => slots.current,
      subscribeSlots: (fn) => {
        slotSubs.current.add(fn);
        return () => slotSubs.current.delete(fn);
      },
    }),
    [],
  );

  const find = useCallback(
    (id: string): RenderedPanel | undefined => sections.flatMap((s) => s.panels).find((p) => p.panel.id === id),
    [sections],
  );
  // A card that does not open again in time (deleted meanwhile, an undo): the editor closes.
  useEffect(() => {
    if (pending == null) return;
    const t = setTimeout(() => setPending(null), PENDING_MS);
    return () => clearTimeout(t);
  }, [pending]);

  const close = useCallback(() => {
    stepping.current = false;
    const c = claimRef.current;
    setClaim(null);
    setPending(null);
    if (adding != null) onAddingDone();
    c?.info.current.onClose();
  }, [adding, onAddingDone]);

  const id = claim?.id ?? pending;
  const rendered = id != null ? find(id) : undefined;
  const mode: EditorMode | null = rendered ? (claim ? "edit" : "pending") : adding != null ? "new" : null;
  const step = (go?: () => void) =>
    go &&
    (() => {
      stepping.current = true;
      go();
    });
  const info = claim?.info.current;

  return (
    <CardEditorHostContext.Provider value={enabled ? host : null}>
      {children}
      {enabled && mode != null && (
        <CardEditor
          mode={mode}
          title={mode === "new" ? `Add a card to “${adding}”` : (info?.title ?? rendered?.label ?? "")}
          onClose={close}
          onPrev={mode === "edit" ? step(info?.onPrev) : undefined}
          onNext={mode === "edit" ? step(info?.onNext) : undefined}
          section={adding}
          panel={rendered ?? null}
          sections={sections}
          metrics={metrics}
          runIds={runIds}
          onCreate={(cards) => {
            const first = adding != null ? onAdd(adding, cards) : undefined;
            setPending(first ?? null);
            onAddingDone();
          }}
          onChange={(c) => {
            if (id != null) onChange(id, c);
          }}
          setSlot={setSlot}
        />
      )}
    </CardEditorHostContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// The editor
// ---------------------------------------------------------------------------

type EditorMode = "new" | "pending" | "edit";

const NO_VIEWERS: ViewerInfo[] = [];

function CardEditor({
  mode,
  title,
  onClose,
  onPrev,
  onNext,
  section,
  panel,
  sections,
  metrics,
  runIds,
  onCreate,
  onChange,
  setSlot,
}: {
  mode: EditorMode;
  title: string;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  section: string | null;
  panel: RenderedPanel | null;
  sections: readonly RenderedSection[];
  metrics: readonly MetricInfo[];
  runIds: readonly string[];
  onCreate: (cards: NewCard[]) => void;
  onChange: (change: PanelChange) => void;
  setSlot: (k: keyof Slots, el: HTMLElement | null) => void;
}) {
  const adding = mode === "new";
  const project = useProjectId();
  const viewers = useViewerList(project).data ?? NO_VIEWERS;
  const viewerDefaults = useViewerDefaults(project).data ?? null;
  const [draft, setDraft] = useState<CardData>({ mode: "series", names: [] });
  const edited = panel?.panel;
  const panelDataNow = useMemo(() => (edited ? panelData(edited) : null), [edited]);
  const data: CardData = adding || !panelDataNow ? draft : panelDataNow;
  const current = panel ? optionKey(panel.panel.type, panel.panel.settings) : null;
  const ready = dataReady(data, metrics);
  const compat = useMemo(
    () => compatibleTypes(data, metrics, runIds.length, adding ? null : current, viewers, viewerDefaults),
    [data, metrics, runIds.length, adding, current, viewers, viewerDefaults],
  );
  const shownBy = useMemo(() => seriesShownBy(sections), [sections]);

  const [dataOpen, setDataOpen] = useState(adding);
  const [typeOpen, setTypeOpen] = useState(false);
  const [focus, setFocus] = useState<string | null>(null);
  // Leaving "new" (a type was picked): both close, the card's settings come up.
  const wasAdding = useRef(adding);
  useEffect(() => {
    if (wasAdding.current && !adding) {
      setDataOpen(false);
      setTypeOpen(false);
    }
    wasAdding.current = adding;
  }, [adding]);

  const openTypes = () => {
    if (!ready) return;
    setFocus(null);
    setTypeOpen(true);
    if (adding) setDataOpen(false);
  };
  const toggleData = () => {
    const next = !dataOpen;
    setDataOpen(next);
    if (next && adding) setTypeOpen(false);
  };
  const pick = (key: string) => {
    if (mode === "pending") return;
    if (adding) {
      onCreate(newCards(data, [key], metrics));
      return;
    }
    setTypeOpen(false);
    if (key !== current) onChange({ option: key });
  };

  const typeOption = compat.options.find((o) => o.key === current);
  const cardCount = adding && ready ? dataParts(data, metrics).length : 0;
  const custom = panel && typeof panel.panel.settings.title === "string" ? panel.panel.settings.title : "";

  // --- the left side -----------------------------------------------------------
  const cardSlot = useCallback((el: HTMLElement | null) => setSlot("card", el), [setSlot]);
  const settingsSlot = useCallback((el: HTMLElement | null) => setSlot("settings", el), [setSlot]);
  const showTiles = typeOpen && ready;
  const left = (
    <>
      <div className={showTiles || mode !== "edit" ? "hidden" : "h-full"} ref={cardSlot} data-testid="card-editor-card" />
      {showTiles ? (
        <CardTypeTiles
          options={compat.options}
          current={adding ? null : current}
          focus={focus}
          onFocus={setFocus}
          onPick={pick}
          busy={mode === "pending"}
          data={data}
          metrics={metrics}
          runIds={runIds}
        />
      ) : mode === "new" ? (
        <DataPreview data={data} option={compat.options.find((o) => o.unavailable == null) ?? null} metrics={metrics} runIds={runIds} />
      ) : mode === "pending" ? (
        <Hint>
          <i className="fa-solid fa-spinner fa-spin mr-1.5" aria-hidden="true" />
          Opening the card…
        </Hint>
      ) : null}
    </>
  );

  const column = (
    <div data-testid="card-editor" data-mode={mode} data-section={section ?? undefined}>
      <section className="mb-3 border-b border-border pb-3" aria-label="Card">
        <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">Card</h4>
        {adding && (
          <p className="mb-2 text-xs text-fg-muted">
            Into <span className="font-semibold text-fg">{section}</span>
          </p>
        )}
        <Fold
          label="Data"
          summary={ready ? <span className="mono">{dataLabel(data, metrics)}</span> : "nothing picked"}
          open={dataOpen}
          onToggle={toggleData}
          testId="card-editor-data"
        >
          <CardDataPicker
            key={adding ? "new" : (panel?.panel.id ?? "")}
            data={data}
            onChange={(d) => {
              if (adding) setDraft(d);
              else if (d.mode !== "groups") onChange({ data: d });
            }}
            metrics={metrics}
            shownBy={shownBy}
            allowGroups={adding}
            onSubmit={openTypes}
            autoFocus={adding}
          />
        </Fold>
        <Fold
          label="Card type"
          summary={
            adding ? (
              ready ? (
                cardCount > 1 ? `${cardCount} cards` : "pick one"
              ) : (
                "pick the data first"
              )
            ) : (
              <>
                {typeOption?.icon && <i className={`fa-solid fa-${typeOption.icon} mr-1`} aria-hidden="true" />}
                {typeOption?.label ?? current}
              </>
            )
          }
          open={typeOpen}
          onToggle={() => (typeOpen ? setTypeOpen(false) : openTypes())}
          disabled={!ready && !typeOpen}
          testId="card-editor-type"
        >
          <CardTypePicker
            options={compat.options}
            reason={compat.reason}
            current={adding ? null : current}
            focus={focus}
            onFocus={setFocus}
            onPick={pick}
            busy={mode === "pending"}
          />
          {adding && (
            <p className="mt-2 text-xs text-fg-muted">
              {cardCount > 1 ? `Picking a type adds ${cardCount} cards; the first opens here.` : "Picking a type adds the card; its settings open here."}
            </p>
          )}
        </Fold>
        {adding && ready && !typeOpen && (
          <button type="button" className="btn mt-2 w-full text-sm touch:min-h-10" onClick={openTypes} data-testid="card-editor-choose-type">
            Choose a card type
          </button>
        )}
      </section>
      {mode === "edit" && panel && (
        <div className="mb-3 border-b border-border pb-3" data-testid="card-editor-title">
          <TextInput
            label="Title"
            value={custom}
            placeholder={panel.label}
            onChange={(v) => onChange({ title: v })}
            overridden={custom !== ""}
            onReset={() => onChange({ title: "" })}
          />
        </div>
      )}
      <div ref={settingsSlot} data-testid="card-editor-settings" />
    </div>
  );

  return (
    <CardDetailModal
      open
      onClose={onClose}
      title={title}
      settingsLabel={adding ? "Add a card" : "Settings"}
      cardLabel={adding ? "Preview" : "Card"}
      initialTab={adding ? "settings" : "card"}
      onPrev={onPrev}
      onNext={onNext}
      settingsContent={column}
    >
      {left}
    </CardDetailModal>
  );
}

/** A collapsible row of the Card section: label, a summary while closed. */
function Fold({
  label,
  summary,
  open,
  onToggle,
  disabled,
  testId,
  children,
}: {
  label: string;
  summary: ReactNode;
  open: boolean;
  onToggle: () => void;
  disabled?: boolean;
  testId: string;
  children: ReactNode;
}) {
  return (
    <div className="py-0.5" data-testid={testId} data-open={open ? "" : undefined}>
      <button
        type="button"
        onClick={onToggle}
        disabled={disabled}
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded py-1.5 text-left text-sm hover:text-fg disabled:cursor-not-allowed disabled:opacity-60 touch:min-h-10"
      >
        <i aria-hidden="true" className={`fa-solid fa-chevron-down text-[9px] text-fg-muted transition-transform ${open ? "" : "-rotate-90"}`} />
        <span className="font-medium text-fg">{label}</span>
        {!open && <span className="min-w-0 flex-1 truncate text-right text-xs text-fg-muted">{summary}</span>}
      </button>
      {open && <div className="pb-2 pt-1">{children}</div>}
    </div>
  );
}

function DataPreview({
  data,
  option,
  metrics,
  runIds,
}: {
  data: CardData;
  option: TypeOption | null;
  metrics: readonly MetricInfo[];
  runIds: readonly string[];
}) {
  const cards = useMemo(() => (option ? newCards(data, [option.key], metrics) : []), [data, option, metrics]);
  if (!dataReady(data, metrics)) {
    return <Hint>Pick the data to add: one or several series, a regex, one card per capture group, or whole runs.</Hint>;
  }
  if (!option || cards.length === 0) return <Hint>No card type shows this data. Pick other series.</Hint>;
  return (
    <div className="space-y-2" data-testid="card-editor-data-preview">
      <p className="text-[11px] uppercase tracking-wide text-fg-subtle">
        Preview · {option.label}
        {cards.length > 1 && ` · ${cards.length} cards`}
        {cards.length > MAX_PREVIEWS && ` (first ${MAX_PREVIEWS})`}
      </p>
      <div className={`grid gap-4 ${cards.length > 1 ? "lg:grid-cols-2" : "grid-cols-1"}`}>
        {cards.slice(0, MAX_PREVIEWS).map((c, i) => (
          <CardPreview
            key={`${option.key}:${i}`}
            draftKey={`add:${i}`}
            type={c.type}
            selector={c.selector}
            settings={c.settings}
            metrics={metrics}
            runIds={runIds}
          />
        ))}
      </div>
    </div>
  );
}
