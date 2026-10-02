/**
 * The workspace renderer: one layout document + a bound run set. The run
 * page (`runIds = [the run]`) and every comparison (`runIds = its runs`)
 * render exactly this component — toolbar, sections, panels, the card
 * builder (add / edit / manage cards, components/workspace/CardBuilder.tsx)
 * — and differ only in the ref and the runs.
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
 * persisting anything. Viewers get no card builder, manage view or
 * duplicate: those only edit the layout.
 */

import { useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import CardErrorBoundary from "../card-kit/CardErrorBoundary";
import ReorderableCardGrid from "../ReorderableCardGrid";
import SectionBlock from "../SectionBlock";
import WorkspaceToolbar from "../WorkspaceToolbar";
import RunColorByProvider from "../RunColorByProvider";
import PanelCard from "./PanelCard";
import CardBuilder, { DEFAULT_NEW_SECTION, type BuilderCard, type BuilderMode, type ManageActions } from "./CardBuilder";
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
  autoPanelsOp,
  deriveLayout,
  panelsToMaterialize,
  sectionAutoPanels,
  type RenderedPanel,
  type RenderedSection,
} from "../../lib/workspace/layout";
import { autoSectionOfPanel, cardCatalogue, seriesShownBy, type CatalogueEntry } from "../../lib/workspace/card-builder";
import { compilePanelFilter } from "../../lib/workspace/panel-filter";
import type { BuiltPanel } from "../../lib/workspace/panel-builder";
import { PanelActionsContext } from "../../lib/workspace/panel-actions";
import { refKey, WorkspaceRefContext, type WorkspaceRef } from "../../lib/workspace/ref";
import { sendCardsToReport } from "../../lib/workspace/send-to-report";
import { getWorkspace, subscribeWorkspace } from "../../lib/workspace/store";
import { useWorkspace } from "../../lib/workspace/use-workspace";

/** Where the quick panel builder puts its panels. */
export const BUILDER_SECTION = DEFAULT_NEW_SECTION;

const EMPTY_SETTINGS: CardOverrides = Object.freeze({}) as CardOverrides;
const identity: WorkspaceOp = (d) => d;

