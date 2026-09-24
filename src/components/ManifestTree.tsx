import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { formatBytes } from "../lib/format";
import { isBrowsableUri, manifestTree, type Manifest, type TreeNode } from "../lib/artifact-manifest";

/**
 * The files of a multi-file artifact version, as a tree. Uploaded files
 * download individually; external references show their URI (a link when a
 * browser can open it).
 */
export default function ManifestTree({ hash }: { hash: string }) {
  const q = useQuery({
    queryKey: ["artifact-manifest", hash],
    staleTime: Infinity,
    queryFn: async () => {
      const r = await fetch(api.artifactUrl(hash));
      if (!r.ok) throw new Error(`fetch failed (${r.status})`);
      return (await r.json()) as Manifest;
    },
  });
  if (q.isLoading) return <div className="h-12 motion-safe:animate-pulse rounded bg-bg-hover" />;
  if (q.isError || !q.data) return <p className="text-xs text-status-failed">Failed to load the file list.</p>;
  if (q.data.files.length === 0) return <p className="text-xs text-fg-subtle">No files.</p>;
  return (
    <ul className="text-xs">
      {manifestTree(q.data.files).map((n) => <Node key={n.name} node={n} depth={0} />)}
    </ul>
  );
}

function Node({ node, depth }: { node: TreeNode; depth: number }) {
  const indent = { paddingLeft: `${depth * 1.25}rem` };
  if (node.kind === "dir") {
    return (
      <li>
        <div className="mono flex items-center gap-1.5 py-0.5 text-fg-muted" style={indent}>
          <i className="fa-regular fa-folder" aria-hidden="true" />
          {node.name}/
        </div>
        <ul>{node.children.map((c) => <Node key={c.name} node={c} depth={depth + 1} />)}</ul>
      </li>
    );
  }
  const e = node.entry;
  return (
    <li className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 py-0.5 hover:bg-bg-hover" style={indent}>
      <span className="mono inline-flex min-w-0 items-center gap-1.5 break-all text-fg">
        <i className={`fa-regular ${"uri" in e ? "fa-share-from-square" : "fa-file"} text-fg-subtle`} aria-hidden="true" />
        {node.name}
      </span>
      {e.size !== undefined && <span className="mono num text-fg-muted">{formatBytes(e.size)}</span>}
      {"uri" in e ? (
        isBrowsableUri(e.uri)
          ? <a href={e.uri} target="_blank" rel="noreferrer" className="mono break-all text-accent hover:underline">{e.uri}</a>
          : <span className="mono break-all text-fg-muted" title="external reference">{e.uri}</span>
      ) : (
        <a
          href={api.artifactUrl(e.hash)}
          download={node.name}
          className="inline-flex items-center gap-1 text-accent hover:underline"
          title={e.hash}
        >
          <i className="fa-solid fa-arrow-down" aria-hidden="true" /> download
        </a>
      )}
    </li>
  );
}
