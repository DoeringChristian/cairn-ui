import { useState } from "react";
import {
  applyTemplateToRuns,
  deleteTemplate,
  useTemplates,
  type ApplyTemplateResult,
  type ComparisonTemplate,
} from "../../lib/comparisons";

interface TemplateSidebarProps {
  projectId: string;
  /** Run IDs of the currently selected comparison (empty when none is selected). */
  currentRunIds: string[];
  /** Fallback pool of run IDs for the minimal picker when there's no current comparison. */
  allRunIds: string[];
  runInfo: Map<string, { displayName?: string; projectId?: string }>;
  onApplied: (result: ApplyTemplateResult, templateName: string) => void;
}

export default function TemplateSidebar({ projectId, currentRunIds, allRunIds, runInfo, onApplied }: TemplateSidebarProps) {
  const { templates } = useTemplates(projectId);
  // The template a run picker is currently open for (no current comparison
  // to draw runs from), and the runs checked in that picker.
  const [pendingTemplate, setPendingTemplate] = useState<ComparisonTemplate | null>(null);
  const [pickedRunIds, setPickedRunIds] = useState<Set<string>>(new Set());
  const [applyingId, setApplyingId] = useState<string | null>(null);

  if (templates.length === 0) return null;

  const applyWithRuns = async (t: ComparisonTemplate, runIds: string[]) => {
    if (runIds.length === 0) return;
    setApplyingId(t.id);
    try {
      const result = await applyTemplateToRuns(projectId, t, runIds);
      onApplied(result, t.name);
      setPendingTemplate(null);
      setPickedRunIds(new Set());
    } finally {
      setApplyingId(null);
    }
  };

  return (
    <div className="mt-4 border-t border-border-subtle pt-3">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">
        Templates
      </h2>
      <ul className="flex flex-col gap-1">
        {templates.map((t) => (
          <li
            key={t.id}
            className="flex items-center justify-between rounded px-2 py-1.5 text-xs text-fg-muted hover:bg-bg-hover"
          >
            <div className="min-w-0">
              <div className="truncate">{t.name}</div>
              <div className="text-[10px] text-fg-subtle">{t.cards.length} card(s)</div>
            </div>
            <div className="ml-2 flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  if (currentRunIds.length > 0) {
                    void applyWithRuns(t, currentRunIds);
                  } else {
                    setPendingTemplate(t);
                    setPickedRunIds(new Set());
                  }
                }}
                disabled={applyingId === t.id}
                className="text-[10px] text-accent hover:underline disabled:opacity-50"
                title={
                  currentRunIds.length > 0
                    ? "New comparison from template, using this comparison's runs"
                    : "New comparison from template \u2014 pick runs"
                }
              >
                {applyingId === t.id ? "Applying\u2026" : "New from template"}
              </button>
              <button
                type="button"
                onClick={() => deleteTemplate(projectId, t.id)}
                className="text-[10px] text-fg-subtle hover:text-status-failed"
                title="Delete template"
              >
                {"\u00D7"}
              </button>
            </div>
          </li>
        ))}
      </ul>

      {pendingTemplate && (
        <div className="mt-2 rounded border border-border p-2">
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="truncate text-[10px] font-medium text-fg-muted">
              Pick runs for "{pendingTemplate.name}"
            </span>
            <button
              type="button"
              onClick={() => setPendingTemplate(null)}
              className="shrink-0 text-[10px] text-fg-subtle hover:text-fg"
            >
              Cancel
            </button>
          </div>
          {allRunIds.length === 0 ? (
            <p className="text-[10px] text-fg-subtle">No runs in this project yet.</p>
          ) : (
            <ul className="flex max-h-40 flex-col gap-0.5 overflow-y-auto">
              {allRunIds.map((runId) => {
                const label = runInfo.get(runId)?.displayName || runId;
                return (
                  <li key={runId}>
                    <label className="flex cursor-pointer items-center gap-1.5 text-[10px] text-fg-muted hover:text-fg">
                      <input
                        type="checkbox"
                        checked={pickedRunIds.has(runId)}
                        onChange={() => {
                          setPickedRunIds((prev) => {
                            const next = new Set(prev);
                            if (next.has(runId)) next.delete(runId);
                            else next.add(runId);
                            return next;
                          });
                        }}
                      />
                      <span className="truncate">{label}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          <button
            type="button"
            onClick={() => void applyWithRuns(pendingTemplate, Array.from(pickedRunIds))}
            disabled={pickedRunIds.size === 0 || applyingId === pendingTemplate.id}
            className="btn mt-2 w-full text-[10px] disabled:opacity-50"
          >
            {applyingId === pendingTemplate.id
              ? "Applying\u2026"
              : `Apply to ${pickedRunIds.size} run${pickedRunIds.size === 1 ? "" : "s"}`}
          </button>
        </div>
      )}
    </div>
  );
}
