import { useMemo, useState, type ReactNode } from "react";
import {
  DEFAULT_RUN_SELECTOR_N,
  type QueryRunSelector,
  type RunSelector,
} from "../../lib/run-selector";
import { disambiguateRunLabels, shortRunId, useRunMetadataVersion } from "../../lib/run-label";
import type { Run } from "../../api/types";
import { useRunColors, useRunView } from "../../lib/run-view";
import RunViewControls, { RunSwatch } from "../RunViewControls";

/** The selector a run set switches to when it goes from static to auto. */
export const DEFAULT_QUERY_SELECTOR: QueryRunSelector = {
  kind: "query",
  mode: "newest-per-name",
  n: DEFAULT_RUN_SELECTOR_N,
};

interface Props {
  /** Header label, e.g. "Runs in comparison"; the run count is appended. */
  title: string;
  /** The runs currently in the set (resolved, when a selector drives it). */
  runIds: string[];
  allProjectRuns: Run[];
  /** Dynamic selector driving the set; undefined for a static run list. */
  selector: RunSelector | undefined;
  /** Shows the mode toggle, selector fields, remove buttons and the run picker. */
  editable: boolean;
  /** Switch between a static run list and a dynamic selector. */
  onToggleMode: () => void;
  onSelectorChange: (next: QueryRunSelector) => void;
  onAddRun: (runId: string) => void;
  onRemoveRun: (runId: string) => void;
  /** Extra header controls, placed before the mode toggle. */
  actions?: ReactNode;
}

const HEADER_BUTTON =
  "inline-flex h-6 touch:h-10 items-center justify-center rounded border border-border bg-bg px-2 text-[10px] text-fg-muted hover:border-accent hover:text-fg";

/**
 * A run set bound either to a static list (removable chips + a "+ run"
 * picker) or to a query selector (name pattern / tags / mode / N fields and
 * read-only chips of the resolved runs). Each chip shows the run's colour
 * and, when the surrounding scope provides an editable `RunViewContext`,
 * the eye / pin / baseline toggles of that scope's run view.
 */
