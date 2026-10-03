import { lazy, Suspense, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { useRunInputArtifacts, useRunOutputArtifacts } from "../api/hooks";
import type { ArtifactVersionInfo, Run } from "../api/types";
import { explorerPath } from "../lib/artifacts/refs";
import { typeBadgeStyle } from "../lib/artifacts/type-style";
import { formatBytes, formatRelative } from "../lib/format";

const LineageView = lazy(() => import("../components/lineage/LineageView"));

/** A run's artifacts: what it logged and what it used, linking into the explorer, and its lineage. */
export default function RunArtifactsTab() {
  const { run } = useOutletContext<{ run: Run }>();
  const outputs = useRunOutputArtifacts(run.id);
  const inputs = useRunInputArtifacts(run.id);
  const [showGraph, setShowGraph] = useState(true);
  const outs = outputs.data?.outputs ?? [];
  const ins = inputs.data?.inputs ?? [];
  const loading = outputs.isLoading || inputs.isLoading;
  return (
    <div className="flex flex-col gap-5" data-testid="run-artifacts-tab">
      <Table
        title="Logged by this run"
        empty="This run logged no artifacts."
        rows={outs}
        loading={loading}
        runProject={run.project_id}
        testId="run-outputs"
      />
      <Table
        title="Used by this run"
        empty="This run used no artifacts."
        rows={ins}
        loading={loading}
        runProject={run.project_id}
        roles
        testId="run-inputs"
      />
      {(outs.length > 0 || ins.length > 0) && (
        <section>
          <div className="mb-2 flex items-center gap-2">
            <h2 className="text-sm font-semibold">Lineage</h2>
            <button type="button" className="btn px-2 py-0.5 text-xs" onClick={() => setShowGraph((s) => !s)}>
              {showGraph ? "Hide" : "Show"}
            </button>
          </div>
          {showGraph && (
            <div className="h-[60vh] min-h-[380px] overflow-hidden rounded-lg border border-border">
              <Suspense fallback={<p className="p-4 text-sm text-fg-muted">Loading graph…</p>}>
                <LineageView projectId={run.project_id} center={{ kind: "run", id: run.id }} />
              </Suspense>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function Table({
  title,
  empty,
  rows,
  loading,
  runProject,
  roles = false,
  testId,
}: {
  title: string;
  empty: string;
  rows: Array<ArtifactVersionInfo & { role?: string; used_at?: string }>;
  loading: boolean;
  runProject: string;
  roles?: boolean;
  testId: string;
}) {
  return (
    <section data-testid={testId}>
      <h2 className="mb-2 text-sm font-semibold">
        {title} <span className="font-normal text-fg-muted">({rows.length})</span>
      </h2>
      {loading ? (
        <p className="text-sm text-fg-muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-fg-subtle">{empty}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-bg-elevated text-left text-xs uppercase tracking-wide text-fg-muted">
              <tr>
                <th className="px-3 py-2">Artifact</th>
                <th className="px-3 py-2">Type</th>
                {roles && <th className="px-3 py-2">Role</th>}
                <th className="px-3 py-2">Aliases / tags</th>
                <th className="px-3 py-2">Step</th>
                <th className="px-3 py-2">Files</th>
                <th className="px-3 py-2">{roles ? "Used" : "Logged"}</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((v) => (
                <tr key={v.id} className="border-t border-border-subtle hover:bg-bg-elevated">
                  <td className="px-3 py-1.5">
                    <Link className="mono text-accent hover:underline" to={explorerPath(v.project_id, v.name, v.version)}>
                      {v.project_id !== runProject ? v.qualified_ref : v.ref}
                    </Link>
                  </td>
                  <td className="px-3 py-1.5">
                    <span className="rounded border px-1.5 py-0.5 text-[10px] font-medium" style={typeBadgeStyle(v.type)}>
                      {v.type}
                    </span>
                  </td>
                  {roles && (
                    <td className="px-3 py-1.5">
                      <span className="rounded border border-border bg-bg px-1.5 py-0.5 text-[10px] text-fg-muted">{v.role}</span>
                    </td>
                  )}
                  <td className="px-3 py-1.5">
                    <span className="flex flex-wrap gap-1">
                      {v.aliases.map((a) => (
                        <span key={a} className="mono rounded border border-accent/40 bg-accent/5 px-1.5 py-0.5 text-[10px] text-accent">
                          {a}
                        </span>
                      ))}
                      {v.tags.map((t) => (
                        <span key={t} className="mono rounded border border-border bg-bg px-1.5 py-0.5 text-[10px] text-fg-muted">
                          #{t}
                        </span>
                      ))}
                    </span>
                  </td>
                  <td className="mono num px-3 py-1.5 text-fg-muted">{v.step ?? "—"}</td>
                  <td className="mono num px-3 py-1.5 text-fg-muted">
                    {v.file_count} · {formatBytes(v.size)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-fg-muted">{formatRelative(roles ? (v.used_at ?? null) : v.created_at)}</td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-xs">
                    <Link className="text-accent hover:underline" to={explorerPath(v.project_id, v.name, v.version, "files")}>
                      files
                    </Link>
                    <span className="mx-1 text-fg-subtle">·</span>
                    <Link className="text-accent hover:underline" to={explorerPath(v.project_id, v.name, v.version, "lineage")}>
                      lineage
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
