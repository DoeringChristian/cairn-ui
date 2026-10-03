/**
 * Which viewer shows a piece of content. One answer for every surface: a
 * card's artifact, an artifact version's file in the explorer, a table's
 * media cell. Decided from what is known before the bytes load: the cairn
 * type it was logged as (`object_type`), then its MIME type, then its file
 * extension. Pure.
 */

export type ViewerKind =
  | "image"
  | "video"
  | "audio"
  | "markdown"
  | "html"
  | "table"
  | "figure"
  | "pointcloud"
  | "mesh"
  | "boxes3d"
  /** An `.npz` archive: a mesh / point cloud when its members say so, else its arrays. */
  | "arrays"
  | "tensor"
  | "json"
  | "text"
  | "pickle"
  /** Bytes cairn does not store (an artifact entry's URI reference). */
  | "reference"
  | "binary";

/** How a table's bytes are laid out. */
export type TableFormat = "cairn" | "csv" | "tsv" | "jsonl";

export interface KindInput {
  /** A file path or name; only its extension is read. */
  path?: string | null;
  mime?: string | null;
  /** The cairn type the content was logged as (`cairn.Image` → "image"). */
  object_type?: string | null;
  /** `null` for a reference entry (no stored bytes); omitted for stored content. */
  digest?: string | null;
}

/** The lower-case extension of a path's last segment ("" when none). */
export function extensionOf(path: string | null | undefined): string {
  if (!path) return "";
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/** cairn types with a viewer of their own. */
const BY_OBJECT_TYPE: Record<string, ViewerKind> = {
  image: "image",
  video: "video",
  audio: "audio",
  markdown: "markdown",
  html: "html",
  table: "table",
  figure: "figure",
  pointcloud: "pointcloud",
  mesh: "mesh",
  boxes3d: "boxes3d",
  tensor: "tensor",
  text: "text",
  pickle: "pickle",
};

const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif", "exr", "tif", "tiff"]);
const VIDEO_EXT = new Set(["mp4", "webm", "ogv", "mov", "m4v", "mkv", "avi"]);
const AUDIO_EXT = new Set(["wav", "mp3", "ogg", "oga", "flac", "m4a", "aac", "opus"]);
const TEXT_EXT = new Set([
  "txt", "log", "py", "ts", "tsx", "js", "jsx", "mjs", "cjs", "sh", "bash", "yaml", "yml", "toml", "ini",
  "cfg", "xml", "css", "c", "h", "cpp", "hpp", "cu", "rs", "go", "java", "r", "sql", "tex", "rst", "diff",
  "patch",
]);

export function viewerKind(e: KindInput): ViewerKind {
  if (e.digest === null) return "reference";
  const byType = e.object_type ? BY_OBJECT_TYPE[e.object_type] : undefined;
  if (byType) return byType;
  const x = extensionOf(e.path);
  const mime = (e.mime ?? "").toLowerCase().split(";")[0]!.trim();
  if (x === "pkl" || x === "pickle" || mime === "application/python-pickle") return "pickle";
  if (mime.startsWith("image/") || IMAGE_EXT.has(x)) return "image";
  if (mime.startsWith("video/") || VIDEO_EXT.has(x)) return "video";
  if (mime.startsWith("audio/") || AUDIO_EXT.has(x)) return "audio";
  if (x === "md" || x === "markdown" || mime === "text/markdown") return "markdown";
  if (x === "html" || x === "htm" || mime === "text/html") return "html";
  if (x === "csv" || x === "tsv" || x === "jsonl" || x === "ndjson") return "table";
  if (mime === "text/csv" || mime === "text/tab-separated-values" || mime === "application/x-ndjson") return "table";
  if (x === "json" || mime === "application/json") return "json";
  if (x === "npy") return "tensor";
  if (x === "npz") return "arrays";
  if (mime.startsWith("text/") || TEXT_EXT.has(x)) return "text";
  return "binary";
}

/** The layout of a "table" kind's bytes. */
export function tableFormat(e: KindInput): TableFormat {
  if (e.object_type === "table") return "cairn";
  const x = extensionOf(e.path);
  const mime = (e.mime ?? "").toLowerCase();
  if (x === "tsv" || mime.startsWith("text/tab-separated-values")) return "tsv";
  if (x === "jsonl" || x === "ndjson" || mime.startsWith("application/x-ndjson")) return "jsonl";
  return "csv";
}

/** Kinds whose viewer reads the bytes as text (and so may read only the head of a big file). */
export function isTextKind(kind: ViewerKind): boolean {
  return kind === "markdown" || kind === "html" || kind === "json" || kind === "text" || kind === "table";
}

/** A Font Awesome icon for a kind (file trees, lists). */
export function kindIcon(kind: ViewerKind): string {
  switch (kind) {
    case "image":
      return "fa-image";
    case "video":
      return "fa-film";
    case "audio":
      return "fa-music";
    case "markdown":
    case "text":
      return "fa-file-lines";
    case "html":
    case "json":
      return "fa-file-code";
    case "table":
      return "fa-table";
    case "figure":
      return "fa-chart-line";
    case "pointcloud":
    case "mesh":
    case "boxes3d":
      return "fa-cube";
    case "tensor":
    case "arrays":
      return "fa-border-all";
    case "pickle":
      return "fa-box";
    case "reference":
      return "fa-link";
    default:
      return "fa-file";
  }
}

/** Which 3D viewer an `.npz` archive's members are laid out for (the 3D handlers' layouts), if any. */
export function npzSceneKind(members: readonly string[]): "mesh" | "pointcloud" | "boxes3d" | null {
  const has = new Set(members);
  if (has.has("positions") && has.has("faces")) return "mesh";
  if (has.has("points")) return "pointcloud";
  if (has.has("mins") && has.has("maxs")) return "boxes3d";
  return null;
}
