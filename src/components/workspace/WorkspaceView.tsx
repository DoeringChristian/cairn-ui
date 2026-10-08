/**
 * The workspace renderer: one layout document + a bound run set. The run
 * page (`runIds = [the run]`) and the workspace page (`runIds = the runs
 * its sidebar picks`) render exactly this component — toolbar, sections, panels, adding cards
 * (the one way: the dashed "Add card" ghost card ending each section's grid),
 * the card editor adding and editing cards (components/workspace/CardEditor.tsx),
 * "+ New section" below the last
 * section, and Manage cards (components/workspace/ManageCards.tsx) — and
 * differ only in the ref and the runs.
 *
 * Every edit is an op on the workspace document (lib/workspace/doc.ts), so
 * it carries over to every run the workspace is bound to. Touching an
 * automatic panel materializes it first (lib/workspace/layout.ts). Card
 * settings are the panels' settings: this view provides the
 * `CardSettingsStoreContext` that maps a card's key to its panel.
 *
 * Read-only surfaces (`CardMutationContext` false) render the same page;
 * `useWorkspace(...).update` is then a no-op and card settings go to the
 * session layer (lib/card-settings.ts), so a viewer can explore without
 * persisting anything. Viewers get no ghost cards, "+ New section", manage view or
 * duplicate: those only edit the layout.
 */

import { useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import CardErrorBoundary from "../card-kit/CardErrorBoundary";
import ReorderableCardGrid from "../ReorderableCardGrid";
import SectionBlock from "../SectionBlock";
import WorkspaceToolbar from "../WorkspaceToolbar";
import RunColorByProvider from "../RunColorByProvider";
import PanelCard from "./PanelCard";
import { CardEditorHost } from "./CardEditor";
import ManageCards, { type ManageActions } from "./ManageCards";
import { useWorkspaceMetrics } from "./use-workspace-metrics";
import { useSession } from "../../api/hooks";
import { CardMutationContext, CardSettingsStoreContext, type CardOverrides, type CardSettingsKey, type CardSettingsStore } from "../../lib/card-settings";
import type { CardType } from "../../lib/cards/card-spec";
import { isMultiRunCardType, type ComparisonCard } from "../../lib/comparisons/types";
import { CardNavProvider } from "../../lib/card-nav";
import { ChartSyncProvider } from "../../lib/chart-sync";
import { WorkspaceDefaultsProvider } from "../../lib/settings-scope";
import { claimedMetric, findPanel, newLayoutId, ops, type Panel, type WorkspaceOp } from "../../lib/workspace/doc";
import {
  addToSectionOp,
  autoPanelsOp,
  deriveLayout,
  uniqueSectionName,
  materializeOp as materializePanelOp,
  withoutEmptyPanels,
  type RenderedPanel,
  type RenderedSection,
} from "../../lib/workspace/layout";
import { autoSectionOfPanel, cardCatalogue, changedPanel, optionKey, type CatalogueEntry, type NewCard, type PanelChange } from "../../lib/workspace/card-builder";
import { compilePanelFilter } from "../../lib/workspace/panel-filter";
import { moveCardOp, moveSectionOp, reorderBeforeId, type CardSpot } from "../../lib/workspace/reorder";
import { PanelActionsContext } from "../../lib/workspace/panel-actions";
import { refKey, WorkspaceRefContext, type WorkspaceRef } from "../../lib/workspace/ref";
import { sendCardsToReport } from "../../lib/workspace/send-to-report";
import { getWorkspace, subscribeWorkspace } from "../../lib/workspace/store";
import { useWorkspace } from "../../lib/workspace/use-workspace";

/** What "+ New section" names a section (made unique: `New section 2`, …). */
const NEW_SECTION_NAME = "New section";
/** An empty workspace shows this section (not stored until a card is added to it). */
const FIRST_SECTION_NAME = "Charts";

const EMPTY_SETTINGS: CardOverrides = Object.freeze({}) as CardOverrides;

interface Props {
  wsRef: WorkspaceRef;
  /** The bound runs, in order. */
  runIds: readonly string[];
  /** Names the reports "send section to report" creates: `<section> · <reportLabel>`. */
  reportLabel: string;
  /** Only these of the runs' metrics (a module-level function: it is a memo dependency). */
  metricFilter?: (name: string) => boolean;
  /**
   * The run page: cards showing nothing the run logs, and sections left
   * without cards, are not rendered (lib/workspace/layout.ts `withoutEmptyPanels`).
   */
  hideEmpty?: boolean;
  /** Shown when the runs log none of the metrics (default "No metrics logged yet."). */
  emptyText?: string;
}

/**
 * A read-role session views workspaces: everything renders, edits stay in
 * this page (card settings in the session layer, layout edits disabled).
 */
export function ViewerGate({ children }: { children: ReactNode }) {
  const viewer = useSession().data?.role === "read";
  const outer = useContext(CardMutationContext);
  return <CardMutationContext.Provider value={outer && !viewer}>{children}</CardMutationContext.Provider>;
}

export default function WorkspaceView(props: Props) {
  return (
    <ViewerGate>
      <WorkspaceViewInner {...props} />
    </ViewerGate>
  );
}

function WorkspaceViewInner({ wsRef, runIds, reportLabel, metricFilter, hideEmpty = false, emptyText = "No metrics logged yet." }: Props) {
  const navigate = useNavigate();
  const key = refKey(wsRef);
  const scope = `ws:${key}`;
  const { doc, readOnly, update } = useWorkspace(wsRef);
  const mutable = !readOnly;
  const runMetrics = useWorkspaceMetrics(runIds);
  const { loading, error } = runMetrics;
  const metrics = useMemo(
    () => (metricFilter ? runMetrics.metrics.filter((m) => metricFilter(m.name)) : runMetrics.metrics),
    [runMetrics.metrics, metricFilter],
  );
  const [query, setQuery] = useState("");

  // Unfiltered (edits resolve against it) and as shown (search applied).
  const derived = useMemo(() => {
    const secs = deriveLayout(doc, metrics);
    return hideEmpty ? withoutEmptyPanels(secs) : secs;
  }, [doc, metrics, hideEmpty]);
  // An empty workspace still shows one section, with its ghost card (written on the first add).
  const all = useMemo<RenderedSection[]>(
    () =>
      derived.length === 0 && mutable && !hideEmpty
        ? [{ name: FIRST_SECTION_NAME, inDoc: false, collapsed: false, sort: false, panels: [] }]
        : derived,
    [derived, mutable, hideEmpty],
  );
  const shown = useMemo(() => {
    if (!query.trim()) return all;
    const secs = deriveLayout(doc, metrics, { query });
    return hideEmpty ? withoutEmptyPanels(secs) : secs;
  }, [doc, metrics, query, all, hideEmpty]);

  // `?card=<series>` (the Overview summary's "show in Workspace"): mount the
  // first card showing that series, scroll to it and highlight it briefly,
  // then drop the parameter.
  const [searchParams, setSearchParams] = useSearchParams();
  const focusName = searchParams.get("card");
  const focusId = useMemo(() => {
    if (!focusName) return null;
    for (const s of shown) for (const rp of s.panels) if (rp.metrics.some((m) => m.name === focusName)) return rp.panel.id;
    return null;
  }, [focusName, shown]);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  useEffect(() => {
    if (!focusId) return;
    let frame = 0;
    let tries = 0;
    let rescroll = 0;
    const cardEl = () =>
      document.querySelector(`[data-panel-id="${CSS.escape(focusId)}"] [data-cairn-card]`) as HTMLElement | null;
    const find = () => {
      const card = cardEl();
      if (!card) {
        if (++tries < 120) frame = requestAnimationFrame(find);
        return;
      }
      card.scrollIntoView({ block: "center" });
      // Again while the cards above it mount and grow (they push it down).
      const again = (n: number) => {
        rescroll = window.setTimeout(() => {
          cardEl()?.scrollIntoView({ block: "center" });
          if (n > 1) again(n - 1);
        }, 250);
      };
      again(4);
      setHighlighted(focusId);
      setSearchParams((p) => {
        const next = new URLSearchParams(p);
        next.delete("card");
        return next;
      }, { replace: true });
    };
    frame = requestAnimationFrame(find);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(rescroll);
    };
  }, [focusId, setSearchParams]);
  useEffect(() => {
    if (!highlighted) return;
    const t = window.setTimeout(() => setHighlighted(null), 2000);
    return () => window.clearTimeout(t);
  }, [highlighted]);
  const allRef = useRef(all);
  allRef.current = all;
  const metricsRef = useRef(metrics);
  metricsRef.current = metrics;

  /** Write an automatic panel — only it — so it can be edited. Computed now: deterministic on replay. */
  const materializeOp = useCallback((id: string): WorkspaceOp => materializePanelOp(allRef.current, id), []);
  /** A section edit: every rendered section gets its place in the document first. */
  const sectionOp = useCallback(
    (op: WorkspaceOp): WorkspaceOp => ops.seq(ops.ensureSections(allRef.current.map((s) => s.name)), op),
    [],
  );

  // Card settings are panel settings.
  const store = useMemo<CardSettingsStore>(
    () => ({
      read: (k: CardSettingsKey) => findPanel(getWorkspace(key), k.metricName)?.panel.settings ?? EMPTY_SETTINGS,
      subscribe: (_k: CardSettingsKey, fn: () => void) => subscribeWorkspace(key, fn),
      write: (k: CardSettingsKey, overrides: CardOverrides) =>
        update(ops.seq(materializeOp(k.metricName), ops.setPanelSettings(k.metricName, overrides)), { noUndo: true }),
    }),
    [key, update, materializeOp],
  );
  const settingsKeyOf = useCallback((id: string): CardSettingsKey => ({ runId: scope, metricName: id }), [scope]);

  // --- panel edits ----------------------------------------------------------
  const removePanel = useCallback(
    (rp: RenderedPanel) => {
      const claimed = rp.auto ? rp.panel.id.slice("auto:".length) : claimedMetric(rp.panel);
      update(ops.removePanel(rp.panel.id, claimed), { label: `Remove ${rp.label}` });
    },
    [update],
  );

  // --- moving cards and sections (drag & drop, Alt+↑/↓; lib/workspace/reorder.ts) --
  /** Everything the page would render, hide patterns ignored: a move materializes those cards too. */
  const unhidden = useCallback(() => deriveLayout(getWorkspace(key), metricsRef.current, { hidePatterns: false }), [key]);
  const moveCard = useCallback(
    (id: string, spot: CardSpot) => update(ops.seq(materializeOp(id), moveCardOp(unhidden(), id, spot)), { label: "Move card" }),
    [update, materializeOp, unhidden],
  );
  const moveSection = useCallback(
    (name: string, beforeName: string | null) =>
      update(moveSectionOp(allRef.current.map((s) => s.name), name, beforeName), { label: `Move section ${name}` }),
    [update],
  );
  /** A card dropped on card `toId` of section `target` takes its place. */
  const reorder = useCallback(
    (target: string, fromId: string, toId: string) => {
      const ids = allRef.current.find((s) => s.name === target)?.panels.map((p) => p.panel.id) ?? [];
      if (!ids.includes(toId)) return;
      moveCard(fromId, { section: target, beforeId: reorderBeforeId(ids, fromId, toId) });
    },
    [moveCard],
  );

  // --- adding cards (the ghost card ending a section) and Manage cards --------
  const [adding, setAdding] = useState<string | null>(null);
  const closeAdd = useCallback(() => setAdding(null), []);
  const [manageOpen, setManageOpen] = useState(false);
  /** A section just made by "+ New section": its name is in edit. */
  const [renaming, setRenaming] = useState<string | null>(null);

  // --- the card editor (the gear; components/workspace/CardEditor.tsx) -------
  // A card opens its editor on mount when asked (just added, picked in Manage
  // cards, or remounted by a type change under the open editor): its key gets
  // a new token and it mounts with autoOpenSettings.
  const [editorTokens, setEditorTokens] = useState<ReadonlyMap<string, number>>(new Map());
  const [openNow, setOpenNow] = useState<string | null>(null);
  const openEditor = useCallback((id: string) => {
    setEditorTokens((m) => new Map(m).set(id, (m.get(id) ?? 0) + 1));
    setOpenNow(id);
  }, []);
  useEffect(() => {
    if (openNow == null) return;
    const t = setTimeout(() => setOpenNow(null), 1500);
    return () => clearTimeout(t);
  }, [openNow, editorTokens]);

  /**
   * The new cards go at the end of the section whose ghost card was
   * pressed, and the first opens in the card editor that added it (it turns
   * into that card's editor). Returns that card's id.
   */
  const addCards = useCallback(
    (section: string, cards: NewCard[]): string | undefined => {
      const panels: Panel[] = cards.map((c) => ({ id: newLayoutId("p_"), ...c }));
      if (panels.length === 0) return undefined;
      update(addToSectionOp(allRef.current, section, panels), { label: `Add ${panels.length} card${panels.length === 1 ? "" : "s"}` });
      openEditor(panels[0]!.id);
      return panels[0]!.id;
    },
    [update, openEditor],
  );

  const addSection = useCallback(() => {
    const name = uniqueSectionName(NEW_SECTION_NAME, allRef.current.map((s) => s.name));
    update(sectionOp(ops.addSection(name)), { label: `Add section ${name}` });
    setRenaming(name);
  }, [update, sectionOp]);
  /** The new section's name edit ended: Escape takes back a section still empty and unnamed. */
  const endNewSectionRename = useCallback(
    (name: string, cancelled: boolean) => {
      setRenaming(null);
      const s = getWorkspace(key).sections.find((x) => x.name === name);
      if (cancelled && s && s.panels.length === 0) update(ops.removeSection(name), { noUndo: true });
    },
    [key, update],
  );
  const panelOf = useCallback(
    (id: string): Panel | undefined =>
      findPanel(getWorkspace(key), id)?.panel ?? allRef.current.flatMap((s) => s.panels).find((p) => p.panel.id === id)?.panel,
    [key],
  );
  const changePanel = useCallback(
    (id: string, change: PanelChange) => {
      const cur = panelOf(id);
      if (!cur) return;
      const next = changedPanel(cur, change);
      update(ops.seq(materializeOp(id), ops.replacePanel(id, next)), {
        label: change.option ? "Change card type" : change.data ? "Change card data" : "Rename card",
        mergeKey: change.title !== undefined ? `title:${id}` : undefined,
      });
      // Another card component remounts under the open editor, which reopens it (CardEditorHost `reopen`).
    },
    [panelOf, update, materializeOp],
  );
  /** Copy a card (an automatic one is written first) right after itself. */
  const duplicate = useCallback(
    (id: string) => {
      const copy = newLayoutId("p_");
      update(ops.seq(materializeOp(id), ops.duplicatePanel(id, copy)), { label: "Duplicate card" });
    },
    [update, materializeOp],
  );
  const toggleAutoPanels = useCallback(() => {
    const on = !getWorkspace(key).autoPanels;
    update(autoPanelsOp(on, allRef.current), { label: on ? "Include unlisted metrics" : "Only listed cards" });
  }, [key, update]);

  const manage = useMemo<ManageActions>(
    () => ({
      toggle: (e: CatalogueEntry) => {
        const id = e.panel.id;
        if (e.status === "listed") update(ops.setPanelHidden(id, true), { label: `Hide ${e.label}` });
        else if (e.status === "hidden") update(ops.setPanelHidden(id, false), { label: `Show ${e.label}` });
        else if (e.status === "auto") update(ops.removePanel(id, claimedMetric(e.panel)), { label: `Hide ${e.label}` });
        else if (e.status === "removed") update(ops.restoreRemoved([claimedMetric(e.panel) ?? ""]), { label: `Show ${e.label}` });
        else update(sectionOp(ops.addPanels(autoSectionOfPanel(e.panel, metricsRef.current), [e.panel])), { label: `Show ${e.label}` });
      },
      duplicate: (e: CatalogueEntry) => duplicate(e.panel.id),
      remove: (e: CatalogueEntry) =>
        update(ops.removePanel(e.panel.id, claimedMetric(e.panel)), { label: `Delete ${e.label}` }),
      edit: (e: CatalogueEntry) => {
        setManageOpen(false);
        if (e.status === "hidden") update(ops.setPanelHidden(e.panel.id, false), { label: `Show ${e.label}` });
        openEditor(e.panel.id);
      },
      moveCard,
      moveSection,
    }),
    [update, sectionOp, duplicate, openEditor, moveCard, moveSection],
  );
  const catalogue = useMemo(() => (manageOpen ? cardCatalogue(doc, metrics) : []), [manageOpen, doc, metrics]);

  // --- toolbar ---------------------------------------------------------------
  const matchCount = useMemo(() => {
    if (!query.trim()) return 0;
    const f = compilePanelFilter(query);
    return all.reduce((n, s) => n + s.panels.filter((p) => f.test(p.label)).length, 0);
  }, [all, query]);

  const sendSection = useCallback(
    async (section: RenderedSection) => {
      const projectId = wsRef.projectId;
      const cards = section.panels.flatMap((rp): Array<{ card: ComparisonCard; settings: Record<string, unknown> }> => {
        const settings = findPanel(getWorkspace(key), rp.panel.id)?.panel.settings ?? {};
        if (isMultiRunCardType(rp.panel.type)) {
          return [{ card: { id: rp.panel.id, type: rp.panel.type, series: runIds.map((runId) => ({ runId, name: rp.label })) }, settings }];
        }
        const series = rp.metrics.flatMap((m) => runIds.filter((r) => m.runIds.includes(r)).map((runId) => ({ runId, name: m.name })));
        return series.length ? [{ card: { id: rp.panel.id, type: rp.panel.type, series }, settings }] : [];
      });
      const reportId = await sendCardsToReport({
        projectId,
        name: `${section.name} · ${reportLabel}`,
        intro: `Section “${section.name}” of ${reportLabel}.`,
        runIds: [...runIds],
        cards,
      });
      navigate(`/p/${projectId}/reports/${reportId}`);
    },
    [wsRef.projectId, key, runIds, reportLabel, navigate],
  );

  const sectionNames = all.map((s) => s.name);
  /** With unlisted metrics off: how many series have no card. */
  const unlisted = useMemo(
    () =>
      doc.autoPanels
        ? 0
        : deriveLayout({ ...doc, autoPanels: true }, metrics, { hidePatterns: false }).reduce(
            (n, s) => n + s.panels.filter((p) => p.auto).length,
            0,
          ),
    [doc, metrics],
  );

  return (
    <WorkspaceRefContext.Provider value={wsRef}>
    <CardSettingsStoreContext.Provider value={store}>
    <WorkspaceDefaultsProvider defaults={doc.defaults}>
    <ChartSyncProvider enabled={doc.prefs.syncZoom}>
    <RunColorByProvider colorBy={doc.prefs.colorBy} runIds={runIds as string[]}>
    <CardNavProvider>
    <CardEditorHost
      enabled={mutable}
      adding={adding}
      onAddingDone={closeAdd}
      sections={all}
      metrics={metrics}
      runIds={runIds}
      onAdd={addCards}
      onChange={changePanel}
      reopen={openEditor}
    >
      <div className="space-y-8" data-cairn-workspace={key}>
        <WorkspaceToolbar
          query={query}
          onQueryChange={setQuery}
          matchCount={matchCount}
          onManageCards={() => setManageOpen(true)}
          onToggleAutoPanels={toggleAutoPanels}
          metrics={metrics}
        />
        {unlisted > 0 && (
          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => setManageOpen(true)}
              disabled={!mutable}
              className="text-xs text-fg-muted underline underline-offset-2 hover:text-fg disabled:no-underline"
              title="Unlisted metrics are off: these series have no card"
              data-testid="unlisted-count"
            >
              {unlisted} series without a card{mutable ? " · manage" : ""}
            </button>
          </div>
        )}
        {error != null && <p className="text-sm text-status-failed">Error: {String(error)}</p>}
        {!loading && metrics.length === 0 && derived.length === 0 && (
          <p className="text-fg-muted">{runIds.length === 0 ? "No runs yet." : emptyText}</p>
        )}
        {query.trim() && shown.every((s) => s.panels.length === 0) && <p className="text-sm text-fg-muted">No panels match.</p>}
        {shown.map((section, i) => {
          if (query.trim() && section.panels.length === 0) return null;
          const full = all.find((s) => s.name === section.name);
          const cardTypes = Array.from(new Set(section.panels.map((p) => p.panel.type))) as CardType[];
          return (
            <SectionBlock
              key={section.name}
              scope={key}
              sectionName={section.name}
              itemCount={section.panels.length}
              collapsed={section.collapsed}
              sorted={section.sort}
              first={i === 0}
              last={i === shown.length - 1}
              cardTypes={cardTypes}
              renameOnMount={mutable && renaming === section.name}
              onRenameEnd={renaming === section.name ? (cancelled) => endNewSectionRename(section.name, cancelled) : undefined}
              onToggleCollapse={() =>
                update(sectionOp(ops.setSectionCollapsed(section.name, !section.collapsed)), {
                  label: section.collapsed ? "Expand section" : "Collapse section",
                })
              }
              onToggleSort={() =>
                update(sectionOp(ops.setSectionSorted(section.name, !section.sort)), {
                  label: section.sort ? "Unsort section" : "Sort section A–Z",
                })
              }
              onMove={(delta) => update(sectionOp(ops.moveSection(section.name, delta)), { label: "Move section" })}
              onRename={(name) => update(sectionOp(ops.renameSection(section.name, name)), { label: `Rename section to ${name}` })}
              onSendToReport={section.panels.length > 0 ? () => sendSection(section) : undefined}
              onDelete={
                section.inDoc && (full?.panels.length ?? 0) === 0
                  ? () => update(ops.removeSection(section.name), { label: `Delete section ${section.name}` })
                  : undefined
              }
            >
              {section.panels.length === 0 && !mutable ? (
                <p className="text-sm text-fg-muted">No panels.</p>
              ) : (
                <ReorderableCardGrid
                  cards={section.panels.map((rp) => ({
                    key: rp.panel.id,
                    content: (
                      <PanelActionsContext.Provider
                        value={
                          mutable ? { onDuplicate: () => duplicate(rp.panel.id), panelId: rp.panel.id } : null
                        }
                      >
                        <CardErrorBoundary variant="card">
                          <div className="contents" data-panel-id={rp.panel.id} data-focused={highlighted === rp.panel.id ? "" : undefined}>
                          <PanelCard
                            // Another viewer (or type) remounts the card, so the open editor lands on the new one's tabs.
                            key={`${rp.panel.id}:${editorTokens.get(rp.panel.id) ?? 0}:${optionKey(rp.panel.type, rp.panel.settings)}`}
                            autoOpenSettings={openNow === rp.panel.id}
                            rendered={rp}
                            runIds={runIds}
                            settingsKey={settingsKeyOf(rp.panel.id)}
                            onRemove={mutable ? () => removePanel(rp) : undefined}
                            focused={focusId === rp.panel.id}
                          />
                          </div>
                        </CardErrorBoundary>
                      </PanelActionsContext.Provider>
                    ),
                  }))}
                  onReorder={mutable && !section.sort ? (from, to) => reorder(section.name, from, to) : undefined}
                  onDropEnd={mutable ? (from) => moveCard(from, { section: section.name, beforeId: null }) : undefined}
                  trailing={mutable ? <AddCardTile section={section.name} onAdd={setAdding} /> : undefined}
                />
              )}
            </SectionBlock>
          );
        })}
        {mutable && !query.trim() && (
          <button
            type="button"
            onClick={addSection}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border py-2 text-sm text-fg-muted transition-colors hover:border-accent hover:text-fg focus-visible:border-accent focus-visible:text-fg touch:min-h-10"
            data-testid="add-section"
          >
            <i className="fa-solid fa-plus" aria-hidden="true" /> New section
          </button>
        )}
      </div>
      {manageOpen && mutable && (
        <ManageCards
          onClose={() => setManageOpen(false)}
          catalogue={catalogue}
          sections={sectionNames}
          autoPanels={doc.autoPanels}
          onToggleAutoPanels={toggleAutoPanels}
          manage={manage}
        />
      )}
    </CardEditorHost>
    </CardNavProvider>
    </RunColorByProvider>
    </ChartSyncProvider>
    </WorkspaceDefaultsProvider>
    </CardSettingsStoreContext.Provider>
    </WorkspaceRefContext.Provider>
  );
}

/**
 * The dashed "Add card" ghost card ending a section's grid — the one way to
 * add a card: it opens the card editor, adding to that section. The size of a small
 * card; a card dragged onto it goes last in the section.
 */
function AddCardTile({ section, onAdd }: { section: string; onAdd: (section: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onAdd(section)}
      className="flex h-[170px] flex-col items-center justify-center gap-2 self-start rounded-lg border-2 border-dashed border-border text-sm text-fg-muted transition-colors hover:border-accent hover:text-fg focus-visible:border-accent focus-visible:text-fg"
      style={{ gridColumn: "span 1" }}
      aria-label={`Add cards to ${section}`}
      title="Add cards to this section"
      data-cairn-drop-end
      data-testid="add-card-tile"
    >
      <i className="fa-solid fa-plus text-lg" aria-hidden="true" />
      Add card
    </button>
  );
}
