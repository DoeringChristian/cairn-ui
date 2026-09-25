/**
 * A report as LaTeX: prose cells go through the same remark pipeline the
 * app renders with (GFM + `$$` math, `singleDollarTextMath: false`, see
 * lib/markdown-math.tsx) and the resulting mdast is walked into LaTeX; each
 * cards cell becomes one figure per card, pointing at the PNG the export
 * captured for it.
 *
 * Only the things the app renders are converted: math is `$$…$$` (inline
 * inside a line, display on its own lines) and passes through verbatim as
 * `\(…\)` / `\[…\]`. A `\(` in the source is a markdown escape of `(`, not
 * math, in the app too. Raw HTML stays text, as in the app.
 *
 * Images: `cairn-asset:<hash>` (a report upload) becomes
 * `\includegraphics{assets/<hash>}`, without an extension (graphicx finds
 * the file the export wrote, `.png` or `.jpg`), and the hash is recorded in
 * `figures.assets` for the caller to fetch. Any other image URL becomes a
 * link, since the zip cannot carry it.
 */

import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import type {
  Blockquote,
  Definition,
  FootnoteDefinition,
  List,
  ListItem,
  Nodes,
  Paragraph,
  PhrasingContent,
  Root,
  RootContent,
  Table,
} from "mdast";
import type { ReportBlock } from "./types.ts";

/** One captured card: its PNG's path in the zip and the caption (the card's title). */
export interface CardFigure {
  path: string;
  caption: string;
}

/** What the export captured, and what the conversion asks it to fetch. */
export interface LatexFigures {
  /** Card id → its captured figure. A card without an entry gets a placeholder. */
  cards: Map<string, CardFigure>;
  /** Report asset hashes the converted markdown references (filled by `markdownToLatex`). */
  assets: Set<string>;
}

export function emptyFigures(): LatexFigures {
  return { cards: new Map(), assets: new Set() };
}

export const ASSET_PREFIX = "cairn-asset:";
/** Where an asset's file lives in the zip, without its extension. */
export function assetStem(hash: string): string {
  return `assets/${hash}`;
}

const ESCAPES: Record<string, string> = {
  "\\": "\\textbackslash{}",
  "{": "\\{",
  "}": "\\}",
  $: "\\$",
  "&": "\\&",
  "#": "\\#",
  "^": "\\textasciicircum{}",
  _: "\\_",
  "%": "\\%",
  "~": "\\textasciitilde{}",
};

