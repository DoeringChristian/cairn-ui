import type { ReactNode } from "react";
import type { RunDetailResponse } from "../../api/types";
import { formatValue } from "../../lib/plot-utils/format";
import { shortRunId } from "../../lib/run-label";
import type { CompareRow } from "../../lib/run-compare";
import { diffCellClassName } from "../../lib/table-diff";
import FoldedText from "../FoldedText";

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
  /** Numbers in full (config values), not rounded (measurements). */
  exact?: boolean;
  /** Pinned keys get a filled pin; clicking toggles. Omit to hide the pins. */
  pinnedKeys?: readonly string[];
  onTogglePin?: (key: string) => void;
  /** Suffix after a key (e.g. the ↓ of a lower-is-better metric). */
  keySuffix?: (row: CompareRow) => ReactNode;
}

/** A differing row's tint (the row's `bg-accent/5`), as a layer over an opaque cell. */
const DIFF_TINT = "linear-gradient(rgb(var(--color-accent-rgb) / 0.05), rgb(var(--color-accent-rgb) / 0.05))";
/** Below this a value column stops shrinking and the table scrolls sideways. */
const VALUE_MIN_WIDTH = "12rem";

/** Rows = keys, columns = runs; differing rows are marked, numeric cells tinted best/worst. */
export default function CompareRowsTable({
  title,
  actions,
  keyHeader,
  rows,
  empty,
  mono = true,
  exact = false,
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
                <th className="pb-1 pr-4 sticky left-0 z-10 w-px whitespace-nowrap bg-bg">{keyHeader}</th>
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
                      // Opaque: values scroll underneath this sticky column, so the
                      // row's diff tint is painted over the solid surface colour.
                      className={`py-1 pr-4 sticky left-0 z-10 w-px whitespace-nowrap bg-bg ${mono ? "mono" : "text-fg-muted"} ${
                        row.differs ? "border-l-2 border-accent" : ""
                      }`}
                      style={row.differs ? { backgroundImage: DIFF_TINT } : undefined}
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
                          className={`mono py-1 pr-4 tabular-nums text-fg-muted ${diffCls}`}
                          // The value columns share the width beside the keys; a
                          // value folds to its column instead of widening the table.
                          style={{ width: `${100 / runIds.length}%` }}
                        >
                          {/* `contain: inline-size` keeps a long value out of the
                              table's column sizing; the minimum still holds. */}
                          <div style={{ minWidth: VALUE_MIN_WIDTH, contain: "inline-size" }}>
                            <FoldedText>{formatValue(v, { exact })}</FoldedText>
                          </div>
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
