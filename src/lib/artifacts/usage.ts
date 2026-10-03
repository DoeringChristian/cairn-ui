/**
 * Copy-ready Python for one artifact version (the Usage tab): consume it in a
 * run, read it back (`get`, `download`, `file`, `open`), read it without a run,
 * and log the next version with the `cairn.Artifact` builder. Paths in the
 * snippets are the version's own entries, so they run as pasted.
 */

import type { FileEntryLike } from "./file-tree.ts";

export interface UsageVersion {
  name: string;
  type: string;
  version: number;
  project_id: string;
  aliases: readonly string[];
  tags: readonly string[];
}

export interface UsageEntry extends FileEntryLike {
  mime?: string | null;
  object_type?: string | null;
}

export interface Snippet {
  id: "use" | "get" | "download" | "file" | "open" | "reader" | "log";
  title: string;
  /** One sentence on what it does / returns. */
  note: string;
  code: string;
}

/** A Python string literal. JSON's escapes are valid Python escapes. */
export const py = (s: string): string => JSON.stringify(s);

const TEXT_EXT = /\.(txt|md|markdown|json|jsonl|ya?ml|csv|tsv|toml|ini|cfg|py|log|xml|html?)$/i;

function isText(e: UsageEntry): boolean {
  if (e.object_type) return false;
  if (e.mime && (e.mime.startsWith("text/") || e.mime === "application/json")) return true;
  return TEXT_EXT.test(e.path);
}

/** The ref a snippet uses: `name:vN`, project-qualified when the reader is elsewhere. */
export function versionRef(v: UsageVersion, fromProject?: string): string {
  const ref = `${v.name}:v${v.version}`;
  return fromProject && fromProject !== v.project_id ? `${v.project_id}/${ref}` : ref;
}

/** The default `download()` directory, as the SDK computes it. */
export function defaultDownloadDir(v: Pick<UsageVersion, "name" | "version">): string {
  return `./artifacts/${v.name}-v${v.version}/`;
}

export function usageSnippets(
  v: UsageVersion,
  entries: readonly UsageEntry[],
  fromProject?: string,
): Snippet[] {
  const ref = versionRef(v, fromProject);
  const project = fromProject ?? v.project_id;
  const uploaded = entries.filter((e) => e.digest !== null);
  const refs = entries.filter((e) => e.digest === null);
  const out: Snippet[] = [];

  out.push({
    id: "use",
    title: "Use this version in a run",
    note: "Records the run as a consumer of exactly this version (role defaults to \"input\") and returns a cairn.ArtifactVersion.",
    code: [
      "import cairn",
      "",
      `with cairn.Run(${py(project)}) as run:`,
      `    art = run.use_artifact(${py(ref)})`,
    ].join("\n"),
  });

  // .get(): the decoded value of one entry; no path when there is only one.
  const objectEntry = entries.find((e) => e.object_type) ?? uploaded[0] ?? entries[0];
  if (objectEntry) {
    const single = entries.length === 1;
    out.push({
      id: "get",
      title: "Load a logged object",
      note: objectEntry.object_type
        ? `Returns the decoded value of ${objectEntry.path} (logged as ${objectEntry.object_type}).`
        : `Returns ${objectEntry.path} as bytes (a plain file).`,
      code: single ? "value = art.get()" : `value = art.get(${py(objectEntry.path)})`,
    });
  }

  out.push({
    id: "download",
    title: "Download every file",
    note: `Returns a pathlib.Path: ${defaultDownloadDir(v)} by default, or $CAIRN_ARTIFACT_DIR/${v.name}-v${v.version}/ when CAIRN_ARTIFACT_DIR is set. Files already there with the right digest are not fetched again.`,
    code: [
      `root = art.download()          # ${defaultDownloadDir(v)}`,
      `root = art.download("data/${v.name}")   # or a directory of your choice`,
    ].join("\n"),
  });

  const fileEntry = uploaded.find((e) => !e.object_type) ?? uploaded[0];
  if (fileEntry) {
    out.push({
      id: "file",
      title: "Download one file",
      note: "Writes the entry under the download directory and returns its pathlib.Path.",
      code: `path = art.file(${py(fileEntry.path)})`,
    });
  }

  const textEntry = uploaded.find(isText);
  const openEntry = textEntry ?? uploaded[0];
  if (openEntry) {
    out.push({
      id: "open",
      title: "Open a file without writing it to disk",
      note: textEntry ? "\"r\" reads UTF-8 text; \"rb\" bytes." : "\"rb\" reads bytes; \"r\" UTF-8 text.",
      code: [
        `with art.open(${py(openEntry.path)}, ${textEntry ? '"r"' : '"rb"'}) as f:`,
        "    data = f.read()",
      ].join("\n"),
    });
  }

  out.push({
    id: "reader",
    title: "Read it without a run",
    note: "Nothing is recorded in the lineage.",
    code: [
      "import cairn",
      "",
      `art = cairn.Reader().artifact(${py(`${v.name}:v${v.version}`)}, project=${py(v.project_id)})`,
    ].join("\n"),
  });

  out.push({
    id: "log",
    title: "Log a new version",
    note: `Each log_artifact call creates ${v.name}:v${v.version + 1} (then v${v.version + 2}, ...); "latest" moves to it, and the aliases you pass move with it.`,
    code: logSnippet(v, uploaded, refs, project),
  });
  return out;
}

function logSnippet(
  v: UsageVersion,
  uploaded: readonly UsageEntry[],
  refs: readonly UsageEntry[],
  project: string,
): string {
  const lines = ["import cairn", "", `with cairn.Run(${py(project)}) as run:`];
  lines.push(`    art = cairn.Artifact(${py(v.name)}, type=${py(v.type)})`);
  // One add_dir per top-level directory, one add_file per top-level file (a few).
  const dirs = [...new Set(uploaded.filter((e) => e.path.includes("/")).map((e) => e.path.split("/")[0]!))];
  const files = uploaded.filter((e) => !e.path.includes("/"));
  for (const d of dirs.slice(0, 2)) lines.push(`    art.add_dir(${py(`path/to/${d}`)}, name=${py(d)})`);
  for (const f of files.slice(0, 2)) lines.push(`    art.add_file(${py(`path/to/${f.path}`)})`);
  for (const r of refs.slice(0, 1)) {
    const name = r.uri && r.uri.replace(/\/+$/, "").split("/").pop() === r.path ? "" : `, name=${py(r.path)}`;
    lines.push(`    art.add_reference(${py(r.uri ?? "s3://bucket/key")}${name})`);
  }
  if (dirs.length + files.length + refs.length === 0) lines.push(`    art.add_file("path/to/file")`);
  lines.push(`    with art.new_file("notes.md") as f:`, `        f.write("what changed")`);
  const userAliases = v.aliases.filter((a) => a !== "latest");
  const args = ["art"];
  if (userAliases.length) args.push(`aliases=[${userAliases.map(py).join(", ")}]`);
  if (v.tags.length) args.push(`tags=[${v.tags.map(py).join(", ")}]`);
  if (args.length === 1) args.push(`aliases=["candidate"]`);
  lines.push(`    new = run.log_artifact(${args.join(", ")})`);
  return lines.join("\n");
}
