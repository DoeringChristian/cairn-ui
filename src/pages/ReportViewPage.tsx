/**
 * A shared report, as a share-link viewer sees it.
 *
 * `/share/:secret` (`ShareRedeemPage`) redeems the link — the server puts its
 * secret in an HttpOnly cookie — then replaces the URL with `/s/:reportId`,
 * so the secret leaves the address bar and history. `/s/:reportId`
 * (`ReportViewPage`) renders the report read-only: no app chrome, no editing,
 * no comments, no add-to buttons. Cards can still be explored (zoom, step,
 * settings), but nothing is saved.
 *
 * Everything comes from `GET /api/share/context` — the report, its runs and
 * their metric index — never from the project run list, which a share cannot
 * read. Selector cells are resolved against those runs (the server resolved
 * the same selectors against the full project to compute the scope) and
 * rendered as fixed run sets.
 */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { qk } from "../api/query-keys";
import type { Run, ShareContext } from "../api/types";
import ReportNotebook from "../components/reports/ReportNotebook";
import {
  buildMetricIndex,
  isCardsBlock,
  parseReportMarkdown,
  restoreReportCardSettings,
  type ReportBlock,
} from "../lib/reports";
import { resolveRunSelectorFromRuns } from "../lib/run-selector";
import { setRunMetadata } from "../lib/run-label";
import { formatRelative } from "../lib/format";

const noop = () => {};

function ShareMessage({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-full max-w-md flex-col items-center justify-center gap-2 px-4 py-24 text-center">
      <h1 className="text-lg font-semibold">{title}</h1>
      {children && <p className="text-sm text-fg-muted">{children}</p>}
    </div>
  );
}

/** `/share/:secret` — redeem, then continue at `/s/:reportId`. */
export function ShareRedeemPage() {
  const { secret } = useParams<{ secret: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState<number | null>(null);

  useEffect(() => {
    if (!secret) return;
    let cancelled = false;
    api
      .redeemShare(secret)
      .then(({ report_id }) => {
        if (cancelled) return;
        // A previously redeemed link's context must not linger.
        queryClient.removeQueries({ queryKey: qk.shareContext() });
        navigate(`/s/${report_id}`, { replace: true });
      })
      .catch((e: { status?: number }) => {
        if (!cancelled) setError(e.status ?? 0);
      });
    return () => {
      cancelled = true;
    };
  }, [secret, navigate, queryClient]);

  if (error === 429) {
    return <ShareMessage title="Too many attempts">Wait a minute, then reload this page.</ShareMessage>;
  }
  if (error !== null) {
    return <ShareMessage title="This link does not work">It is invalid, has expired, or was revoked.</ShareMessage>;
  }
  return <ShareMessage title="Opening shared report…" />;
}

/** Parse the shared report into cells whose run sets are all fixed. */
function blocksFromContext(ctx: ShareContext): { blocks: ReportBlock[]; settings: Record<string, unknown> } {
  const source = typeof ctx.report.payload.source === "string" ? ctx.report.payload.source : "";
  const metricIndex = buildMetricIndex(
    Object.entries(ctx.metric_index).map(([runId, sequences]) => ({ runId, sequences })),
  );
  const parsed = parseReportMarkdown(source, metricIndex, { allProjectRuns: ctx.runs });
  const blocks = parsed.blocks.map((b): ReportBlock => {
    if (!isCardsBlock(b) || !b.runSelector) return b;
    return { ...b, runSelector: undefined, runIds: resolveRunSelectorFromRuns(b.runSelector, ctx.runs) };
  });
  return { blocks, settings: parsed.settings };
}

/** `/s/:reportId` — the shared report, read-only. */
export default function ReportViewPage() {
  const { reportId } = useParams<{ reportId: string }>();
  const queryClient = useQueryClient();
  const q = useQuery({
    queryKey: qk.shareContext(),
    queryFn: api.shareContext,
    retry: false,
    staleTime: 30_000,
  });
  const ctx = q.data && q.data.report.id === reportId ? q.data : undefined;

  const view = useMemo(() => (ctx ? blocksFromContext(ctx) : null), [ctx]);

  // Seed what the cards would otherwise fetch one by one: run labels and each
  // run's sequence roster.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!ctx || !view) return;
    setRunMetadata(ctx.runs as Run[]);
    for (const [runId, sequences] of Object.entries(ctx.metric_index)) {
      queryClient.setQueryData(qk.sequences(runId), { sequences });
    }
    restoreReportCardSettings(ctx.report.id, view.blocks, view.settings);
    setReady(true);
  }, [ctx, view, queryClient]);

  useEffect(() => {
    if (ctx) document.title = `${ctx.report.name} · Cairn`;
  }, [ctx]);

  if (q.isLoading) return <ShareMessage title="Loading shared report…" />;
  if (!ctx || !view) {
    return <ShareMessage title="This link does not work">It is invalid, has expired, or was revoked.</ShareMessage>;
  }

  return (
    <div className="min-h-full bg-bg">
      <main className="mx-auto w-full max-w-7xl px-4 py-6 print:p-0">
        <header className="mb-6 flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="mono min-w-0 break-all text-xl font-semibold">{ctx.report.name}</h1>
          <p className="text-xs text-fg-subtle print:hidden" title={ctx.expires_at}>
            Shared report · view only · updated {formatRelative(ctx.report.updated_at)}
          </p>
        </header>
        {ready && (
          <ReportNotebook
            projectId={ctx.report.project_id}
            reportId={ctx.report.id}
            blocks={view.blocks}
            allProjectRuns={ctx.runs}
            onUpdateBlock={noop}
            onMoveBlock={noop}
            onDeleteBlock={noop}
            onInsertBlock={noop}
            readOnly
          />
        )}
      </main>
    </div>
  );
}
