import { useEffect, useState } from "react";
import { Link, useLocation, useOutletContext } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { useMetricRules, useRuns, useSetNotes, useSetTags, useRunInputArtifacts, useRunOutputArtifacts, useRunRelations, useSourceTree } from "../api/hooks";
import type { ArtifactVersionInfo, Param, Run } from "../api/types";
import { groupWorkspacePath } from "../components/runs-table/RunsTableParts";
import TagInput from "../components/TagInput";
import { copyText } from "../lib/clipboard";
import { formatBytes, formatDuration, safeJsonParse } from "../lib/format";
import { remoteHref } from "../lib/git-remote";
import { galleryQuery } from "../lib/media/gallery-query";
import { isGalleryMedia, summaryMediaLabel, type SummaryMedia } from "../lib/media/summary-media";
import { formatValue } from "../lib/plot-utils/format";
import { collapseRelations, commandLine, configRows, filterRows, relationItems, summaryRows, type RelationItem, type SummaryRow } from "../lib/run-overview";
import { useProjectTags } from "../lib/use-project-tags";
import { explorerPath } from "../lib/artifacts/refs";
import Markdown from "../lib/markdown";

interface Ctx {
  run: Run;
  params: Param[];
  summary: Param[];
  /** The summary as logged (nested), media values as `$media` markers. */
  summaryDoc: Record<string, unknown>;
}

/**
 * The run page's Overview (as wandb's): one "Run" block of what the run is
 * (notes, tags, state, group, job type, version, times, author, host, git,
 * command, path), the
 * config and the summary side by side, each with a key search, and the
 * artifacts it logged and used.
 */
export default function RunOverviewTab() {
  const { run, params, summary, summaryDoc } = useOutletContext<Ctx>();
  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold">Overview</h2>
      <RunBlock run={run} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ConfigTable params={params} />
        <SummaryTable run={run} summary={summary} summaryDoc={summaryDoc} />
      </div>
      <RunArtifactsSection run={run} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// The Run block
// ---------------------------------------------------------------------------

const DASH = <span className="text-fg-subtle">—</span>;

function startTime(iso: string): string {
  const d = new Date(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
    hour: "2-digit",
    minute: "2-digit",
  });
}

function RunBlock({ run }: { run: Run }) {
  const projectId = run.project_id;
  const env = safeJsonParse<Record<string, unknown>>(run.env_snapshot);
  const tags = safeJsonParse<string[]>(run.tags) ?? [];
  const argv = safeJsonParse<string[]>(run.cli_args) ?? [];
  const os = typeof env?.platform === "string" ? env.platform : null;
  const python = typeof env?.python_version === "string" ? env.python_version : null;
  const osPython = os || python ? [os, python].filter(Boolean).join(" · ") : null;
  const state = `${run.status}${run.exit_code != null ? ` (exit ${run.exit_code})` : ""}`;
  const runPath = `${run.project_id}/${run.id}`;
  return (
    <Section title="Run">
      <dl className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm" data-testid="run-block">
        <Field label="Notes">
          <NotesEditor runId={run.id} notes={run.notes ?? ""} />
        </Field>
        <Field label="Tags">
          <TagsEditor run={run} tags={tags} />
        </Field>
        <Field label="State">
          <Pair
            left={<span className="mono">{state}</span>}
            right={[
              [
                "Group",
                run.group != null && projectId ? (
                  <Link to={groupWorkspacePath(projectId, run.group)} className="mono text-accent hover:underline" title={`Show only ${run.group} in the workspace`}>
                    {run.group} ↗
                  </Link>
                ) : (
                  DASH
                ),
              ],
              ["Job type", run.job_type != null ? <span className="mono">{run.job_type}</span> : DASH],
              ["Version", run.version != null ? <span className="mono num">v{run.version}</span> : DASH],
            ]}
          />
        </Field>
        <Field label="Start time">
          <Pair
            left={<span title={run.created_at}>{startTime(run.created_at)}</span>}
            right={[["Duration", <span className="mono num">{formatDuration(run.created_at, run.ended_at)}</span>]]}
          />
        </Field>
        <Field label="Author">
          <Pair
            left={run.user ? <span className="mono">{run.user}</span> : DASH}
            right={[
              ["Host", run.hostname ? <span className="mono break-all">{run.hostname}</span> : DASH],
              ["OS / Python", osPython ? <span className="mono break-all">{osPython}</span> : DASH],
            ]}
          />
        </Field>
        <Field label="Git">
          <GitLine run={run} />
        </Field>
        <Field label="Command">
          {argv.length ? <code className="mono break-all text-fg">{commandLine(argv)}</code> : DASH}
        </Field>
        <Field label="Run path">
          <span className="inline-flex flex-wrap items-center gap-2">
            <span className="mono break-all">{runPath}</span>
            <CopyButton text={runPath} />
          </span>
        </Field>
        <RelationsRows run={run} />
      </dl>
    </Section>
  );
}

