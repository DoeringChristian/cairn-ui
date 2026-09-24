/**
 * Multi-file artifacts: a version whose blob is a manifest naming its files
 * (uploaded, by hash) and external references (by URI). Same wire constant as
 * the SDK's `cairn.sdk.artifact_dir.MANIFEST_MIME`.
 */

export const MANIFEST_MIME = "application/vnd.cairn.artifact-manifest+json";

export type ManifestEntry =
  | { path: string; hash: string; size: number; mime: string }
  | { path: string; uri: string; size?: number; etag?: string };

export interface Manifest {
  files: ManifestEntry[];
}

export interface TreeDir {
  kind: "dir";
  name: string;
  children: TreeNode[];
}

export interface TreeFile {
  kind: "file";
  name: string;
  entry: ManifestEntry;
}

export type TreeNode = TreeDir | TreeFile;

/** Entries as a directory tree: directories first, then files, each by name. */
export function manifestTree(entries: ManifestEntry[]): TreeNode[] {
  const root: TreeDir = { kind: "dir", name: "", children: [] };
  for (const entry of entries) {
    const parts = entry.path.split("/").filter(Boolean);
    let dir = root;
    for (const part of parts.slice(0, -1)) {
      let next = dir.children.find((c): c is TreeDir => c.kind === "dir" && c.name === part);
      if (!next) {
        next = { kind: "dir", name: part, children: [] };
        dir.children.push(next);
      }
      dir = next;
    }
    dir.children.push({ kind: "file", name: parts[parts.length - 1] ?? entry.path, entry });
  }
  const sort = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "dir" ? -1 : 1));
    for (const n of nodes) if (n.kind === "dir") sort(n.children);
  };
  sort(root.children);
  return root.children;
}

/** An external reference's URI is a link only when a browser can open it. */
export function isBrowsableUri(uri: string): boolean {
  return /^https?:\/\//i.test(uri);
}
