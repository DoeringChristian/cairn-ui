/**
 * A report as LaTeX: prose cells are parsed by the same pipeline the app
 * renders with (lib/markdown/pipeline.ts: GFM + Pandoc Markdown) and the
 * resulting mdast is walked into LaTeX; each cards cell becomes one figure
 * per card, pointing at the PNG the export captured for it.
 *
 * Math passes through verbatim: inline `$…$` / `\(…\)` as `\(…\)`, display
 * (`$$…$$`, `\[…\]`, a `$$` block) as `\[…\]`, and a math environment
 * (`\begin{align}…`) or any other raw TeX block as written. Macro blocks
 * (`\newcommand…`) are kept, `\DeclareMathOperator` turned into the
 * equivalent `\newcommand` so it works outside the preamble. Raw HTML stays
 * text, as in the app.
 *
 * Pandoc extras: footnotes (also inline `^[…]`) → `\footnote`, definition
 * lists → `description`, `^sup^`/`~sub~` → `\textsuperscript`/`\textsubscript`,
 * callouts (`> [!NOTE]`, `::: note`) → a quote headed by the title, other
 * fenced divs → their content, spans → their content (`.smallcaps` →
 * `\textsc`, `.underline` → `\uline`), implicit figures → `figure` with a
 * caption, line blocks → lines joined by `\newline`, fancy lists → the
 * matching `enumerate` labels, citations → `\cite`, header ids → `\label`
 * and `{-}` → a starred (unnumbered) section.
 *
 * Images: `cairn-asset:<hash>` (a report upload) becomes
 * `\includegraphics{assets/<hash>}`, without an extension (graphicx finds
 * the file the export wrote, `.png` or `.jpg`), and the hash is recorded in
 * `figures.assets` for the caller to fetch. Any other image URL becomes a
 * link, since the zip cannot carry it.
 */

import type {
  Blockquote,
  Definition,
  FootnoteDefinition,
  Heading,
  List,
  ListItem,
  Nodes,
  PhrasingContent,
  RootContent,
  Table,
} from "mdast";
import type { ContainerDirective } from "mdast-util-directive";
import type { DefListNode } from "mdast-util-definition-list";
import type { ReportBlock } from "./types.ts";
import { parseMarkdown } from "../markdown/pipeline.ts";
import { katexMacroSource } from "../markdown/micromark-pandoc.ts";
import { isDisplayMath, type Figure } from "../markdown/mdast-pandoc.ts";

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
      return heading(node, ctx);
    case "paragraph":
      return inline(node.children, ctx);
    case "math":
      if ((node.data as { rawTex?: boolean } | undefined)?.rawTex) return node.value;
      return DISPLAY_ENV.test(node.value.trim()) ? node.value.trim() : `\\[\n${node.value}\n\\]`;
    case "rawTex":
      return node.value;
    case "texMacros":
      return katexMacroSource(node.value);
    case "containerDirective":
      return fencedDiv(node, ctx);
    case "figure":
      return figure(node, ctx);
    case "lineBlock":
      return `\\noindent ${inline(node.children, ctx)}`;
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
    default: {
      const other = node as Nodes;
      if (other.type === ("defList" as string)) return defList(other as unknown as DefListNode, ctx);
      return "children" in other ? blocks(other.children as RootContent[], ctx) : "";
    }
  }
}

function heading(node: Heading, ctx: Ctx): string {
  const starred = (node.data as { unnumbered?: boolean } | undefined)?.unnumbered ? "*" : "";
  const id = node.data?.hProperties?.id;
  const label = typeof id === "string" ? `\\label{${escapeUrl(id)}}` : "";
  return `\\${HEADINGS[node.depth - 1]}${starred}{${inline(node.children, ctx)}}${label}`;
}

/** A quote headed by `title` (callouts). */
function quote(title: string | null, body: string): string {
  const head = title !== null ? `\\textbf{${title}}${body ? "\\par\n" : ""}` : "";
  return `\\begin{quote}\n${head}${body}\n\\end{quote}`;
}

function calloutTitle(props: Record<string, unknown> | undefined): string | null {
  const kind = props?.dataCallout;
  if (typeof kind !== "string") return null;
  const title = typeof props!.dataTitle === "string" ? props!.dataTitle.trim() : "";
  return escapeLatex(title || kind[0]!.toUpperCase() + kind.slice(1));
}

/** `::: note` → a callout quote; any other fenced div → its content. */
function fencedDiv(node: ContainerDirective, ctx: Ctx): string {
  const title = calloutTitle(node.data?.hProperties as Record<string, unknown> | undefined);
  const body = blocks(node.children, ctx);
  return title !== null ? quote(title, body) : body;
}

function defList(node: DefListNode, ctx: Ctx): string {
  const items: string[] = [];
  for (const c of node.children) {
    if (c.type === "defListTerm") items.push(`\\item[${inline(c.children, ctx)}]`);
    else items.push(blocks(c.children as RootContent[], ctx));
  }
  return `\\begin{description}\n${items.join("\n")}\n\\end{description}`;
}

function figure(node: Figure, ctx: Ctx): string {
  const [img, caption] = node.children;
  return [
    "\\begin{figure}[htbp]",
    "\\centering",
    image(img.url, img.alt ?? "", ctx),
    `\\caption{${inline(caption.children, ctx)}}`,
    "\\end{figure}",
  ].join("\n");
}

/** A blockquote, or a callout (`> [!NOTE] Title`, marked by remark-callouts) as a quote headed by its title. */
function blockquote(node: Blockquote, ctx: Ctx): string {
  return quote(calloutTitle(node.data?.hProperties as Record<string, unknown> | undefined), blocks(node.children, ctx));
}

/** `enumerate` labels of fancy lists (`a.`, `(ii)`, …), by HTML list type. */
const ENUM_LABEL: Record<string, string> = {
  a: "\\alph{enumi}.",
  A: "\\Alph{enumi}.",
  i: "\\roman{enumi}.",
  I: "\\Roman{enumi}.",
};

function list(node: List, ctx: Ctx): string {
  const env = node.ordered ? "enumerate" : "itemize";
  const start = node.ordered && node.start != null && node.start !== 1 ? `\\setcounter{enumi}{${node.start - 1}}\n` : "";
  const type = node.data?.hProperties?.type;
  const label = node.ordered && typeof type === "string" && ENUM_LABEL[type] ? `\\renewcommand{\\labelenumi}{${ENUM_LABEL[type]}}\n` : "";
  const items = node.children.map((item) => listItem(item, ctx)).join("\n");
  return `\\begin{${env}}\n${label}${start}${items}\n\\end{${env}}`;
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
      return isDisplayMath(node) ? `\\[${node.value}\\]` : `\\(${node.value}\\)`;
    case "superscript":
      return `\\textsuperscript{${inline(node.children, ctx)}}`;
    case "subscript":
      return `\\textsubscript{${inline(node.children, ctx)}}`;
    case "span": {
      const body = inline(node.children, ctx);
      return node.kind === "smallcaps" ? `\\textsc{${body}}` : node.kind === "underline" ? `\\uline{${body}}` : body;
    }
    case "citation":
      return `\\cite{${node.keys.map(escapeUrl).join(",")}}`;
    case "break":
      return "\\newline\n";
    case "link":
      // An in-document anchor (`#id`: a heading's `{#id}`) is a cross-reference.
      if (node.url.startsWith("#") && node.url.length > 1) return `\\hyperref[${escapeUrl(node.url.slice(1))}]{${inline(node.children, ctx)}}`;
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
      // Any other phrasing: keep its text.
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
  "\\usepackage{amssymb}",
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
    "\\author{}",
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
