/**
 * Notebook embeds of whole pages (lib/embed.ts): the app's pages without its
 * navigation, for iframes in Jupyter / marimo (`cairn.Run`'s notebook
 * display, `cairn.ui.workspace`, `cairn.ui.report`).
 *
 * - `/embed/run/<run>[?tab=overview]`: the run page's header line
 *   (`train v2 · ● running · exp-44 · finetune   ↗ open in cairn`) and its
 *   tabs, under the same tab routes as the run page.
 * - `/embed/workspace/<project>[?filter=…]`: the runs sidebar and the cards;
 *   the filter is the run state's initial filter, never saved into the view.
 * - `/embed/report/<project>/<report>`: the report body, read-only.
 *
 * Read-gated like the app (and `/embed/card`): the same session cookie, a
 * 401 goes to /login. Live like the pages they show (the same polling).
 */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Navigate, NavLink, Outlet, useParams, useSearchParams } from "react-router-dom";
import { useReport, useRun, useRunSetPool } from "../api/hooks";
import RunStatusBadge from "../components/RunStatusBadge";
import RunsWorkspace from "../components/workspace-runs/RunsWorkspace";
import ReportNotebook from "../components/reports/ReportNotebook";
import { embedFilter, embedTabPath, runPagePath, RUN_TABS } from "../lib/embed";
import { ProjectProvider } from "../lib/project-context";
import { parseReportMarkdown, restoreReportCardSettings, type ReportBlock, type ReportPayload } from "../lib/reports";
import { useRunMetadataVersion } from "../lib/run-label";
import { resolveRunSet } from "../lib/run-sets";
import { RunViewContext } from "../lib/run-view";
import { useProjectRunView } from "../lib/run-view-store";
import { UndoProvider } from "../lib/undo-context";
import { refKey, viewRef } from "../lib/workspace/ref";
import { useViews } from "../lib/workspace/use-views";

/** No app header: sticky parts stick to the frame's top. */
function EmbedFrame({ projectId, children }: { projectId: string; children: ReactNode }) {
  useRunMetadataVersion();
  return (
    <ProjectProvider value={projectId}>
      <UndoProvider key={projectId}>
        <div className="min-h-full bg-bg px-3 py-3 [--header-h:0px]">{children}</div>
      </UndoProvider>
    </ProjectProvider>
  );
}

const muted = (text: string) => <p className="p-4 text-sm text-fg-muted">{text}</p>;

/** `/embed/run/:runId` and its tab routes. */
export function EmbedRunPage() {
  const { runId } = useParams<{ runId: string }>();
  const [search] = useSearchParams();
  const q = useRun(runId!);
  const runView = useProjectRunView(q.data?.run.project_id);

  // `?tab=` opens that tab (the tabs are routes, as on the run page).
  const tab = embedTabPath(search.get("tab"));
  if (tab) return <Navigate to={tab} replace />;

  if (q.isLoading) return muted("Loading…");
  if (q.isError || !q.data) return muted(`Run ${runId} not found.`);
  const run = q.data.run;
  const sep = <span className="text-fg-subtle">·</span>;

  return (
    <EmbedFrame projectId={run.project_id}>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm" data-testid="embed-run-header">
        <span className="mono font-semibold">{run.display_name ?? run.id}</span>
        {run.version != null && <span className="mono num text-fg-muted">v{run.version}</span>}
        {sep}
        <RunStatusBadge status={run.status} archived={run.archived} />
        {run.group != null && (
          <>
            {sep}
            <span className="mono text-fg-muted">{run.group}</span>
          </>
        )}
        {run.job_type != null && (
          <>
            {sep}
            <span className="mono text-fg-muted">{run.job_type}</span>
          </>
        )}
        <OpenInCairn to={runPagePath(run.project_id, run.id)} />
      </div>
      <nav className="mb-4 flex gap-1 overflow-x-auto whitespace-nowrap border-b border-border">
        {RUN_TABS.map((t) => (
          <NavLink
            key={t.id}
            to={t.id}
            end={t.id === "."}
            className={({ isActive }) =>
              [
                "border-b-2 px-3 py-2 text-sm transition-colors",
                isActive ? "border-accent text-fg" : "border-transparent text-fg-muted hover:text-fg",
              ].join(" ")
            }
          >
            {t.label}
          </NavLink>
        ))}
      </nav>
      <RunViewContext.Provider value={runView}>
        <Outlet context={{ run, params: q.data.params, config: q.data.config_doc ?? {}, summary: q.data.summary ?? [], summaryDoc: q.data.summary_doc ?? {} }} />
      </RunViewContext.Provider>
    </EmbedFrame>
  );
}

function OpenInCairn({ to }: { to: string }) {
  return (
    <a href={to} target="_blank" rel="noreferrer" className="ml-auto text-xs text-fg-muted hover:text-accent" data-testid="embed-open">
      ↗ open in cairn
    </a>
  );
}

/** `/embed/workspace/:projectId[?filter=…]`. */
export function EmbedWorkspacePage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [search] = useSearchParams();
  // Read once: the embed's initial filter (later edits stay in the embed).
  const [initialFilter] = useState(() => embedFilter(search.get("filter")));
  const views = useViews(projectId ?? null);
  const current = views.data?.current ?? null;
  const wsRef = useMemo(() => (projectId && current ? viewRef(projectId, current) : null), [projectId, current]);
  if (!projectId) return null;
  return (
    <EmbedFrame projectId={projectId}>
      {wsRef ? <RunsWorkspace key={refKey(wsRef)} wsRef={wsRef} initialFilter={initialFilter} /> : muted("Loading…")}
    </EmbedFrame>
  );
}

const noop = () => {};

/** `/embed/report/:projectId/:reportId`: the report body, read-only. */
export function EmbedReportPage() {
  const { projectId, reportId } = useParams<{ projectId: string; reportId: string }>();
  const q = useReport(projectId ?? "", reportId ?? "");
  const runsQ = useRunSetPool(projectId);
  const [blocks, setBlocks] = useState<ReportBlock[] | null>(null);

  // As the report page: parse once both the report and its run pool are in.
  useEffect(() => {
    if (blocks || !q.data || !reportId || (!runsQ.data && !runsQ.isError)) return;
    const runs = runsQ.data?.runs ?? [];
    const payload = q.data.payload as unknown as ReportPayload;
    const parsed = parseReportMarkdown(payload.source, undefined, {
      resolveRunSets: (sets) => sets.map((set) => resolveRunSet(set, runs)),
    });
    restoreReportCardSettings(reportId, parsed.blocks, parsed.settings);
    setBlocks(parsed.blocks);
  }, [blocks, q.data, runsQ.data, runsQ.isError, reportId]);

  if (!projectId || !reportId) return null;
  if (q.isError) return muted(`Report ${reportId} not found.`);
  return (
    <EmbedFrame projectId={projectId}>
      {q.data && <h1 className="mb-4 text-xl font-semibold">{q.data.name}</h1>}
      {blocks ? (
        <ReportNotebook
          projectId={projectId}
          reportId={reportId}
          blocks={blocks}
          onUpdateBlock={noop}
          onMoveBlock={noop}
          onDeleteBlock={noop}
          onInsertBlock={noop}
          readOnly
        />
      ) : (
        muted("Loading…")
      )}
    </EmbedFrame>
  );
}
