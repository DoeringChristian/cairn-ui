import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useArtifactFileText, useArtifactVersionFiles } from "../../api/artifact-hooks";
import { api, errorText } from "../../api/client";
import type { ArtifactEntryInfo, ArtifactVersionInfo } from "../../api/types";
import CodeBlock from "../../components/artifacts/CodeBlock";
import CopyButton from "../../components/artifacts/CopyButton";
import Markdown from "../../lib/markdown";
import { isBrowsableUri } from "../../lib/artifact-manifest";
import { breadcrumbs, buildFileTree, findNode, type FileTreeDir, type FileTreeNode } from "../../lib/artifacts/file-tree";
import { csvDelimiter, parseCsv, PREVIEW_BYTES, prettyJson, previewKind } from "../../lib/artifacts/preview";
import { py } from "../../lib/artifacts/usage";
import { formatBytes } from "../../lib/format";
import { langFromPath } from "../../lib/syntax-highlight";

type Node = FileTreeNode<ArtifactEntryInfo>;
type Dir = FileTreeDir<ArtifactEntryInfo>;

/** The version's files: a directory tree beside the selected file's details and preview. */
export default function FilesTab({ version }: { version: ArtifactVersionInfo }) {
  const q = useArtifactVersionFiles(version.id);
  const [params, setParams] = useSearchParams();
  const selectedPath = params.get("path") ?? "";
  const root = useMemo(() => buildFileTree(q.data?.files ?? []), [q.data]);
  const select = (path: string) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        if (path) n.set("path", path);
        else n.delete("path");
        return n;
      },
      { replace: true },
    );
  if (q.isLoading) return <p className="text-sm text-fg-muted">Loading files…</p>;
  if (q.isError) return <p className="text-sm text-status-failed">{errorText(q.error)}</p>;
  const selected = findNode(root, selectedPath) ?? root;
  return (
    <div className="flex flex-col gap-3" data-testid="files-tab">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <nav className="mono flex flex-wrap items-center gap-1 text-xs" aria-label="path">
          {breadcrumbs(selected.path).map((b, i, all) => (
            <span key={b.path} className="flex items-center gap-1">
              {i > 0 && <span className="text-fg-subtle">/</span>}
              {i === all.length - 1 ? (
                <span className="font-semibold">{b.name}</span>
              ) : (
                <button type="button" className="text-accent hover:underline" onClick={() => select(b.path)}>
                  {b.name}
                </button>
              )}
            </span>
          ))}
        </nav>
        <span className="text-xs text-fg-muted">
          {root.fileCount} file{root.fileCount === 1 ? "" : "s"}
          {root.refCount > 0 && ` (${root.refCount} reference${root.refCount === 1 ? "" : "s"})`} · {formatBytes(root.size)}
        </span>
        <a
          className="btn ml-auto px-2 py-1 text-xs"
          href={api.artifactVersionDownloadUrl(version.id)}
          download
          title={root.refCount ? "References are not included: their bytes live at their URIs" : undefined}
        >
          <i className="fa-solid fa-file-zipper" aria-hidden="true" /> Download {version.name}-v{version.version}.zip
        </a>
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[18rem_1fr]">
        <div className="card max-h-[70vh] overflow-auto py-1">
          <TreeView root={root} selected={selected.path} onSelect={select} />
        </div>
        <div className="min-w-0">
          {selected.kind === "dir" ? (
            <DirListing dir={selected} onSelect={select} />
          ) : (
            <FileDetail key={selected.path} version={version} entry={selected.entry} />
          )}
        </div>
      </div>
    </div>
  );
}

