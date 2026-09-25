/**
 * Report page — /p/:projectId/reports/:reportId
 *
 * A notebook that is editable (see `ReportNotebook`): markdown and
 * cards cells, inserted, moved and deleted in place. A read-role session
 * gets it in view mode instead. Autosave: debounced PUT
 * ~1.5s after the last change (and on leaving the page). Card settings overrides are
 * gathered from/restored to localStorage under the report's pseudo-scope on
 * save/load — see lib/reports/payload.ts.
 *
 * `blocks[]` is the only editing surface. The persisted markdown `source` is
 * available read-only via "View source" — never a second editable copy.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { RUN_SELECTOR_FETCH_LIMIT, useReport, useRuns, useSession, useUpdateReport } from "../api/hooks";
import { formatRelative } from "../lib/format";
import { loadCardOverrides } from "../lib/card-settings";
import { templateCardOf, type ComparisonTemplateCard } from "../lib/comparisons";
import {
  allReportCards,
  buildReportPayload,
  cardSettingsKeyForReport,
  createReportTemplate,
  isCardsBlock,
  parseReportMarkdown,
  restoreReportCardSettings,
  type ReportBlock,
  type ReportPayload,
} from "../lib/reports";
import ReportNotebook, { makeEmptyBlock } from "../components/reports/ReportNotebook";
import { usePushUndo } from "../lib/undo-context";
import { downloadBlob, safeName } from "../lib/download";
import { ReportExportContext } from "../lib/reports/export-context";

const AUTOSAVE_DELAY_MS = 1500;
const PRINT_WAIT_LIMIT_MS = 20000;

/**
 * Resolve once the page has settled enough to print: no query in flight and
 * every image decoded, seen twice in a row (a finished fetch often mounts a
 * card that starts the next one), then one more frame so charts have drawn.
 * Gives up waiting after PRINT_WAIT_LIMIT_MS and prints what is there.
 */
async function waitForSettledPage(qc: QueryClient): Promise<void> {
  const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
  const settled = () =>
    qc.isFetching() === 0 && Array.from(document.images).every((img) => img.complete);
  const deadline = performance.now() + PRINT_WAIT_LIMIT_MS;
  let calm = 0;
  while (calm < 2 && performance.now() < deadline) {
    await new Promise((r) => setTimeout(r, 150));
    calm = settled() ? calm + 1 : 0;
  }
  await frame();
}
const DEFAULT_REPORT_NAME = "Untitled report";

type SaveState = "idle" | "saving" | "saved" | "error";

