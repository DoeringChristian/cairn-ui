/**
 * A metric column's header menu (the Runs page's metric columns, the
 * Scalars card's): sort, the project's rule for the metric (Summary: which
 * number the runs show; Goal: which way is better), the logged rule and
 * whether the project overrides it, Reset to logged, Hide column.
 *
 * Summary and Goal write the project override
 * (`PUT /api/projects/{p}/metric-rules/{m}`, lib/metric-rules.ts); Reset
 * drops it. A read-only viewer sees the values, disabled.
 */

import { useCanEdit } from "../api/artifact-hooks";
import { useMetricRulesDoc, useSetMetricRule } from "../api/hooks";
import { GOAL_LABEL, GOALS, metricRuleMenuState, SUMMARIES, withPick, type Goal, type Summary } from "../lib/metric-rules";

export const MENU_ITEM =
  "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-fg hover:bg-bg-hover disabled:opacity-40 touch:min-h-10";

export default function MetricColumnMenu({
  projectId,
  metric,
  onSort,
  onHide,
  onClose,
}: {
  projectId: string | null;
  metric: string;
  onSort: (direction: "asc" | "desc") => void;
  onHide: () => void;
  onClose: () => void;
}) {
  const doc = useMetricRulesDoc(projectId);
  const set = useSetMetricRule(projectId);
  const canEdit = useCanEdit() && !!projectId;
  const m = metricRuleMenuState(doc, metric);
  const act = (fn: () => void) => () => {
    fn();
    onClose();
  };
  const disabled = !canEdit || set.isPending;
  return (
    <div className="flex flex-col" role="none" data-testid="metric-column-menu">
      <button type="button" role="menuitem" className={MENU_ITEM} onClick={act(() => onSort("asc"))}>
        <i className="fa-solid fa-arrow-up-short-wide w-3" aria-hidden="true" /> Sort ascending
      </button>
      <button type="button" role="menuitem" className={MENU_ITEM} onClick={act(() => onSort("desc"))}>
        <i className="fa-solid fa-arrow-down-wide-short w-3" aria-hidden="true" /> Sort descending
      </button>
      <div className="my-1 border-t border-border-subtle" />
      <label className="flex items-center gap-2 px-2 py-1 text-xs text-fg-muted">
        <span className="w-14 shrink-0">Summary</span>
        <select
          className="input min-w-0 flex-1 py-0.5 text-xs"
          value={m.summary}
          disabled={disabled}
          aria-label={`Summary of ${metric}`}
          onChange={(e) => set.mutate({ metric, override: withPick(m.override, { summary: e.target.value as Summary }) })}
        >
          {SUMMARIES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-2 px-2 py-1 text-xs text-fg-muted">
        <span className="w-14 shrink-0">Goal</span>
        <select
          className="input min-w-0 flex-1 py-0.5 text-xs"
          value={m.goal}
          disabled={disabled}
          aria-label={`Goal of ${metric}`}
          onChange={(e) => set.mutate({ metric, override: withPick(m.override, { goal: e.target.value as Goal }) })}
        >
          {GOALS.map((g) => (
            <option key={g} value={g}>
              {GOAL_LABEL[g]}
            </option>
          ))}
        </select>
      </label>
      <p className="mono px-2 py-1 text-[10px] text-fg-subtle" data-testid="metric-rule-note">
        {m.note}
      </p>
      <div className="px-2 py-1">
        <button
          type="button"
          className="btn px-2 py-0.5 text-xs"
          disabled={disabled || !m.override}
          onClick={() => set.mutate({ metric, override: null })}
        >
          Reset to logged
        </button>
      </div>
      <div className="my-1 border-t border-border-subtle" />
      <button type="button" role="menuitem" className={MENU_ITEM} onClick={act(onHide)}>
        <i className="fa-solid fa-eye-slash w-3" aria-hidden="true" /> Hide column
      </button>
    </div>
  );
}
