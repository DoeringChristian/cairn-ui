import { lazy, Suspense, useState, type ReactNode } from "react";
import { Link, NavLink, useNavigate, useParams } from "react-router-dom";
import {
  useArtifactFamilyByName,
  useArtifactVersionConsumers,
  useArtifactVersionFiles,
  useCanEdit,
  useUpdateArtifactFamily,
} from "../../api/artifact-hooks";
import { errorText } from "../../api/client";
import type { ArtifactFamilyDetail, ArtifactVersionInfo, RunStatus } from "../../api/types";
import CopyButton from "../../components/artifacts/CopyButton";
import RunStatusBadge from "../../components/RunStatusBadge";
import CodeBlock from "../../components/artifacts/CodeBlock";
import {
  AliasesEditor,
  DeleteFamilyDialog,
  DeleteVersionDialog,
  DescriptionEditor,
  TagsEditor,
} from "../../components/artifacts/VersionEditors";
import { formatBytes, formatRelative } from "../../lib/format";
import { explorerPath, isVersionTab, parseVersionSegment, type VersionTab } from "../../lib/artifacts/refs";
import { usageSnippets } from "../../lib/artifacts/usage";
import { TypeBadge } from "./ExplorerLayout";
import FilesTab from "./FilesTab";
import MetadataTab from "./MetadataTab";
import VersionsTab from "./VersionsTab";

// React Flow lives in its own chunk, loaded when a graph is shown.
const LineageView = lazy(() => import("../../components/lineage/LineageView"));

const TAB_LABELS: Record<VersionTab, string> = {
  overview: "Overview",
  metadata: "Metadata",
  usage: "Usage",
  files: "Files",
  lineage: "Lineage",
  versions: "Versions",
};

/** The default tab: Usage for a version no run has used yet, else Overview. */
export function defaultTab(v: Pick<ArtifactVersionInfo, "consumer_count">): VersionTab {
  return v.consumer_count === 0 ? "usage" : "overview";
}

export default function VersionPage() {
  const { projectId, name, versionSeg, tab } = useParams<{
    projectId: string;
    name: string;
    versionSeg: string;
    tab?: string;
  }>();
  const famQ = useArtifactFamilyByName(projectId!, name);
  const versionNum = parseVersionSegment(versionSeg);
  if (famQ.isLoading) return <p className="text-fg-muted">Loading…</p>;
  if (famQ.isError || !famQ.data)
    return (
      <div className="card p-4 text-sm">
        <p className="text-status-failed">{errorText(famQ.error)}</p>
        <Link className="text-accent hover:underline" to={explorerPath(projectId!)}>
          All artifacts
        </Link>
      </div>
    );
  const family = famQ.data;
  const version = family.versions.find((v) => v.version === versionNum);
  if (!version) {
    const latest = family.versions[0];
    return (
      <div className="card p-4 text-sm" data-testid="version-missing">
        <p className="mb-2">
          <span className="mono">
            {family.name}:{versionSeg}
          </span>{" "}
          does not exist (it may have been deleted).
        </p>
        {latest ? (
          <Link className="text-accent hover:underline" to={explorerPath(projectId!, family.name, latest.version)}>
            Go to {latest.ref}
          </Link>
        ) : (
          <Link className="text-accent hover:underline" to={explorerPath(projectId!)}>
            All artifacts
          </Link>
        )}
      </div>
    );
  }
  const active: VersionTab = isVersionTab(tab) ? tab : defaultTab(version);
  return <VersionView projectId={projectId!} family={family} version={version} tab={active} />;
}

