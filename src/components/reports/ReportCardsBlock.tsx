/**
 * Cards block editor/viewer for a report: a list of ComparisonCard[]
 * rendered by `ComparisonCardView` with settings scoped under
 * `reportRunId(reportId)`, over the runs of the cell's run sets
 * (lib/run-sets.ts), resolved live against the project's runs (or fixed by
 * the caller: a share link's server-resolved sets). The cards draw the union
 * of the sets' runs; with several sets each set has its own colour family.
 * The sets are listed and edited in a "Runs" dialog opened from the cell
 * toolbar (RunSetsPanel: add, edit, remove, insert from the workspace), so
 * the report itself shows only its cards.
 *
 * Report cards resolve against built-in defaults only (no workspace or
 * section defaults), so a report looks the same to everyone. `readOnly`
 * (view mode) freezes the cell: no toolbar, reorder or remove, and card
 * settings changes stay in the viewer's session (see lib/card-settings.ts).
 */

import { useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import AddCardModal, { type AddCardSelection } from "../AddCardModal";
import ComparisonCardView from "../comparison/ComparisonCardView";
import ReorderableCardGrid from "../ReorderableCardGrid";
import Dialog, { DialogBody } from "../ui/Dialog";
import { CELL_TOOLBAR_BTN } from "./cell-toolbar";
import { CardCommentsContext, ReportCommentsContext } from "./comments-context";
import RunSetsPanel from "./RunSetsPanel";
import { shouldAutoRebind } from "../../lib/reports/run-set-rebind";
import { insertFromWorkspace } from "../../lib/reports/insert-from-workspace";
import { CardMutationContext, CardSettingsChangeContext, loadCardOverrides, saveCardOverrides } from "../../lib/card-settings";
import { PanelActionsContext } from "../../lib/workspace/panel-actions";
import { CascadeScopeContext } from "../../lib/settings-scope";
import { rebindCardsToMetricIndex, rebindCardsToRuns, rebuildCardsFromRuns } from "../../lib/comparisons";
import { cardFromSpec, cardSettingsKeyForReport, newId, restoreReportCardSettings, useMetricIndex, type CardsBlock } from "../../lib/reports";
import { recompileDecision, recompileFailedBlock } from "../../lib/reports/recompile";
import { resolveRunSet, runSetColors, unionOfSets, type RunSet } from "../../lib/run-sets";
import { RunColorByContext, type RunColorByValue } from "../../lib/run-color-by-context";
import { useRunSetPool } from "../../api/hooks";
import { EMPTY_RUN_VIEW, RunViewContext, type RunView } from "../../lib/run-view";
import { isEmptyRunView } from "../../lib/run-view-store";
import { MediaSyncProvider, SectionMediaBar } from "../card-kit/media-sync";

interface Props {
  projectId: string;
  reportId: string;
  block: CardsBlock;
  onChange: (next: CardsBlock) => void;
  /** Renders the cell toolbar with this cell's own actions (`extra`) in it. */
  toolbar: (extra: ReactNode) => ReactNode;
  /** View mode: cards can be explored but nothing is saved. */
  readOnly?: boolean;
}

export default function ReportCardsBlock({ projectId, reportId, block: parsedBlock, onChange, toolbar, readOnly = false }: Props) {
  // Each card's comment count and popover (editable reports only).
  const comments = useContext(ReportCommentsContext);
  const [addCardOpen, setAddCardOpen] = useState(false);
  const [runsOpen, setRunsOpen] = useState(false);
  const [resetting, setResetting] = useState(false);

  // The cell's runs: each run set resolved over the project's runs, or fixed.
  const fixed = parsedBlock.fixedRuns;
  const poolQ = useRunSetPool(projectId, !fixed);
  const pool = poolQ.data?.runs;
  const resolvedSets = useMemo(
    () => fixed ?? (pool ? parsedBlock.runSets.map((set) => resolveRunSet(set, pool)) : null),
    [fixed, pool, parsedBlock.runSets],
  );
  const resolved = resolvedSets !== null;
  const runIds = useMemo(() => unionOfSets(resolvedSets ?? []), [resolvedSets]);
  const runIdsKey = runIds.join("|");

  // Several sets: each its own colour family (as a colour-by would).
  const familyColors = useMemo(() => (resolvedSets ? runSetColors(resolvedSets) : null), [resolvedSets]);
  const colorCtx = useMemo<RunColorByValue | null>(
    () => (familyColors ? { runIds, colorBy: null, colors: familyColors, legend: [], error: null, loading: false } : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [familyColors, runIdsKey],
  );

  const { index: liveMetricIndex, isLoading: indexLoading } = useMetricIndex(runIds);

  // A fence that failed to compile at hydrate time (typically a `metric:`
  // card with no `type:`, parsed before any sequence list was fetched) is
  // compiled again once this cell's metric index has loaded. The result is
  // display-only: `block` below is what every edit builds on, so it reaches
  // the saved report only through a user edit (see lib/reports/recompile.ts).
  const decision = recompileDecision({
    block: parsedBlock,
    runIds,
    runsResolved: resolved,
    indexLoading,
  });
  const restoredRef = useRef<string | null>(null);
  const recompiled = useMemo(() => {
    if (decision !== "recompile") return null;
    const r = recompileFailedBlock(parsedBlock, liveMetricIndex, runIds);
    // The fence's inline settings, once per fence (they'd otherwise clobber
    // a setting changed since).
    const restoreKey = `${parsedBlock.id}\n${parsedBlock.errorSource}`;
    if (r.ok && restoredRef.current !== restoreKey) {
      restoredRef.current = restoreKey;
      restoreReportCardSettings(reportId, [r.block], r.settings);
    }
    return r;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decision, parsedBlock, liveMetricIndex, runIdsKey, reportId]);
  const block = recompiled?.ok ? { ...recompiled.block, ...(fixed ? { fixedRuns: fixed } : {}) } : parsedBlock;
  const error = recompiled ? (recompiled.ok ? undefined : recompiled.error) : parsedBlock.error;
  // Render-only rebind (never persisted — see the auto-rebind effect below
  // for the persisting counterpart): the persisted `cards` can be stale
  // relative to the live runs right after hydration or between edits.
  // Viewers never trigger a save, but they still see cards bound to the
  // runs the sets resolve to now.
  const displayCards = useMemo(
    () => (resolved ? rebindCardsToMetricIndex(block.cards, runIds, liveMetricIndex) : block.cards),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [resolved, block.cards, runIdsKey, liveMetricIndex],
  );

  const setRunSets = (runSets: RunSet[]) => onChange({ ...block, runSets, notice: undefined });

  // Explicit, destructive "start over" action — full regrow (one card per
  // (name, object_type) across the cell's runs), discarding curated
  // cards/order/overlays.
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

  // "⤓ Insert from workspace": a set copying the workspace's run state; a cell without cards also gets its layout's cards.
  const handleInsertFromWorkspace = async () => {
    const r = await insertFromWorkspace({ projectId, reportId, sets: block.runSets, copyCards: block.cards.length === 0, pool: pool ?? [] });
    onChange({ ...block, runSets: r.runSets, ...(r.cards ? { cards: r.cards } : {}), notice: undefined });
  };

  // Auto-rebind: when the resolved runs change, rebind the existing cards to
  // them so they don't go stale. Never regrows the card set.
  const lastReboundKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (readOnly || fixed) return;
    // A fence that failed to compile is never rewritten on its own.
    if (parsedBlock.error !== undefined) return;
    if (!shouldAutoRebind({ resolved, cards: block.cards, resolvedRunIds: runIds })) return;
    // Guard against re-running for a key we already rebound (e.g. while the
    // async rebind for this exact run set is in flight, or after it landed
    // and block.cards was updated but still doesn't perfectly match, which
    // can happen for curated overlay cards that intentionally don't grow).
    if (lastReboundKeyRef.current === runIdsKey) return;
    lastReboundKeyRef.current = runIdsKey;
    let cancelled = false;
    void (async () => {
      const rebound = await rebindCardsToRuns(block.cards, runIds);
      if (!cancelled) onChange({ ...block, cards: rebound });
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runIdsKey, resolved]);

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

  /** A copy of a card (its settings too) right after it. */
  const duplicateCard = (cardId: string) => {
    const at = block.cards.findIndex((c) => c.id === cardId);
    if (at < 0) return;
    const card = block.cards[at]!;
    const copy = { ...card, id: newId() };
    saveCardOverrides(cardSettingsKeyForReport(reportId, copy), loadCardOverrides(cardSettingsKeyForReport(reportId, card)));
    onChange({ ...block, cards: [...block.cards.slice(0, at + 1), copy, ...block.cards.slice(at + 1)] });
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
  // The cell's run view (```cairn `view.hidden/pinned/baseline`). A viewer
  // can still toggle it, but only for this session.
  const [sessionView, setSessionView] = useState<RunView | null>(null);
  const runViewCtx = useMemo(
    () => ({
      view: (readOnly ? sessionView : null) ?? block.runView ?? EMPTY_RUN_VIEW,
      set: readOnly
        ? setSessionView
        : (next: RunView) => onChange({ ...block, runView: isEmptyRunView(next) ? undefined : next }),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [readOnly, sessionView, block],
  );

  const handleSettingsTouched = useCallback(() => {
    onChange({ ...block });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [block]);

  if (error !== undefined) {
    return (
      <div>
        {/* Only the notebook's own cell actions (move, delete): editing a
            cell that never compiled would replace its fence. */}
        {!readOnly && toolbar(null)}
        {decision === "wait" ? (
          <div className="card p-4 text-sm text-fg-muted">Loading…</div>
        ) : (
          <CellError message={error} />
        )}
      </div>
    );
  }

  return (
    // A card's settings change (step, yScale, …) re-saves the report.
    <CardMutationContext.Provider value={!readOnly}>
    <CascadeScopeContext.Provider value="builtin-only">
    <CardSettingsChangeContext.Provider value={readOnly ? undefined : handleSettingsTouched}>
    <RunViewContext.Provider value={runViewCtx}>
    <RunColorByContext.Provider value={colorCtx}>
    <div>
      {!readOnly && toolbar(
        <>
          <button
            type="button"
            className={CELL_TOOLBAR_BTN}
            onClick={() => setAddCardOpen(true)}
            disabled={runIds.length === 0}
            title={runIds.length === 0 ? "This cell's run sets show no runs" : "Add card"}
            aria-label="Add card"
          >
            <i className="fa-solid fa-plus" aria-hidden="true" />
          </button>
          <button
            type="button"
            className={CELL_TOOLBAR_BTN}
            onClick={() => setRunsOpen(true)}
            title="Runs in this cell"
            aria-label="Runs in this cell"
          >
            <i className="fa-solid fa-sliders" aria-hidden="true" />
            <span className="mono text-[10px]">{runIds.length}</span>
          </button>
        </>,
      )}

      <Dialog open={runsOpen} onClose={() => setRunsOpen(false)} title="Runs in this cell">
        <DialogBody>
          <RunSetsPanel
            projectId={projectId}
            sets={block.runSets}
            resolved={resolvedSets}
            pool={pool ?? []}
            onChange={readOnly ? undefined : setRunSets}
            onInsertFromWorkspace={readOnly || fixed || !pool ? undefined : handleInsertFromWorkspace}
            actions={
              !readOnly && (
                <button
                  type="button"
                  onClick={() => void handleResetFromRuns()}
                  disabled={resetting || runIds.length === 0}
                  className="inline-flex h-6 touch:h-10 items-center justify-center rounded border border-border bg-bg px-2 text-[10px] text-fg-muted hover:border-accent hover:text-fg disabled:opacity-40"
                  title="Discard current cards and regrow one card per metric across this cell's runs"
                >
                  {resetting ? "Resetting…" : "Reset cards from runs"}
                </button>
              )
            }
          />
        </DialogBody>
      </Dialog>

      <AddCardModal open={addCardOpen} onClose={() => setAddCardOpen(false)} runIds={runIds} onAdd={onAddCard} />

      {displayCards.length === 0 ? (
        <div className="card flex flex-wrap items-center gap-3 p-4 text-sm text-fg-muted print:hidden">
          {block.notice ?? (!resolved ? "Loading runs…" : runIds.length === 0 ? "No runs match this cell's run sets." : "No cards yet.")}
          {!readOnly && <button
            type="button"
            onClick={() => (runIds.length === 0 ? setRunsOpen(true) : setAddCardOpen(true))}
            className="inline-flex items-center gap-1.5 rounded border border-border px-3 py-1.5 text-xs font-medium text-fg-muted hover:border-accent hover:text-fg transition-colors"
          >
            {runIds.length === 0 ? "Runs" : "+ Add card"}
          </button>}
        </div>
      ) : (
        <MediaSyncProvider scopeKey={`report:${reportId}:${block.id}`}>
        <SectionMediaBar className="mb-3" />
        <ReorderableCardGrid
          cards={displayCards.map((card) => ({
            key: card.id,
            content: (
              <CardCommentsContext.Provider
                value={
                  comments
                    ? {
                        cardId: card.id,
                        count: comments.openCountByCard.get(card.id) ?? 0,
                        open: (el) => comments.open({ kind: "card", cardId: card.id }, el),
                      }
                    : null
                }
              >
                <PanelActionsContext.Provider value={readOnly ? null : { onDuplicate: () => duplicateCard(card.id) }}>
                  <ComparisonCardView
                    card={card}
                    settingsKey={cardSettingsKeyForReport(reportId, card)}
                    onRemove={readOnly ? undefined : () => removeCard(card.id)}
                  />
                </PanelActionsContext.Provider>
              </CardCommentsContext.Provider>
            ),
          }))}
          onReorder={readOnly ? undefined : reorderCards}
          dataAttributes={{ "data-report-block": block.id }}
        />
        </MediaSyncProvider>
      )}
    </div>
    </RunColorByContext.Provider>
    </RunViewContext.Provider>
    </CardSettingsChangeContext.Provider>
    </CascadeScopeContext.Provider>
    </CardMutationContext.Provider>
  );
}

/** A ```cairn fence that failed to compile: its error and how to fix it. */
function CellError({ message }: { message: string }) {
  return (
    <div role="alert" className="card border-status-failed/50 p-4 text-sm">
      <div className="mb-1 flex items-center gap-2 font-medium text-status-failed">
        <i className="fa-solid fa-triangle-exclamation" aria-hidden="true" />
        This cell's <code className="mono">```cairn</code> block has an error
      </div>
      <p className="mono whitespace-pre-wrap break-words text-xs text-fg">{message}</p>
      <p className="mt-2 text-xs text-fg-muted">
        The block is saved exactly as written. Fix it in the report's markdown source, or delete the cell. A{" "}
        <code className="mono">metric:</code> card needs that metric logged on the cell's runs, or an explicit{" "}
        <code className="mono">type:</code>.
      </p>
    </div>
  );
}
