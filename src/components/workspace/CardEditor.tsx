/**
 * The card editor: one modal for adding a card to a workspace section and
 * for editing one (the gear), on the run page and the workspace page alike. It is
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
 *   instead of the card. The card's width (Full · 1/2 · 1/3 · 1/4 of the
 *   row) sits above every tab.
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

import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, type KeyboardEvent, type MutableRefObject, type ReactNode } from "react";
import { CardEditorHostContext, type CardEditorClaim, type Host, type Slots } from "./card-editor-host";
import CardDetailModal from "../CardDetailModal";
import CardPreview from "./CardPreview";
import CardDataPicker from "./CardDataPicker";
import CardTypePicker, { CardTypeTiles, Hint, MAX_PREVIEWS } from "./CardTypePicker";
import { SettingsTabBar } from "../settings/palette/SettingsTabs";
import Segmented from "../settings/palette/Segmented";
import { CARD_WIDTHS, WIDTH_LABEL, type CardWidth } from "../../lib/cards/card-width";
import { SETTINGS_TABS, landingTab, type SettingsTabId } from "../settings/palette/logic";
import { useViewerDefaults, useViewerList } from "../../lib/custom/hooks";
import { useProjectId } from "../../lib/project-context";
import {
  compatibleTypes,
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

  const slots = useRef<Slots>({ card: null, settings: null, tab: null });
  const slotSubs = useRef(new Set<() => void>());
  const setSlot = useCallback(<K extends keyof Slots>(k: K, v: Slots[K]) => {
    if (slots.current[k] === v) return;
    slots.current = { ...slots.current, [k]: v };
    for (const fn of slotSubs.current) fn();
  }, []);

  // The one tab row: Data | Type | the card's own tabs (its settings panel reports them).
  const [tab, setTab] = useState<EditorTab>("data");
  /** A type was just picked (a new card, or another type): open the card on Values, else its first tab, once it reports them. */
  const [landing, setLanding] = useState(false);
  const [cardTabs, setCardTabs] = useState<SettingsTabId[]>([]);

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
        setCardTabs([]);
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
      reportTabs: (tabs) => setCardTabs((prev) => (prev.join(" ") === tabs.join(" ") ? prev : tabs)),
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
  // A card that is gone (an undo took it away) or does not open again in time: the editor closes.
  const pendingGone = pending != null && find(pending) == null;
  useEffect(() => {
    if (pending == null) return;
    if (pendingGone) {
      setPending(null);
      return;
    }
    const t = setTimeout(() => setPending(null), PENDING_MS);
    return () => clearTimeout(t);
  }, [pending, pendingGone]);

  const close = useCallback(() => {
    stepping.current = false;
    const c = claimRef.current;
    setClaim(null);
    setPending(null);
    setTab("data");
    setLanding(false);
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
  const land = () => {
    setTab("values");
    setLanding(true);
  };
  useLayoutEffect(() => {
    if (!landing || !claim || cardTabs.length === 0) return;
    setLanding(false);
    setTab(landingTab(cardTabs) ?? "data");
  }, [landing, claim, cardTabs]);
  // A tab the card under the editor lacks (after ←/→) shows Data, and comes back with a card that has it.
  const shownTab: EditorTab = landing || tab === "type" || tab === "data" || cardTabs.includes(tab) ? tab : "data";
  useLayoutEffect(() => setSlot("tab", shownTab === "type" || shownTab === "data" ? null : shownTab), [setSlot, shownTab]);

  return (
    <CardEditorHostContext.Provider value={enabled ? host : null}>
      {children}
      {enabled && mode != null && (
        <CardEditor
          mode={mode}
          title={mode === "new" ? `New card in “${adding}”` : (info?.title ?? rendered?.label ?? "")}
          tab={shownTab}
          onTab={setTab}
          cardTabs={cardTabs}
          onClose={close}
          width={mode === "edit" ? info?.width : undefined}
          onWidth={info?.onWidth}
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
            land();
            onAddingDone();
          }}
          onChange={(c) => {
            if (id != null) onChange(id, c);
          }}
          onLand={land}
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
type EditorTab = "data" | "type" | SettingsTabId;

const NO_VIEWERS: ViewerInfo[] = [];

/** Full · 1/2 · 1/3 · 1/4 of the row (lib/cards/card-width.ts). */
const WIDTH_OPTIONS = CARD_WIDTHS.map((w) => ({ value: w, label: WIDTH_LABEL[w] }));

function CardEditor({
  mode,
  title,
  tab,
  onTab,
  cardTabs,
  onClose,
  width,
  onWidth,
  onPrev,
  onNext,
  section,
  panel,
  sections,
  metrics,
  runIds,
  onCreate,
  onChange,
  onLand,
  setSlot,
}: {
  mode: EditorMode;
  title: string;
  tab: EditorTab;
  onTab: (tab: EditorTab) => void;
  /** The card's own settings tabs. */
  cardTabs: SettingsTabId[];
  onClose: () => void;
  /** The edited card's width (its width setting shows above every tab). */
  width?: CardWidth;
  onWidth?: (width: CardWidth) => void;
  onPrev?: () => void;
  onNext?: () => void;
  section: string | null;
  panel: RenderedPanel | null;
  sections: readonly RenderedSection[];
  metrics: readonly MetricInfo[];
  runIds: readonly string[];
  onCreate: (cards: NewCard[]) => void;
  onChange: (change: PanelChange) => void;
  /** A type was picked: the card opens on Values (else its first tab). */
  onLand: () => void;
  setSlot: <K extends keyof Slots>(k: K, v: Slots[K]) => void;
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
  const [focus, setFocus] = useState<string | null>(null);

  // Stepping to another card (←/→) leaves the type list.
  const shownId = adding ? null : (edited?.id ?? null);
  const wasShown = useRef(shownId);
  useEffect(() => {
    if (wasShown.current === shownId) return;
    wasShown.current = shownId;
    setFocus(null);
    if (tab === "type") onTab("data");
  }, [shownId, tab, onTab]);

  const typeTab = tab === "type" && ready;
  const pick = (key: string) => {
    if (mode === "pending") return;
    if (adding) {
      onCreate(newCards(data, [key], metrics));
      return;
    }
    onLand();
    if (key !== current) onChange({ option: key });
  };
  const cardCount = adding && ready ? dataParts(data, metrics).length : 0;

  const cardSlot = useCallback((el: HTMLElement | null) => setSlot("card", el), [setSlot]);
  const settingsSlot = useCallback((el: HTMLElement | null) => setSlot("settings", el), [setSlot]);

  const tabs = [
    { id: "data" as EditorTab, label: "Data" },
    { id: "type" as EditorTab, label: "Type", disabled: !ready },
    ...SETTINGS_TABS.filter((t) => cardTabs.includes(t.id)),
  ];

  const left = (
    <>
      <div className={typeTab || mode !== "edit" ? "hidden" : "h-full"} ref={cardSlot} data-testid="card-editor-card" />
      {typeTab ? (
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
    <div data-testid="card-editor" data-mode={mode} data-tab={tab} data-section={section ?? undefined}>
      {width && onWidth && (
        <div className="mb-3 border-b border-border pb-3" data-testid="card-editor-width">
          <Segmented<CardWidth>
            label="Width"
            value={width}
            onChange={onWidth}
            options={WIDTH_OPTIONS}
          />
        </div>
      )}
      {tab === "data" && (
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
            onSubmit={() => ready && onTab("type")}
            autoFocus={adding}
          />
      )}
      {tab === "type" && (
        <>
          <CardTypePicker
            options={compat.options}
            reason={compat.reason}
            current={adding ? null : current}
            focus={focus}
            onFocus={setFocus}
            onPick={pick}
            busy={mode === "pending"}
          />
          {cardCount > 1 && <p className="mt-2 text-xs text-fg-muted">Adds {cardCount} cards; the first opens here.</p>}
        </>
      )}
      <div
        className={tab === "data" || tab === "type" ? "hidden" : undefined}
        ref={settingsSlot}
        data-testid="card-editor-settings"
      />
    </div>
  );

  return (
    <CardDetailModal
      open
      onClose={onClose}
      title={title}
      titleNode={mode === "edit" && panel ? <InlineTitle title={title} custom={typeof panel.panel.settings.title === "string" ? panel.panel.settings.title : ""} onChange={(t) => onChange({ title: t })} /> : undefined}
      settingsLabel={adding ? "New card" : "Settings"}
      cardLabel={adding ? "Preview" : "Card"}
      initialTab={adding ? "settings" : "card"}
      onPrev={onPrev}
      onNext={onNext}
      settingsHeader={<SettingsTabBar items={tabs} current={tab} onSelect={onTab} />}
      settingsContent={column}
    >
      {left}
    </CardDetailModal>
  );
}

/** The card's title in the editor's header, with ✎: Enter or blur saves, Escape cancels, empty is the default title. */
function InlineTitle({ title, custom, onChange }: { title: string; custom: string; onChange: (title: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const done = useRef(false);
  if (draft == null) {
    return (
      <span className="inline-flex max-w-full items-center gap-2">
        <span className="truncate" onDoubleClick={() => ((done.current = false), setDraft(custom))}>
          {title}
        </span>
        <button
          type="button"
          onClick={() => ((done.current = false), setDraft(custom))}
          className="shrink-0 text-sm text-fg-subtle hover:text-fg"
          aria-label="Edit title"
          title="Edit title"
        >
          <i className="fa-solid fa-pencil" aria-hidden="true" />
        </button>
      </span>
    );
  }
  const end = (keep: boolean) => {
    if (done.current) return;
    done.current = true;
    if (keep && draft.trim() !== custom) onChange(draft.trim());
    setDraft(null);
  };
  const key = (e: KeyboardEvent) => {
    if (e.key === "Enter") end(true);
    else if (e.key === "Escape") {
      e.stopPropagation();
      end(false);
    }
  };
  return (
    <input
      className="input mono w-full py-0.5 text-base font-semibold"
      value={draft}
      placeholder="Default title"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => end(true)}
      onKeyDown={key}
      aria-label="Title"
      autoFocus
    />
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
