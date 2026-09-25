/**
 * "Add to report": a card header button whose popover lists the project's
 * reports plus "create new". Picking one appends a ```cairn cards cell with
 * a copy of this card (new ids; its settings overrides inline) to the end of
 * the report's markdown source — the existing text is never rewritten (see
 * lib/reports/append.ts).
 *
 * The PUT carries `expected_updated_at`: if the report changed since it was
 * read, the server answers 409; the button re-reads it and tries once more,
 * then gives up with an error rather than overwrite someone's edit.
 */

import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { qk } from "../api/query-keys";
import { loadCardOverrides, type CardSettingsKey } from "../lib/card-settings";
import type { CardType } from "../lib/cards/card-spec";
import type { ComparisonSeriesRef } from "../lib/comparisons";
import { formatRelative } from "../lib/format";
import { useProjectId } from "../lib/project-context";
import { newId, type CardsBlock } from "../lib/reports";
import { appendCardsFence } from "../lib/reports/append";
import { ICON_BTN } from "./card-header/icon-btn";
import SettingsPopover from "./SettingsPopover";
import { useCompactViewport } from "../lib/use-media-query";

interface Props {
  cardType: CardType;
  series: ComparisonSeriesRef[];
  /** Where this card's settings overrides live; copied inline into the report. */
  settingsKey: CardSettingsKey;
}

class ReportChangedError extends Error {}

/** Append the card to report `reportId`: read, append, PUT if unchanged; one retry on a conflict. */
async function appendToReport(projectId: string, reportId: string, block: CardsBlock, settings: Record<string, unknown>) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const report = await api.report(projectId, reportId);
    const payload = report.payload ?? {};
    const source = typeof payload.source === "string" ? payload.source : "";
    const res = await api.updateReportIfUnchanged(
      projectId,
      reportId,
      { payload: { ...payload, source: appendCardsFence(source, block, settings) } },
      report.updated_at,
    );
    if (res.ok) return;
  }
  throw new ReportChangedError("The report kept changing while adding the card. Try again.");
}

export default function AddToReportButton({ cardType, series, settingsKey }: Props) {
  const projectId = useProjectId();
  const qc = useQueryClient();
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  // Fetched only while the popover is open (every card has this button).
  const reportsQ = useQuery({
    queryKey: qk.reports(projectId ?? ""),
    queryFn: () => api.reports(projectId ?? ""),
    enabled: open && !!projectId,
  });
  const reports = reportsQ.data?.reports ?? [];
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ id: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const compact = useCompactViewport();

  if (!projectId) return null;

  const add = async (target: { id: string; name: string } | { create: string }) => {
    setBusy(true);
    setError(null);
    try {
      const report =
        "create" in target
          ? await api.createReport(projectId, target.create, { source: "" }).then((r) => ({ id: r.id, name: r.name }))
          : target;
      const cardId = newId();
      const block: CardsBlock = {
        id: newId(),
        type: "cards",
        runIds: [...new Set(series.map((s) => s.runId))],
        cards: [{ id: cardId, type: cardType, series: series.map((s) => ({ runId: s.runId, name: s.name })) }],
      };
      const overrides = loadCardOverrides(settingsKey);
      await appendToReport(projectId, report.id, block, overrides ? { [cardId]: overrides } : {});
      void qc.invalidateQueries({ queryKey: qk.report(projectId, report.id) });
      void qc.invalidateQueries({ queryKey: qk.reports(projectId) });
      setDone(report);
      setNewName("");
    } catch (e) {
      setError(e instanceof ReportChangedError ? e.message : `Could not add to the report: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    setOpen(false);
    setDone(null);
    setError(null);
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        className={ICON_BTN}
        aria-label="Add to report"
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Add to report"
      >
        <i className="fa-regular fa-file-lines" aria-hidden="true" />
      </button>
      <SettingsPopover open={open} onClose={close} anchorRef={btnRef} title="Add to report">
        {done ? (
          <div className="flex flex-col gap-2 text-xs">
            <p className="text-accent">Added to {done.name}.</p>
            <div className="flex gap-2">
              <Link to={`/p/${projectId}/reports/${done.id}`} className="btn text-xs touch:min-h-10" onClick={close}>
                Open report
              </Link>
              <button type="button" className="btn text-xs touch:min-h-10" onClick={close}>
                Done
              </button>
            </div>
          </div>
        ) : (
          <>
            {error && <p className="mb-2 text-xs text-status-failed">{error}</p>}
            {reportsQ.isLoading ? (
              <p className="mb-2 text-xs text-fg-subtle">Loading reports…</p>
            ) : reports.length === 0 ? (
              <p className="mb-2 text-xs text-fg-subtle">No reports yet.</p>
            ) : (
              <div className={`mb-2 flex flex-col gap-1 ${compact ? "" : "max-h-48 overflow-y-auto"}`}>
                {reports.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    disabled={busy}
                    onClick={() => void add({ id: r.id, name: r.name })}
                    className="rounded border border-border-subtle px-2 py-1.5 text-left text-xs text-fg-muted hover:bg-bg-hover disabled:opacity-50 touch:py-2.5"
                  >
                    <div className="truncate">{r.name}</div>
                    <div className="text-[10px] text-fg-subtle">
                      {r.block_count} cell(s) · updated {formatRelative(r.updated_at)}
                    </div>
                  </button>
                ))}
              </div>
            )}
            <div className="mt-1 border-t border-border-subtle pt-2">
              <label className="mb-1 block text-[10px] uppercase tracking-wide text-fg-muted">New report</label>
              <div className="flex gap-1">
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void add({ create: newName.trim() || "Untitled report" });
                    }
                  }}
                  placeholder="Name"
                  className="input min-w-0 flex-1 text-xs touch:min-h-10"
                />
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void add({ create: newName.trim() || "Untitled report" })}
                  className="btn px-2 text-xs touch:min-h-10"
                >
                  Create
                </button>
              </div>
            </div>
            {busy && <p className="mt-2 text-xs text-fg-subtle">Adding…</p>}
          </>
        )}
      </SettingsPopover>
    </>
  );
}