function TreeView({ root, selected, onSelect }: { root: Dir; selected: string; onSelect: (p: string) => void }) {
  // Directories on the way to the selection start open; the root's children always show.
  const [open, setOpen] = useState<Set<string>>(() => {
    const s = new Set<string>();
    const parts = selected.split("/");
    for (let i = 1; i < parts.length; i++) s.add(parts.slice(0, i).join("/"));
    return s;
  });
  const toggle = (p: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(p)) n.delete(p);
      else n.add(p);
      return n;
    });
  const render = (n: Node, depth: number) => {
    const pad = { paddingLeft: `${8 + depth * 14}px` };
    const active = n.path === selected;
    if (n.kind === "dir") {
      const isOpen = open.has(n.path);
      return (
        <li key={n.path} role="treeitem" aria-expanded={isOpen}>
          <div className={`flex items-center gap-1 pr-2 text-xs ${active ? "bg-accent/10" : "hover:bg-bg-hover"}`} style={pad}>
            <button type="button" className="w-3 text-fg-subtle" onClick={() => toggle(n.path)} aria-label={isOpen ? `collapse ${n.name}` : `expand ${n.name}`}>
              <i className={`fa-solid ${isOpen ? "fa-caret-down" : "fa-caret-right"}`} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="mono flex min-w-0 flex-1 items-center gap-1.5 py-1 text-left"
              onClick={() => {
                onSelect(n.path);
                if (!isOpen) toggle(n.path);
              }}
            >
              <i className={`fa-regular ${isOpen ? "fa-folder-open" : "fa-folder"} text-fg-muted`} aria-hidden="true" />
              <span className="truncate">{n.name}</span>
              <span className="ml-auto shrink-0 text-[10px] text-fg-subtle">{n.fileCount}</span>
            </button>
          </div>
          {isOpen && <ul role="group">{n.children.map((c) => render(c, depth + 1))}</ul>}
        </li>
      );
    }
    const ref = n.entry.digest === null;
    return (
      <li key={n.path} role="treeitem" aria-selected={active}>
        <button
          type="button"
          className={`mono flex w-full items-center gap-1.5 py-1 pr-2 text-left text-xs ${active ? "bg-accent/10 text-accent" : "hover:bg-bg-hover"}`}
          style={{ paddingLeft: `${8 + depth * 14 + 16}px` }}
          onClick={() => onSelect(n.path)}
        >
          <i className={`fa-solid ${ref ? "fa-link" : fileIcon(n.entry)} w-3 text-fg-muted`} aria-hidden="true" />
          <span className="min-w-0 truncate">{n.name}</span>
          <span className="ml-auto shrink-0 text-[10px] text-fg-subtle">{n.entry.size != null ? formatBytes(n.entry.size) : ""}</span>
        </button>
      </li>
    );
  };
  return (
    <ul role="tree" aria-label="files">
      {root.children.map((c) => render(c, 0))}
    </ul>
  );
}

function fileIcon(e: ArtifactEntryInfo): string {
  switch (previewKind(e)) {
    case "image":
      return "fa-image";
    case "markdown":
    case "text":
      return "fa-file-lines";
    case "json":
      return "fa-file-code";
    case "csv":
      return "fa-table";
    case "pickle":
      return "fa-box";
    default:
      return "fa-file";
  }
}

