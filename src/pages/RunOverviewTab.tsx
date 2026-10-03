import { useEffect, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { api } from "../api/client";
import { useRuns, useSetNotes, useSetTags, useRunInputArtifacts, useRunOutputArtifacts, useSourceTree } from "../api/hooks";
import type { ArtifactVersionInfo, MetricDef, Param, Run } from "../api/types";
import { formatBytes, safeJsonParse } from "../lib/format";
import { remoteHref } from "../lib/git-remote";
import { summaryRuleFor } from "../lib/metric-defs";
import { formatNum } from "../lib/plot-utils/types";
import { useProjectTags } from "../lib/use-project-tags";
import TagInput from "../components/TagInput";
import Markdown from "../lib/markdown";

interface Ctx {
  run: Run;
  params: Param[];
  summary: Param[];
  metricDefs: MetricDef[];
}

export default function RunOverviewTab() {
  const { run, params, summary, metricDefs } = useOutletContext<Ctx>();
  const env = safeJsonParse<Record<string, unknown>>(run.env_snapshot);
  const tags = safeJsonParse<string[]>(run.tags) ?? [];
  const cliArgs = safeJsonParse<string[]>(run.cli_args) ?? [];

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <Section title="Details">
        <DefinitionList
          rows={[
            ["Project", run.project_id],
            ["Status", run.status],
            ["Exit code", run.exit_code ?? "—"],
            ["Host", run.hostname ?? "—"],
            ["User", run.user ?? "—"],
          ]}
        />
      </Section>
      <Section title="Git">
        <DefinitionList
          rows={[
            ["Remote", <GitRemote remote={run.git_remote} />],
            ["Branch", run.git_branch ?? "—"],
            [
              "Commit",
              run.git_sha ? (
                <span className="mono text-fg">{run.git_sha.slice(0, 12)}</span>
              ) : (
                "—"
              ),
            ],
            [
              "Dirty",
              run.git_dirty === null ? "—" : run.git_dirty ? "yes" : "no",
            ],
            ["Diff", <GitDiffLink runId={run.id} />],
          ]}
        />
      </Section>
      <MetricsSection run={run} summary={summary} metricDefs={metricDefs} />
      <Section title="Tags / Notes" className="lg:col-span-2">
        <TagsEditor run={run} tags={tags} />
        <NotesEditor runId={run.id} notes={run.notes ?? ""} />
      </Section>
      <Section title={`Params (${params.length})`} className="lg:col-span-2">
        {params.length === 0 ? (
          <p className="text-sm text-fg-subtle">No params logged.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-fg-muted">
              <tr>
                <th className="pb-1 pr-4">Key</th>
                <th className="pb-1 pr-4">Type</th>
                <th className="pb-1">Value</th>
              </tr>
            </thead>
            <tbody>
              {params.map((p) => (
                <tr key={p.key} className="border-t border-border-subtle">
                  <td className="mono break-all py-1 pr-4">{p.key}</td>
                  <td className="mono py-1 pr-4 text-fg-subtle">{p.value_type}</td>
                  <td className="mono break-all py-1 text-fg-muted">{p.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
      {cliArgs.length > 0 && (
        <Section title="CLI args">
          <pre className="mono overflow-x-auto rounded bg-bg p-2 text-xs text-fg-muted">
            {cliArgs.join(" ")}
          </pre>
        </Section>
      )}
      {env && (
        <Section title="Environment snapshot">
          <DefinitionList
            rows={[
              ["Python", String(env.python_version ?? "—")],
              ["Platform", String(env.platform ?? "—")],
              [
                "CUDA",
                env.cuda_available
                  ? `yes (${env.cuda_version ?? "?"})`
                  : "no",
              ],
              [
                "GPUs",
                Array.isArray(env.gpu_names) && env.gpu_names.length > 0
                  ? (env.gpu_names as string[]).join(", ")
                  : "—",
              ],
            ]}
          />
        </Section>
      )}
      <RunArtifactsSection run={run} />
    </div>
  );
}

function GitRemote({ remote }: { remote: string | null }) {
  if (!remote) return <>—</>;
  const href = remoteHref(remote);
  if (!href) return <>{remote}</>;
  return (
    <a href={href} target="_blank" rel="noreferrer" className="text-accent hover:underline">
      {remote}
    </a>
  );
}

/** The `git diff HEAD` the SDK stores with the source snapshot of a dirty tree, as a download. */
function GitDiffLink({ runId }: { runId: string }) {
  const q = useSourceTree(runId);
  const hash = q.data?.diff_hash;
  if (!hash) return <>—</>;
  return (
    <a href={api.artifactUrl(hash)} download={`${runId}.diff`} className="text-accent hover:underline">
      diff
    </a>
  );
}

/**
 * The run's final values, as the runs table shows them: each scalar's last
 * point, a `run.track(..., summary=...)` rule's value, or an explicit
 * `run.summary(...)` key (which wins). `system.*` sampler metrics fold away.
 */
function MetricsSection({ run, summary, metricDefs }: { run: Run; summary: Param[]; metricDefs: MetricDef[] }) {
  const [showSystem, setShowSystem] = useState(false);
  const explicit = new Set(summary.map((p) => p.key));
  const all = Object.entries(run.values ?? {}).sort(([a], [b]) => a.localeCompare(b));
  const system = all.filter(([k]) => k.startsWith("system."));
  const rows = showSystem ? all : all.filter(([k]) => !k.startsWith("system."));
  const source = (key: string) =>
    explicit.has(key) ? "summary" : (summaryRuleFor(key, metricDefs) ?? "last");
  return (
    <Section title={`Metrics (${all.length - system.length})`} className="lg:col-span-2">
      {all.length === 0 ? (
        <p className="text-sm text-fg-subtle">No metrics logged.</p>
      ) : (
        <>
          {rows.length > 0 && (
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-fg-muted">
                <tr>
                  <th className="pb-1 pr-4">Name</th>
                  <th className="pb-1 pr-4">Value</th>
                  <th className="pb-1">From</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(([key, v]) => (
                  <tr key={key} className="border-t border-border-subtle">
                    <td className="mono break-all py-1 pr-4">{key}</td>
                    <td className="mono num py-1 pr-4 text-fg">
                      {v == null ? "—" : typeof v === "number" ? formatNum(v) : String(v)}
                    </td>
                    <td className="mono py-1 text-fg-subtle">{source(key)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {system.length > 0 && (
            <button
              type="button"
              onClick={() => setShowSystem((s) => !s)}
              className="mt-2 text-xs text-fg-muted hover:text-fg"
            >
              {showSystem ? "Hide" : "Show"} system metrics ({system.length})
            </button>
          )}
        </>
      )}
    </Section>
  );
}

function Section({
  title,
  children,
  className = "",
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`card min-w-0 p-4 ${className}`}>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-fg-muted">
        {title}
      </h2>
      {children}
    </section>
  );
}

function DefinitionList({ rows }: { rows: Array<[string, React.ReactNode]> }) {
  return (
    <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-fg-muted">{k}</dt>
          <dd className="mono break-words text-fg">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function TagsEditor({ run, tags }: { run: Run; tags: string[] }) {
  const mutation = useSetTags(run.id);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const runsQ = useRuns({ project: run.project_id, limit: 500 });
  const suggestions = useProjectTags(runsQ.data?.runs ?? []);

  const removeTag = (tag: string) => {
    mutation.mutate(tags.filter((t) => t !== tag));
  };

  return (
    <div className="mb-3">
      <div className="flex flex-wrap items-center gap-2">
        {tags.length === 0 && !adding ? (
          <span className="text-sm text-fg-subtle">(none)</span>
        ) : (
          tags.map((t) => (
            <span
              key={t}
              className="mono group inline-flex items-center gap-1 rounded border border-border bg-bg px-2 py-0.5 text-xs text-fg-muted"
            >
              {t}
              <button
                type="button"
                onClick={() => removeTag(t)}
                className="ml-0.5 transition-opacity hover:border-status-failed hover:text-status-failed can-hover:opacity-0 can-hover:group-hover:opacity-100"
                aria-label={`remove tag ${t}`}
              >
                &times;
              </button>
            </span>
          ))
        )}
        {adding ? (
          <TagInput
            autoFocus
            className="w-40"
            value={draft}
            onChange={setDraft}
            onCommit={(tag) => {
              if (!tags.includes(tag)) mutation.mutate([...tags, tag]);
              setDraft("");
              setAdding(false);
            }}
            onCancel={() => { setDraft(""); setAdding(false); }}
            suggestions={suggestions}
            exclude={tags}
          />
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="btn px-2 py-0.5 text-xs"
            aria-label="add tag"
          >
            +
          </button>
        )}
      </div>
      {mutation.isError && (
        <span className="text-xs text-status-failed">save failed</span>
      )}
    </div>
  );
}

function RunArtifactsSection({ run }: { run: Run }) {
  const inputsQ = useRunInputArtifacts(run.id);
  const outputsQ = useRunOutputArtifacts(run.id);

  const inputs = inputsQ.data?.inputs ?? [];
  const outputs = outputsQ.data?.outputs ?? [];

  if (inputsQ.isLoading || outputsQ.isLoading) return null;
  if (inputs.length === 0 && outputs.length === 0) return null;

  const row = (v: ArtifactVersionInfo, role?: string) => (
    <li key={v.id} className="flex flex-wrap items-center gap-2 text-sm">
      <Link to={`/p/${v.project_id}/artifacts/${v.family_id}`} className="mono text-accent hover:underline">
        {v.project_id !== run.project_id ? v.qualified_ref : v.ref}
      </Link>
      <span className="text-fg-muted text-xs">{v.type}</span>
      {v.step != null && <span className="mono text-fg-muted text-xs">step {v.step}</span>}
      <span className="mono num text-fg-muted text-xs">
        {v.file_count} file{v.file_count === 1 ? "" : "s"} · {formatBytes(v.size)}
      </span>
      {v.aliases.map((a) => (
        <span key={a} className="rounded border border-border bg-bg px-1.5 py-0.5 text-[10px] text-fg-muted">{a}</span>
      ))}
      {role && (
        <span className="rounded border border-accent/40 bg-bg px-1.5 py-0.5 text-[10px] text-accent">{role}</span>
      )}
    </li>
  );

  return (
    <Section title="Artifacts" className="lg:col-span-2">
      {outputs.length > 0 && (
        <div className="mb-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted mb-1">Logged</h3>
          <ul className="flex flex-col gap-1">{outputs.map((o) => row(o))}</ul>
        </div>
      )}
      {inputs.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted mb-1">Used</h3>
          <ul className="flex flex-col gap-1">{inputs.map((i) => row(i, i.role))}</ul>
        </div>
      )}
    </Section>
  );
}

/**
 * The run's notes: rendered as markdown (the shared pipeline, lib/markdown.tsx),
 * edited as text. Empty notes open straight in the editor.
 */
function NotesEditor({ runId, notes }: { runId: string; notes: string }) {
  const mutation = useSetNotes(runId);
  const [draft, setDraft] = useState(notes);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    setDraft(notes);
  }, [notes]);

  const dirty = draft !== notes;

  if (!editing && notes.trim()) {
    return (
      <div className="group/notes relative rounded border border-border px-3 py-2 text-sm" data-testid="run-notes">
        <button
          type="button"
          className="btn absolute right-1.5 top-1.5 px-2 py-0.5 text-xs can-hover:opacity-0 can-hover:group-hover/notes:opacity-100 focus-visible:opacity-100"
          onClick={() => setEditing(true)}
        >
          edit
        </button>
        <Markdown>{notes}</Markdown>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <textarea
        className="input min-h-[4rem] resize-y text-sm"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="(no notes — markdown, with $math$)"
        autoFocus={editing}
      />
      <div className="flex items-center gap-2">
        {dirty && (
          <button
            type="button"
            className="btn px-2 py-0.5 text-xs"
            onClick={() => mutation.mutate(draft, { onSuccess: () => setEditing(false) })}
            disabled={mutation.isPending}
          >
            {mutation.isPending ? "saving…" : "save"}
          </button>
        )}
        {editing && (
          <button
            type="button"
            className="btn px-2 py-0.5 text-xs"
            onClick={() => {
              setDraft(notes);
              setEditing(false);
            }}
          >
            {dirty ? "cancel" : "done"}
          </button>
        )}
        {mutation.isError && (
          <span className="text-xs text-status-failed">save failed</span>
        )}
      </div>
    </div>
  );
}