export default function ReportEditorPage() {
  const { projectId, reportId } = useParams<{ projectId: string; reportId: string }>();
  const q = useReport(projectId ?? "", reportId ?? "");
  // A read-role session views the report: cards explore without saving.
  const readOnly = useSession().data?.role === "read";
  const updateMut = useUpdateReport(projectId ?? "", reportId ?? "");
  const queryClient = useQueryClient();
  const [printing, setPrinting] = useState(false);
  const handleExportPdf = async () => {
    setPrinting(true);
    try {
      await waitForSettledPage(queryClient);
      window.print();
    } finally {
      setPrinting(false);
    }
  };
  // Export LaTeX: render every card (ReportExportContext), capture them, zip.
  const [exportingLatex, setExportingLatex] = useState(false);
  const notebookRef = useRef<HTMLDivElement>(null);
  const handleExportLatex = async () => {
    if (!reportId || !notebookRef.current) return;
    setExportingLatex(true);
    try {
      const { exportReportLatex } = await import("../lib/reports/export-latex");
      const title = name.trim() || DEFAULT_REPORT_NAME;
      const { zip, skipped } = await exportReportLatex({
        root: notebookRef.current, blocks, reportId, title, queryClient,
      });
      downloadBlob(zip, `${safeName(title)}.zip`);
      if (skipped.length > 0) {
        setApplyBanner(`LaTeX export: ${skipped.length} card(s) had no chart to capture (${skipped.join(", ")}).`);
      }
    } catch (err) {
      console.error("LaTeX export failed", err);
      setApplyBanner(`LaTeX export failed: ${String(err)}`);
    } finally {
      setExportingLatex(false);
    }
  };
  // Same pool size a `RunSelector` query resolves against, so every resolved
  // run has a label here.
  const runsQ = useRuns({ project: projectId, limit: RUN_SELECTOR_FETCH_LIMIT });
  const allProjectRuns = runsQ.data?.runs ?? [];

  const [name, setName] = useState("");
  // Inline title rename: click-to-edit, independent of `editMode` — mirrors ReportsListPage's `ReportRow` inline rename so
  // there's exactly one rename affordance style across the reports UI, and
  // no blocking `prompt()` anywhere in the create/rename path.
  const [titleEditing, setTitleEditing] = useState(false);
  const [blocks, setBlocks] = useState<ReportBlock[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");

  // Read-only "View source" — recomputed from `blocks[]` on demand, not held
  // as parallel state.
  const [showSource, setShowSource] = useState(false);

  // `rawCairnSourceRef` caches each ```cairn fence's exact original text so
  // an unedited hydrate->save round-trip stays byte-identical (see
  // markdown-source.ts's module doc); any edit to a CardsBlock invalidates
  // its own cache entry so serializing afterwards regenerates fresh YAML
  // instead of showing stale content.
  const rawCairnSourceRef = useRef<Record<string, string>>({});

  // Transient "restored N of M cards" feedback handed over from
  // ReportsListPage's "New from template" apply (mirrors ComparePage's
  // templateApplyFeedback router-state handling).
  const location = useLocation();
  const [applyBanner, setApplyBanner] = useState<string | null>(
    (location.state as { templateApplyFeedback?: string } | null)?.templateApplyFeedback ?? null,
  );
  useEffect(() => {
    const feedback = (location.state as { templateApplyFeedback?: string } | null)?.templateApplyFeedback;
    if (!feedback) return;
    setApplyBanner(feedback);
    window.history.replaceState({}, "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state]);
  const [lastSavedAt, setLastSavedAt] = useState<string | undefined>(undefined);

  const justHydratedRef = useRef(false);
  const saveTimerRef = useRef<number | null>(null);

  // Re-hydrate local editor state whenever the report id changes.
  useEffect(() => {
    setHydrated(false);
  }, [reportId]);

  // Wait for `runsQ` too (not just the report itself) before hydrating — a
  // selector-bound ```cairn block needs the live project run pool to resolve
  // its run set *before* `compileCairnBlock` runs (see parseReportMarkdown's
  // `opts.allProjectRuns` doc); parsing with an empty pool would compile the
  // card with `series: []`, losing its metric name for good. Both queries
  // fire in parallel, so this rarely adds user-visible latency.
  //
  // But don't wait forever: if `runsQ` errors out (data stays undefined
  // after retries are exhausted), proceed anyway and hydrate with an empty
  // run pool (`allProjectRuns` already falls back to `[]` above) rather than
  // leaving the whole report — including prose that needs no runs at all —
  // permanently blank.
  useEffect(() => {
    if (hydrated || !q.data || (!runsQ.data && !runsQ.isError)) return;
    setName(q.data.name);
    const payload = q.data.payload as unknown as ReportPayload;
    const parsed = parseReportMarkdown(payload.source, undefined, { allProjectRuns });
    setBlocks(parsed.blocks);
    rawCairnSourceRef.current = parsed.rawCairnSource;
    if (reportId) restoreReportCardSettings(reportId, parsed.blocks, parsed.settings);
    setLastSavedAt(q.data.updated_at);
    justHydratedRef.current = true;
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data, runsQ.data, runsQ.isError, hydrated, reportId]);

  const doSave = useCallback(() => {
    if (!hydrated || !reportId) return;
    // Never persist an empty name: fall back to DEFAULT_REPORT_NAME and show
    // it in the input, so the input matches what was saved.
    const trimmed = name.trim();
    const effectiveName = trimmed || DEFAULT_REPORT_NAME;
    if (effectiveName !== name) setName(effectiveName);
    setSaveState("saving");

    const payload = buildReportPayload(reportId, blocks, rawCairnSourceRef.current);

    updateMut.mutate(
      { name: effectiveName, payload: payload as unknown as Record<string, unknown> },
      {
        onSuccess: (res) => {
          setSaveState("saved");
          setLastSavedAt(res.updated_at);
        },
        onError: () => setSaveState("error"),
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, reportId, blocks, name]);

  // Debounced autosave — fires ~1.5s after the last local edit.
  useEffect(() => {
    if (!hydrated) return;
    if (justHydratedRef.current) {
      justHydratedRef.current = false;
      return;
    }
    if (saveTimerRef.current != null) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      doSave();
    }, AUTOSAVE_DELAY_MS);
    return () => {
      if (saveTimerRef.current != null) window.clearTimeout(saveTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocks, name, hydrated]);

  // Keep a ref to the latest doSave so the unmount-only effect below (empty
  // deps, so it can't re-subscribe on every edit) never calls a stale
  // closure over blocks/name.
  const doSaveRef = useRef(doSave);
  useEffect(() => {
    doSaveRef.current = doSave;
  }, [doSave]);

  // Flush a pending autosave on unmount so navigating away doesn't drop it.
  useEffect(() => {
    return () => {
      if (saveTimerRef.current != null) {
        window.clearTimeout(saveTimerRef.current);
        doSaveRef.current();
      }
    };
  }, []);

  // Cmd/Ctrl+S saves now instead of waiting for the autosave debounce.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (saveTimerRef.current != null) window.clearTimeout(saveTimerRef.current);
        doSaveRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Every block edit is an undo step; typing into one block within the
  // merge window is one step.
  const pushUndo = usePushUndo();
  const blocksRef = useRef(blocks);
  blocksRef.current = blocks;
  const editBlocks = (label: string, fn: (prev: ReportBlock[]) => ReportBlock[], mergeKey?: string) => {
    const prev = blocksRef.current;
    const next = fn(prev);
    if (next === prev) return;
    blocksRef.current = next;
    setBlocks(next);
    pushUndo({ label, undo: () => setBlocks(prev), redo: () => setBlocks(next), mergeKey });
  };

  const updateBlock = (id: string, next: ReportBlock) => {
    // A CardsBlock's content changed — its cached raw ```cairn fence text
    // (if any, from the last markdown parse) is now stale; drop it so the
    // next markdown-source serialize regenerates fresh YAML instead of
    // silently showing the pre-edit text (see rawCairnSourceRef's doc above).
    if (isCardsBlock(next)) delete rawCairnSourceRef.current[id];
    editBlocks("Edit cell", (prev) => prev.map((b) => (b.id === id ? next : b)), `report-block|${id}`);
  };

  const deleteBlock = (id: string) => {
    delete rawCairnSourceRef.current[id];
    editBlocks("Delete cell", (prev) => prev.filter((b) => b.id !== id));
  };

  const moveBlock = (id: string, dir: -1 | 1) => {
    editBlocks("Move cell", (prev) => {
      const idx = prev.findIndex((b) => b.id === id);
      if (idx < 0) return prev;
      const toIdx = idx + dir;
      if (toIdx < 0 || toIdx >= prev.length) return prev;
      const next = [...prev];
      const [moved] = next.splice(idx, 1);
      next.splice(toIdx, 0, moved!);
      return next;
    });
  };

  // Insert a fresh markdown/cards cell immediately after `afterId` (or at the
  // end when `afterId` is null) — Jupyter's insert-below.
  const insertBlock = (index: number, type: ReportBlock["type"]) => {
    const block = makeEmptyBlock(type);
    editBlocks("Insert cell", (prev) => [...prev.slice(0, index), block, ...prev.slice(index)]);
  };

  // Save every cards-block card across this report as a reusable report
  // template — mirrors the compare page's "Save template",
  // scoped under `cardSettingsKeyForReport` instead of `cardSettingsKeyFor`.
  const handleSaveAsTemplate = () => {
    if (!reportId || !projectId) return;
    const templateName = prompt("Template name:", name);
    if (!templateName) return;
    const cards = allReportCards(blocks);
    const templateCards: ComparisonTemplateCard[] = cards.map((card) =>
      templateCardOf(
        card,
        loadCardOverrides(cardSettingsKeyForReport(reportId, card)) ?? undefined,
      ),
    );
    createReportTemplate(projectId, templateName, templateCards);
  };

  if (!projectId || !reportId) return null;

  if (q.isLoading) return <p className="text-fg-muted">Loading...</p>;
  if (q.isError) return <p className="text-status-failed">Error: {String(q.error)}</p>;

  const statusText =
    saveState === "saving"
      ? "saving…"
      : saveState === "error"
        ? "save failed"
        : lastSavedAt
          ? `saved · updated ${formatRelative(lastSavedAt)}`
          : "";

  // Recomputed on demand (not parallel state) whenever the escape hatch is
  // open — cheap relative to a render, and guarantees it's always exactly
  // what a save would persist right now.
  const sourceText = showSource
    ? buildReportPayload(reportId, blocks, rawCairnSourceRef.current).source
    : "";

  return (
    <div>
      <div className="mb-1">
        <Link to={`/p/${projectId}/reports`} className="text-xs text-fg-muted hover:text-fg">
          {"←"} Reports
        </Link>
      </div>

      {applyBanner && (
        <div className="mb-4 flex items-center justify-between gap-2 print:hidden rounded border border-accent/40 bg-accent/10 px-3 py-2 text-xs text-fg">
          <span>{applyBanner}</span>
          <button
            type="button"
            onClick={() => setApplyBanner(null)}
            className="shrink-0 text-fg-subtle hover:text-fg"
            aria-label="Dismiss"
          >
            {"×"}
          </button>
        </div>
      )}

      <div className="mb-6 flex flex-wrap items-baseline justify-between gap-3">
        {titleEditing ? (
          <input
            type="text"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              if (!name.trim()) setName(DEFAULT_REPORT_NAME);
              setTitleEditing(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                (e.target as HTMLInputElement).blur();
              } else if (e.key === "Escape") {
                e.preventDefault();
                setTitleEditing(false);
              }
            }}
            className="input min-w-[12rem] flex-1 text-xl font-semibold"
          />
        ) : (
          <h1
            role="button"
            tabIndex={0}
            title="Click to rename"
            onClick={() => setTitleEditing(true)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setTitleEditing(true);
              }
            }}
            className="mono min-w-0 break-all text-xl font-semibold cursor-text rounded hover:bg-bg-hover/60"
          >
            {name}
          </h1>
        )}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 print:hidden">
          <span className="text-xs text-fg-subtle" title={statusText}>
            {statusText}
          </span>
          <button
            type="button"
            onClick={handleSaveAsTemplate}
            className="btn text-xs"
            title="Save this report's cards as a reusable template"
          >
            Save as template
          </button>
          <button
            type="button"
            onClick={() => setShowSource((v) => !v)}
            className="btn text-xs"
            title="View the report's canonical markdown source (read-only)"
          >
            {showSource ? "Hide source" : "View source"}
          </button>
          <button
            type="button"
            onClick={() => void handleExportPdf()}
            disabled={printing}
            className="btn text-xs disabled:opacity-60"
            title="Print the report; choose “Save as PDF” as the destination"
          >
            {printing ? "Preparing…" : "Export PDF"}
          </button>
          <button
            type="button"
            onClick={() => void handleExportLatex()}
            disabled={exportingLatex}
            className="btn text-xs disabled:opacity-60"
            title="Download the report as a LaTeX project: report.tex plus a PNG per card, zipped"
          >
            {exportingLatex ? "Exporting…" : "Export LaTeX"}
          </button>
        </div>
      </div>

      {showSource && (
        <pre className="mono mb-4 print:hidden max-h-[50vh] overflow-auto rounded border border-border-subtle bg-bg p-3 text-xs leading-relaxed text-fg-muted whitespace-pre-wrap">
          {sourceText || "(empty)"}
        </pre>
      )}

      <ReportExportContext.Provider value={exportingLatex}>
      <div ref={notebookRef}>
      <ReportNotebook
        projectId={projectId}
        reportId={reportId}
        blocks={blocks}
        allProjectRuns={allProjectRuns}
        onUpdateBlock={updateBlock}
        onMoveBlock={moveBlock}
        onDeleteBlock={deleteBlock}
        onInsertBlock={insertBlock}
        readOnly={readOnly}
      />
      </div>
      </ReportExportContext.Provider>

    </div>
  );
}
