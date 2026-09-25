import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import CardRenderer from "./CardRenderer";
import ReorderableCardGrid from "./ReorderableCardGrid";
import SectionBlock from "./SectionBlock";
import WorkspaceToolbar from "./WorkspaceToolbar";
import CustomPanelCards, { CUSTOM_SECTION, customPanelSettingsKey } from "./CustomPanelCards";
import type { SequenceMeta } from "../api/types";
import { groupIntoSections, orderSections } from "../lib/sections";
import {
  applyLayout,
  cardKeyOf,
  EMPTY_LAYOUT,
  isEmptyLayout,
  loadRunLayout,
  moveCard,
  resetRunLayout,
  saveRunLayout,
} from "../lib/run-layout";
import type { RunLayout } from "../lib/run-layout";
import { useCollapsedSections } from "../lib/use-collapsed-sections";
import { useProjectId } from "../lib/project-context";
import { CardMutationContext, saveCardOverrides } from "../lib/card-settings";
import { CARD_TYPES, type CardType } from "../lib/cards/card-spec";
import { CardNavProvider } from "../lib/card-nav";
import { WorkspaceDefaultsProvider } from "../lib/settings-scope";
import { usePushUndo } from "../lib/undo-context";
import { shortRunLabel } from "../lib/run-label";
import { newId } from "../lib/reports";
import type { ComparisonCard } from "../lib/comparisons";
import { ops } from "../lib/workspace/doc";
import { compilePanelFilter, filterPanels } from "../lib/workspace/panel-filter";
import type { BuiltPanel } from "../lib/workspace/panel-builder";
import { sendCardsToReport } from "../lib/workspace/send-to-report";
import { useWorkspace } from "../lib/workspace/use-workspace";

interface Props {
  runId: string;
  sequences: SequenceMeta[];
}

interface Entry {
  primary: SequenceMeta;
  extras: SequenceMeta[];
}

const asCardType = (t: string): CardType | null => ((CARD_TYPES as readonly string[]).includes(t) ? (t as CardType) : null);

