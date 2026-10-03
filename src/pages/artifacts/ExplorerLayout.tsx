import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, Outlet, useNavigate, useParams } from "react-router-dom";
import { useArtifactFamilies, useArtifactFamilyByName } from "../../api/artifact-hooks";
import { errorText } from "../../api/client";
import type { ArtifactFamily } from "../../api/types";
import { formatBytes, formatRelative } from "../../lib/format";
import { explorerPath, isVersionTab, parseVersionSegment } from "../../lib/artifacts/refs";
import { typeBadgeStyle } from "../../lib/artifacts/type-style";

/** `latest` first, then the user aliases, as `alias:vN`. */
function aliasLabels(aliases: Record<string, number>): string[] {
  return Object.entries(aliases)
    .sort(([a], [b]) => (a === "latest" ? -1 : b === "latest" ? 1 : a.localeCompare(b)))
    .map(([a, v]) => `${a}:v${v}`);
}

export function TypeBadge({ type, className = "" }: { type: string; className?: string }) {
  return (
    <span
      className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium ${className}`}
      style={typeBadgeStyle(type)}
    >
      {type}
    </span>
  );
}

function familyMatches(f: ArtifactFamily, q: string): boolean {
  if (!q) return true;
  const s = q.toLowerCase();
  return (
    f.name.toLowerCase().includes(s) ||
    f.type.toLowerCase().includes(s) ||
    (f.description ?? "").toLowerCase().includes(s) ||
    Object.keys(f.aliases).some((a) => a.toLowerCase().includes(s))
  );
}

/**
 * The artifact explorer: a sidebar tree (types -> artifacts -> versions,
 * searchable) beside the selected artifact's version view.
 */
export default function ExplorerLayout() {
  const { projectId, name } = useParams<{ projectId: string; name?: string }>();
  const q = useArtifactFamilies(projectId!);
  const [search, setSearch] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-start">
      <aside
        className="md:sticky md:top-[calc(var(--header-h)+12px)] md:w-72 md:shrink-0"
        aria-label="artifacts"
      >
        <button
          type="button"
          className="btn mb-2 w-full justify-between md:hidden"
          onClick={() => setSidebarOpen((o) => !o)}
          aria-expanded={sidebarOpen}
        >
          <span>Artifacts</span>
          <i className={`fa-solid ${sidebarOpen ? "fa-chevron-up" : "fa-chevron-down"}`} aria-hidden="true" />
        </button>
        <div
          className={`${sidebarOpen ? "flex" : "hidden"} card flex-col overflow-hidden md:flex md:max-h-[calc(100vh-var(--header-h)-24px)]`}
        >
          <div className="border-b border-border p-2">
            <div className="relative">
              <i className="fa-solid fa-magnifying-glass pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-fg-subtle" aria-hidden="true" />
              <input
                className="input py-1 pl-7 text-sm"
                placeholder="Search artifacts"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="search artifacts"
              />
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto py-1" data-testid="artifact-tree">
            {q.isLoading && <p className="px-3 py-2 text-xs text-fg-muted">Loading…</p>}
            {q.isError && <p className="px-3 py-2 text-xs text-status-failed">{errorText(q.error)}</p>}
            {q.data && (
              <TypeTree
                projectId={projectId!}
                families={q.data.families}
                search={search.trim()}
                selected={name ?? null}
                onNavigate={() => setSidebarOpen(false)}
              />
            )}
          </div>
          <div className="border-t border-border px-3 py-1.5 text-[11px] text-fg-subtle">
            <Link to={explorerPath(projectId!)} className="hover:text-fg">
              All artifacts
            </Link>
            <span className="mx-1">·</span>
            <Link to={`/p/${projectId}/lineage`} className="hover:text-fg">
              Project lineage
            </Link>
          </div>
        </div>
      </aside>
      <section className="min-w-0 flex-1">
        <Outlet />
      </section>
    </div>
  );
}

function TypeTree({
  projectId,
  families,
  search,
  selected,
  onNavigate,
}: {
  projectId: string;
  families: ArtifactFamily[];
  search: string;
  selected: string | null;
  onNavigate: () => void;
}) {
  const byType = useMemo(() => {
    const m = new Map<string, ArtifactFamily[]>();
    for (const f of families) {
      if (!familyMatches(f, search)) continue;
      (m.get(f.type) ?? m.set(f.type, []).get(f.type)!).push(f);
    }
    for (const list of m.values()) list.sort((a, b) => a.name.localeCompare(b.name));
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [families, search]);
  const [closedTypes, setClosedTypes] = useState<Set<string>>(new Set());
  if (families.length === 0) return <p className="px-3 py-2 text-xs text-fg-muted">No artifacts in this project yet.</p>;
  if (byType.length === 0) return <p className="px-3 py-2 text-xs text-fg-muted">Nothing matches “{search}”.</p>;
  return (
    <ul role="tree" className="text-sm">
      {byType.map(([type, fams]) => {
        const open = !closedTypes.has(type) || !!search;
        return (
          <li key={type} role="treeitem" aria-expanded={open}>
            <button
              type="button"
              className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-xs font-semibold uppercase tracking-wide text-fg-muted hover:bg-bg-hover"
              onClick={() =>
                setClosedTypes((s) => {
                  const n = new Set(s);
                  if (n.has(type)) n.delete(type);
                  else n.add(type);
                  return n;
                })
              }
            >
              <i className={`fa-solid ${open ? "fa-caret-down" : "fa-caret-right"} w-3`} aria-hidden="true" />
              <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: typeBadgeStyle(type).color }} />
              {type}
              <span className="ml-auto font-normal normal-case text-fg-subtle">{fams.length}</span>
            </button>
            {open && (
              <ul role="group">
                {fams.map((f) => (
                  <FamilyItem
                    key={f.id}
                    projectId={projectId}
                    family={f}
                    selected={selected === f.name}
                    forceOpen={!!search && Object.keys(f.aliases).some((a) => a.includes(search.toLowerCase()))}
                    onNavigate={onNavigate}
                  />
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function FamilyItem({
  projectId,
  family,
  selected,
  forceOpen,
  onNavigate,
}: {
  projectId: string;
  family: ArtifactFamily;
  selected: boolean;
  forceOpen: boolean;
  onNavigate: () => void;
}) {
  const [open, setOpen] = useState(selected);
  useEffect(() => {
    if (selected) setOpen(true);
  }, [selected]);
  const expanded = open || forceOpen;
  const detail = useArtifactFamilyByName(projectId, expanded ? family.name : null);
  const { versionSeg, tab } = useParams<{ versionSeg?: string; tab?: string }>();
  const currentVersion = selected ? parseVersionSegment(versionSeg) : null;
  const keepTab = isVersionTab(tab) ? tab : null;
  return (
    <li role="treeitem" aria-expanded={expanded} aria-selected={selected}>
      <div className={`flex items-center ${selected ? "bg-accent/5" : ""}`}>
        <button
          type="button"
          className="w-7 shrink-0 py-1 pl-4 text-fg-subtle hover:text-fg"
          onClick={() => setOpen((o) => !o)}
          aria-label={expanded ? `collapse ${family.name}` : `expand ${family.name}`}
        >
          <i className={`fa-solid ${expanded ? "fa-caret-down" : "fa-caret-right"}`} aria-hidden="true" />
        </button>
        <Link
          to={explorerPath(projectId, family.name)}
          onClick={() => {
            setOpen(true);
            onNavigate();
          }}
          className={`mono min-w-0 flex-1 truncate py-1 pr-2 text-[13px] hover:text-accent ${selected ? "font-semibold text-fg" : "text-fg"}`}
          title={family.name}
        >
          {family.name}
        </Link>
        <span className="mono pr-2 text-[11px] text-fg-subtle">{family.version_count}</span>
      </div>
      {expanded && (
        <ul role="group" className="pb-1">
          {detail.isLoading && <li className="py-0.5 pl-12 text-xs text-fg-subtle">Loading…</li>}
          {detail.data?.versions.map((v) => {
            const active = currentVersion === v.version;
            return (
              <li key={v.id} role="treeitem" aria-selected={active}>
                <Link
                  to={explorerPath(projectId, family.name, v.version, keepTab)}
                  onClick={onNavigate}
                  className={`flex items-center gap-1.5 py-0.5 pl-12 pr-2 text-xs ${
                    active ? "bg-accent/10 font-semibold text-accent" : "text-fg-muted hover:bg-bg-hover hover:text-fg"
                  }`}
                >
                  <span className="mono">v{v.version}</span>
                  {v.aliases.map((a) => (
                    <span key={a} className="mono rounded border border-border bg-bg px-1 text-[10px] leading-4 text-fg-muted">
                      {a}
                    </span>
                  ))}
                  {v.consumer_count === 0 && (
                    <span className="ml-auto text-[10px] text-fg-subtle" title="never used by a run">
                      unused
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}

/** No artifact selected: every artifact of the project. */
export function ArtifactsHome() {
  const { projectId } = useParams<{ projectId: string }>();
  const q = useArtifactFamilies(projectId!);
  const families = q.data?.families ?? [];
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h1 className="mono min-w-0 break-all text-xl font-semibold">{projectId} / artifacts</h1>
        <p className="text-sm text-fg-muted">
          {families.length} artifact{families.length === 1 ? "" : "s"}
        </p>
      </div>
      {q.isLoading ? (
        <p className="text-fg-muted">Loading…</p>
      ) : families.length === 0 ? (
        <div className="card p-6 text-sm text-fg-muted">
          <p className="mb-2 font-semibold text-fg">No artifacts yet.</p>
          <p>
            Log one from a run with <code className="mono">run.log_artifact(...)</code>; see the{" "}
            <span className="mono">Usage</span> tab of any version for snippets.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm" data-testid="artifacts-table">
            <thead className="bg-bg-elevated text-left text-xs uppercase tracking-wide text-fg-muted">
              <tr>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Latest</th>
                <th className="px-3 py-2">Versions</th>
                <th className="px-3 py-2">Total size</th>
                <th className="px-3 py-2">Aliases</th>
                <th className="px-3 py-2">Updated</th>
              </tr>
            </thead>
            <tbody>
              {[...families]
                .sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name))
                .map((f) => (
                  <tr key={f.id} className="border-t border-border-subtle hover:bg-bg-elevated">
                    <td className="px-3 py-2">
                      <Link to={explorerPath(projectId!, f.name)} className="mono text-accent hover:underline">
                        {f.name}
                      </Link>
                      {f.description && <div className="max-w-md truncate text-xs text-fg-muted">{f.description}</div>}
                    </td>
                    <td className="px-3 py-2">
                      <TypeBadge type={f.type} />
                    </td>
                    <td className="mono num px-3 py-2 text-fg-muted">{f.latest_version ? `v${f.latest_version}` : "—"}</td>
                    <td className="mono num px-3 py-2 text-fg-muted">{f.version_count}</td>
                    <td className="mono num px-3 py-2 text-fg-muted">{formatBytes(f.total_size)}</td>
                    <td className="px-3 py-2">
                      <span className="flex flex-wrap gap-1">
                        {aliasLabels(f.aliases).map((a) => (
                          <span key={a} className="mono rounded border border-border bg-bg px-1.5 py-0.5 text-[10px] text-fg-muted">
                            {a}
                          </span>
                        ))}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-fg-muted">{formatRelative(f.updated_at)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** `/artifacts/<name>`: the newest version (or a message when there is none). */
export function FamilyRedirect() {
  const { projectId, name } = useParams<{ projectId: string; name: string }>();
  const q = useArtifactFamilyByName(projectId!, name);
  const navigate = useNavigate();
  if (q.isLoading) return <p className="text-fg-muted">Loading…</p>;
  if (q.isError)
    return (
      <div className="card p-4 text-sm">
        <p className="text-status-failed">{errorText(q.error)}</p>
        <button type="button" className="btn mt-2" onClick={() => navigate(explorerPath(projectId!))}>
          All artifacts
        </button>
      </div>
    );
  const latest = q.data?.versions[0];
  if (!latest) return <p className="text-fg-muted">{name} has no versions.</p>;
  return <Navigate to={explorerPath(projectId!, name, latest.version)} replace />;
}
