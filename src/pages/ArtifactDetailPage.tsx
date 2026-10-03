import { Fragment, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useArtifactFamily } from "../api/hooks";
import { api } from "../api/client";
import { qk } from "../api/query-keys";
import { formatBytes, formatRelative } from "../lib/format";
import type { ArtifactVersionInfo } from "../api/types";
import ManifestTree from "../components/ManifestTree";

/** `latest` and `vN` are system-maintained, never set by hand. */
const RESERVED_ALIAS = /^(latest|v\d+)$/;

function typeBadgeColor(type: string): string {
  switch (type) {
    case "dataset":
      return "bg-blue-500/15 text-blue-400 border-blue-500/30";
    case "model":
      return "bg-green-500/15 text-green-400 border-green-500/30";
    case "code":
      return "bg-purple-500/15 text-purple-400 border-purple-500/30";
    default:
      return "bg-fg-subtle/10 text-fg-muted border-border";
  }
}

/** Expands a version into its file tree. */
function FilesToggle({ v, open, onToggle }: { v: ArtifactVersionInfo; open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
    >
      <i className={`fa-solid ${open ? "fa-chevron-down" : "fa-chevron-right"} text-[10px]`} aria-hidden="true" />
      {v.file_count} file{v.file_count === 1 ? "" : "s"}
    </button>
  );
}

function Producer({ v, projectId }: { v: ArtifactVersionInfo; projectId: string }) {
  if (!v.created_by_run) return <span className="text-fg-subtle">{"\u2014"}</span>;
  return (
    <Link to={`/p/${v.producer?.project_id ?? projectId}/r/${v.created_by_run}`} className="mono text-accent hover:underline text-xs">
      {v.producer?.name ?? v.created_by_run.slice(0, 8)}
    </Link>
  );
}

function AliasChips({ v }: { v: ArtifactVersionInfo }) {
  return (
    <span className="flex flex-wrap gap-1">
      {v.aliases.map((a) => (
        <span key={a} className="mono rounded border border-border bg-bg px-1.5 py-0.5 text-[10px] text-fg-muted">{a}</span>
      ))}
    </span>
  );
}

