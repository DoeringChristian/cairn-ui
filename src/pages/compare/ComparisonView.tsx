import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import ComparisonOverviewTab from "../ComparisonOverviewTab";
import ComparisonSourceTab from "../ComparisonSourceTab";
import AddCardModal, { type AddCardSelection } from "../../components/AddCardModal";
import ComparisonCardView from "../../components/comparison/ComparisonCardView";
import RunSetEditor, { DEFAULT_QUERY_SELECTOR } from "../../components/comparison/RunSetEditor";
import ReorderableCardGrid from "../../components/ReorderableCardGrid";
import RunSelectorBadge from "../../components/RunSelectorBadge";
import { SectionBlock } from "../../components/CardGrid";
import {
  cardSettingsKeyFor,
  compareRunId,
  comparisonRunIds,
  createTemplate,
  templateCardOf,
  type Comparison,
  type ComparisonCard,
  type ComparisonTemplateCard,
  type SmartFilters,
} from "../../lib/comparisons";
import { buildReportPayload, cardSettingsKeyForReport, newId } from "../../lib/reports";
import { describeRunSelector } from "../../lib/run-selector";
import { loadCardOverrides, saveCardOverrides } from "../../lib/card-settings";
import { groupComparisonCardsIntoSections } from "../../lib/sections";
import { useCollapsedSections } from "../../lib/use-collapsed-sections";
import { disambiguateRunLabels, useRunMetadataVersion } from "../../lib/run-label";
import { useRunSelectorResolution } from "../../api/hooks";
import { api } from "../../api/client";
import type { Run } from "../../api/types";

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

  const sections = useMemo(
    () => groupComparisonCardsIntoSections(comparison.cards),
    [comparison.cards],
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

  const metaVersion = useRunMetadataVersion();
  const runLabels = useMemo(() => disambiguateRunLabels(compRunIds), [compRunIds, metaVersion]);

  // Snapshot this comparison into a new report: a markdown header (name +
  // run list) and one cards block with copies of the cards (new ids), each
  // card's settings copied into the report's scope. The comparison itself
  // is left untouched.
  const handleCreateReport = useCallback(async () => {
    setCreatingReport(true);
    try {
      const newCards: ComparisonCard[] = comparison.cards.map((card) => ({ ...card, id: newId() }));
      const runList = compRunIds.map((id) => runLabels[id] ?? id).join(", ");
      const headerBlock = {
        id: newId(),
        type: "markdown" as const,
        text: `# ${comparison.name}\n\nFrom comparison "${comparison.name}". Runs: ${runList || "(none)"}`,
      };
      const cardsBlock = {
        id: newId(),
        type: "cards" as const,
        runIds: compRunIds,
        cards: newCards,
      };
      const blocks = [headerBlock, cardsBlock];

      const created = await api.createReport(projectId, comparison.name, { source: "" });

      comparison.cards.forEach((card, i) => {
        const overrides = loadCardOverrides(cardSettingsKeyFor(comparison.id, card));
        if (overrides) saveCardOverrides(cardSettingsKeyForReport(created.id, newCards[i]!), overrides);
      });
      const fullPayload = buildReportPayload(created.id, blocks);
      await api.updateReport(projectId, created.id, { payload: fullPayload as unknown as Record<string, unknown> });

      navigate(`/p/${projectId}/reports/${created.id}`);
    } finally {
      setCreatingReport(false);
    }
  }, [comparison, compRunIds, runLabels, projectId, navigate]);

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
        <>
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

          {comparison.cards.length === 0 ? (
            <div className="card p-6 text-sm text-fg-muted">
              No cards yet. Click "Add card" to pick metrics from the comparison's runs.
            </div>
          ) : (
            <div className="space-y-8">
              {sections.map((section) => (
                <SectionBlock
                  key={section.name}
                  sectionName={section.name}
                  itemCount={section.cards.length}
                  collapsed={collapsedSections.has(section.name)}
                  onToggleCollapse={() => toggleSection(section.name)}
                >
                  <ReorderableCardGrid
                    cards={section.cards.map((card) => ({
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
                    onReorder={onReorderCards}
                  />
                </SectionBlock>
              ))}
            </div>
          )}
        </>
      )}

      {tab === "source" && (
        <ComparisonSourceTab compRunIds={compRunIds} />
      )}
    </div>
  );
}

