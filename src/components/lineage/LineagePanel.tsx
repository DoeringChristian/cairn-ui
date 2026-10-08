import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { invalidateArtifacts, useArtifactVersion, useCanEdit } from "../../api/artifact-hooks";
import { useRun, useSetTags } from "../../api/hooks";
import type { LineageRunNode, LineageVersionNode, RunStatus } from "../../api/types";
import type { ModelGraph, ViewGroupNode, ViewNode } from "../../lib/lineage/graph-model";
import { explorerPath } from "../../lib/artifacts/refs";
import { formatBytes, formatRelative, safeJsonParse } from "../../lib/format";
import ChipEditor from "../artifacts/ChipEditor";
import { AliasesEditor, DescriptionEditor, TagsEditor } from "../artifacts/VersionEditors";
import RunStatusBadge from "../RunStatusBadge";
import { groupPagePath } from "../runs-table/RunsTableParts";
import ConfigTree from "../viewers/ConfigTree";
import { TypeBadgeInline } from "./TypeBadgeInline";

export interface PanelActions {
  onExpand: (id: string, direction: "upstream" | "downstream") => void;
  onExpandGroup: (key: string) => void;
  onCollapseGroup: (key: string) => void;
  onSelect: (id: string | null) => void;
  hidden: (id: string) => { up: number; down: number };
  /** The (expanded) sibling group a raw node belongs to, if any. */
  groupOf: (id: string) => string | null;
}

/** The details of the selected node, with its actions, beside the graph. */
export default function LineagePanel({
  node,
  model,
  projectId,
  actions,
}: {
  node: ViewNode;
  model: ModelGraph;
  projectId: string;
  actions: PanelActions;
}) {
  return (
    <aside
      className="absolute bottom-2 right-2 top-2 z-10 flex w-[340px] max-w-[calc(100%-1rem)] flex-col overflow-hidden rounded-lg border border-border bg-bg shadow-lg"
      data-testid="lineage-panel"
      aria-label="node details"
    >
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
          {node.kind === "run" ? "Run" : node.kind === "artifact_version" ? "Artifact version" : "Group"}
        </span>
        <button
          type="button"
          className="h-6 w-6 rounded text-fg-muted hover:bg-bg-hover hover:text-fg"
          aria-label="close panel"
          onClick={() => actions.onSelect(null)}
        >
          {"×"}
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 text-sm">
        {node.kind === "run" && <RunDetails node={node} projectId={projectId} actions={actions} />}
        {node.kind === "artifact_version" && <VersionDetails node={node} projectId={projectId} actions={actions} />}
        {node.kind === "group" && <GroupDetails node={node} model={model} actions={actions} />}
      </div>
    </aside>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[6.5rem_1fr] gap-2 py-1">
      <dt className="text-xs text-fg-muted">{label}</dt>
      <dd className="min-w-0 text-xs">{children}</dd>
    </div>
  );
}

function ExpandActions({ id, actions }: { id: string; actions: PanelActions }) {
  const h = actions.hidden(id);
  const group = actions.groupOf(id);
  return (
    <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">
      <button type="button" className="btn px-2 py-1 text-xs" disabled={h.up === 0} onClick={() => actions.onExpand(id, "upstream")}>
        <i className="fa-solid fa-arrow-left" aria-hidden="true" /> Upstream{h.up ? ` (+${h.up})` : ""}
      </button>
      <button type="button" className="btn px-2 py-1 text-xs" disabled={h.down === 0} onClick={() => actions.onExpand(id, "downstream")}>
        Downstream{h.down ? ` (+${h.down})` : ""} <i className="fa-solid fa-arrow-right" aria-hidden="true" />
      </button>
      {group && (
        <button type="button" className="btn px-2 py-1 text-xs" onClick={() => actions.onCollapseGroup(group)}>
          <i className="fa-solid fa-layer-group" aria-hidden="true" /> Collapse siblings
        </button>
      )}
    </div>
  );
}

