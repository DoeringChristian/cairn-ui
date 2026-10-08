import { useState } from "react";
import { useOutletContext, useParams } from "react-router-dom";
import { useSourceFile, useSourceTree } from "../api/hooks";
import type { Run } from "../api/types";
import { formatBytes, safeJsonParse } from "../lib/format";
import { langFromPath } from "../lib/syntax-highlight";
import { TextView } from "../components/viewers/TextViewer";

/** The run page's Files tab: the captured source files, then the environment and its packages. */
export default function RunFilesTab() {
  return (
    <div className="space-y-8">
      <SourceFiles />
      <Environment />
    </div>
  );
}

function Heading({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-fg-muted">{children}</h2>;
}

function SourceFiles() {
  const { runId } = useParams<{ runId: string }>();
  const tree = useSourceTree(runId!);
  const [selected, setSelected] = useState<string | null>(null);
  const file = useSourceFile(runId!, selected);

  let body: React.ReactNode;
  if (tree.isLoading) body = <p className="text-fg-muted">Loading source…</p>;
  else if (tree.isError) body = <p className="text-fg-muted">No source archive was captured for this run.</p>;
  else {
    const files = tree.data?.files ?? [];
    body = (
      <div className="grid grid-cols-1 gap-4 md:grid-cols-[260px_1fr]">
        <aside className="card max-h-[30vh] overflow-auto p-3 md:max-h-[70vh]">
          <div className="mb-2 text-xs uppercase tracking-wide text-fg-muted">
            {files.length} files
            {tree.data?.marker ? ` · marker: ${tree.data.marker}` : ""}
          </div>
          <ul className="space-y-0.5 text-sm">
            {files.map((f) => (
              <li key={f.path}>
                <button
                  onClick={() => setSelected(f.path)}
                  className={`mono block w-full truncate rounded px-2 py-0.5 text-left hover:bg-bg-hover ${
                    selected === f.path ? "bg-bg-hover text-fg" : "text-fg-muted"
                  }`}
                  title={f.path}
                >
                  {f.path}
                </button>
              </li>
            ))}
          </ul>
        </aside>
        <main className="card max-h-[70vh] overflow-auto p-4">
          {!selected ? (
            <p className="text-fg-muted">Pick a file on the left.</p>
          ) : file.isLoading ? (
            <p className="text-fg-muted">Loading…</p>
          ) : file.data?.encoding === "base64" ? (
            <p className="text-fg-muted">Binary file ({formatBytes(file.data.content.length)} base64).</p>
          ) : (
            <TextView text={file.data?.content ?? ""} lang={langFromPath(selected)} />
          )}
        </main>
      </div>
    );
  }
  return (
    <section data-testid="run-files-source">
      <Heading>Source</Heading>
      {body}
    </section>
  );
}

function Environment() {
  const { run } = useOutletContext<{ run: Run }>();
  const env = safeJsonParse<Record<string, unknown>>(run.env_snapshot);
  if (!env) {
    return (
      <section data-testid="run-files-env">
        <Heading>Environment</Heading>
        <p className="text-fg-muted">No environment captured.</p>
      </section>
    );
  }
  const pipText = String(env._pip_freeze_text ?? "");
  const rest = Object.entries(env).filter(([k]) => k !== "_pip_freeze_text");
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_2fr]" data-testid="run-files-env">
      <section className="card min-w-0 p-4">
        <Heading>Environment</Heading>
        <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
          {rest.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-fg-muted">{k}</dt>
              <dd className="mono whitespace-pre-wrap break-all text-fg">{formatValue(v)}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section className="card min-w-0 p-4">
        <Heading>Packages (pip freeze)</Heading>
        <pre className="mono max-h-[60vh] overflow-auto rounded bg-bg p-3 text-xs text-fg-muted">
          {pipText || "(not captured)"}
        </pre>
      </section>
    </div>
  );
}

function formatValue(v: unknown): string {
  if (v == null) return "—";
  if (Array.isArray(v)) return v.map(String).join(", ");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
