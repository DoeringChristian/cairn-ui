/**
 * Every comment thread of a report, in a side panel: comments on the whole
 * report first, then threads in document order (labelled by where they
 * sit; the label scrolls there), then "detached" threads whose card, cell,
 * heading or quoted text is gone. Filter: open, resolved or all. The box at
 * the top starts a report-level thread.
 */

import { useEffect, useMemo, useState } from "react";
import { useReportCommentMutations } from "../../api/hooks";
import type { ReportBlock } from "../../lib/reports";
import { sectionHeadingAt, type OutlineHeading } from "../../lib/reports/outline";
import { CommentComposer, CommentThread } from "./CommentThread";
import type { CommentThreadData } from "./comments-context";

type Filter = "open" | "resolved" | "all";

interface Props {
  projectId: string;
  reportId: string;
  blocks: ReportBlock[];
  outline: OutlineHeading[];
  threads: CommentThreadData[];
  /** thread root id → cell index, or null when detached. */
  locations: ReadonlyMap<string, number | null>;
  onClose: () => void;
  onLocate: (threadId: string) => void;
}

function labelFor(t: CommentThreadData, at: number, blocks: ReportBlock[], outline: OutlineHeading[]): string {
  const section = sectionHeadingAt(outline, at)?.text;
  const where = section ? `§ ${section}` : `Cell ${at + 1}`;
  if (t.root.anchor_kind === "card") {
    const b = blocks[at];
    const card = b?.type === "cards" ? b.cards.find((c) => c.id === t.root.anchor_id) : undefined;
    const name = card?.series[0]?.name ?? card?.type ?? "card";
    return `Card ${name} · ${where}`;
  }
  return t.root.anchor_kind === "quote" ? `Text · ${where}` : where;
}

export default function ReportCommentsPanel({ projectId, reportId, blocks, outline, threads, locations, onClose, onLocate }: Props) {
  const m = useReportCommentMutations(projectId, reportId);
  const [filter, setFilter] = useState<Filter>("open");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const shown = threads.filter((t) =>
    filter === "all" ? true : filter === "open" ? t.root.resolved_at == null : t.root.resolved_at != null,
  );
  const groups = useMemo(() => {
    const report: CommentThreadData[] = [];
    const placed: Array<{ t: CommentThreadData; at: number }> = [];
    const detached: CommentThreadData[] = [];
    for (const t of shown) {
      if (t.root.anchor_kind === "report") report.push(t);
      else {
        const at = locations.get(t.root.id);
        if (at == null) detached.push(t);
        else placed.push({ t, at });
      }
    }
    placed.sort((a, b) => a.at - b.at);
    return { report, placed, detached };
  }, [shown, locations]);

  const openCount = threads.filter((t) => t.root.resolved_at == null).length;
  const segBtn = (f: Filter, label: string) => (
    <button
      type="button"
      onClick={() => setFilter(f)}
      aria-pressed={filter === f}
      className={`rounded px-2 py-0.5 text-[11px] touch:min-h-8 ${filter === f ? "bg-bg-hover text-fg" : "text-fg-subtle hover:text-fg"}`}
    >
      {label}
    </button>
  );

  return (
    <aside
      aria-label="Comments"
      className="fixed inset-y-0 right-0 z-40 print:hidden flex w-full max-w-sm flex-col border-l border-border bg-bg-elevated shadow-xl"
    >
      <div className="flex items-center gap-2 border-b border-border-subtle px-3 py-2">
        <h2 className="text-sm font-semibold text-fg">Comments</h2>
        <span className="text-xs text-fg-subtle">{openCount} open</span>
        <button type="button" onClick={onClose} className="ml-auto h-7 w-7 touch:h-10 touch:w-10 rounded text-fg-subtle hover:bg-bg-hover hover:text-fg" aria-label="Close comments">
          <i className="fa-solid fa-xmark" aria-hidden="true" />
        </button>
      </div>
      <div className="flex items-center gap-1 border-b border-border-subtle px-3 py-1.5" role="group" aria-label="Filter threads">
        {segBtn("open", "Open")}
        {segBtn("resolved", "Resolved")}
        {segBtn("all", "All")}
      </div>
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-3">
        <CommentComposer
          placeholder="Comment on the whole report…"
          onSubmit={(body) => m.create.mutateAsync({ body, anchor_kind: "report" })}
        />
        {groups.report.map((t) => (
          <CommentThread key={t.root.id} thread={t} projectId={projectId} reportId={reportId} label="Report" />
        ))}
        {groups.placed.map(({ t, at }) => (
          <CommentThread
            key={t.root.id}
            thread={t}
            projectId={projectId}
            reportId={reportId}
            label={labelFor(t, at, blocks, outline)}
            onLocate={() => onLocate(t.root.id)}
          />
        ))}
        {groups.detached.length > 0 && (
          <>
            <p className="mt-2 text-[10px] uppercase tracking-wide text-fg-subtle">
              Detached — what these were on is no longer in the report
            </p>
            {groups.detached.map((t) => (
              <CommentThread key={t.root.id} thread={t} projectId={projectId} reportId={reportId} label="Detached" />
            ))}
          </>
        )}
        {shown.length === 0 && (
          <p className="py-4 text-center text-xs text-fg-subtle">
            {filter === "resolved" ? "No resolved threads." : filter === "open" ? "No open threads." : "No comments yet."}
          </p>
        )}
      </div>
    </aside>
  );
}
