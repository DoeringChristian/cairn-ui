import { useMemo, useRef, useState } from "react";
import CardShell from "../../CardShell";
import { CardMutationContext } from "../../../lib/card-settings";
import TableSettingsPanel from "../../settings-panels/TableSettingsPanel";
import DataTable from "../../table/DataTable";
import QueryBar from "../../table/QueryBar";
import { builtin, type TableSettings } from "../../cards-settings/table";
import { applyTableOps } from "../../../lib/table/pipeline";
import type { TableData } from "../../../lib/table/types";
import { downloadCardPng } from "../../../lib/download";
import { useSessionSettings } from "./ReportSettings";

export type CapturedSeries = {role: string; name: string; points: {x: number; y: number}[]};
export function ReportTable({series, scalar, title = "Table", caption, onCopySource, onComment, onEditSource}: {series: CapturedSeries[]; scalar: boolean; title?: string; caption?: string; onCopySource: () => void; onComment?: () => void; onEditSource?: () => void}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const element = useRef<HTMLDivElement>(null);
  const ctl = useSessionSettings<TableSettings>(builtin);
  const input = useMemo<TableData>(() => ({columns: [{name: "Input", type: "string"}, {name: "Step", type: "number"}, {name: "Value", type: "number"}], data: series.flatMap(row => (scalar ? row.points.slice(-1) : row.points).map(point => [row.name, point.x, point.y]))}), [series, scalar]);
  const result = useMemo(() => applyTableOps(input, ctl.value.ops), [input, ctl.value.ops]);
  const table = <><QueryBar value={ctl.value.ops.query || ""} onChange={query => ctl.set({ops: {...ctl.value.ops, query}})} error={result.queryError} shown={result.queriedRows} total={input.data.length} columns={input.columns.map(c => c.name)} /><DataTable table={result.table} rowsPerPage={ctl.value.rowsPerPage} onRowsPerPageChange={rowsPerPage => ctl.set({rowsPerPage})} hiddenColumns={ctl.value.hiddenColumns} columnOrder={ctl.value.columnOrder} sort={ctl.value.sort} onSortChange={sort => ctl.set({sort})} /></>;
  const settings = <TableSettingsPanel ctl={ctl} mode="card" singleTable ctx={{inputColumns: input.columns.map(c => c.name), derivedColumns: (ctl.value.ops.derived || []).map(c => c.name), outputColumns: result.table.columns.map(c => c.name), multi: false, diffDefault: false, sources: [], derivedErrors: result.derivedErrors, groupByError: result.groupByError}} />;
  const download = () => {const url = URL.createObjectURL(new Blob([JSON.stringify(result.table, null, 2)], {type: "application/json"})); const link = document.createElement("a"); link.href = url; link.download = `${title}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);};
  return <figure className="document-embedded-card">
    <CardMutationContext.Provider value={false}>
      <CardShell
        cardRef={element}
        settings={ctl.value}
        updateSettings={ctl.set}
        title={title}
        cardKind="table"
        onScreenshot={() => {if (element.current) void downloadCardPng(element.current, title).catch(error => setError(String(error)));}}
        onSettings={() => setOpen(true)}
        onDownload={download}
        onResetView={ctl.resetAll}
        headerMenu={[{icon: "fa-link", label: "Copy source reference", onClick: onCopySource}, ...(onComment ? [{icon: "fa-comment", label: "Comments", onClick: onComment}] : []), ...(onEditSource ? [{icon: "fa-pen", label: "Edit source", onClick: onEditSource}] : [])]}
        settingsPanel={settings}
        modalOpen={open}
        onModalClose={() => setOpen(false)}
        modalContent={<div className="flex h-full min-h-0 w-full flex-col">{table}</div>}
      >
        {error && <p role="alert">{error}</p>}
        {table}
      </CardShell>
    </CardMutationContext.Provider>
    {caption && <figcaption>{caption}</figcaption>}
  </figure>;
}