function RunDetails({ node, projectId, actions }: { node: LineageRunNode; projectId: string; actions: PanelActions }) {
  const q = useRun(node.id);
  const canEdit = useCanEdit();
  const setTags = useSetTags(node.id);
  const qc = useQueryClient();
  const run = q.data?.run;
  const tags = run ? (safeJsonParse<string[]>(run.tags) ?? []) : node.tags;
  const project = node.project_id ?? projectId;
  const save = (next: string[]) => setTags.mutate(next, { onSuccess: () => invalidateArtifacts(qc) });
  return (
    <div data-testid="panel-run">
      <div className="mb-2">
        <div className="mono break-all text-base font-semibold">{node.name ?? node.id}</div>
        <div className="mono break-all text-[11px] text-fg-subtle">{node.id}</div>
      </div>
      {node.deleted ? (
        <p className="text-xs text-fg-muted">This run was deleted; its lineage edges remain.</p>
      ) : (
        <dl>
          <Row label="Status">{node.status ? <RunStatusBadge status={node.status as RunStatus} archived={node.archived} /> : "—"}</Row>
          <Row label="Group">
            {node.group != null && project ? (
              <Link to={groupPagePath(project, node.group)} className="mono text-accent hover:underline">
                {node.group}
              </Link>
            ) : (
              (node.group ?? <span className="text-fg-subtle">—</span>)
            )}
          </Row>
          <Row label="Job type">{node.job_type ?? <span className="text-fg-subtle">—</span>}</Row>
          <Row label="Created">{formatRelative(node.created_at)}</Row>
          <Row label="Tags">
            <ChipEditor
              label="tag"
              testId="panel-run-tags"
              values={tags}
              editable={canEdit}
              onAdd={(t) => !tags.includes(t) && save([...tags, t])}
              onRemove={(t) => save(tags.filter((x) => x !== t))}
              pending={setTags.isPending}
              error={setTags.error}
            />
          </Row>
          <Row label="Artifacts">
            {node.full_degree?.in ?? 0} used · {node.full_degree?.out ?? 0} logged
          </Row>
        </dl>
      )}
      {!node.deleted && (
        <div className="mt-2">
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-fg-muted">Config</h4>
          {q.isLoading ? (
            <p className="text-xs text-fg-subtle">Loading…</p>
          ) : (
            <div className="max-h-64 overflow-auto rounded border border-border-subtle bg-bg-elevated px-2 py-1" data-testid="panel-run-config">
              <ConfigTree config={q.data?.config_doc} openDepth={1} />
            </div>
          )}
          <Link className="btn mt-3 px-2 py-1 text-xs" to={`/p/${project}/r/${node.id}`}>
            Open run <i className="fa-solid fa-arrow-up-right-from-square" aria-hidden="true" />
          </Link>
        </div>
      )}
      <ExpandActions id={node.id} actions={actions} />
    </div>
  );
}

function VersionDetails({ node, projectId, actions }: { node: LineageVersionNode; projectId: string; actions: PanelActions }) {
  const q = useArtifactVersion(node.id);
  const v = q.data;
  const project = node.project_id ?? projectId;
  return (
    <div data-testid="panel-version">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <TypeBadgeInline type={node.type} />
        <span className="mono break-all text-base font-semibold">{node.qualified_ref}</span>
      </div>
      {q.isLoading || !v ? (
        <p className="text-xs text-fg-subtle">Loading…</p>
      ) : (
        <dl>
          <Row label="Aliases">
            <AliasesEditor version={v} />
          </Row>
          <Row label="Tags">
            <TagsEditor version={v} />
          </Row>
          <Row label="Description">
            <DescriptionEditor version={v} compact />
          </Row>
          <Row label="Digest">
            <span className="mono break-all">{v.digest.slice(0, 16)}…</span>
          </Row>
          <Row label="Created">{formatRelative(v.created_at)}</Row>
          <Row label="Step">{v.step ?? <span className="text-fg-subtle">—</span>}</Row>
          <Row label="Files">
            {v.file_count} · {formatBytes(v.size)}
          </Row>
          <Row label="Created by">
            {v.producer ? (
              <Link className="mono text-accent hover:underline" to={`/p/${v.producer.project_id ?? project}/r/${v.producer.id}`}>
                {v.producer.name ?? v.producer.id.slice(0, 8)}
              </Link>
            ) : (
              <span className="text-fg-subtle">no run</span>
            )}
          </Row>
          <Row label="Consumers">{v.consumer_count}</Row>
        </dl>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <Link className="btn px-2 py-1 text-xs" to={explorerPath(project, node.name, node.version, "overview")}>
          Open in explorer <i className="fa-solid fa-arrow-up-right-from-square" aria-hidden="true" />
        </Link>
        <Link className="btn px-2 py-1 text-xs" to={explorerPath(project, node.name, node.version, "files")}>
          Files
        </Link>
      </div>
      <ExpandActions id={node.id} actions={actions} />
    </div>
  );
}

function GroupDetails({ node, model, actions }: { node: ViewGroupNode; model: ModelGraph; actions: PanelActions }) {
  return (
    <div data-testid="panel-group">
      <div className="mb-1 text-base font-semibold">{node.label}</div>
      <p className="mb-3 text-xs text-fg-muted">
        {node.member_kind === "run"
          ? "Runs with the same inputs, folded into one node."
          : "Versions of one artifact from sibling producers, folded into one node."}
      </p>
      <button type="button" className="btn mb-3 px-2 py-1 text-xs" onClick={() => actions.onExpandGroup(node.group_key)}>
        <i className="fa-solid fa-up-right-and-down-left-from-center" aria-hidden="true" /> Expand group
      </button>
      <ul className="flex flex-col gap-0.5">
        {node.members.map((id) => {
          const m = model.nodes.get(id);
          return (
            <li key={id}>
              <button
                type="button"
                className="mono w-full truncate rounded px-1 py-0.5 text-left text-xs hover:bg-bg-hover"
                onClick={() => {
                  actions.onExpandGroup(node.group_key);
                  actions.onSelect(id);
                }}
              >
                {m ? m.label : id.slice(0, 8)}
                {m?.kind === "run" && m.status && <span className="ml-2 text-fg-subtle">{m.status}</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
