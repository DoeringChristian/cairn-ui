import { lazy, Suspense, useMemo, useState } from "react";
import type { ViewerSource } from "../../lib/viewers/source";
import { isPlotlyFigure, recordsToTable } from "../../lib/viewers/table-source";
import JsonTree from "./JsonTree";
import { TextView } from "./TextViewer";
import { TableView } from "./TableViewer";
import { TruncatedNote, useViewerText, ViewerError, ViewerLoading } from "./use-viewer-text";
import ViewModeSwitch from "./ViewModeSwitch";

// Plotly lives in its own chunk, loaded when a figure is shown.
const PlotlyFigureViewer = lazy(() => import("./FigureViewer").then((m) => ({ default: m.PlotlyFigureViewer })));

type JsonMode = "figure" | "table" | "tree" | "raw";
const LABELS: Record<JsonMode, string> = { figure: "Figure", table: "Table", tree: "Tree", raw: "JSON" };

/**
 * A JSON document: as the figure it describes (a Plotly figure), as a table
 * (a list of records), as the shared JSON tree, or as highlighted text.
 * The first that fits is shown; the others are a click away. The head of a
 * file too big to read whole shows as text.
 */
export default function JsonViewer({ source, maxBytes }: { source: Pick<ViewerSource, "hash" | "size">; maxBytes?: number }) {
  const t = useViewerText(source, maxBytes);
  const parsed = useMemo(() => {
    if (t.text == null || t.cut) return { ok: false as const };
    try {
      return { ok: true as const, value: JSON.parse(t.text) as unknown };
    } catch {
      return { ok: false as const };
    }
  }, [t.text, t.cut]);
  const table = useMemo(() => (parsed.ok ? recordsToTable(parsed.value) : null), [parsed]);
  const modes = useMemo<JsonMode[]>(() => {
    if (!parsed.ok) return ["raw"];
    return [...(isPlotlyFigure(parsed.value) ? ["figure" as const] : []), ...(table ? ["table" as const] : []), "tree", "raw"];
  }, [parsed, table]);
  const [picked, setPicked] = useState<JsonMode | null>(null);
  const mode = picked && modes.includes(picked) ? picked : modes[0]!;

  if (t.loading) return <ViewerLoading />;
  if (t.error) return <ViewerError error={t.error} />;
  const text = t.text ?? "";
  return (
    <div className="flex min-h-0 flex-col gap-2" data-viewer="json-file">
      {t.cut && maxBytes != null && <TruncatedNote shown={maxBytes} total={source.size} />}
      <ViewModeSwitch modes={modes} value={mode} onChange={setPicked} labels={LABELS} />
      {mode === "figure" && parsed.ok ? (
        <Suspense fallback={<ViewerLoading className="h-[60vh]" />}>
          <PlotlyFigureViewer figure={parsed.value as { data: Array<Record<string, unknown>> }} />
        </Suspense>
      ) : mode === "table" && table ? (
        <TableView table={table} />
      ) : mode === "tree" && parsed.ok ? (
        <div className="card max-h-[70vh] overflow-auto px-3 py-2">
          <JsonTree value={parsed.value} />
        </div>
      ) : (
        <TextView text={parsed.ok ? JSON.stringify(parsed.value, null, 2) : text} lang="json" className="max-h-[70vh]" />
      )}
    </div>
  );
}