export default function RunSetEditor({
  title,
  runIds,
  allProjectRuns,
  selector,
  editable,
  onToggleMode,
  onSelectorChange,
  onAddRun,
  onRemoveRun,
  actions,
}: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);

  const candidates = useMemo(() => {
    const included = new Set(runIds);
    return allProjectRuns.filter((r) => !included.has(r.id));
  }, [allProjectRuns, runIds]);

  const includedRuns = useMemo(
    () => runIds
      .map((id) => allProjectRuns.find((r) => r.id === id))
      .filter((r): r is Run => r !== undefined),
    [runIds, allProjectRuns],
  );

  // Recompute labels once the run metadata cache is seeded (api/hooks.ts).
  const metaVersion = useRunMetadataVersion();
  const chipLabels = useMemo(() => disambiguateRunLabels(runIds), [runIds, metaVersion]);
  // Candidate labels disambiguate against every project run so duplicates surface.
  const candidateLabels = useMemo(
    () => disambiguateRunLabels(allProjectRuns.map((r) => r.id)),
    [allProjectRuns, metaVersion],
  );

  const colors = useRunColors(runIds);
  const { view, set: setView } = useRunView();
  const hiddenCount = runIds.filter((id) => view.hidden.includes(id)).length;

  const query = selector?.kind === "query" ? selector : undefined;
  const staticMode = !selector;

  return (
    <div className="card p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs uppercase tracking-wide text-fg-muted">
          {title} ({runIds.length}{hiddenCount > 0 ? `, ${hiddenCount} hidden` : ""})
        </span>
        <div className="flex flex-wrap items-center gap-2">
          {actions}
          {editable && (
            <button
              type="button"
              onClick={onToggleMode}
              className={HEADER_BUTTON}
              title={
                selector
                  ? "Switch to a fixed run list"
                  : "Switch to a dynamic run selector (always tracks matching runs)"
              }
            >
              {selector ? "Use static runs" : "Use auto (query)"}
            </button>
          )}
          {editable && staticMode && (
            <button type="button" onClick={() => setPickerOpen((v) => !v)} className={HEADER_BUTTON}>
              {pickerOpen ? "Done" : `+ Add runs (${candidates.length} available)`}
            </button>
          )}
        </div>
      </div>

      {editable && query && (
        <div className="mb-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <label className="text-[10px] text-fg-muted">
            Name pattern
            <input
              type="text"
              value={query.namePattern ?? ""}
              onChange={(e) => onSelectorChange({ ...query, namePattern: e.target.value || undefined })}
              placeholder="e.g. training-*"
              className="input mt-0.5 w-full text-xs"
            />
          </label>
          <label className="text-[10px] text-fg-muted">
            Tags (comma-sep)
            <input
              type="text"
              value={(query.tags ?? []).join(", ")}
              onChange={(e) =>
                onSelectorChange({
                  ...query,
                  tags: e.target.value.split(",").map((t) => t.trim()).filter(Boolean),
                })
              }
              placeholder="e.g. prod, nightly"
              className="input mt-0.5 w-full text-xs"
            />
          </label>
          <label className="text-[10px] text-fg-muted">
            Mode
            <select
              value={query.mode}
              onChange={(e) => onSelectorChange({ ...query, mode: e.target.value as QueryRunSelector["mode"] })}
              className="input mt-0.5 w-full text-xs"
            >
              <option value="latest-n">Latest N</option>
              <option value="newest-per-name">Newest per name</option>
            </select>
          </label>
          <label className="text-[10px] text-fg-muted">
            N
            <input
              type="number"
              min={1}
              value={query.n ?? DEFAULT_RUN_SELECTOR_N}
              onChange={(e) => onSelectorChange({ ...query, n: Math.max(1, Number(e.target.value) || 1) })}
              className="input mt-0.5 w-full text-xs"
            />
          </label>
        </div>
      )}

      {runIds.length === 0 ? (
        <p className="text-xs text-fg-subtle">
          {selector
            ? "No runs currently match this selector."
            : 'No runs yet. Click "Add runs" to pick some.'}
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {includedRuns.map((r) => {
            const label = chipLabels[r.id] ?? shortRunId(r.id);
            const hidden = view.hidden.includes(r.id);
            return (
              <span
                key={r.id}
                className={`group/chip inline-flex min-w-0 max-w-full items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] mono ${
                  view.baseline === r.id ? "border-accent/60 bg-accent/10" : "border-border-subtle bg-bg-hover"
                }`}
                title={r.id}
              >
                <RunSwatch color={colors.get(r.id)} />
                <span className={`truncate text-fg ${hidden ? "line-through opacity-50" : ""}`}>{label}</span>
                <RunViewControls runId={r.id} view={view} onChange={setView} />
                {editable && staticMode && (
                  <button
                    type="button"
                    onClick={() => onRemoveRun(r.id)}
                    className="shrink-0 text-fg-subtle hover:text-status-failed touch:-my-3 touch:-mr-3 touch:inline-flex touch:h-10 touch:w-10 touch:items-center touch:justify-center"
                    aria-label={`Remove ${label}`}
                    title={`Remove ${label}`}
                  >
                    {"×"}
                  </button>
                )}
              </span>
            );
          })}
        </div>
      )}

      {editable && staticMode && pickerOpen && (
        <div className="mt-2 border-t border-border-subtle pt-2">
          {candidates.length === 0 ? (
            <p className="text-xs text-fg-subtle">All project runs already included.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">
              {candidates.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => onAddRun(r.id)}
                  className="inline-flex items-center gap-1 rounded border border-border-subtle bg-bg px-1.5 py-0.5 text-[11px] mono text-fg-muted hover:border-accent hover:text-fg"
                  title={r.id}
                >
                  <span aria-hidden="true">+</span>
                  {candidateLabels[r.id] ?? shortRunId(r.id)}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