export default function ArtifactDetailPage() {
  const { projectId, familyId } = useParams<{
    projectId: string;
    familyId: string;
  }>();
  const q = useArtifactFamily(projectId!, familyId!);
  const queryClient = useQueryClient();

  const [openVersions, setOpenVersions] = useState<Set<string>>(new Set());
  const toggleVersion = (id: string) =>
    setOpenVersions((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const [aliasInput, setAliasInput] = useState("");
  const [aliasVersionInput, setAliasVersionInput] = useState("");

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: qk.artifactFamily(projectId!, familyId!) });
    queryClient.invalidateQueries({ queryKey: qk.artifactFamilies(projectId!) });
  };
  const versionId = (version: number) => q.data?.versions.find((v) => v.version === version)?.id;

  const aliasMutation = useMutation({
    mutationFn: ({ alias, version }: { alias: string; version: number }) => {
      const id = versionId(version);
      if (!id) throw new Error(`no version ${version}`);
      return api.addArtifactAlias(id, alias);
    },
    onSuccess: () => {
      invalidate();
      setAliasInput("");
      setAliasVersionInput("");
    },
  });

  const deleteAliasMutation = useMutation({
    mutationFn: ({ alias, version }: { alias: string; version: number }) => {
      const id = versionId(version);
      if (!id) throw new Error(`no version ${version}`);
      return api.removeArtifactAlias(id, alias);
    },
    onSuccess: invalidate,
  });

  if (!projectId || !familyId) return null;
  if (q.isLoading) return <p className="text-fg-muted">Loading...</p>;
  if (q.isError)
    return <p className="text-status-failed">Error: {String(q.error)}</p>;
  if (!q.data) return null;

  const family = q.data;

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-baseline gap-3">
        <h1 className="mono min-w-0 break-all text-xl font-semibold">{family.name}</h1>
        <span
          className={`rounded border px-2 py-0.5 text-xs font-medium ${typeBadgeColor(family.type)}`}
        >
          {family.type}
        </span>
        {family.description && (
          <span className="text-sm text-fg-muted">{family.description}</span>
        )}
      </div>

      {/* Aliases */}
      <section className="card mb-6 p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-fg-muted">
          Aliases
        </h2>
        <div className="flex flex-wrap items-center gap-2 mb-3">
          {Object.entries(family.aliases).map(([a, version]) => (
            <span
              key={a}
              className="group mono inline-flex items-center gap-1 rounded border border-border bg-bg px-2 py-0.5 text-xs text-fg-muted"
            >
              {a} {"\u2192"} v{version}
              {/* `latest` always names the newest version: it cannot be moved or removed. */}
              {a !== "latest" && (
                <button
                  type="button"
                  className="ml-0.5 transition-opacity hover:text-status-failed can-hover:opacity-0 can-hover:group-hover:opacity-100"
                  onClick={() => deleteAliasMutation.mutate({ alias: a, version })}
                  aria-label={`delete alias ${a}`}
                >
                  {"\u00D7"}
                </button>
              )}
            </span>
          ))}
        </div>
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const ver = parseInt(aliasVersionInput, 10);
            const alias = aliasInput.trim();
            if (alias && !isNaN(ver) && !RESERVED_ALIAS.test(alias)) {
              aliasMutation.mutate({ alias: aliasInput.trim(), version: ver });
            }
          }}
        >
          <input
            className="input py-1 text-xs w-32"
            value={aliasInput}
            onChange={(e) => setAliasInput(e.target.value)}
            placeholder="alias name"
          />
          <input
            className="input py-1 text-xs w-20"
            type="number"
            min={1}
            value={aliasVersionInput}
            onChange={(e) => setAliasVersionInput(e.target.value)}
            placeholder="version"
          />
          <button type="submit" className="btn px-2 py-1 text-xs">
            Set alias
          </button>
          {RESERVED_ALIAS.test(aliasInput.trim()) && (
            <span className="text-xs text-status-failed">"latest" and "vN" are reserved</span>
          )}
          {(aliasMutation.isError || deleteAliasMutation.isError) && (
            <span className="text-xs text-status-failed">
              {String(aliasMutation.error ?? deleteAliasMutation.error)}
            </span>
          )}
        </form>
      </section>

      {/* Version history */}
      <section className="card p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-fg-muted">
          Versions ({family.versions.length})
        </h2>
        {family.versions.length === 0 ? (
          <p className="text-sm text-fg-subtle">No versions yet.</p>
        ) : (
          <>
            {/* Mobile: card list */}
            <ul className="flex flex-col gap-2 md:hidden">
              {family.versions.map((v) => (
                <li key={v.id} className="rounded-lg border border-border bg-bg-elevated p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="mono font-semibold">v{v.version}</span>
                    <AliasChips v={v} />
                    <FilesToggle v={v} open={openVersions.has(v.id)} onToggle={() => toggleVersion(v.id)} />
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-fg-muted">
                    <span className="mono" title={v.digest}>{v.digest.slice(0, 12)}</span>
                    <span>{formatBytes(v.size)}</span>
                    {v.step != null && <span>step {v.step}</span>}
                    <span>{formatRelative(v.created_at)}</span>
                    <Producer v={v} projectId={projectId} />
                    <span>{v.consumer_count} consumer{v.consumer_count === 1 ? "" : "s"}</span>
                  </div>
                  {openVersions.has(v.id) && (
                    <div className="mt-2 border-t border-border-subtle pt-2"><ManifestTree hash={v.digest} /></div>
                  )}
                </li>
              ))}
            </ul>

            {/* Desktop: table */}
            <div className="hidden overflow-x-auto rounded-lg border border-border md:block">
              <table className="w-full text-sm">
                <thead className="bg-bg-elevated text-left text-xs uppercase tracking-wide text-fg-muted">
                  <tr>
                    <th className="px-3 py-2">Version</th>
                    <th className="px-3 py-2">Aliases</th>
                    <th className="px-3 py-2">Digest</th>
                    <th className="px-3 py-2">Size</th>
                    <th className="px-3 py-2">Step</th>
                    <th className="px-3 py-2">Created</th>
                    <th className="px-3 py-2">Logged by</th>
                    <th className="px-3 py-2">Used by</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {family.versions.map((v) => (
                    <Fragment key={v.id}>
                    <tr className="border-t border-border-subtle hover:bg-bg-elevated">
                      <td className="mono num px-3 py-2">v{v.version}</td>
                      <td className="px-3 py-2"><AliasChips v={v} /></td>
                      <td className="mono px-3 py-2 text-fg-muted" title={v.digest}>
                        {v.digest.slice(0, 12)}
                      </td>
                      <td className="mono num px-3 py-2 text-fg-muted">
                        {formatBytes(v.size)}
                      </td>
                      <td className="mono num px-3 py-2 text-fg-muted">{v.step ?? "\u2014"}</td>
                      <td className="px-3 py-2 text-fg-muted">
                        {formatRelative(v.created_at)}
                      </td>
                      <td className="px-3 py-2"><Producer v={v} projectId={projectId} /></td>
                      <td className="mono num px-3 py-2 text-fg-muted">{v.consumer_count}</td>
                      <td className="px-3 py-2">
                        <FilesToggle v={v} open={openVersions.has(v.id)} onToggle={() => toggleVersion(v.id)} />
                      </td>
                    </tr>
                    {openVersions.has(v.id) && (
                      <tr className="border-t border-border-subtle">
                        <td colSpan={9} className="px-3 py-2"><ManifestTree hash={v.digest} /></td>
                      </tr>
                    )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