function DirListing({ dir, onSelect }: { dir: Dir; onSelect: (p: string) => void }) {
  if (dir.children.length === 0) return <p className="text-sm text-fg-muted">No files.</p>;
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="bg-bg-elevated text-left text-xs uppercase tracking-wide text-fg-muted">
          <tr>
            <th className="px-3 py-2">Name</th>
            <th className="px-3 py-2">Size</th>
            <th className="px-3 py-2">Type</th>
            <th className="px-3 py-2">Digest / URI</th>
          </tr>
        </thead>
        <tbody>
          {dir.children.map((c) => (
            <tr key={c.path} className="border-t border-border-subtle hover:bg-bg-elevated">
              <td className="px-3 py-1.5">
                <button type="button" className="mono text-accent hover:underline" onClick={() => onSelect(c.path)}>
                  {c.name}
                  {c.kind === "dir" ? "/" : ""}
                </button>
              </td>
              <td className="mono num px-3 py-1.5 text-fg-muted">
                {c.kind === "dir" ? formatBytes(c.size) : c.entry.size != null ? formatBytes(c.entry.size) : "—"}
              </td>
              <td className="px-3 py-1.5 text-xs text-fg-muted">
                {c.kind === "dir" ? `${c.fileCount} file${c.fileCount === 1 ? "" : "s"}` : c.entry.object_type ?? c.entry.mime ?? "—"}
              </td>
              <td className="mono max-w-[16rem] truncate px-3 py-1.5 text-xs text-fg-muted">
                {c.kind === "dir" ? "" : c.entry.digest ? c.entry.digest.slice(0, 16) : c.entry.uri}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FileDetail({ version, entry }: { version: ArtifactVersionInfo; entry: ArtifactEntryInfo }) {
  const kind = previewKind(entry);
  const url = api.artifactVersionFileUrl(version.id, entry.path);
  const name = entry.path.slice(entry.path.lastIndexOf("/") + 1);
  return (
    <div className="flex flex-col gap-3" data-testid="file-detail">
      <div className="card px-4 py-3">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h3 className="mono min-w-0 break-all text-sm font-semibold">{entry.path}</h3>
          {entry.digest !== null && (
            <a className="btn ml-auto px-2 py-0.5 text-xs" href={url} download={name} data-testid="file-download">
              <i className="fa-solid fa-download" aria-hidden="true" /> Download
            </a>
          )}
        </div>
        <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1 text-xs">
          <dt className="text-fg-muted">Size</dt>
          <dd className="mono">{entry.size != null ? `${formatBytes(entry.size)} (${entry.size.toLocaleString()} B)` : "unknown"}</dd>
          {entry.digest !== null ? (
            <>
              <dt className="text-fg-muted">Digest</dt>
              <dd className="mono break-all">
                sha256:{entry.digest} <CopyButton text={entry.digest} />
              </dd>
            </>
          ) : (
            <>
              <dt className="text-fg-muted">Reference</dt>
              <dd className="mono break-all" data-testid="reference-uri">
                {isBrowsableUri(entry.uri ?? "") ? (
                  <a className="text-accent hover:underline" href={entry.uri!} target="_blank" rel="noreferrer">
                    {entry.uri}
                  </a>
                ) : (
                  entry.uri
                )}{" "}
                <CopyButton text={entry.uri ?? ""} />
              </dd>
              {entry.etag && (
                <>
                  <dt className="text-fg-muted">ETag</dt>
                  <dd className="mono break-all">{entry.etag}</dd>
                </>
              )}
            </>
          )}
          <dt className="text-fg-muted">MIME</dt>
          <dd className="mono">{entry.mime ?? "—"}</dd>
          {entry.object_type && (
            <>
              <dt className="text-fg-muted">Logged as</dt>
              <dd className="mono">{entry.object_type}</dd>
            </>
          )}
        </dl>
      </div>
      <Preview version={version} entry={entry} kind={kind} url={url} />
    </div>
  );
}

function Preview({
  version,
  entry,
  kind,
  url,
}: {
  version: ArtifactVersionInfo;
  entry: ArtifactEntryInfo;
  kind: ReturnType<typeof previewKind>;
  url: string;
}) {
  const textual = kind === "markdown" || kind === "json" || kind === "csv" || kind === "text";
  const text = useArtifactFileText(version.id, entry.path, PREVIEW_BYTES, textual && (entry.size ?? 1) > 0);
  const cut = (entry.size ?? 0) > PREVIEW_BYTES;
  const truncatedNote = cut && (
    <p className="text-xs text-fg-muted">
      Showing the first {formatBytes(PREVIEW_BYTES)} of {formatBytes(entry.size ?? 0)}; download for the rest.
    </p>
  );

  if (kind === "reference")
    return (
      <div className="card px-4 py-3 text-sm text-fg-muted" data-testid="preview-reference">
        This entry is a reference: cairn records its URI{entry.size != null ? " and size" : ""} but does not store its
        bytes. <code className="mono">art.download()</code> copies it when cairn can read the URI (a local path,{" "}
        <code className="mono">file://</code>, or an fsspec filesystem).
      </div>
    );
  if (kind === "image")
    return (
      <div className="card cairn-checkerboard flex items-center justify-center overflow-auto p-3" data-testid="preview-image">
        <img src={url} alt={entry.path} className="max-h-[60vh] max-w-full object-contain" />
      </div>
    );
  if (kind === "pickle") {
    const m = entry.meta as Record<string, unknown>;
    return (
      <div className="card flex flex-col gap-2 px-4 py-3 text-sm" data-testid="preview-pickle">
        <p>
          A pickled Python object
          {typeof m.python_type === "string" && (
            <>
              {" "}
              of type <code className="mono">{String(m.python_module ?? "")}.{m.python_type}</code>
            </>
          )}
          . Browsers cannot unpickle it; load it in Python:
        </p>
        <CodeBlock code={`value = art.get(${py(entry.path)})`} />
        {Object.keys(m).length > 0 && (
          <dl className="grid grid-cols-[9rem_1fr] gap-x-3 gap-y-0.5 text-xs">
            {Object.entries(m).map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-fg-muted">{k}</dt>
                <dd className="mono break-all">{typeof v === "string" ? v : JSON.stringify(v)}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    );
  }
  if (kind === "binary")
    return (
      <div className="card px-4 py-3 text-sm text-fg-muted" data-testid="preview-binary">
        No preview for this file type. Download it, or read it in Python with{" "}
        <code className="mono">art.open({py(entry.path)}, "rb")</code>.
      </div>
    );
  if ((entry.size ?? 1) === 0) return <p className="text-sm text-fg-muted">Empty file.</p>;
  if (text.isLoading) return <div className="h-24 motion-safe:animate-pulse rounded bg-bg-hover" />;
  if (text.isError) return <p className="text-sm text-status-failed">{errorText(text.error)}</p>;
  const body = text.data ?? "";
  if (kind === "markdown")
    return (
      <div className="card px-5 py-4" data-testid="preview-markdown">
        {truncatedNote}
        <div className="text-sm">
          <Markdown>{body}</Markdown>
        </div>
      </div>
    );
  if (kind === "json") {
    const pretty = cut ? null : prettyJson(body);
    return (
      <div className="flex flex-col gap-1" data-testid="preview-json">
        {truncatedNote}
        <CodeBlock code={pretty ?? body} lang="json" />
      </div>
    );
  }
  if (kind === "csv") {
    // A cut file ends mid-row: drop the partial last line.
    const usable = cut ? body.slice(0, body.lastIndexOf("\n") + 1) : body;
    const { rows, truncated } = parseCsv(usable, { delimiter: csvDelimiter(entry.path), maxRows: 501 });
    const [head, ...rest] = rows;
    return (
      <div className="flex flex-col gap-1" data-testid="preview-csv">
        {(truncatedNote || truncated) && (
          <p className="text-xs text-fg-muted">Showing the first {rest.length} rows; download for the rest.</p>
        )}
        <div className="max-h-[60vh] overflow-auto rounded-lg border border-border">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-bg-elevated text-left">
              <tr>
                {(head ?? []).map((h, i) => (
                  <th key={i} className="mono whitespace-nowrap border-b border-border px-2 py-1.5 font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rest.map((r, i) => (
                <tr key={i} className="border-t border-border-subtle">
                  {r.map((c, j) => (
                    <td key={j} className="mono num whitespace-nowrap px-2 py-1">
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }
  const lang = langFromPath(entry.path);
  return (
    <div className="flex flex-col gap-1" data-testid="preview-text">
      {truncatedNote}
      {lang && body.length < 100_000 ? (
        <CodeBlock code={body} lang={lang} />
      ) : (
        <pre className="card mono max-h-[60vh] overflow-auto whitespace-pre-wrap px-3 py-2 text-xs">{body}</pre>
      )}
    </div>
  );
}
