import { useMemo } from "react";
import { buildParamDiff, differingCount, selectRows } from "../../lib/run-compare";
import CompareRowsTable, { type RunCompareSectionProps } from "./CompareRowsTable";

/** Each run's params side by side; differing keys marked. */
export default function ParamsDiffTable({ runs, labels, colors, onlyDiffs, filter = "", pinnedKeys = [], onTogglePin, actions }: RunCompareSectionProps) {
  const table = useMemo(() => buildParamDiff(runs), [runs]);
  const rows = useMemo(() => selectRows(table, { onlyDiffs, filter, pinnedKeys }), [table, onlyDiffs, filter, pinnedKeys]);
  const n = differingCount(table);
  return (
    <CompareRowsTable
      title={`Parameters (${n} differ${n === 1 ? "s" : ""})`}
      actions={actions}
      keyHeader="Key"
      rows={rows}
      empty={
        table.rows.length === 0
          ? "No parameters logged."
          : onlyDiffs && !filter.trim()
            ? "All parameters are identical across runs."
            : "No matching parameters."
      }
      runIds={table.runIds}
      labels={labels}
      colors={colors}
      pinnedKeys={pinnedKeys}
      onTogglePin={onTogglePin}
    />
  );
}
