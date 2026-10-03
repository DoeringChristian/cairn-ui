/**
 * A version's entries as a directory tree (the Files tab). Directories are
 * implied by entry paths (`train/a.png` -> dir `train`); each directory sums
 * the uploaded bytes and counts the files and references beneath it.
 */

export interface FileEntryLike {
  path: string;
  size: number | null;
  /** Null for a reference. */
  digest: string | null;
  /** Set for a reference. */
  uri: string | null;
}

export interface FileTreeDir<E extends FileEntryLike> {
  kind: "dir";
  name: string;
  /** "" for the root, else `a/b` (no trailing slash). */
  path: string;
  children: Array<FileTreeNode<E>>;
  /** Uploaded bytes below (references excluded, as the version's size). */
  size: number;
  /** Files (uploaded + references) below. */
  fileCount: number;
  refCount: number;
}

export interface FileTreeFile<E extends FileEntryLike> {
  kind: "file";
  name: string;
  path: string;
  entry: E;
}

export type FileTreeNode<E extends FileEntryLike> = FileTreeDir<E> | FileTreeFile<E>;

function newDir<E extends FileEntryLike>(name: string, path: string): FileTreeDir<E> {
  return { kind: "dir", name, path, children: [], size: 0, fileCount: 0, refCount: 0 };
}

/** The tree of `entries`: directories first, then files, each by name. */
export function buildFileTree<E extends FileEntryLike>(entries: readonly E[]): FileTreeDir<E> {
  const root = newDir<E>("", "");
  const dirs = new Map<string, FileTreeDir<E>>([["", root]]);
  const dirOf = (path: string): FileTreeDir<E> => {
    const hit = dirs.get(path);
    if (hit) return hit;
    const cut = path.lastIndexOf("/");
    const parent = dirOf(cut < 0 ? "" : path.slice(0, cut));
    const d = newDir<E>(path.slice(cut + 1), path);
    parent.children.push(d);
    dirs.set(path, d);
    return d;
  };
  for (const e of entries) {
    const cut = e.path.lastIndexOf("/");
    const parentPath = cut < 0 ? "" : e.path.slice(0, cut);
    dirOf(parentPath).children.push({ kind: "file", name: e.path.slice(cut + 1), path: e.path, entry: e });
    // Totals up the chain.
    let p: string | null = parentPath;
    while (p !== null) {
      const d = dirs.get(p)!;
      d.fileCount += 1;
      if (e.digest === null) d.refCount += 1;
      else d.size += e.size ?? 0;
      p = p === "" ? null : p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "";
    }
  }
  const sort = (d: FileTreeDir<E>) => {
    d.children.sort((a, b) =>
      a.kind !== b.kind ? (a.kind === "dir" ? -1 : 1) : a.name.localeCompare(b.name),
    );
    for (const c of d.children) if (c.kind === "dir") sort(c);
  };
  sort(root);
  return root;
}

/** The node at `path` ("" = root), or null. */
export function findNode<E extends FileEntryLike>(
  root: FileTreeDir<E>,
  path: string,
): FileTreeNode<E> | null {
  if (path === "") return root;
  let cur: FileTreeNode<E> = root;
  for (const part of path.split("/")) {
    if (cur.kind !== "dir") return null;
    const next: FileTreeNode<E> | undefined = cur.children.find((c) => c.name === part);
    if (!next) return null;
    cur = next;
  }
  return cur;
}

/** `a/b/c` -> `[{root}, {a}, {a/b}, {a/b/c}]` for a breadcrumb. */
export function breadcrumbs(path: string): Array<{ name: string; path: string }> {
  const out = [{ name: "root", path: "" }];
  if (!path) return out;
  const parts = path.split("/");
  parts.forEach((name, i) => out.push({ name, path: parts.slice(0, i + 1).join("/") }));
  return out;
}

/** Every directory path in the tree (for "expand all"). */
export function allDirPaths<E extends FileEntryLike>(root: FileTreeDir<E>): string[] {
  const out: string[] = [];
  const walk = (d: FileTreeDir<E>) => {
    if (d.path) out.push(d.path);
    for (const c of d.children) if (c.kind === "dir") walk(c);
  };
  walk(root);
  return out;
}
