/**
 * The workspace renderer: one layout document + a bound run set. The run
 * page (`runIds = [the run]`) and every comparison (`runIds = its runs`)
 * render exactly this component — toolbar, sections, panels, the add/edit
 * panel dialog, removed panels — and differ only in the ref and the runs.
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
 * persisting anything.
 */

import { useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import CardErrorBoundary from "../card-kit/CardErrorBoundary";
import ReorderableCardGrid from "../ReorderableCardGrid";
import SectionBlock from "../SectionBlock";
import WorkspaceToolbar from "../WorkspaceToolbar";
import RunColorByProvider from "../RunColorByProvider";
import PanelCard from "./PanelCard";
import PanelDialog, { type PanelDialogResult } from "./PanelDialog";
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
  deriveLayout,
  panelsToMaterialize,
  sectionAutoPanels,
  type RenderedPanel,
  type RenderedSection,
} from "../../lib/workspace/layout";
import { compilePanelFilter } from "../../lib/workspace/panel-filter";
import type { BuiltPanel } from "../../lib/workspace/panel-builder";
import { PanelActionsContext } from "../../lib/workspace/panel-actions";
import { refKey, WorkspaceRefContext, type WorkspaceRef } from "../../lib/workspace/ref";
import { sendCardsToReport } from "../../lib/workspace/send-to-report";
import { getWorkspace, subscribeWorkspace } from "../../lib/workspace/store";
import { useWorkspace } from "../../lib/workspace/use-workspace";

/** Where the quick panel builder puts its panels. */
export const BUILDER_SECTION = "Custom panels";

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

  // --- the add / edit panel dialog ------------------------------------------
  const [dialog, setDialog] = useState<{ section: string; panel: Panel | null } | null>(null);
  const [autoFocusId, setAutoFocusId] = useState<string | null>(null);
  useEffect(() => {
    if (autoFocusId != null) setAutoFocusId(null);
  }, [autoFocusId]);

  const submitDialog = useCallback(
    (r: PanelDialogResult) => {
      if (!dialog) return;
      if (dialog.panel) {
        const id = dialog.panel.id;
        update(
          sectionOp(
            ops.seq(
              materializeOp(id),
              ops.setPanelType(id, r.type),
              ops.setPanelSelector(id, r.selector),
              r.section !== dialog.section ? ops.movePanel(id, r.section, null) : identity,
            ),
          ),
          { label: "Edit panel" },
        );
        return;
      }
      const panel: Panel = { id: newLayoutId("p_"), type: r.type, selector: r.selector, settings: {} };
      update(sectionOp(ops.addPanels(r.section, [panel])), { label: "Add panel" });
      setAutoFocusId(panel.id);
    },
    [dialog, update, sectionOp, materializeOp],
  );

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

  const [managingRemoved, setManagingRemoved] = useState(false);
  const removed = useMemo(() => [...doc.removed].sort(), [doc.removed]);
  const sectionNames = all.map((s) => s.name);

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
          actions={toolbarActions}
        />
        {removed.length > 0 && (
          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => setManagingRemoved((v) => !v)}
              className="text-xs text-fg-muted underline underline-offset-2 hover:text-fg"
              title="Automatic panels removed from this workspace"
            >
              {removed.length} removed · manage
            </button>
          </div>
        )}
        {managingRemoved && removed.length > 0 && (
          <RemovedPanels
            names={removed}
            editable={mutable}
            onRestore={(names) => {
              update(ops.restoreRemoved(names), { label: names.length === 1 ? `Restore ${names[0]}` : "Restore all panels" });
              if (names.length === removed.length) setManagingRemoved(false);
            }}
          />
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
              onAddPanel={() => setDialog({ section: section.name, panel: null })}
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
                        value={mutable ? { onEdit: () => setDialog({ section: section.name, panel: rp.panel }) } : null}
                      >
                        <CardErrorBoundary variant="card">
                          <PanelCard
                            rendered={rp}
                            runIds={runIds}
                            settingsKey={settingsKeyOf(rp.panel.id)}
                            onRemove={mutable ? () => removePanel(rp) : undefined}
                            autoOpenSettings={rp.panel.id === autoFocusId}
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
      {dialog && (
        <PanelDialog
          open
          onClose={() => setDialog(null)}
          metrics={metrics}
          sections={sectionNames}
          section={dialog.section}
          panel={dialog.panel}
          onSubmit={submitDialog}
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

/** The removed automatic panels, each restorable. */
function RemovedPanels({
  names,
  editable,
  onRestore,
}: {
  names: string[];
  editable: boolean;
  onRestore: (names: string[]) => void;
}) {
  return (
    <div className="card p-3">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Removed from this workspace</span>
        {editable && (
          <button
            type="button"
            onClick={() => onRestore(names)}
            className="text-xs text-fg-muted underline underline-offset-2 hover:text-fg"
          >
            restore all
          </button>
        )}
      </div>
      <ul className="flex flex-wrap gap-1.5">
        {names.map((name) => (
          <li key={name}>
            <button
              type="button"
              disabled={!editable}
              onClick={() => onRestore([name])}
              className="mono inline-flex items-center gap-1 rounded bg-bg-hover px-1.5 py-0.5 text-xs text-fg-muted hover:text-fg disabled:cursor-default"
              title={`Restore ${name}`}
            >
              <span aria-hidden="true">+</span>
              {name}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
