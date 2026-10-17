import { isMap, isScalar, parseDocument } from "yaml";
import type { ReferenceBlock, SourceLocation } from "./clipboard";

export const TITLE_TARGET = "report-title";
export const DESCRIPTION_TARGET = "report-description";
export type HeadingSources = {title_source?: SourceLocation; description_source?: SourceLocation};
type ReferenceDocument = HeadingSources & {title: string; description?: string; blocks: ReferenceBlock[]};

export function isReportHeading(id: string): boolean {
  return id === TITLE_TARGET || id === DESCRIPTION_TARGET;
}

export function referenceBlock(document: ReferenceDocument, id: string): ReferenceBlock | undefined {
  if (id === TITLE_TARGET) return {id, text: document.title, source: document.title_source};
  if (id === DESCRIPTION_TARGET) return {id, text: document.description || "", source: document.description_source};
  return document.blocks.find(block => block.id === id);
}

export function projectSource(source: SourceLocation | undefined, slug: string): SourceLocation | undefined {
  return source && {...source, project_file: source.project_file || `reports/${slug}/${source.file}`};
}

/** Older immutable documents can recover metadata locations from their captured entry. */
export function capturedHeadingSources(text: string, file: string, expected: {title: string; description?: string}): HeadingSources {
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return {};
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (end < 0) return {};
  const header = lines.slice(1, end).join("\n");
  const parsed = parseDocument(header);
  if (parsed.errors.length || !isMap(parsed.contents)) return {};
  const sources: HeadingSources = {};
  for (const key of ["title", "description"] as const) {
    const pair = parsed.contents.items.find(pair => isScalar(pair.key) && pair.key.value === key);
    if (!pair || !isScalar(pair.key) || !pair.key.range || parsed.get(key) !== expected[key]) continue;
    const line = header.slice(0, pair.key.range[0]).split("\n").length + 1;
    sources[`${key}_source`] = {file, line};
  }
  return sources;
}

export async function loadHeadingSources(document: ReferenceDocument, documentUrl: string, signal: AbortSignal): Promise<HeadingSources> {
  if (document.title_source && (!document.description || document.description_source)) return {};
  try {
    const response = await fetch(new URL("manifest.json", documentUrl), {signal});
    if (!response.ok) return {};
    const manifest = await response.json() as {entry?: string; sources?: Record<string, unknown>};
    // An explicit manifest entry is authoritative. Old builds used a single
    // conventional entry; require its actual captured metadata to match too.
    const candidates = manifest.entry ? [manifest.entry] : Object.keys(manifest.sources || {}).filter(path => path === "report.qmd" || path === "report.md");
    if (candidates.length !== 1) return {};
    const entry = candidates[0];
    if (entry.startsWith("/") || entry.split("/").some(part => !part || part === "." || part === "..")) return {};
    const source = await fetch(new URL(`../sources/${entry.split("/").map(encodeURIComponent).join("/")}`, documentUrl), {signal});
    if (!source.ok || Number(source.headers.get("Content-Length")) > 1024 * 1024) return {};
    const text = await source.text();
    if (text.length > 1024 * 1024) return {};
    return capturedHeadingSources(text, entry, document);
  } catch {
    // A missing capture must not prevent reading the report or invent a line.
    return {};
  }
}
