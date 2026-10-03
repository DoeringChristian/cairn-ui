import { useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { applyTableOps } from "../../lib/table/pipeline";
import type { TableData } from "../../lib/table/types";
import type { TableFormat } from "../../lib/viewers/kind";
import type { ViewerSource } from "../../lib/viewers/source";
import { csvToTable, jsonlToTable } from "../../lib/viewers/table-source";
import { builtin as TABLE_DEFAULTS } from "../cards-settings/table";
import DataTable from "../table/DataTable";
import QueryBar from "../table/QueryBar";
import { TruncatedNote, useViewerText, ViewerError, ViewerLoading } from "./use-viewer-text";

/** A logged `cairn.Table` blob by hash (immutable content, so never stale). */
export const tableBlobQuery = (hash: string) => ({
  queryKey: ["table-blob", hash] as const,
  staleTime: Infinity,
  queryFn: async (): Promise<TableData> => {
    const r = await fetch(api.artifactUrl(hash));
    if (!r.ok) throw new Error(`fetch failed (${r.status})`);
    return (await r.json()) as TableData;
  },
});

/**
 * One table in the table card's grid (sortable, paginated, media cells)
 * under its query bar (a row filter such as `loss < 0.5`).
 */
export function TableView({ table, fill = false }: { table: TableData; fill?: boolean }) {
  const [query, setQuery] = useState("");
  const result = useMemo(() => applyTableOps(table, { query }), [table, query]);
  return (
    <div className={`flex min-h-0 flex-col ${fill ? "h-full" : "max-h-[70vh]"}`} data-viewer="table">
      <QueryBar
        value={query}
        onChange={setQuery}
        error={result.queryError}
        shown={result.queriedRows}
        total={table.data.length}
        columns={table.columns.map((c) => c.name)}
      />
      <div className="min-h-0 flex-1">
        <DataTable table={result.table} rowsPerPage={TABLE_DEFAULTS.rowsPerPage} hiddenColumns={[]} />
      </div>
    </div>
  );
}

/** A logged table, or a CSV / TSV / JSON Lines file, in `TableView`. */
export default function TableViewer({
  source,
  format,
  maxBytes,
  fill,
}: {
  source: Pick<ViewerSource, "hash" | "size">;
  format: TableFormat;
  /** Text formats: read at most this many bytes (the first rows of a big file). */
  maxBytes?: number;
  fill?: boolean;
}) {
  const blob = useQuery({ ...tableBlobQuery(source.hash), enabled: format === "cairn", placeholderData: keepPreviousData });
  const text = useViewerText(source, maxBytes, format !== "cairn");
  const parsed = useMemo(() => {
    if (format === "cairn" || text.text == null) return null;
    if (format === "jsonl") return jsonlToTable(text.text, { cut: text.cut });
    return csvToTable(text.text, { delimiter: format === "tsv" ? "\t" : ",", cut: text.cut });
  }, [format, text.text, text.cut]);
  if (format === "cairn") {
    if (blob.isLoading) return <ViewerLoading className="h-48" />;
    if (blob.isError || !blob.data) return <ViewerError error={blob.error ?? "failed to load table"} />;
    return <TableView table={blob.data} fill={fill} />;
  }
  if (text.loading) return <ViewerLoading className="h-48" />;
  if (text.error) return <ViewerError error={text.error} />;
  if (!parsed) return <ViewerError error="Not a table: a line is not a JSON object." />;
  return (
    <div className={`flex min-h-0 flex-col gap-1 ${fill ? "h-full" : ""}`}>
      {parsed.truncated && (
        <TruncatedNote shown={maxBytes ?? 0} total={source.size} what={`${parsed.data.length.toLocaleString()} rows`} />
      )}
      <TableView table={parsed} fill={fill} />
    </div>
  );
}