interface Props {
  wsRef: WorkspaceRef;
  /** The bound runs, in order. */
  runIds: readonly string[];
  /** Names the reports "send section to report" creates: `<section> · <reportLabel>`. */
  reportLabel: string;
  /** Extra toolbar buttons (the run page's "New comparison"). */
  toolbarActions?: ReactNode;
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

function WorkspaceViewInner({ wsRef, runIds, reportLabel, toolbarActions }: Props) {
  const navigate = useNavigate();
  const key = refKey(wsRef);
  const scope = `ws:${key}`;
  const { doc, readOnly, update } = useWorkspace(wsRef);
  const mutable = !readOnly;
  const { metrics, loading, error } = useWorkspaceMetrics(runIds);
  const [query, setQuery] = useState("");

  // Unfiltered (edits resolve against it) and as shown (search applied).
  const all = useMemo(() => deriveLayout(doc, metrics), [doc, metrics]);
  const shown = useMemo(() => (query.trim() ? deriveLayout(doc, metrics, { query }) : all), [doc, metrics, query, all]);
  const allRef = useRef(all);
  allRef.current = all;

  /** Write an automatic panel (and those before it) so it can be edited. Computed now: deterministic on replay. */
  const materializeOp = useCallback((id: string): WorkspaceOp => {
    const secs = allRef.current;
    const m = panelsToMaterialize(secs, id);
    if (!m || m.panels.length === 0) return identity;
    return ops.seq(ops.ensureSections(secs.map((s) => s.name)), ops.addPanels(m.section, m.panels));
  }, []);
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

  const reorder = useCallback(
    (target: string, fromId: string, toId: string) => {
      const secs = allRef.current;
      const list = secs.find((s) => s.name === target)?.panels.map((p) => p.panel.id) ?? [];
      const toIdx = list.indexOf(toId);
      if (toIdx < 0) return;
      const next = list.filter((id) => id !== fromId);
      next.splice(toIdx, 0, fromId);
      const beforeId = next[toIdx + 1] ?? null;
      const source = secs.find((s) => s.panels.some((p) => p.panel.id === fromId));
      update(
        sectionOp(
          ops.seq(
            ops.addPanels(target, sectionAutoPanels(secs, target)),
            source && source.name !== target ? ops.addPanels(source.name, sectionAutoPanels(secs, source.name)) : identity,
            ops.movePanel(fromId, target, beforeId),
          ),
        ),
        { label: "Move panel" },
      );
    },
    [update, sectionOp],
  );

  // --- the card builder -------------------------------------------------------
  const metricsRef = useRef(metrics);
  metricsRef.current = metrics;
  const [builder, setBuilder] = useState<BuilderMode | null>(null);

  const addCards = useCallback(
    (section: string, cards: BuilderCard[]) => {
      const panels: Panel[] = cards.map((c) => ({ id: newLayoutId("p_"), ...c }));
      update(sectionOp(ops.addPanels(section, panels)), { label: `Add ${panels.length} card${panels.length === 1 ? "" : "s"}` });
    },
    [update, sectionOp],
  );
  const saveCard = useCallback(
    (id: string, card: BuilderCard, section: string) => {
      const from = findPanel(getWorkspace(key), id)?.section ?? allRef.current.find((s) => s.panels.some((p) => p.panel.id === id))?.name;
      update(
        sectionOp(
          ops.seq(materializeOp(id), ops.replacePanel(id, card), section !== from ? ops.movePanel(id, section, null) : identity),
        ),
        { label: "Edit card" },
      );
    },
    [key, update, sectionOp, materializeOp],
  );
  /** Copy a card (an automatic one is written first) right after itself. */
  const duplicate = useCallback(
    (id: string) => {
      const copy = newLayoutId("p_");
      update(sectionOp(ops.seq(materializeOp(id), ops.duplicatePanel(id, copy))), { label: "Duplicate card" });
    },
    [update, sectionOp, materializeOp],
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
      move: (e: CatalogueEntry, to: string) =>
        update(sectionOp(ops.seq(materializeOp(e.panel.id), ops.movePanel(e.panel.id, to, null))), { label: `Move ${e.label}` }),
    }),
    [update, sectionOp, materializeOp, duplicate],
  );
  const shownBy = useMemo(() => seriesShownBy(all), [all]);
  const catalogue = useMemo(() => (builder?.kind === "manage" ? cardCatalogue(doc, metrics) : []), [builder, doc, metrics]);

  // --- toolbar ---------------------------------------------------------------
  const matchCount = useMemo(() => {
    if (!query.trim()) return 0;
    const f = compilePanelFilter(query);
    return all.reduce((n, s) => n + s.panels.filter((p) => f.test(p.label)).length, 0);
  }, [all, query]);
  const scalarNames = useMemo(() => metrics.filter((m) => m.object_type === "scalar").map((m) => m.name), [metrics]);
  const buildPanels = useCallback(
    (built: BuiltPanel[]) => {
      const panels: Panel[] = built.map((p) => ({
        id: newLayoutId("p_"),
        type: "scalar",
        selector: { names: p.metrics },
        settings: { title: p.title },
      }));
      update(sectionOp(ops.seq(ops.addSection(BUILDER_SECTION, 0), ops.addPanels(BUILDER_SECTION, panels))), {
        label: `Add ${panels.length} panel(s)`,
      });
    },
    [update, sectionOp],
  );

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
  /** The document a saved view stores, with "include unlisted metrics" as chosen. */
  const viewDoc = useCallback(
    (autoPanels: boolean) => {
      const d = getWorkspace(key);
      return d.autoPanels === autoPanels ? d : autoPanelsOp(autoPanels, allRef.current)(d);
    },
    [key],
  );

  return (
    <WorkspaceRefContext.Provider value={wsRef}>
    <CardSettingsStoreContext.Provider value={store}>
    <WorkspaceDefaultsProvider defaults={doc.defaults}>
    <ChartSyncProvider enabled={doc.prefs.syncZoom}>
    <RunColorByProvider colorBy={doc.prefs.colorBy} runIds={runIds as string[]}>
    <CardNavProvider>
      <div className="space-y-8" data-cairn-workspace={key}>
        <WorkspaceToolbar
          query={query}
          onQueryChange={setQuery}
          matchCount={matchCount}
          builderMetrics={scalarNames}
          onBuildPanels={buildPanels}
          onAddSection={(name) => update(sectionOp(ops.addSection(name)), { label: `Add section ${name}` })}
          onAddCards={() => setBuilder({ kind: "add", section: null })}
          onManageCards={() => setBuilder({ kind: "manage" })}
          onToggleAutoPanels={toggleAutoPanels}
          viewDoc={viewDoc}
          actions={toolbarActions}
        />
        {unlisted > 0 && (
          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => setBuilder({ kind: "manage" })}
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
        {!loading && metrics.length === 0 && all.length === 0 && (
          <p className="text-fg-muted">{runIds.length === 0 ? "No runs yet." : "No metrics logged yet."}</p>
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
              onAddPanel={mutable ? () => setBuilder({ kind: "add", section: section.name }) : undefined}
              onSendToReport={section.panels.length > 0 ? () => sendSection(section) : undefined}
              onDelete={
                section.inDoc && (full?.panels.length ?? 0) === 0
                  ? () => update(ops.removeSection(section.name), { label: `Delete section ${section.name}` })
                  : undefined
              }
            >
              {section.panels.length === 0 ? (
                <p className="text-sm text-fg-muted">
                  No panels{mutable ? " — use + to add one, or drag a panel here." : "."}
                </p>
              ) : (
                <ReorderableCardGrid
                  cards={section.panels.map((rp) => ({
                    key: rp.panel.id,
                    content: (
                      <PanelActionsContext.Provider
                        value={
                          mutable
                            ? {
                                onEdit: () => setBuilder({ kind: "edit", panel: rp.panel, section: section.name, returnTo: null }),
                                onDuplicate: () => duplicate(rp.panel.id),
                              }
                            : null
                        }
                      >
                        <CardErrorBoundary variant="card">
                          <PanelCard
                            rendered={rp}
                            runIds={runIds}
                            settingsKey={settingsKeyOf(rp.panel.id)}
                            onRemove={mutable ? () => removePanel(rp) : undefined}
                          />
                        </CardErrorBoundary>
                      </PanelActionsContext.Provider>
                    ),
                  }))}
                  onReorder={mutable && !section.sort ? (from, to) => reorder(section.name, from, to) : undefined}
                />
              )}
            </SectionBlock>
          );
        })}
      </div>
      {builder && mutable && (
        <CardBuilder
          mode={builder}
          onModeChange={setBuilder}
          metrics={metrics}
          runIds={runIds}
          shownBy={shownBy}
          sections={sectionNames}
          catalogue={catalogue}
          autoPanels={doc.autoPanels}
          onToggleAutoPanels={toggleAutoPanels}
          onAdd={addCards}
          onSave={saveCard}
          manage={manage}
        />
      )}
    </CardNavProvider>
    </RunColorByProvider>
    </ChartSyncProvider>
    </WorkspaceDefaultsProvider>
    </CardSettingsStoreContext.Provider>
    </WorkspaceRefContext.Provider>
  );
}