/** `Inputs ← …` and `Used by → …`, each left out when empty. */
function RelationsRows({ run }: { run: Run }) {
  const q = useRunRelations(run.id, run.status === "running");
  if (!q.data) return null;
  const inputs = relationItems(run.project_id, q.data.inputs.runs, q.data.inputs.artifacts);
  const usedBy = relationItems(run.project_id, q.data.used_by.runs);
  return (
    <>
      {inputs.length > 0 && (
        <Field label="Inputs">
          <RelationList arrow="←" items={inputs} testId="run-inputs" />
        </Field>
      )}
      {usedBy.length > 0 && (
        <Field label="Used by">
          <RelationList arrow="→" items={usedBy} testId="run-used-by" />
        </Field>
      )}
    </>
  );
}

function RelationList({ arrow, items, testId }: { arrow: string; items: RelationItem[]; testId: string }) {
  const [expanded, setExpanded] = useState(false);
  const { items: shown, more } = collapseRelations(items, expanded);
  return (
    <span className="inline-flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-1" data-testid={testId}>
      <span className="text-fg-subtle" aria-hidden>{arrow}</span>
      {shown.map((it, i) => (
        <span key={it.key} className="inline-flex items-baseline gap-1.5">
          {i > 0 && <span className="text-fg-subtle">·</span>}
          <Link to={it.href} className="mono break-all text-accent hover:underline">
            {it.label}
          </Link>
          {it.otherProject && <span className="text-xs text-fg-subtle">(other project)</span>}
        </span>
      ))}
      {more > 0 && (
        <button type="button" className="text-xs text-fg-muted hover:text-accent" onClick={() => setExpanded(true)}>
          +{more} more
        </button>
      )}
    </span>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="contents">
      <dt className="pt-0.5 text-fg-muted">{label}</dt>
      <dd className="min-w-0 text-fg">{children}</dd>
    </div>
  );
}

/** One value, then more labelled ones in a second column (wrapping below on a phone). */
function Pair({ left, right }: { left: React.ReactNode; right: Array<[string, React.ReactNode]> }) {
  return (
    <div className="grid grid-cols-1 gap-x-6 gap-y-1 md:grid-cols-2">
      <div className="min-w-0">{left}</div>
      <div className="flex min-w-0 flex-wrap gap-x-6 gap-y-1">
        {right.map(([label, value]) => (
          <span key={label} className="inline-flex min-w-0 gap-3">
            <span className="text-fg-muted">{label}</span>
            {value}
          </span>
        ))}
      </div>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="btn px-2 py-0.5 text-xs"
      onClick={() => {
        void copyText(text).then((ok) => {
          setCopied(ok);
          if (ok) setTimeout(() => setCopied(false), 1500);
        });
      }}
      title={`Copy ${text}`}
    >
      {copied ? "copied" : "copy"}
    </button>
  );
}

/** remote · branch · commit (dirty) [diff] */
function GitLine({ run }: { run: Run }) {
  const parts: React.ReactNode[] = [];
  if (run.git_remote) {
    const href = remoteHref(run.git_remote);
    parts.push(
      href ? (
        <a key="remote" href={href} target="_blank" rel="noreferrer" className="text-accent hover:underline">
          {run.git_remote}
        </a>
      ) : (
        <span key="remote">{run.git_remote}</span>
      ),
    );
  }
  if (run.git_branch) parts.push(<span key="branch">{run.git_branch}</span>);
  if (run.git_sha) {
    parts.push(
      <span key="sha" title={run.git_sha}>
        {run.git_sha.slice(0, 12)}
        {run.git_dirty ? <span className="text-status-running"> (dirty)</span> : null}
      </span>,
    );
  }
  if (parts.length === 0) return DASH;
  return (
    <span className="mono inline-flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 break-all">
      {parts.flatMap((p, i) => (i ? [<span key={`dot${i}`} className="text-fg-subtle">·</span>, p] : [p]))}
      <GitDiffLink runId={run.id} />
    </span>
  );
}

/** The `git diff HEAD` the SDK stores with the source snapshot of a dirty tree, as a download. */
function GitDiffLink({ runId }: { runId: string }) {
  const q = useSourceTree(runId);
  const hash = q.data?.diff_hash;
  if (!hash) return null;
  return (
    <a href={api.artifactUrl(hash)} download={`${runId}.diff`} className="btn ml-1 px-2 py-0.5 text-xs">
      diff
    </a>
  );
}

// ---------------------------------------------------------------------------
// Config and Summary
// ---------------------------------------------------------------------------

