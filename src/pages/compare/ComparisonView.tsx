import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import ComparisonOverviewTab from "../ComparisonOverviewTab";
import ComparisonSourceTab from "../ComparisonSourceTab";
import AddCardModal, { type AddCardSelection } from "../../components/AddCardModal";
import ComparisonCardView from "../../components/comparison/ComparisonCardView";
import RunSetEditor, { DEFAULT_QUERY_SELECTOR } from "../../components/comparison/RunSetEditor";
import ReorderableCardGrid from "../../components/ReorderableCardGrid";
import RunSelectorBadge from "../../components/RunSelectorBadge";
import SectionBlock from "../../components/SectionBlock";
import WorkspaceToolbar from "../../components/WorkspaceToolbar";
import {
  addCardToComparison,
  cardSettingsKeyFor,
  compareRunId,
  comparisonRunIds,
  createTemplate,
  isMultiRunCardType,
  MULTI_RUN_CARD_LABELS,
  templateCardOf,
  type Comparison,
  type ComparisonCard,
  type ComparisonTemplateCard,
  type SmartFilters,
  updateComparison,
} from "../../lib/comparisons";
import { useComparisonUndo } from "../../lib/comparisons/undo";
import { useMetricIndex } from "../../lib/reports";
import { EMPTY_RUN_VIEW, RunViewContext, type RunView } from "../../lib/run-view";
import { isEmptyRunView } from "../../lib/run-view-store";
import { describeRunSelector } from "../../lib/run-selector";
import { loadCardOverrides, saveCardOverrides } from "../../lib/card-settings";
import { groupComparisonCardsIntoSections, orderSections } from "../../lib/sections";
import { CardNavProvider } from "../../lib/card-nav";
import { WorkspaceDefaultsProvider } from "../../lib/settings-scope";
import { compilePanelFilter, filterPanels } from "../../lib/workspace/panel-filter";
import type { BuiltPanel } from "../../lib/workspace/panel-builder";
import { sendCardsToReport } from "../../lib/workspace/send-to-report";
import { useWorkspace } from "../../lib/workspace/use-workspace";
import { useCollapsedSections } from "../../lib/use-collapsed-sections";
import { disambiguateRunLabels, useRunMetadataVersion } from "../../lib/run-label";
import { useRunSelectorResolution } from "../../api/hooks";
import type { Run } from "../../api/types";

/** The name a comparison card is searched and sorted by. */
function comparisonCardLabel(card: ComparisonCard): string {
  if (isMultiRunCardType(card.type)) return MULTI_RUN_CARD_LABELS[card.type];
  return card.series[0]?.name ?? card.type;
}

const COMPARISON_TABS = [
  { id: "overview", label: "Overview" },
  { id: "metrics", label: "Metrics & Media" },
  { id: "source", label: "Source" },
];

interface ComparisonViewProps {
  comparison: Comparison;
  allProjectRuns: Run[];
  allProjectRunIds: string[];
  projectId: string;
  /** Id of the just-added card to auto-open settings for and scroll to. */
  autoFocusCardId: string | null;
  onRename: (name: string) => void;
  onDelete: () => void;
  onRemoveCard: (cardId: string) => void;
  onAddCard: (sel: AddCardSelection) => void;
  onAddRuns: (runIds: string[]) => void;
  onRemoveRun: (runId: string) => void;
  onRefreshSmartFilters: (comparisonId: string, smartFilters: SmartFilters) => Promise<void>;
  /** Rebuild cards from an already-resolved RunSelector run set (see lib/run-selector.ts). */
  onRefreshRunSelector: (comparisonId: string, runIds: string[]) => Promise<void>;
  /** Set (or clear, with undefined) this comparison's dynamic run selector. */
  onSetRunSelector: (sel: Comparison["runSelector"]) => void;
  onReorderCards: (fromId: string, toId: string) => void;
}

