/**
 * Cards block editor/viewer for a report — bound to either a static set of
 * runIds or a dynamic `RunSelector` (see lib/run-selector.ts), holding a
 * list of ComparisonCard[] rendered by `ComparisonCardView` with settings
 * scoped under `reportRunId(reportId)`. The run set is edited with the same
 * `RunSetEditor` a comparison uses.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AddCardModal, { type AddCardSelection } from "../AddCardModal";
import ComparisonCardView from "../comparison/ComparisonCardView";
import ReorderableCardGrid from "../ReorderableCardGrid";
import RunSelectorBadge from "../RunSelectorBadge";
import RunSetEditor, { DEFAULT_QUERY_SELECTOR } from "../comparison/RunSetEditor";
import { CardSettingsChangeContext } from "../../lib/card-settings";
import {
  rebindCardsToMetricIndex,
  rebindCardsToRuns,
  rebuildCardsFromRuns,
} from "../../lib/comparisons";
import { cardFromSpec, cardSettingsKeyForReport, useMetricIndex, type CardsBlock } from "../../lib/reports";
import { describeRunSelector, type QueryRunSelector } from "../../lib/run-selector";
import { useRunSelectorResolution } from "../../api/hooks";
import type { Run } from "../../api/types";

interface Props {
  projectId: string;
  reportId: string;
  block: CardsBlock;
  allProjectRuns: Run[];
  onChange: (next: CardsBlock) => void;
}

export default function ReportCardsBlock({ projectId, reportId, block, allProjectRuns, onChange }: Props) {
  const [addCardOpen, setAddCardOpen] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [resetting, setResetting] = useState(false);

  const staticRunIds = block.runIds ?? [];
  // A CardsBlock's runSelector, when present, is always a query selector in
  // this UI (the "static" case is expressed via `runIds` with no
  // runSelector at all) — narrow so the form below can read/patch
  // query-only fields without a union check at every access.
  const selector: QueryRunSelector | undefined =
    block.runSelector?.kind === "query" ? block.runSelector : undefined;

  const resolution = useRunSelectorResolution(projectId, selector);
  const runIds = selector ? resolution.runIds : staticRunIds;

  // Render-only rebind (never persisted/autosaved — see handleRefresh's and
  // the auto-rebind effect's doc below for the persisting counterpart): a
  // selector block's *persisted* `cards` can be stale relative to `runIds`
  // right after this report was hydrated from its markdown `source` (a fresh
  // parse has no live-resolved runs to compile against) or between edits.
  // Viewers never trigger a save, but they should still see cards bound
  // to the currently-resolved runs rather than a frozen/stale snapshot —
  // this mirrors the ```cairn fence preview's own `opts.resolvedRunIds`
  // handling (cairn-block.ts), just without ever calling `onChange`.
  const { index: liveMetricIndex } = useMetricIndex(selector ? runIds : []);
  const displayCards = useMemo(
    () => (selector ? rebindCardsToMetricIndex(block.cards, runIds, liveMetricIndex) : block.cards),
    [selector, block.cards, runIds, liveMetricIndex],
  );

  const addRun = (id: string) => {
    onChange({ ...block, runIds: Array.from(new Set([...staticRunIds, id])) });
  };
  const removeRun = (id: string) => {
    onChange({
      ...block,
      runIds: staticRunIds.filter((r) => r !== id),
      cards: block.cards.map((c) => ({ ...c, series: c.series.filter((s) => s.runId !== id) })),
    });
  };

  const toggleAutoMode = () => {
    if (selector) {
      // Switch back to static: keep whatever runs are currently resolved.
      onChange({ ...block, runSelector: undefined, runIds: resolution.runIds });
    } else {
      onChange({ ...block, runSelector: { ...DEFAULT_QUERY_SELECTOR } });
    }
  };

  // Re-resolve which runs currently match, then REBIND the existing cards to
  // that run set (keep curated cards/order, re-derive series) rather than
  // discarding and regrowing one card per metric — see rebindCardsToRuns.
  const handleRefresh = async () => {
    setRebuilding(true);
    try {
      const freshRunIds = await resolution.refresh();
      const cards = await rebindCardsToRuns(block.cards, freshRunIds);
      onChange({ ...block, cards });
    } finally {
      setRebuilding(false);
    }
  };

  // Explicit, destructive "start over" action — full regrow (one card per
  // (name, object_type) across the block's runs), discarding curated
  // cards/order/overlays; the "refresh" above rebinds instead (see
  // rebindCardsToRuns).
  const handleResetFromRuns = async () => {
    if (runIds.length === 0) return;
    setResetting(true);
    try {
      const cards = await rebuildCardsFromRuns(runIds);
      onChange({ ...block, cards });
    } finally {
      setResetting(false);
    }
  };

  // Auto-rebind: when a selector block's resolved run set changes, rebind the
  // existing cards to the new runs so they don't go stale between explicit
  // refreshes. Never regrows the card set.
  const resolvedRunIdsKey = selector ? runIds.join("|") : "";
  const lastReboundKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!selector) return;
    if (block.cards.length === 0) return;
    const boundRunIds = new Set(block.cards.flatMap((c) => c.series.map((s) => s.runId)));
    const resolvedSet = new Set(runIds);
    const isStale =
      boundRunIds.size !== resolvedSet.size || [...resolvedSet].some((id) => !boundRunIds.has(id));
    if (!isStale) return;
    // Guard against re-running for a key we already rebound (e.g. while the
    // async rebind for this exact run set is in flight, or after it landed
    // and block.cards was updated but still doesn't perfectly match, which
    // can happen for curated overlay cards that intentionally don't grow).
    if (lastReboundKeyRef.current === resolvedRunIdsKey) return;
    lastReboundKeyRef.current = resolvedRunIdsKey;
    let cancelled = false;
    void (async () => {
      const rebound = await rebindCardsToRuns(block.cards, runIds);
      if (!cancelled) onChange({ ...block, cards: rebound });
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selector, resolvedRunIdsKey]);

  // AddCardSelection → ComparisonCard is the shared `cardFromSpec` (see
  // lib/reports/card-from-spec.ts) — also consumed by the ```cairn dialect
  // interpreter (lib/reports/cairn-block.ts), so the two authoring paths
  // build cards identically.
  const onAddCard = (sel: AddCardSelection) => {
    onChange({ ...block, cards: [...block.cards, cardFromSpec(sel)] });
  };

  const removeCard = (cardId: string) => {
    onChange({ ...block, cards: block.cards.filter((c) => c.id !== cardId) });
  };

  const reorderCards = (fromId: string, toId: string) => {
    const cards = [...block.cards];
    const fromIdx = cards.findIndex((c) => c.id === fromId);
    const toIdx = cards.findIndex((c) => c.id === toId);
    if (fromIdx < 0 || toIdx < 0) return;
    const [moved] = cards.splice(fromIdx, 1);
    cards.splice(toIdx, 0, moved!);
    onChange({ ...block, cards });
  };

  // A card's settings change (yScale, step, mode, ...) only touches
  // localStorage, not `block`, so it would never reach ReportEditorPage's
  // blocks[]-keyed autosave. "Touch" this block (new object identity, same
  // content) whenever a settings write lands, reusing that autosave trigger.
  const handleSettingsTouched = useCallback(() => {
    onChange({ ...block });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [block]);

  return (
    // A card's settings change (step, yScale, …) re-saves the report.
    <CardSettingsChangeContext.Provider value={handleSettingsTouched}>
    <div>
      <div className="mb-3 print:hidden">
          <RunSetEditor
            title="Runs in this block"
            runIds={runIds}
            allProjectRuns={allProjectRuns}
            selector={selector}
            editable
            onToggleMode={toggleAutoMode}
            onSelectorChange={(runSelector) => onChange({ ...block, runSelector })}
            onAddRun={addRun}
            onRemoveRun={removeRun}
            actions={
              <>
                {selector && (
                  <RunSelectorBadge
                    title={describeRunSelector(selector)}
                    count={resolution.runIds.length}
                    isRefreshing={rebuilding || resolution.isFetching}
                    onRefresh={() => void handleRefresh()}
                  />
                )}
                <button
                  type="button"
                  onClick={() => void handleResetFromRuns()}
                  disabled={resetting || runIds.length === 0}
                  className="inline-flex h-6 touch:h-10 items-center justify-center rounded border border-border bg-bg px-2 text-[10px] text-fg-muted hover:border-accent hover:text-fg disabled:opacity-40"
                  title="Discard current cards and regrow one card per metric across this block's runs"
                >
                  {resetting ? "Resetting…" : "Reset cards from runs"}
                </button>
              </>
            }
          />
      </div>

      <AddCardModal open={addCardOpen} onClose={() => setAddCardOpen(false)} runIds={runIds} onAdd={onAddCard} />
      <div className="mb-3 print:hidden">
        <button
          type="button"
          onClick={() => setAddCardOpen(true)}
          disabled={runIds.length === 0}
          className="inline-flex items-center gap-1.5 rounded border border-border px-3 py-1.5 text-xs font-medium text-fg-muted hover:border-accent hover:text-fg transition-colors disabled:opacity-40"
          title={runIds.length === 0 ? "Add runs to this block first" : undefined}
        >
          <span aria-hidden="true">+</span> Add card
        </button>
      </div>

      {displayCards.length === 0 ? (
        <div className="card p-4 text-sm text-fg-muted">
          {runIds.length === 0
            ? "No runs bound to this block yet."
            : 'No cards yet. Click "Add card" to pick metrics from this block\'s runs.'}
        </div>
      ) : (
        <ReorderableCardGrid
          cards={displayCards.map((card) => ({
            key: card.id,
            content: (
              <ComparisonCardView
                card={card}
                settingsKey={cardSettingsKeyForReport(reportId, card)}
                onRemove={() => removeCard(card.id)}
              />
            ),
          }))}
          onReorder={reorderCards}
        />
      )}
    </div>
    </CardSettingsChangeContext.Provider>
  );
}