export default function CardGrid({ runId, sequences }: Props) {
  const [layout, setLayout] = useState<RunLayout>(() => loadRunLayout(runId));
  const navigate = useNavigate();

  // The project workspace: hidden cards and hide patterns (every run of the
  // project), section pins/sorting, defaults and custom panels.
  const projectId = useProjectId();
  const { doc, update } = useWorkspace(projectId);
  const mutable = useContext(CardMutationContext) && projectId != null;
  const pushUndo = usePushUndo();
  const [managingHidden, setManagingHidden] = useState(false);
  const [query, setQuery] = useState("");

  const { collapsed: collapsedSections, toggle: toggleSectionCollapse } = useCollapsedSections(runId);

  // Reload persisted layout when the run changes.
  const runIdRef = useRef(runId);
  runIdRef.current = runId;
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  useEffect(() => {
    setLayout(loadRunLayout(runId));
  }, [runId]);

  // Every layout change is one undo step. Undo may run after navigating to
  // another run: it writes the layout of the run it was made on.
  const changeLayout = useCallback(
    (label: string, next: RunLayout) => {
      const rid = runIdRef.current;
      const prev = layoutRef.current;
      const commit = (l: RunLayout) => {
        if (isEmptyLayout(l)) resetRunLayout(rid);
        else saveRunLayout(rid, l);
        if (runIdRef.current === rid) {
          layoutRef.current = l;
          setLayout(l);
        }
      };
      commit(next);
      pushUndo({ label, undo: () => commit(prev), redo: () => commit(next) });
    },
    [pushUndo],
  );

  // `shownOrder` is the section's order as rendered. It seeds the persisted
  // list first, so an index into it means the same slot in the layout even
  // when the layout lists only some (or none) of the section's cards.
  const commitMove = useCallback(
    (
      cardKey: string,
      section: string,
      shownOrder: string[],
      toIndex: number | null,
    ) => {
      const prev = layoutRef.current;
      const shown = new Set(shownOrder);
      const rest = (prev.sectionOrderOfCards[section] ?? []).filter((k) => !shown.has(k));
      const seeded: RunLayout = {
        ...prev,
        sectionOrderOfCards: { ...prev.sectionOrderOfCards, [section]: [...shownOrder, ...rest] },
      };
      changeLayout(`Move ${cardKey}`, moveCard(seeded, cardKey, section, section, toIndex));
    },
    [changeLayout],
  );

  const handleReset = useCallback(() => changeLayout("Reset layout", { ...EMPTY_LAYOUT }), [changeLayout]);

  const hiddenSet = useMemo(() => new Set(doc.hiddenCards), [doc.hiddenCards]);
  const sections = useMemo(() => {
    const visible = filterPanels(sequences, (s) => s.name, {
      query,
      hidePatterns: doc.hidePatterns,
      hidden: hiddenSet,
      keyOf: cardKeyOf,
    });
    const auto = groupIntoSections(visible);
    return orderSections(applyLayout(auto, layout), doc.sections, (m) => m.name);
  }, [sequences, layout, hiddenSet, doc.hidePatterns, doc.sections, query]);

  const customPanels = useMemo(
    () => filterPanels(doc.customPanels, (p) => p.title, { query, hidePatterns: doc.hidePatterns }),
    [doc.customPanels, doc.hidePatterns, query],
  );

  const matchCount = useMemo(() => {
    if (!query.trim()) return 0;
    const f = compilePanelFilter(query);
    return sequences.filter((s) => !hiddenSet.has(cardKeyOf(s)) && f.test(s.name)).length;
  }, [sequences, hiddenSet, query]);

  const scalarNames = useMemo(
    () => sequences.filter((s) => s.object_type === "scalar").map((s) => s.name),
    [sequences],
  );

  const buildPanels = useCallback(
    (built: BuiltPanel[]) => {
      if (!projectId) return;
      const panels = built.map((p) => ({ id: newId(), title: p.title, type: "scalar" as const, metrics: p.metrics }));
      // The panel's title is its card title (settings shared by every run).
      for (const p of panels) saveCardOverrides(customPanelSettingsKey(projectId, p.id), { title: p.title });
      update(ops.addCustomPanels(panels), { label: `Add ${panels.length} panel(s)` });
    },
    [projectId, update],
  );

  const sendSection = useCallback(
    async (sectionName: string, metas: SequenceMeta[]) => {
      if (!projectId) return;
      const byId = new Map<string, string>();
      const cards: ComparisonCard[] = [];
      for (const m of metas) {
        const type = asCardType(m.object_type);
        if (!type) continue;
        const card: ComparisonCard = { id: newId(), type, series: [{ runId, name: m.name }] };
        byId.set(card.id, m.name);
        cards.push(card);
      }
      const label = shortRunLabel(runId);
      const reportId = await sendCardsToReport({
        projectId,
        name: `${sectionName} · ${label}`,
        intro: `Section “${sectionName}” of run ${label}.`,
        runIds: [runId],
        cards,
        settingsKeyOf: (card) => ({ runId, metricName: byId.get(card.id) ?? card.id }),
      });
      navigate(`/p/${projectId}/reports/${reportId}`);
    },
    [projectId, runId, navigate],
  );

  // Every removed card, whether or not this run logs it — a card removed
  // while viewing another run must still be restorable from here.
  const hiddenKeys = useMemo(() => [...doc.hiddenCards].sort(), [doc.hiddenCards]);

  if (sequences.length === 0) {
    return <p className="text-fg-muted">No metrics logged for this run yet.</p>;
  }

  const showReset = !isEmptyLayout(layout);

  return (
    <WorkspaceDefaultsProvider defaults={doc.defaults}>
      {/* MERGER: ChartSyncProvider (lib/chart-sync.tsx) wraps from here, driven by doc.prefs.syncZoom / doc.prefs.syncCursor. */}
      <CardNavProvider>
      <div className="space-y-8">
        {projectId && (
          <WorkspaceToolbar
            projectId={projectId}
            query={query}
            onQueryChange={setQuery}
            matchCount={matchCount}
            builderMetrics={scalarNames}
            onBuildPanels={buildPanels}
            runLayout={{ value: layout, apply: (l) => changeLayout("Apply view layout", l) }}
          />
        )}
        {(showReset || hiddenKeys.length > 0) && (
          <div className="flex items-center justify-end gap-3">
            {hiddenKeys.length > 0 && (
              <button
                type="button"
                onClick={() => setManagingHidden((v) => !v)}
                className="text-xs text-fg-muted underline underline-offset-2 hover:text-fg"
                title="Cards removed from this project's default view"
              >
                {hiddenKeys.length} hidden · manage
              </button>
            )}
            {showReset && mutable && (
              <button
                type="button"
                onClick={handleReset}
                className="text-xs text-fg-muted underline underline-offset-2 hover:text-fg"
                title="Clear persisted card layout for this run"
              >
                reset layout
              </button>
            )}
          </div>
        )}
        {managingHidden && hiddenKeys.length > 0 && (
          <HiddenCardsPanel
            hiddenKeys={hiddenKeys}
            onShow={(key) => update(ops.showCards([key]), { label: `Show ${key}` })}
            onShowAll={() => {
              update(ops.showAllCards(), { label: "Show all cards" });
              setManagingHidden(false);
            }}
          />
        )}
        {projectId && (
          <CustomPanelCards
            projectId={projectId}
            runId={runId}
            panels={customPanels}
            collapsed={collapsedSections.has(CUSTOM_SECTION)}
            onToggleCollapse={() => toggleSectionCollapse(CUSTOM_SECTION)}
            onRemove={mutable ? (id) => update(ops.removeCustomPanel(id), { label: "Remove panel" }) : undefined}
          />
        )}
        {sections.length === 0 && customPanels.length === 0 && (
          <p className="text-sm text-fg-muted">No cards match.</p>
        )}
        {sections.map((section) => {
          const entries = toEntries(section.items);
          // cardKey per rendered entry. Use the same convention `run-layout`
          // uses so drag payloads and layout lookups stay in sync.
          const entryKeys = entries.map((e) => cardKeyOf(e.primary));
          const cardTypes = Array.from(
            new Set(section.items.map((m) => asCardType(m.object_type)).filter((t): t is CardType => t != null)),
          );
          return (
            <SectionBlock
              key={section.name}
              sectionName={section.name}
              itemCount={entries.length}
              collapsed={collapsedSections.has(section.name)}
              onToggleCollapse={() => toggleSectionCollapse(section.name)}
              cardTypes={cardTypes}
              onSendToReport={() => sendSection(section.name, section.items)}
            >
              <ReorderableCardGrid
                cards={entries.map((entry) => ({
                  key: cardKeyOf(entry.primary),
                  content: (
                    <CardFor
                      runId={runId}
                      entry={entry}
                      onRemove={
                        mutable
                          ? () => {
                              const key = cardKeyOf(entry.primary);
                              update(ops.hideCards([key]), { label: `Hide ${key}` });
                            }
                          : undefined
                      }
                    />
                  ),
                }))}
                onReorder={
                  // A sorted section has no manual order to change.
                  doc.sections.sort.includes(section.name)
                    ? undefined
                    : (fromKey, toKey) => {
                        const toIdx = entryKeys.indexOf(toKey);
                        commitMove(fromKey, section.name, entryKeys, toIdx >= 0 ? toIdx : null);
                      }
                }
              />
            </SectionBlock>
          );
        })}
      </div>
      </CardNavProvider>
    </WorkspaceDefaultsProvider>
  );
}

