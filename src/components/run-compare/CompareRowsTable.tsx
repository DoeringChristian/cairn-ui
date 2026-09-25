import type { ReactNode } from "react";
import type { RunDetailResponse } from "../../api/types";
import { formatNum } from "../../lib/plot-utils/types";
import { shortRunId } from "../../lib/run-label";
import type { CompareRow, CompareValue } from "../../lib/run-compare";
import { diffCellClassName } from "../../lib/table-diff";

export interface CompareColumnsProps {
  /** Column order. */
  runIds: readonly string[];
  labels: Record<string, string>;
  /** Run colours for the header swatches (lib/run-view.tsx `useRunColors`). */
  colors?: Map<string, string>;
}

interface Props extends CompareColumnsProps {
  title: ReactNode;
  /** Right of the title (a filter box, …). */
  actions?: ReactNode;
  keyHeader: string;
  rows: CompareRow[];
  /** Shown instead of the table when `rows` is empty. */
  empty: string;
  mono?: boolean;
  /** Pinned keys get a filled pin; clicking toggles. Omit to hide the pins. */
  pinnedKeys?: readonly string[];
  onTogglePin?: (key: string) => void;
  /** Suffix after a key (e.g. the ↓ of a lower-is-better metric). */
  keySuffix?: (row: CompareRow) => ReactNode;
}

function show(v: CompareValue): string {
  return v == null ? "—" : typeof v === "number" ? formatNum(v) : String(v);
}

/** Rows = keys, columns = runs; differing rows are marked, numeric cells tinted best/worst. */
export default function CompareRowsTable({
  title,
  actions,
  keyHeader,
  rows,
  empty,
  mono = true,
  runIds,
  labels,
  colors,
  pinnedKeys,
  onTogglePin,
  keySuffix,
}: Props) {
  const pinned = new Set(pinnedKeys ?? []);
  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-fg-muted">{title}</h3>
        {actions}
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-fg-subtle">{empty}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-fg-muted">
              <tr>
                <th className="pb-1 pr-4 sticky left-0 bg-bg-surface">{keyHeader}</th>
                {runIds.map((id) => (
                  <th key={id} className="pb-1 pr-4 whitespace-nowrap">
                    <span className="inline-flex items-center gap-1.5">
                      {colors?.get(id) && (
                        <span
                          aria-hidden
                          className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: colors.get(id) }}
                        />
                      )}
                      {labels[id] ?? shortRunId(id)}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const isPinned = pinned.has(row.key);
                return (
                  <tr key={row.key} className={`group border-t border-border-subtle ${row.differs ? "bg-accent/5" : ""}`}>
                    <td
                      className={`py-1 pr-4 sticky left-0 ${mono ? "mono" : "text-fg-muted"} ${
                        row.differs ? "bg-accent/5 border-l-2 border-accent" : "bg-bg-surface"
                      }`}
                    >
                      <span className="inline-flex items-center gap-1">
                        {onTogglePin && (
                          <button
                            type="button"
                            onClick={() => onTogglePin(row.key)}
                            className={`text-[10px] leading-none hover:text-accent ${
                              isPinned ? "text-accent" : "text-fg-subtle opacity-0 group-hover:opacity-100 focus:opacity-100"
                            }`}
                            title={isPinned ? "Unpin" : "Pin to the top"}
                            aria-label={isPinned ? `Unpin ${row.key}` : `Pin ${row.key}`}
                            aria-pressed={isPinned}
                          >
                            <i className="fa-solid fa-thumbtack" aria-hidden="true" />
                          </button>
                        )}
                        {row.key}
                        {keySuffix?.(row)}
                      </span>
                    </td>
                    {row.values.map((v, i) => {
                      const st = row.statuses?.[i];
                      const diffCls = st && v != null ? diffCellClassName(st, row.lowerBetter) : "";
                      return (
                        <td
                          key={runIds[i]}
                          className={`mono py-1 pr-4 whitespace-nowrap tabular-nums text-fg-muted ${diffCls}`}
                        >
                          {show(v)}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** What ParamsDiffTable / MetricsSummaryTable / EnvDiffTable take. */
export interface RunCompareSectionProps {
  /** The runs' details, in column order (hidden runs already dropped). */
  runs: readonly RunDetailResponse[];
  labels: Record<string, string>;
  colors?: Map<string, string>;
  onlyDiffs: boolean;
  /** Case-insensitive key substring. */
  filter?: string;
  pinnedKeys?: readonly string[];
  onTogglePin?: (key: string) => void;
  /** Right of the section title. */
  actions?: ReactNode;
}
