import { Link, useSearchParams } from "react-router-dom";
import { useArtifactVersionFiles } from "../../api/artifact-hooks";
import type { ArtifactEntryInfo, ArtifactFamilyDetail, ArtifactVersionInfo } from "../../api/types";
import { explorerPath } from "../../lib/artifacts/refs";
import { diffFiles, diffMetadata, formatValue, type DiffStatus } from "../../lib/artifacts/version-diff";
import { formatBytes, formatRelative } from "../../lib/format";

/**
 * Every version of the artifact, and a comparison of two of them (`?a=` the
 * base, `?b=` the other; by default the previous version against this one).
 */
export default function VersionsTab({
  projectId,
  family,
  current,
}: {
  projectId: string;
  family: ArtifactFamilyDetail;
  current: ArtifactVersionInfo;
}) {
  const [params, setParams] = useSearchParams();
  const versions = family.versions;
  const byNum = (n: number | null) => versions.find((v) => v.version === n) ?? null;
  const prev = versions.find((v) => v.version < current.version) ?? null;
  const a = byNum(params.has("a") ? Number(params.get("a")) : null) ?? (prev && prev.id !== current.id ? prev : null);
  const b = byNum(params.has("b") ? Number(params.get("b")) : null) ?? current;
  const pick = (slot: "a" | "b", v: number) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        n.set(slot, String(v));
        return n;
      },
      { replace: true },
    );
  return (
    <div className="flex flex-col gap-5" data-testid="versions-tab">
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-bg-elevated text-left text-xs uppercase tracking-wide text-fg-muted">
            <tr>
              <th className="px-2 py-2" title="compare: base">A</th>
              <th className="px-2 py-2" title="compare: other">B</th>
              <th className="px-3 py-2">Version</th>
              <th className="px-3 py-2">Aliases</th>
              <th className="px-3 py-2">Tags</th>
              <th className="px-3 py-2">Step</th>
              <th className="px-3 py-2">Files</th>
              <th className="px-3 py-2">Size</th>
              <th className="px-3 py-2">Created</th>
              <th className="px-3 py-2">Logged by</th>
              <th className="px-3 py-2">Used by</th>
            </tr>
          </thead>
          <tbody>
            {versions.map((v) => (
              <tr key={v.id} className={`border-t border-border-subtle ${v.id === current.id ? "bg-accent/5" : "hover:bg-bg-elevated"}`}>
                <td className="px-2 py-1.5">
                  <input type="radio" name="cmp-a" aria-label={`compare base v${v.version}`} checked={a?.id === v.id} onChange={() => pick("a", v.version)} />
                </td>
                <td className="px-2 py-1.5">
                  <input type="radio" name="cmp-b" aria-label={`compare other v${v.version}`} checked={b.id === v.id} onChange={() => pick("b", v.version)} />
                </td>
                <td className="px-3 py-1.5">
                  <Link to={explorerPath(projectId, family.name, v.version, "overview")} className="mono text-accent hover:underline">
                    v{v.version}
                  </Link>
                </td>
                <td className="px-3 py-1.5">
                  <Chips values={v.aliases} accent />
                </td>
                <td className="px-3 py-1.5">
                  <Chips values={v.tags} />
                </td>
                <td className="mono num px-3 py-1.5 text-fg-muted">{v.step ?? "—"}</td>
                <td className="mono num px-3 py-1.5 text-fg-muted">{v.file_count}</td>
                <td className="mono num px-3 py-1.5 text-fg-muted">{formatBytes(v.size)}</td>
                <td className="whitespace-nowrap px-3 py-1.5 text-fg-muted">{formatRelative(v.created_at)}</td>
                <td className="px-3 py-1.5">
                  {v.producer ? (
                    <Link className="mono text-xs text-accent hover:underline" to={`/p/${v.producer.project_id ?? projectId}/r/${v.producer.id}`}>
                      {v.producer.name ?? v.producer.id.slice(0, 8)}
                    </Link>
                  ) : (
                    <span className="text-fg-subtle">—</span>
                  )}
                </td>
                <td className="mono num px-3 py-1.5 text-fg-muted">{v.consumer_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {a && a.id !== b.id ? (
        <Compare a={a} b={b} />
      ) : (
        <p className="text-sm text-fg-muted">Pick two different versions (A and B) to compare them.</p>
      )}
    </div>
  );
}

function Chips({ values, accent = false }: { values: readonly string[]; accent?: boolean }) {
  if (values.length === 0) return <span className="text-fg-subtle">—</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {values.map((x) => (
        <span
          key={x}
          className={`mono rounded border px-1.5 py-0.5 text-[10px] ${accent ? "border-accent/40 bg-accent/5 text-accent" : "border-border bg-bg text-fg-muted"}`}
        >
          {x}
        </span>
      ))}
    </span>
  );
}

const STATUS_CLS: Record<DiffStatus, string> = {
  added: "text-status-completed",
  removed: "text-status-failed",
  changed: "text-status-running",
  same: "text-fg-subtle",
};

function Compare({ a, b }: { a: ArtifactVersionInfo; b: ArtifactVersionInfo }) {
  const fa = useArtifactVersionFiles(a.id);
  const fb = useArtifactVersionFiles(b.id);
  const meta = diffMetadata(a.metadata, b.metadata);
  const changedMeta = meta.filter((r) => r.status !== "same");
  const files = fa.data && fb.data ? diffFiles<ArtifactEntryInfo>(fa.data.files, fb.data.files) : null;
  return (
    <section className="flex flex-col gap-4" data-testid="version-compare">
      <h2 className="text-sm font-semibold">
        <span className="mono">v{a.version}</span> → <span className="mono">v{b.version}</span>
        <span className="ml-2 text-xs font-normal text-fg-muted">
          {a.digest === b.digest ? "identical contents (same manifest digest)" : "different contents"}
        </span>
      </h2>
      <div className="card px-4 py-3">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">
          Metadata · {changedMeta.length} of {meta.length} key{meta.length === 1 ? "" : "s"} differ
        </h3>
        {meta.length === 0 ? (
          <p className="text-sm text-fg-subtle">Neither version has metadata.</p>
        ) : (
          <table className="w-full text-xs" data-testid="metadata-diff">
            <thead className="text-left text-fg-muted">
              <tr>
                <th className="py-1 pr-3">Key</th>
                <th className="py-1 pr-3">v{a.version}</th>
                <th className="py-1 pr-3">v{b.version}</th>
                <th className="py-1">Change</th>
              </tr>
            </thead>
            <tbody>
              {meta.map((r) => (
                <tr key={r.key} className="border-t border-border-subtle" data-status={r.status}>
                  <td className="mono py-1 pr-3">{r.key}</td>
                  <td className="mono break-all py-1 pr-3 text-fg-muted">{formatValue(r.before)}</td>
                  <td className="mono break-all py-1 pr-3">{formatValue(r.after)}</td>
                  <td className={`py-1 ${STATUS_CLS[r.status]}`}>{r.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="card px-4 py-3">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">Files</h3>
        {!files ? (
          <p className="text-sm text-fg-muted">Loading…</p>
        ) : (
          <div className="flex flex-col gap-3 text-xs" data-testid="files-diff">
            <p className="text-fg-muted">
              <span className={STATUS_CLS.added}>{files.added.length} added</span> ·{" "}
              <span className={STATUS_CLS.removed}>{files.removed.length} removed</span> ·{" "}
              <span className={STATUS_CLS.changed}>{files.changed.length} changed</span> · {files.unchanged.length} unchanged
            </p>
            <FileList title="Added" cls={STATUS_CLS.added} items={files.added.map((e) => ({ path: e.path, detail: sizeOf(e) }))} />
            <FileList title="Removed" cls={STATUS_CLS.removed} items={files.removed.map((e) => ({ path: e.path, detail: sizeOf(e) }))} />
            <FileList
              title="Changed"
              cls={STATUS_CLS.changed}
              items={files.changed.map((c) => ({ path: c.path, detail: `${sizeOf(c.before)} → ${sizeOf(c.after)}` }))}
            />
          </div>
        )}
      </div>
    </section>
  );
}

const sizeOf = (e: ArtifactEntryInfo) => (e.digest === null ? `ref ${e.uri}` : e.size != null ? formatBytes(e.size) : "?");

function FileList({ title, cls, items }: { title: string; cls: string; items: Array<{ path: string; detail: string }> }) {
  if (items.length === 0) return null;
  return (
    <div>
      <h4 className={`mb-1 font-semibold ${cls}`}>{title}</h4>
      <ul className="flex flex-col gap-0.5">
        {items.map((i) => (
          <li key={i.path} className="flex gap-3">
            <span className="mono">{i.path}</span>
            <span className="text-fg-muted">{i.detail}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
