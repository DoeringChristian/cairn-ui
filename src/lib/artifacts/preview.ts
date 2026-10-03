/**
 * How the Files tab previews an entry, and the CSV parser its table preview
 * uses. Text-like previews read at most `PREVIEW_BYTES` (a Range request).
 */

export type PreviewKind =
  | "reference"
  | "pickle"
  | "image"
  | "markdown"
  | "json"
  | "csv"
  | "text"
  | "binary";

export const PREVIEW_BYTES = 256 * 1024;

export interface PreviewEntry {
  path: string;
  digest: string | null;
  mime: string | null;
  object_type: string | null;
}

const ext = (path: string) => {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
};

const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif"]);
const TEXT_EXT = new Set([
  "txt", "log", "py", "ts", "tsx", "js", "sh", "yaml", "yml", "toml", "ini", "cfg", "xml",
  "html", "htm", "css", "c", "h", "cpp", "rs", "go", "java", "r", "sql", "tex", "rst", "jsonl",
]);

export function previewKind(e: PreviewEntry): PreviewKind {
  if (e.digest === null) return "reference";
  const x = ext(e.path);
  const mime = (e.mime ?? "").toLowerCase();
  if (e.object_type === "pickle" || x === "pkl" || x === "pickle" || mime === "application/python-pickle") {
    return "pickle";
  }
  if (mime.startsWith("image/") || IMAGE_EXT.has(x)) return "image";
  if (x === "md" || x === "markdown" || mime === "text/markdown") return "markdown";
  if (x === "json" || mime === "application/json") return "json";
  if (x === "csv" || x === "tsv" || mime === "text/csv" || mime === "text/tab-separated-values") return "csv";
  if (mime.startsWith("text/") || TEXT_EXT.has(x)) return "text";
  return "binary";
}

/** The delimiter for a CSV-like file: tab for `.tsv`, else comma. */
export function csvDelimiter(path: string): string {
  return ext(path) === "tsv" ? "\t" : ",";
}

/**
 * RFC 4180 CSV: quoted fields (with `""` escapes and embedded newlines),
 * CRLF or LF. At most `maxRows` rows; `truncated` when there were more (or
 * the text ended mid-row because it was cut).
 */
export function parseCsv(
  text: string,
  { delimiter = ",", maxRows = 500 }: { delimiter?: string; maxRows?: number } = {},
): { rows: string[][]; truncated: boolean } {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = 0;
  const endRow = () => {
    row.push(field);
    rows.push(row);
    row = [];
    field = "";
  };
  while (i < text.length) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
      } else {
        field += c;
      }
      i += 1;
      continue;
    }
    if (c === '"' && field === "") quoted = true;
    else if (c === delimiter) {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i += 1;
      endRow();
      if (rows.length > maxRows) return { rows: rows.slice(0, maxRows), truncated: true };
    } else field += c;
    i += 1;
  }
  if (field !== "" || row.length > 0) endRow();
  if (rows.length > maxRows) return { rows: rows.slice(0, maxRows), truncated: true };
  return { rows, truncated: quoted };
}

/** Pretty JSON, or null when `text` is not JSON. */
export function prettyJson(text: string): string | null {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return null;
  }
}