function VersionView({
  projectId,
  family,
  version,
  tab,
}: {
  projectId: string;
  family: ArtifactFamilyDetail;
  version: ArtifactVersionInfo;
  tab: VersionTab;
}) {
  const canEdit = useCanEdit();
  const navigate = useNavigate();
  const [deleting, setDeleting] = useState<"version" | "family" | null>(null);
  return (
    <div data-testid="version-view">
      <header className="mb-3 flex flex-wrap items-start gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <TypeBadge type={version.type} />
            <h1 className="mono min-w-0 break-all text-xl font-semibold" data-testid="version-title">
              <span className="text-fg-muted">{version.project_id}/</span>
              {version.name}
              <span className="text-fg-muted">:v{version.version}</span>
            </h1>
            <CopyButton text={version.qualified_ref} />
            {version.aliases.map((a) => (
              <span key={a} className="mono rounded border border-accent/40 bg-accent/5 px-1.5 py-0.5 text-[11px] text-accent">
                {a}
              </span>
            ))}
          </div>
          <p className="mt-1 text-xs text-fg-muted">
            Logged {formatRelative(version.created_at)}
            {version.producer ? (
              <>
                {" by "}
                <Link
                  className="mono text-accent hover:underline"
                  to={`/p/${version.producer.project_id ?? projectId}/r/${version.producer.id}`}
                >
                  {version.producer.name ?? version.producer.id.slice(0, 8)}
                </Link>
              </>
            ) : (
              " without a run"
            )}
            {version.step != null && <> · step <span className="mono num">{version.step}</span></>}
            {" · "}
            {version.file_count} file{version.file_count === 1 ? "" : "s"} · {formatBytes(version.size)}
            {" · "}
            {version.consumer_count} consumer{version.consumer_count === 1 ? "" : "s"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <a className="btn px-2 py-1 text-xs" href={`/api/artifact-versions/${version.id}/download`} download>
            <i className="fa-solid fa-download" aria-hidden="true" /> Download
          </a>
          {canEdit && (
            <>
              <button type="button" className="btn px-2 py-1 text-xs" onClick={() => setDeleting("version")}>
                <i className="fa-solid fa-trash" aria-hidden="true" /> Delete version
              </button>
              <button type="button" className="btn px-2 py-1 text-xs" onClick={() => setDeleting("family")}>
                Delete artifact
              </button>
            </>
          )}
        </div>
      </header>
      <nav className="mb-4 flex gap-1 overflow-x-auto whitespace-nowrap border-b border-border" role="tablist">
        {(Object.keys(TAB_LABELS) as VersionTab[]).map((t) => (
          <NavLink
            key={t}
            role="tab"
            aria-selected={t === tab}
            to={explorerPath(projectId, family.name, version.version, t)}
            className={`border-b-2 px-3 py-2 text-sm transition-colors ${
              t === tab ? "border-accent text-fg" : "border-transparent text-fg-muted hover:text-fg"
            }`}
          >
            {TAB_LABELS[t]}
            {t === "usage" && version.consumer_count === 0 && (
              <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-accent align-middle" aria-label="never used" />
            )}
          </NavLink>
        ))}
      </nav>
      {tab === "overview" && <OverviewTab projectId={projectId} family={family} version={version} />}
      {tab === "metadata" && <MetadataTab version={version} />}
      {tab === "usage" && <UsageTab projectId={projectId} version={version} />}
      {tab === "files" && <FilesTab version={version} />}
      {tab === "lineage" && (
        <div className="h-[70vh] min-h-[420px] overflow-hidden rounded-lg border border-border" data-testid="lineage-tab">
          <Suspense fallback={<p className="p-4 text-sm text-fg-muted">Loading graph…</p>}>
            <LineageView key={version.id} projectId={projectId} center={{ kind: "artifact_version", id: version.id }} />
          </Suspense>
        </div>
      )}
      {tab === "versions" && <VersionsTab projectId={projectId} family={family} current={version} />}
      <DeleteVersionDialog
        version={version}
        open={deleting === "version"}
        onClose={() => setDeleting(null)}
        onDeleted={() => {
          // The newest version left (the cached family still lists the deleted one).
          const next = family.versions.find((v) => v.id !== version.id);
          navigate(next ? explorerPath(projectId, family.name, next.version) : explorerPath(projectId), { replace: true });
        }}
      />
      <DeleteFamilyDialog
        family={family}
        open={deleting === "family"}
        onClose={() => setDeleting(null)}
        onDeleted={() => navigate(explorerPath(projectId), { replace: true })}
      />
    </div>
  );
}

function Field({ label, children, testId }: { label: string; children: ReactNode; testId?: string }) {
  return (
    <div className="grid grid-cols-1 gap-1 border-b border-border-subtle py-2.5 sm:grid-cols-[11rem_1fr] sm:gap-4" data-testid={testId}>
      <dt className="text-xs font-medium uppercase tracking-wide text-fg-muted sm:pt-0.5">{label}</dt>
      <dd className="min-w-0 text-sm">{children}</dd>
    </div>
  );
}

const DASH = <span className="text-fg-subtle">—</span>;

function OverviewTab({
  projectId,
  family,
  version,
}: {
  projectId: string;
  family: ArtifactFamilyDetail;
  version: ArtifactVersionInfo;
}) {
  const consumers = useArtifactVersionConsumers(version.id);
  return (
    <div className="flex flex-col gap-4">
      {version.consumer_count === 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-accent/40 bg-accent/5 px-4 py-3 text-sm" data-testid="unused-banner">
          <i className="fa-solid fa-circle-info text-accent" aria-hidden="true" />
          <span>No run has used this version yet.</span>
          <Link to={explorerPath(projectId, version.name, version.version, "usage")} className="font-medium text-accent hover:underline">
            See how to use it →
          </Link>
        </div>
      )}
      <dl className="card px-4 py-1">
        <Field label="Full name">
          <span className="mono break-all">{version.qualified_ref}</span> <CopyButton text={version.qualified_ref} />
        </Field>
        <Field label="Type">
          <TypeBadge type={version.type} />
        </Field>
        <Field label="Aliases" testId="field-aliases">
          <AliasesEditor version={version} />
        </Field>
        <Field label="Tags" testId="field-tags">
          <TagsEditor version={version} />
        </Field>
        <Field label="Digest">
          <span className="mono break-all text-xs">{version.digest}</span> <CopyButton text={version.digest} />
        </Field>
        <Field label="Created at">
          {new Date(version.created_at).toLocaleString()} <span className="text-fg-muted">({formatRelative(version.created_at)})</span>
        </Field>
        <Field label="Step">{version.step != null ? <span className="mono num">{version.step}</span> : DASH}</Field>
        <Field label="Description" testId="field-description">
          <DescriptionEditor version={version} />
        </Field>
        <Field label="Created by run" testId="field-producer">
          {version.producer ? (
            <span className="flex flex-wrap items-center gap-2">
              <Link className="mono text-accent hover:underline" to={`/p/${version.producer.project_id ?? projectId}/r/${version.producer.id}`}>
                {version.producer.name ?? version.producer.id}
              </Link>
              {version.producer.status && <RunStatusBadge status={version.producer.status as RunStatus} archived={version.producer.archived} />}
            </span>
          ) : version.created_by_run ? (
            <span className="mono text-fg-muted">{version.created_by_run} (deleted)</span>
          ) : (
            <span className="text-fg-muted">Logged without a run</span>
          )}
        </Field>
        <Field label="Linked to">{DASH}</Field>
        <Field label="TTL">{DASH}</Field>
        <Field label="Consumers" testId="field-consumers">
          <span className="mono num">{version.consumer_count}</span>
          {consumers.data && consumers.data.consumers.length > 0 && (
            <ul className="mt-1.5 flex flex-col gap-1">
              {consumers.data.consumers.map((c) => (
                <li key={c.run.id} className="flex flex-wrap items-center gap-2 text-xs">
                  {c.run.name !== null ? (
                    <Link className="mono text-accent hover:underline" to={`/p/${c.run.project_id ?? projectId}/r/${c.run.id}`}>
                      {c.run.name}
                    </Link>
                  ) : (
                    <span className="mono text-fg-muted">{c.run.id.slice(0, 8)} (deleted)</span>
                  )}
                  <span className="rounded border border-border bg-bg px-1.5 py-0.5 text-[10px] text-fg-muted">role: {c.role}</span>
                  {c.run.status && <RunStatusBadge status={c.run.status as RunStatus} archived={c.run.archived} />}
                  <span className="text-fg-subtle">used {formatRelative(c.used_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Field>
        <Field label="Number of files">
          <span className="mono num">{version.file_count}</span>
          {version.ref_count > 0 && (
            <span className="text-fg-muted">
              {" "}
              ({version.ref_count} reference{version.ref_count === 1 ? "" : "s"})
            </span>
          )}
        </Field>
        <Field label="Size">
          <span className="mono num">{formatBytes(version.size)}</span>
          {version.ref_count > 0 && <span className="text-fg-muted"> (uploaded files; references not counted)</span>}
        </Field>
      </dl>
      <FamilyAbout family={family} />
    </div>
  );
}

/** The artifact's own description (shared by every version). */
function FamilyAbout({ family }: { family: ArtifactFamilyDetail }) {
  const canEdit = useCanEdit();
  const update = useUpdateArtifactFamily(family.id);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(family.description ?? "");
  return (
    <section className="card px-4 py-3" data-testid="family-about">
      <div className="mb-1 flex items-center gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">About {family.name}</h2>
        <span className="text-xs text-fg-subtle">
          {family.version_count} version{family.version_count === 1 ? "" : "s"} · {formatBytes(family.total_size)} total
        </span>
        {canEdit && !editing && (
          <button
            type="button"
            className="btn ml-auto px-2 py-0.5 text-xs"
            onClick={() => {
              setDraft(family.description ?? "");
              setEditing(true);
            }}
          >
            Edit
          </button>
        )}
      </div>
      {editing ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            update.mutate(draft, { onSuccess: () => setEditing(false) });
          }}
        >
          <textarea className="input min-h-[3rem] text-sm" value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="artifact description" />
          <div className="flex gap-2">
            <button type="submit" className="btn px-2 py-0.5 text-xs" disabled={update.isPending}>
              Save
            </button>
            <button type="button" className="btn px-2 py-0.5 text-xs" onClick={() => setEditing(false)}>
              Cancel
            </button>
            {update.isError && <span className="text-xs text-status-failed">{errorText(update.error)}</span>}
          </div>
        </form>
      ) : (
        <p className="text-sm">{family.description || <span className="text-fg-subtle">No description for the artifact.</span>}</p>
      )}
    </section>
  );
}

function UsageTab({ projectId, version }: { projectId: string; version: ArtifactVersionInfo }) {
  const files = useArtifactVersionFiles(version.id);
  if (files.isLoading) return <p className="text-sm text-fg-muted">Loading…</p>;
  const snippets = usageSnippets(version, files.data?.files ?? [], projectId);
  return (
    <div className="flex max-w-4xl flex-col gap-5" data-testid="usage-tab">
      {version.consumer_count === 0 && (
        <div className="rounded-lg border border-accent/40 bg-accent/5 px-4 py-3 text-sm">
          <p className="font-semibold">{version.ref} has never been used by a run.</p>
          <p className="mt-0.5 text-fg-muted">
            Consume it with <code className="mono">run.use_artifact</code> so the lineage records which runs depend on it.
          </p>
        </div>
      )}
      {snippets.map((s) => (
        <section key={s.id} data-testid={`snippet-${s.id}`}>
          <h3 className="text-sm font-semibold">{s.title}</h3>
          <p className="mb-1.5 text-xs text-fg-muted">{s.note}</p>
          <CodeBlock code={s.code} />
        </section>
      ))}
    </div>
  );
}