export default function ComparisonView({
  comparison,
  allProjectRuns,
  allProjectRunIds,
  projectId,
  autoFocusCardId,
  onRename,
  onDelete,
  onRemoveCard,
  onAddCard,
  onAddRuns,
  onRemoveRun,
  onRefreshSmartFilters,
  onRefreshRunSelector,
  onSetRunSelector,
  onReorderCards,
}: ComparisonViewProps) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get("tab") ?? "overview";
  const setTab = useCallback(
    (t: string) => {
      const p = new URLSearchParams(searchParams);
      p.set("tab", t);
      setSearchParams(p, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const [editingName, setEditingName] = useState(false);
  const [draft, setDraft] = useState(comparison.name);
  const [addCardOpen, setAddCardOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [selectorRefreshing, setSelectorRefreshing] = useState(false);
  const [creatingReport, setCreatingReport] = useState(false);

  const runSelectorResolution = useRunSelectorResolution(projectId, comparison.runSelector);
  const handleRefreshRunSelector = useCallback(async () => {
    setSelectorRefreshing(true);
    try {
      const freshRunIds = await runSelectorResolution.refresh();
      await onRefreshRunSelector(comparison.id, freshRunIds);
    } finally {
      setSelectorRefreshing(false);
    }
  }, [comparison.id, onRefreshRunSelector, runSelectorResolution]);

  const { collapsed: collapsedSections, toggle: toggleSection } = useCollapsedSections(
    compareRunId(comparison.id),
  );

  // Workspace: defaults, hide patterns, section pins/sorting, sync zoom.
  const { doc } = useWorkspace(projectId);
  const [query, setQuery] = useState("");
  const visibleCards = useMemo(
    () => filterPanels(comparison.cards, comparisonCardLabel, { query, hidePatterns: doc.hidePatterns }),
    [comparison.cards, query, doc.hidePatterns],
  );
  const matchCount = useMemo(() => {
    if (!query.trim()) return 0;
    const f = compilePanelFilter(query);
    return comparison.cards.filter((c) => f.test(comparisonCardLabel(c))).length;
  }, [comparison.cards, query]);
  const sections = useMemo(
    () =>
      orderSections(
        groupComparisonCardsIntoSections(visibleCards).map((s) => ({ name: s.name, items: s.cards })),
        doc.sections,
        comparisonCardLabel,
      ),
    [visibleCards, doc.sections],
  );

  const handleRefresh = useCallback(async () => {
    if (!comparison.smartFilters) return;
    setRefreshing(true);
    try {
      await onRefreshSmartFilters(comparison.id, comparison.smartFilters);
    } finally {
      setRefreshing(false);
    }
  }, [comparison.id, comparison.smartFilters, onRefreshSmartFilters]);

  const compRunIds = useMemo(() => comparisonRunIds(comparison), [comparison]);

  // The comparison's run view (hidden, pinned, baseline), saved with it.
  const runView = useMemo(
    () => ({
      view: comparison.runView ?? EMPTY_RUN_VIEW,
      set: (next: RunView) =>
        void updateComparison(projectId, comparison.id, (c) => ({ ...c, runView: isEmptyRunView(next) ? undefined : next })),
    }),
    [comparison.runView, comparison.id, projectId],
  );

  const metaVersion = useRunMetadataVersion();
  const runLabels = useMemo(() => disambiguateRunLabels(compRunIds), [compRunIds, metaVersion]);

  // Snapshot this comparison into a new report: a markdown header (name +
  // run list) and one cards block with copies of the cards (new ids), each
  // card's settings copied into the report's scope. The comparison itself
  // is left untouched.
  const handleCreateReport = useCallback(async () => {
    setCreatingReport(true);
    try {
      const runList = compRunIds.map((id) => runLabels[id] ?? id).join(", ");
      const reportId = await sendCardsToReport({
        projectId,
        name: comparison.name,
        intro: `From comparison "${comparison.name}". Runs: ${runList || "(none)"}`,
        runIds: compRunIds,
        cards: comparison.cards,
        settingsKeyOf: (card) => cardSettingsKeyFor(comparison.id, card),
      });
      navigate(`/p/${projectId}/reports/${reportId}`);
    } finally {
      setCreatingReport(false);
    }
  }, [comparison, compRunIds, runLabels, projectId, navigate]);

  // One section into a new report.
  const sendSection = useCallback(
    async (sectionName: string, cards: ComparisonCard[]) => {
      const runList = compRunIds.map((id) => runLabels[id] ?? id).join(", ");
      const reportId = await sendCardsToReport({
        projectId,
        name: `${sectionName} · ${comparison.name}`,
        intro: `Section “${sectionName}” of comparison "${comparison.name}". Runs: ${runList || "(none)"}`,
        runIds: compRunIds,
        cards,
        settingsKeyOf: (card) => cardSettingsKeyFor(comparison.id, card),
      });
      navigate(`/p/${projectId}/reports/${reportId}`);
    },
    [comparison, compRunIds, runLabels, projectId, navigate],
  );

  // Quick panel builder: one line plot per built panel, across every run
  // of the comparison that logs its metrics.
  const { index: metricIndex } = useMetricIndex(compRunIds);
  const scalarNames = useMemo(
    () => Array.from(metricIndex.values()).filter((e) => e.object_type === "scalar").map((e) => e.name),
    [metricIndex],
  );
  const track = useComparisonUndo(projectId);
  const buildPanels = useCallback(
    (panels: BuiltPanel[]) => {
      const cards = panels.map((p) => ({
        type: "scalar" as const,
        series: p.metrics.flatMap((name) =>
          (metricIndex.get(`${name}::scalar`)?.runs ?? []).map((r) => ({ runId: r.runId, name })),
        ),
      }));
      track(`Add ${cards.length} panel(s)`, comparison.id, () => {
        panels.forEach((p, i) => {
          const card = cards[i]!;
          const id = addCardToComparison(projectId, comparison.id, card);
          // The panel's title is its card title.
          saveCardOverrides(cardSettingsKeyFor(comparison.id, { id, ...card }), { title: p.title });
        });
      });
    },
    [metricIndex, track, projectId, comparison.id],
  );

  useEffect(() => {
    if (!editingName) setDraft(comparison.name);
  }, [comparison.name, editingName]);

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {editingName ? (
          <input
            autoFocus
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              const t = draft.trim();
              if (t && t !== comparison.name) onRename(t);
              setEditingName(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                const t = draft.trim();
                if (t && t !== comparison.name) onRename(t);
                setEditingName(false);
              } else if (e.key === "Escape") {
                e.preventDefault();
                setEditingName(false);
                setDraft(comparison.name);
              }
            }}
            className="input min-w-0 flex-1 text-lg font-semibold"
          />
        ) : (
          <h2
            className="min-w-0 break-words text-lg font-semibold cursor-text"
            title="Click to rename"
            onClick={() => setEditingName(true)}
          >
            {comparison.name}
          </h2>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {comparison.runSelector && (
            <RunSelectorBadge
              title={describeRunSelector(comparison.runSelector)}
              count={runSelectorResolution.runIds.length}
              isRefreshing={selectorRefreshing || runSelectorResolution.isFetching}
              onRefresh={() => void handleRefreshRunSelector()}
            />
          )}
          {comparison.smartFilters && (
            <button
              type="button"
              onClick={handleRefresh}
              disabled={refreshing}
              className="inline-flex items-center gap-1.5 rounded border border-border px-3 py-1.5 text-xs font-medium text-fg-muted hover:border-accent hover:text-fg transition-colors disabled:opacity-50"
              title="Re-run smart filters to include new runs"
            >
              {refreshing ? "Refreshing..." : "Refresh"}
            </button>
          )}
          <button
            type="button"
            onClick={() => void handleCreateReport()}
            disabled={creatingReport}
            className="btn text-xs disabled:opacity-50"
            title="Snapshot this comparison's cards + settings into a new report"
          >
            {creatingReport ? "Creating…" : "Create report"}
          </button>
          <button
            type="button"
            onClick={() => {
              if (confirm(`Delete "${comparison.name}"?`)) onDelete();
            }}
            className="btn text-xs"
          >
            Delete
          </button>
          <button
            type="button"
            onClick={() => {
              const name = prompt("Template name:", comparison.name);
              if (!name) return;
              // A template card records the card's type plus every metric key
              // it displays (multi-run cards carry none and match on type) —
              // see `templateCardOf`.
              const templateCards: ComparisonTemplateCard[] = comparison.cards.map((card) =>
                templateCardOf(
                  card,
                  loadCardOverrides(cardSettingsKeyFor(comparison.id, card)) ?? undefined,
                ),
              );
              createTemplate(projectId, name, templateCards);
            }}
            className="btn text-xs"
            title="Save card layout as a reusable template"
          >
            Save template
          </button>
        </div>
      </div>

      {/* Tab bar */}
      <nav className="flex gap-1 overflow-x-auto whitespace-nowrap border-b border-border">
        {COMPARISON_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={[
              "border-b-2 px-3 py-2 text-sm transition-colors",
              tab === t.id
                ? "border-accent text-fg"
                : "border-transparent text-fg-muted hover:text-fg",
            ].join(" ")}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {/* Tab content */}
      {tab === "overview" && (
        <ComparisonOverviewTab compRunIds={compRunIds} />
      )}

      {tab === "metrics" && (
        <RunViewContext.Provider value={runView}>
          <RunSetEditor
            title="Runs in comparison"
            runIds={compRunIds}
            allProjectRuns={allProjectRuns}
            selector={comparison.runSelector}
            editable
            onToggleMode={() => {
              if (comparison.runSelector) {
                onSetRunSelector(undefined);
                return;
              }
              // A selector replaces the Smart Wizard's filters (the two are exclusive).
              if (
                comparison.smartFilters &&
                !confirm("This comparison was built with Smart Filters. Switching to a run selector replaces that binding — continue?")
              ) {
                return;
              }
              onSetRunSelector({ ...DEFAULT_QUERY_SELECTOR });
            }}
            onSelectorChange={onSetRunSelector}
            onAddRun={(runId) => onAddRuns([runId])}
            onRemoveRun={onRemoveRun}
          />

          <AddCardModal
            open={addCardOpen}
            onClose={() => setAddCardOpen(false)}
            runIds={compRunIds.length > 0 ? compRunIds : allProjectRunIds}
            onAdd={onAddCard}
          />

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setAddCardOpen(true)}
              className="inline-flex items-center gap-1.5 rounded border border-border px-3 py-1.5 text-xs font-medium text-fg-muted hover:border-accent hover:text-fg transition-colors"
            >
              <span aria-hidden="true">+</span> Add card
            </button>
          </div>

          <WorkspaceToolbar
            projectId={projectId}
            query={query}
            onQueryChange={setQuery}
            matchCount={matchCount}
            builderMetrics={scalarNames}
            onBuildPanels={buildPanels}
          />

          {comparison.cards.length === 0 ? (
            <div className="card p-6 text-sm text-fg-muted">
              No cards yet. Click "Add card" to pick metrics from the comparison's runs.
            </div>
          ) : (
            <WorkspaceDefaultsProvider defaults={doc.defaults}>
            {/* MERGER: ChartSyncProvider (lib/chart-sync.tsx) wraps from here, driven by doc.prefs.syncZoom / doc.prefs.syncCursor. */}
            <CardNavProvider>
            <div className="space-y-8">
              {sections.length === 0 && <p className="text-sm text-fg-muted">No cards match.</p>}
              {sections.map((section) => (
                <SectionBlock
                  key={section.name}
                  sectionName={section.name}
                  itemCount={section.items.length}
                  collapsed={collapsedSections.has(section.name)}
                  onToggleCollapse={() => toggleSection(section.name)}
                  cardTypes={Array.from(new Set(section.items.map((c) => c.type)))}
                  onSendToReport={() => sendSection(section.name, section.items)}
                >
                  <ReorderableCardGrid
                    cards={section.items.map((card) => ({
                      key: card.id,
                      content: (
                        <ComparisonCardView
                          card={card}
                          settingsKey={cardSettingsKeyFor(comparison.id, card)}
                          onRemove={() => onRemoveCard(card.id)}
                          autoOpenSettings={card.id === autoFocusCardId}
                        />
                      ),
                    }))}
                    // A sorted section has no manual order to change.
                    onReorder={doc.sections.sort.includes(section.name) ? undefined : onReorderCards}
                  />
                </SectionBlock>
              ))}
            </div>
            </CardNavProvider>
            </WorkspaceDefaultsProvider>
          )}
        </RunViewContext.Provider>
      )}

      {tab === "source" && (
        <ComparisonSourceTab compRunIds={compRunIds} />
      )}
    </div>
  );
}

