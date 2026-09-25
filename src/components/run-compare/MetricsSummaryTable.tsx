import { useMemo } from "react";
import { buildMetricsSummary, differingCount, selectRows } from "../../lib/run-compare";
import CompareRowsTable, { type RunCompareSectionProps } from "./CompareRowsTable";

/**
 * Each run's final metric values side by side: the same values the runs
 * table shows. The best cell is green, the worst red; a metric whose summary
 * rule is "min" counts lower as better (marked ↓). `system.*` metrics are
 * left out.
 */
export default function MetricsSummaryTable({ runs, labels, colors, onlyDiffs, filter = "", pinnedKeys = [], onTogglePin, actions }: RunCompareSectionProps) {
  const table = useMemo(() => buildMetricsSummary(runs), [runs]);
  const rows = useMemo(() => selectRows(table, { onlyDiffs, filter, pinnedKeys }), [table, onlyDiffs, filter, pinnedKeys]);
  const n = differingCount(table);
  return (
    <CompareRowsTable
      title={`Metrics (${n} differ${n === 1 ? "s" : ""})`}
      actions={actions}
      keyHeader="Metric"
      rows={rows}
      empty={
        table.rows.length === 0
          ? "No metrics logged."
          : onlyDiffs && !filter.trim()
            ? "All metrics are identical across runs."
            : "No matching metrics."
      }
      runIds={table.runIds}
      labels={labels}
      colors={colors}
      pinnedKeys={pinnedKeys}
      onTogglePin={onTogglePin}
      keySuffix={(row) =>
        row.lowerBetter && (
          <span className="ml-0.5 text-[10px] text-fg-subtle" title='summary="min": lower is better'>
            ↓
          </span>
        )
      }
    />
  );
}