function SearchBox({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <input
      type="search"
      className="input w-36 py-0.5 text-xs normal-case tracking-normal sm:w-44"
      placeholder="search"
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function KeyValueTable({ rows, empty, testId }: { rows: Array<{ key: string; value: React.ReactNode; note?: React.ReactNode }>; empty: string; testId: string }) {
  if (rows.length === 0) return <p className="text-sm text-fg-subtle">{empty}</p>;
  return (
    <table className="w-full table-fixed text-sm" data-testid={testId}>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key} className="border-t border-border-subtle first:border-t-0">
            <td className="mono w-1/2 break-all py-1 pr-4 align-top text-fg-muted">{r.key}</td>
            <td className="mono num break-all py-1 align-top text-fg">
              {r.value}
              {r.note ? <span className="ml-2 text-xs text-fg-subtle">{r.note}</span> : null}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ConfigTable({ params }: { params: Param[] }) {
  const [query, setQuery] = useState("");
  const all = configRows(params);
  const rows = filterRows(all, query);
  return (
    <Section title={`Config (${all.length})`} right={all.length > 0 ? <SearchBox value={query} onChange={setQuery} label="Search config" /> : undefined}>
      <KeyValueTable
        testId="run-config"
        empty={all.length === 0 ? "No config." : "No key matches."}
        rows={rows.map((r) => ({ key: r.key, value: formatValue(r.value, { exact: true }) }))}
      />
    </Section>
  );
}

function SummaryTable({ run, summary, summaryDoc }: { run: Run; summary: Param[]; summaryDoc: Record<string, unknown> }) {
  const [query, setQuery] = useState("");
  const ruleOf = useMetricRules(run.project_id);
  const all = summaryRows(run.values ?? {}, summaryDoc, summary, ruleOf);
  const rows = filterRows(all, query);
  return (
    <Section title={`Summary (${all.length})`} right={all.length > 0 ? <SearchBox value={query} onChange={setQuery} label="Search summary" /> : undefined}>
      <KeyValueTable
        testId="run-summary"
        empty={all.length === 0 ? "No metrics logged." : "No key matches."}
        rows={rows.map((r: SummaryRow) => ({
          key: r.key,
          value: r.media ? <SummaryMediaValue name={r.key} media={r.media} /> : formatValue(r.value),
          note: r.media ? undefined : `(${r.source})`,
        }))}
      />
    </Section>
  );
}

/** A media value of the summary: its kind ("figure", "6 images"), linking to its card in the Workspace tab. */
function SummaryMediaValue({ name, media }: { name: string; media: SummaryMedia }) {
  // The run page's history state (opened from the workspace: its back link) goes along.
  const location = useLocation();
  const gallery = useQuery({ ...galleryQuery(media.hash), enabled: isGalleryMedia(media) });
  return (
    <span className="inline-flex min-w-0 flex-wrap items-baseline gap-1.5 text-fg-muted" data-summary-media={name}>
      <span>{summaryMediaLabel(media, gallery.data)}</span>
      <span aria-hidden="true">·</span>
      <Link
        // The run's Workspace tab, relative: the same under the app and an embed (/embed/run/<id>).
        to={{ pathname: "..", search: `?card=${encodeURIComponent(name)}` }}
        relative="path"
        state={location.state}
        className="text-xs text-fg-subtle hover:text-accent hover:underline"
      >
        show in Workspace
      </Link>
    </span>
  );
}

// ---------------------------------------------------------------------------

function Section({
  title,
  right,
  children,
  className = "",
}: {
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`card min-w-0 p-4 ${className}`}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-fg-muted">{title}</h3>
        {right}
      </div>
      {children}
    </section>
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
      <Link to={explorerPath(v.project_id, v.name, v.version)} className="mono text-accent hover:underline">
        {v.project_id !== run.project_id ? v.qualified_ref : v.ref}
      </Link>
      <span className="text-xs text-fg-muted">{v.type}</span>
      {v.step != null && <span className="mono text-xs text-fg-muted">step {v.step}</span>}
      <span className="mono num text-xs text-fg-muted">
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
    <Section title="Artifacts">
      <dl className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm" data-testid="run-artifacts">
        <Field label="Outputs">
          {outputs.length > 0 ? <ul className="flex flex-col gap-1">{outputs.map((o) => row(o))}</ul> : DASH}
        </Field>
        <Field label="Inputs">
          {inputs.length > 0 ? <ul className="flex flex-col gap-1">{inputs.map((i) => row(i, i.role))}</ul> : DASH}
        </Field>
      </dl>
    </Section>
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
    <div>
      <div className="flex flex-wrap items-center gap-2">
        {tags.map((t) => (
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
        ))}
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
            + add
          </button>
        )}
      </div>
      {mutation.isError && (
        <span className="text-xs text-status-failed">save failed</span>
      )}
    </div>
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
        placeholder="add notes… (markdown, with $math$)"
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
