import { useMemo } from "react";
import { buildEnvDiff, selectRows } from "../../lib/run-compare";
import CompareRowsTable, { type RunCompareSectionProps } from "./CompareRowsTable";

/** The runs' captured environments (Python, platform, CUDA, GPUs) side by side. */
export default function EnvDiffTable({ runs, labels, colors, onlyDiffs, filter = "", pinnedKeys = [], onTogglePin, actions }: RunCompareSectionProps) {
  const table = useMemo(() => buildEnvDiff(runs), [runs]);
  const rows = useMemo(() => selectRows(table, { onlyDiffs, filter, pinnedKeys }), [table, onlyDiffs, filter, pinnedKeys]);
  return (
    <CompareRowsTable
      title="Environment"
      actions={actions}
      keyHeader="Field"
      mono={false}
      rows={rows}
      empty={onlyDiffs && !filter.trim() ? "Environment is identical across runs." : "No matching fields."}
      runIds={table.runIds}
      labels={labels}
      colors={colors}
      pinnedKeys={pinnedKeys}
      onTogglePin={onTogglePin}
    />
  );
}