// -----------------------------------------------------------------------------
// Scalar collapsing + dispatch (unchanged behavior).
// -----------------------------------------------------------------------------

function toEntries(metas: SequenceMeta[]): Entry[] {
  // Each metric name is an independent card — no grouping.
  // Users can merge metrics via chip drag-drop or the settings picker.
  return metas.map((m) => ({ primary: m, extras: [] }));
}

function CardFor({
  runId,
  entry,
  onRemove,
}: {
  runId: string;
  entry: Entry;
  onRemove?: () => void;
}) {
  return <CardRenderer runId={runId} metric={entry.primary} onRemove={onRemove} />;
}

// -----------------------------------------------------------------------------
// Removed-cards panel: the "add back" half of the per-project default view.
// -----------------------------------------------------------------------------

function HiddenCardsPanel({
  hiddenKeys,
  onShow,
  onShowAll,
}: {
  hiddenKeys: string[];
  onShow: (cardKey: string) => void;
  onShowAll: () => void;
}) {
  return (
    <div className="card p-3">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
          Removed from this project&rsquo;s view
        </span>
        <button
          type="button"
          onClick={onShowAll}
          className="text-xs text-fg-muted underline underline-offset-2 hover:text-fg"
        >
          show all
        </button>
      </div>
      <ul className="flex flex-wrap gap-1.5">
        {hiddenKeys.map((key) => {
          const name = key;
          return (
            <li key={key}>
              <button
                type="button"
                onClick={() => onShow(key)}
                className="mono inline-flex items-center gap-1 rounded bg-bg-hover px-1.5 py-0.5 text-xs text-fg-muted hover:text-fg"
                title={`Show ${name}`}
              >
                <span aria-hidden="true">+</span>
                {name}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
