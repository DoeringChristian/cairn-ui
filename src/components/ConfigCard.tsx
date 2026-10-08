/**
 * Config card (the Summary section): the shown runs' config keys as rows
 * (dotted, as the runs table), tags and notes first, one column per run —
 * or per group when the workspace is grouped (its value when all its runs
 * agree, else `mixed`; lib/summary-tables.ts). "Only diffs" hides the keys
 * that are the same in every column.
 */

import { useMemo, useRef, useState } from "react";
import { useCardSettings } from "../lib/card-settings";
import { downloadCsv, safeName } from "../lib/download";
import { formatValue } from "../lib/plot-utils/format";
import { configTable, MIXED, type Cell } from "../lib/summary-tables";
import CardShell from "./CardShell";
import FoldedText from "./FoldedText";
import type { ConfigSettings } from "./cards-settings/config";
import ConfigSettingsPanel from "./settings-panels/ConfigSettingsPanel";
import { EmptyCell, UnitLabel, useSummaryRuns } from "./summary/use-summary-runs";

interface Props {
  runIds: string[];
  settingsKey: { runId: string; metricName: string };
  onRemove?: () => void;
  autoOpenSettings?: boolean;
}

const text = (v: Cell) => (v == null ? "" : v === MIXED ? "mixed" : formatValue(v, { exact: true }));

export default function ConfigCard({ runIds: allRunIds, settingsKey, onRemove, autoOpenSettings }: Props) {
  const ctl = useCardSettings<ConfigSettings>(settingsKey, "config");
  const s = ctl.value;
  const [expanded, setExpanded] = useState(autoOpenSettings ?? false);
  const { runIds, runs, loading, groupOf, labelOf, colorOf } = useSummaryRuns(allRunIds);
  const table = useMemo(() => configTable(runs, { groupOf, onlyDiffs: s.onlyDiffs }), [runs, groupOf, s.onlyDiffs]);
  const cardRef = useRef<HTMLDivElement>(null);

  const body = (className: string) => {
    if (runIds.length === 0) return <p className={`text-sm text-fg-muted ${className}`}>No runs.</p>;
    if (loading && runs.length === 0) return <p className={`text-sm text-fg-muted ${className}`}>Loading…</p>;
    return (
      <div className={`overflow-auto ${className}`}>
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-fg-muted">
            <tr>
              <th className="sticky left-0 top-0 z-20 bg-bg pb-1 pr-4 font-medium">key</th>
              {table.units.map((u) => (
                <th key={u.key} className="sticky top-0 z-10 bg-bg pb-1 pr-4 font-medium">
                  <UnitLabel label={labelOf(u)} color={colorOf(u)} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((r) => (
              <tr key={`${r.kind}:${r.key}`} className="border-t border-border-subtle">
                <td className={`sticky left-0 bg-bg py-1 pr-4 whitespace-nowrap ${r.kind === "config" ? "mono" : "text-fg-muted"}`}>{r.key}</td>
                {r.cells.map((v, i) => (
                  <td key={table.units[i]!.key} className={`py-1 pr-4 ${r.kind === "config" ? "mono tabular-nums" : ""}`}>
                    {v == null || v === MIXED ? (
                      <EmptyCell mixed={v === MIXED} />
                    ) : (
                      <div style={{ minWidth: "6rem", contain: "inline-size" }}>
                        <FoldedText>{text(v)}</FoldedText>
                      </div>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {table.rows.length === 0 && (
          <p className="mt-2 text-sm text-fg-subtle">{s.onlyDiffs ? "The same in every column." : "No config."}</p>
        )}
      </div>
    );
  };

  return (
    <CardShell
      cardKind="config"
      cardRef={cardRef}
      settings={s}
      updateSettings={ctl.set}
      title={s.title ?? "Config"}
      defaultHeight={320}
      headerActions={
        <button
          type="button"
          role="checkbox"
          aria-checked={s.onlyDiffs}
          disabled={ctl.locked}
          onClick={() => ctl.set({ onlyDiffs: !s.onlyDiffs })}
          className="inline-flex items-center gap-1.5 whitespace-nowrap rounded px-1 text-xs text-fg-muted hover:text-fg disabled:opacity-40"
          title="Hide the keys that are the same in every column"
          data-testid="config-only-diffs"
        >
          <i className={`fa-regular ${s.onlyDiffs ? "fa-square-check text-accent" : "fa-square"}`} aria-hidden="true" />
          only diffs
        </button>
      }
      onSettings={() => setExpanded(true)}
      onRemove={onRemove}
      onDownload={() => {
        const headers = ["key", ...table.units.map(labelOf)];
        downloadCsv(headers, table.rows.map((r) => [r.key, ...r.cells.map(text)]), safeName(s.title ?? "config") + ".csv");
      }}
      settingsPanel={<ConfigSettingsPanel ctl={ctl} mode="card" />}
      modalOpen={expanded}
      onModalClose={() => setExpanded(false)}
      scrollIntoViewOnMount={autoOpenSettings}
      modalContent={<div className="flex h-[calc(100vh-12rem)] flex-col">{body("flex-1 min-h-0")}</div>}
    >
      {body("flex-1 min-h-0")}
    </CardShell>
  );
}