/** Escape LaTeX's special characters in plain text. */
export function escapeLatex(text: string): string {
  return text.replace(/[\\{}$&#^_%~]/g, (c) => ESCAPES[c]!);
}

/** Escape a URL for `\href`/`\url`: only what breaks the argument. */
function escapeUrl(url: string): string {
  return url.replace(/[\\{}%#]/g, (c) => `\\${c}`);
}

const HEADINGS = ["section", "subsection", "subsubsection", "paragraph", "subparagraph", "subparagraph"];

/** Environments that are display math on their own (not wrapped in `\[…\]`). */
const DISPLAY_ENV = /^\\begin\{(equation|align|alignat|gather|multline|flalign)\*?\}/;

const CALLOUT = /^\[!([A-Za-z]+)\][ \t]*([^\n]*)(?:\n|$)/;

function parseMarkdown(md: string): Root {
  const processor = unified().use(remarkParse).use(remarkGfm).use(remarkMath, { singleDollarTextMath: false });
  return processor.runSync(processor.parse(md)) as Root;
}

interface Ctx {
  figures: LatexFigures;
  definitions: Map<string, Definition>;
  footnotes: Map<string, FootnoteDefinition>;
}

/** Convert one markdown cell to LaTeX body text. Records referenced assets in `figures.assets`. */
export function markdownToLatex(md: string, figures: LatexFigures): string {
  const root = parseMarkdown(md);
  const ctx: Ctx = { figures, definitions: new Map(), footnotes: new Map() };
  collectDefinitions(root, ctx);
  return blocks(root.children, ctx);
}

function collectDefinitions(node: Nodes, ctx: Ctx): void {
  if (node.type === "definition") ctx.definitions.set(node.identifier, node);
  if (node.type === "footnoteDefinition") ctx.footnotes.set(node.identifier, node);
  if ("children" in node) for (const c of node.children) collectDefinitions(c, ctx);
}

function blocks(nodes: RootContent[], ctx: Ctx): string {
  return nodes
    .map((n) => block(n, ctx))
    .filter((s) => s !== "")
    .join("\n\n");
}

function block(node: RootContent, ctx: Ctx): string {
  switch (node.type) {
    case "heading":
      return `\\${HEADINGS[node.depth - 1]}{${inline(node.children, ctx)}}`;
    case "paragraph":
      return inline(node.children, ctx);
    case "math":
      return DISPLAY_ENV.test(node.value.trim()) ? node.value.trim() : `\\[\n${node.value}\n\\]`;
    case "code":
      return `\\begin{verbatim}\n${node.value}\n\\end{verbatim}`;
    case "blockquote":
      return blockquote(node, ctx);
    case "list":
      return list(node, ctx);
    case "table":
      return table(node, ctx);
    case "thematicBreak":
      return "\\begin{center}\\rule{0.5\\linewidth}{0.4pt}\\end{center}";
    case "html":
      return escapeLatex(node.value);
    case "definition":
    case "footnoteDefinition":
      return "";
    default:
      return "children" in node ? blocks(node.children as RootContent[], ctx) : "";
  }
}

/** `> [!NOTE] Title` (GitHub/Obsidian callout) → a quote headed by its title. */
function blockquote(node: Blockquote, ctx: Ctx): string {
  let children = node.children;
  let title: string | null = null;
  const first = children[0];
  const lead = first?.type === "paragraph" ? first.children[0] : undefined;
  const m = lead?.type === "text" ? CALLOUT.exec(lead.value) : null;
  if (m && first?.type === "paragraph" && lead?.type === "text") {
    const kind = m[1]!.toLowerCase();
    title = m[2]!.trim() ? inline([{ type: "text", value: m[2]!.trim() }], ctx) : escapeLatex(kind[0]!.toUpperCase() + kind.slice(1));
    const rest = lead.value.slice(m[0].length);
    const para: Paragraph = { ...first, children: rest ? [{ ...lead, value: rest }, ...first.children.slice(1)] : first.children.slice(1) };
    children = para.children.length > 0 ? [para, ...children.slice(1)] : children.slice(1);
  }
  const body = blocks(children, ctx);
  const head = title !== null ? `\\textbf{${title}}${body ? "\\par\n" : ""}` : "";
  return `\\begin{quote}\n${head}${body}\n\\end{quote}`;
}

function list(node: List, ctx: Ctx): string {
  const env = node.ordered ? "enumerate" : "itemize";
  const start = node.ordered && node.start != null && node.start !== 1 ? `\\setcounter{enumi}{${node.start - 1}}\n` : "";
  const items = node.children.map((item) => listItem(item, ctx)).join("\n");
  return `\\begin{${env}}\n${start}${items}\n\\end{${env}}`;
}

function listItem(item: ListItem, ctx: Ctx): string {
  const mark = item.checked === true ? "[{[x]}] " : item.checked === false ? "[{[ ]}] " : " ";
  return `\\item${mark}${blocks(item.children, ctx)}`;
}

function table(node: Table, ctx: Ctx): string {
  const cols = Math.max(0, ...node.children.map((r) => r.children.length));
  const spec = Array.from({ length: cols }, (_, i) => {
    const a = node.align?.[i];
    return a === "center" ? "c" : a === "right" ? "r" : "l";
  }).join("");
  const row = (i: number) =>
    node.children[i]!.children.map((cell) => inline(cell.children, ctx)).join(" & ") + " \\\\";
  const lines = ["\\begin{center}", `\\begin{tabular}{${spec}}`, "\\toprule"];
  if (node.children.length > 0) lines.push(row(0), "\\midrule");
  for (let i = 1; i < node.children.length; i++) lines.push(row(i));
  lines.push("\\bottomrule", "\\end{tabular}", "\\end{center}");
  return lines.join("\n");
}

function inline(nodes: PhrasingContent[], ctx: Ctx): string {
  return nodes.map((n) => phrasing(n, ctx)).join("");
}

function phrasing(node: PhrasingContent, ctx: Ctx): string {
  switch (node.type) {
    case "text":
      return escapeLatex(node.value);
    case "emphasis":
      return `\\emph{${inline(node.children, ctx)}}`;
    case "strong":
      return `\\textbf{${inline(node.children, ctx)}}`;
    case "delete":
      return `\\sout{${inline(node.children, ctx)}}`;
    case "inlineCode":
      return `\\texttt{${escapeLatex(node.value)}}`;
    case "inlineMath":
      return `\\(${node.value}\\)`;
    case "break":
      return "\\newline\n";
    case "link":
      return `\\href{${escapeUrl(node.url)}}{${inline(node.children, ctx)}}`;
    case "linkReference": {
      const def = ctx.definitions.get(node.identifier);
      const text = inline(node.children, ctx);
      return def ? `\\href{${escapeUrl(def.url)}}{${text}}` : text;
    }
    case "image":
      return image(node.url, node.alt ?? "", ctx);
    case "imageReference": {
      const def = ctx.definitions.get(node.identifier);
      return def ? image(def.url, node.alt ?? "", ctx) : escapeLatex(node.alt ?? "");
    }
    case "footnoteReference": {
      const def = ctx.footnotes.get(node.identifier);
      return def ? `\\footnote{${blocks(def.children, ctx)}}` : "";
    }
    case "html":
      return escapeLatex(node.value);
    default: {
      // Phrasing added by a plugin (none today): keep its text.
      const other = node as Nodes;
      return "children" in other ? inline(other.children as PhrasingContent[], ctx) : "";
    }
  }
}

function image(url: string, alt: string, ctx: Ctx): string {
  if (url.startsWith(ASSET_PREFIX)) {
    const hash = url.slice(ASSET_PREFIX.length);
    if (/^[A-Za-z0-9]+$/.test(hash)) {
      ctx.figures.assets.add(hash);
      return `\\includegraphics[width=\\linewidth,height=0.6\\textheight,keepaspectratio]{${assetStem(hash)}}`;
    }
  }
  return `\\href{${escapeUrl(url)}}{${escapeLatex(alt || url)}}`;
}

const PREAMBLE = [
  "\\documentclass{article}",
  "\\usepackage[utf8]{inputenc}",
  "\\usepackage[T1]{fontenc}",
  "\\usepackage{graphicx}",
  "\\usepackage{amsmath}",
  "\\usepackage{booktabs}",
  "\\usepackage[normalem]{ulem}",
  "\\usepackage{hyperref}",
];

function cardFigure(fig: CardFigure | undefined, cardId: string): string {
  if (!fig) return `% card ${cardId}: no image captured`;
  return [
    "\\begin{figure}[htbp]",
    "\\centering",
    `\\includegraphics[width=\\linewidth,height=0.45\\textheight,keepaspectratio]{${fig.path}}`,
    `\\caption{${escapeLatex(fig.caption)}}`,
    "\\end{figure}",
  ].join("\n");
}

/** The whole report as a standalone `.tex` document. Records referenced assets in `figures.assets`. */
export function buildLatexDocument(blocks: ReportBlock[], figures: LatexFigures, opts: { title: string }): string {
  const body: string[] = [];
  for (const b of blocks) {
    if (b.type === "markdown") {
      const tex = markdownToLatex(b.text, figures);
      if (tex) body.push(tex);
    } else {
      if (b.title) body.push(`\\paragraph{${escapeLatex(b.title)}}`);
      for (const card of b.cards) body.push(cardFigure(figures.cards.get(card.id), card.id));
    }
  }
  return [
    ...PREAMBLE,
    "",
    `\\title{${escapeLatex(opts.title)}}`,
    "\\date{}",
    "",
    "\\begin{document}",
    "\\maketitle",
    "",
    ...body.flatMap((s) => [s, ""]),
    "\\end{document}",
    "",
  ].join("\n");
}
