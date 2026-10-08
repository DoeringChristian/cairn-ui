/**
 * "Runs in this cell": the cell's run sets, each with its name and the runs
 * it resolves to right now (colour, and the cell's eye / pin / baseline
 * toggles when the scope's run view is editable). Until the run set editor
 * (B5) only the filter of the first set can be changed, with the runs
 * table's filter control; a cell without run sets gets one when its filter
 * is first set.
 */

import { useMemo, type ReactNode } from "react";
import type { Run } from "../../api/types";
import { filterFieldsOf, isEmptyFilter, type GroupNode } from "../../lib/run-filter";
import { disambiguateRunLabels, shortRunId, useRunMetadataVersion } from "../../lib/run-label";
import { defaultRunSet, type RunSet } from "../../lib/run-sets";
import { useRunColors, useRunView } from "../../lib/run-view";
import { RunFilterControl } from "../RunFilterBar";
import RunViewControls, { RunSwatch } from "../RunViewControls";

interface Props {
  sets: readonly RunSet[];
  /** Each set's runs (null while loading). */
  resolved: string[][] | null;
  /** The runs the filter's field list is built from. */
  pool: readonly Run[];
  /** Absent: read-only. */
  onChange?: (next: RunSet[]) => void;
  /** Extra controls in the header. */
  actions?: ReactNode;
}

export default function RunSetsPanel({ sets, resolved, pool, onChange, actions }: Props) {
  const fields = useMemo(() => filterFieldsOf(pool), [pool]);
  const all = useMemo(() => [...new Set((resolved ?? []).flat())], [resolved]);
  const metaVersion = useRunMetadataVersion();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const labels = useMemo(() => disambiguateRunLabels(all), [all.join("|"), metaVersion]);
  const colors = useRunColors(all);
  const { view, set: setView } = useRunView();

  const setFirstFilter = (filter: GroupNode) => {
    if (!onChange) return;
    const [first, ...rest] = sets.length > 0 ? sets : [defaultRunSet("Run set 1")];
    onChange([{ ...first!, filter }, ...rest]);
  };

  return (
    <div className="card flex flex-col gap-3 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs uppercase tracking-wide text-fg-muted">
          Run sets ({sets.length}) · {all.length} run{all.length === 1 ? "" : "s"}
        </span>
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      </div>
      {sets.length === 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs text-fg-subtle">No run sets: this cell shows no runs.</p>
          {onChange && (
            <div className="flex flex-wrap items-center gap-2">
              <RunFilterControl fields={fields} filter={defaultRunSet().filter} onChange={setFirstFilter} />
            </div>
          )}
        </div>
      )}
      {sets.map((set, i) => {
        const ids = resolved?.[i] ?? [];
        return (
          <section key={i} className="flex flex-col gap-1.5" aria-label={set.name}>
            <h3 className="text-xs font-medium text-fg">
              {set.name}{" "}
              <span className="font-normal text-fg-muted">
                ({resolved ? ids.length : "…"} run{ids.length === 1 ? "" : "s"}
                {set.latestOnly ? ", latest only" : ""}
                {set.groupBy.length > 0 ? `, grouped` : ""})
              </span>
            </h3>
            {i === 0 && onChange ? (
              <div className="flex flex-wrap items-center gap-2">
                <RunFilterControl fields={fields} filter={set.filter} onChange={setFirstFilter} />
              </div>
            ) : (
              !isEmptyFilter(set.filter) && <p className="text-[11px] text-fg-subtle">Filtered.</p>
            )}
            {resolved && ids.length === 0 ? (
              <p className="text-xs text-fg-subtle">No runs match this set.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {ids.map((id) => {
                  const label = labels[id] ?? shortRunId(id);
                  const hidden = view.hidden.includes(id);
                  return (
                    <span
                      key={id}
                      className={`inline-flex min-w-0 max-w-full items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] mono ${
                        view.baseline === id ? "border-accent/60 bg-accent/10" : "border-border-subtle bg-bg-hover"
                      }`}
                      title={id}
                    >
                      <RunSwatch color={colors.get(id)} />
                      <span className={`truncate text-fg ${hidden ? "line-through opacity-50" : ""}`}>{label}</span>
                      <RunViewControls runId={id} view={view} onChange={setView} />
                    </span>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
