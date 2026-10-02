/**
 * Pandoc Markdown on top of GFM: a remark plugin adding the syntax (math,
 * raw TeX, fenced divs — see micromark-pandoc.ts, preprocess.ts) and the
 * tree transforms for the rest. The support matrix lives in
 * docs/guides/media.md; in short:
 *
 * - Blocks: fenced divs (`.note`/`.tip`/`.important`/`.warning`/`.caution`,
 *   and `.callout-*`, become callouts), header attributes `{#id .class}`,
 *   implicit figures, line blocks `| …`, fancy lists (`a.`, `(ii)`, `#.`, …)
 *   and example lists `(@)` — both only as tight lists of single paragraphs.
 * - Inline: inline footnotes `^[…]`, bracketed spans `[…]{.class}`,
 *   citations `[@key]` (no bibliography: shown as written), link and image
 *   attributes, `^super^` / `~sub~`, smart punctuation.
 *
 * Attributes go through attributes.ts's allowlist (the sanitization contract).
 */

import type {
  FootnoteDefinition,
  Heading,
  Image,
  Link,
  List,
  ListItem,
  Nodes,
  Paragraph,
  Parent,
  PhrasingContent,
  Root,
  RootContent,
  Text,
} from "mdast";
import type { ContainerDirective } from "mdast-util-directive";
import type { Math } from "mdast-util-math";
import type { Construct, Extension } from "micromark-util-types";
import type { Processor } from "unified";
import { math } from "micromark-extension-math";
import { mathFromMarkdown } from "mdast-util-math";
import { directive } from "micromark-extension-directive";
import { directiveFromMarkdown } from "mdast-util-directive";
import { pandocMathFromMarkdown, pandocMathSyntax } from "./micromark-pandoc.ts";
import { attr, parseAttributes, safeProperties, splitTrailingAttributes, type PandocAttributes } from "./attributes.ts";
import { CALLOUT_KINDS, type CalloutKind } from "./remark-callouts.ts";
import type { Citation, Figure, LineBlock, Span } from "./mdast-pandoc.ts";

/* ------------------------------------------------------------ syntax */

const MATH_FLOW = math().flow![36] as Construct;
/** remark-directive's container construct only: no `::leaf` / `:text` directives (`a:b` stays text). */
const DIV_SYNTAX: Extension = { flow: { 58: [(directive().flow![58] as Construct[])[0]!] } };

export default function remarkPandoc(this: Processor) {
  const data = this.data();
  (data.micromarkExtensions ??= []).push(pandocMathSyntax(MATH_FLOW), DIV_SYNTAX);
  (data.fromMarkdownExtensions ??= []).push(mathFromMarkdown(), pandocMathFromMarkdown(), directiveFromMarkdown());
  return (tree: Root) => transformPandoc(tree);
}

/* --------------------------------------------------------- transform */

interface Ctx {
  footnotes: FootnoteDefinition[];
  /** Example label → its number. */
  examples: Map<string, number>;
  exampleCount: number;
  noteCount: number;
}

type PhrasingParent = Parent & { children: PhrasingContent[] };
type BlockParent = Parent & { children: RootContent[] };

const PHRASING_PARENTS = new Set([
  "paragraph", "heading", "tableCell", "emphasis", "strong", "delete", "link", "linkReference",
  "defListTerm", "span", "superscript", "subscript", "figureCaption", "lineBlock",
]);

export function transformPandoc(tree: Root): void {
  const ctx: Ctx = { footnotes: [], examples: new Map(), exampleCount: 0, noteCount: 0 };
  blockPrePass(tree);
  inlinePass(tree, ctx);
  paragraphPass(tree, ctx);
  if (ctx.examples.size) exampleRefs(tree, ctx);
  smartPass(tree);
  tree.children.push(...ctx.footnotes);
}

function each(node: Nodes, fn: (n: Nodes, parent: Parent | null) => void, parent: Parent | null = null): void {
  fn(node, parent);
  if ("children" in node) for (const c of [...(node.children as Nodes[])]) each(c, fn, node as Parent);
}

/* --- blocks before inline: divs, heading attributes, `$$ x` first lines */

const CALLOUT_SET = new Set<string>(CALLOUT_KINDS);

function blockPrePass(tree: Root): void {
  each(tree, (node) => {
    if (node.type === "containerDirective") fencedDiv(node);
    else if (node.type === "heading") headingAttributes(node);
    else if (node.type === "math" && node.meta) mathMeta(node);
  });
}

function directiveAttributes(node: ContainerDirective): PandocAttributes {
  const a = node.attributes ?? {};
  const classes = (a.class ?? "").split(/\s+/).filter(Boolean);
  if (node.name !== "div") classes.unshift(node.name);
  const pairs = Object.entries(a)
    .filter(([k, v]) => k !== "class" && k !== "id" && v != null)
    .map(([k, v]) => [k, v!] as [string, string]);
  return { id: a.id ?? null, classes, pairs };
}

/** A pandoc fenced div: a callout for the callout classes, else a `<div>`. */
function fencedDiv(node: ContainerDirective): void {
  const attrs = directiveAttributes(node);
  let kind: CalloutKind | undefined;
  let kindClass: string | undefined;
  for (const c of attrs.classes) {
    const k = c.toLowerCase().replace(/^callout-/, "");
    if (CALLOUT_SET.has(k)) {
      kind = k as CalloutKind;
      kindClass = c;
      break;
    }
  }
  const props = safeProperties(attrs, { except: kindClass ? [kindClass, "callout"] : [] });
  if (kind) {
    delete props.title;
    node.data = {
      ...node.data,
      hName: "blockquote",
      hProperties: { ...props, dataCallout: kind, dataFold: "", dataTitle: attr(attrs, "title") ?? "" },
    };
  } else {
    node.data = { ...node.data, hName: "div", hProperties: props };
  }
}

function headingAttributes(node: Heading): void {
  const last = node.children[node.children.length - 1];
  if (last?.type !== "text") return;
  const split = splitTrailingAttributes(last.value);
  if (!split) return;
  last.value = split.text;
  if (!last.value) node.children.pop();
  const props = safeProperties(split.attrs, { except: ["unnumbered"] });
  node.data = {
    ...node.data,
    ...(split.attrs.classes.includes("unnumbered") ? { unnumbered: true } : {}),
    hProperties: { ...(node.data?.hProperties ?? {}), ...props },
  } as Heading["data"];
}

/** `$$ a\nb\n$$`: the text after the opening `$$` is math too (remark-math reads it as "meta"). */
function mathMeta(node: Math): void {
  node.value = node.value ? `${node.meta}\n${node.value}` : node.meta!;
  node.meta = null;
  const code = node.data?.hChildren?.[0];
  if (code && code.type === "element") code.children = [{ type: "text", value: node.value }];
}

/* --- inline */

function inlinePass(node: Nodes, ctx: Ctx): void {
  if (PHRASING_PARENTS.has(node.type)) phrasing(node as PhrasingParent, ctx);
  else if ("children" in node) for (const c of node.children as Nodes[]) inlinePass(c, ctx);
}

function phrasing(parent: PhrasingParent, ctx: Ctx): void {
  brackets(parent, ctx);
  trailingAttributes(parent);
  for (const c of parent.children) if ("children" in c) phrasing(c as PhrasingParent, ctx);
  supSub(parent);
}

/** Where a `]` matching the `[` before (`i`, `from`) is, counting nested brackets in text nodes. */
function findClose(kids: PhrasingContent[], i: number, from: number): { j: number; k: number } | null {
  let depth = 0;
  for (let j = i; j < kids.length; j++) {
    const n = kids[j]!;
    if (n.type !== "text") continue;
    for (let k = j === i ? from : 0; k < n.value.length; k++) {
      const ch = n.value[k];
      if (ch === "[") depth++;
      else if (ch === "]") {
        if (depth === 0) return { j, k };
        depth--;
      }
    }
  }
  return null;
}

/** The children strictly between (`i`, `a`) and (`j`, `b`), text split at the edges. */
function between(kids: PhrasingContent[], i: number, a: number, j: number, b: number): PhrasingContent[] {
  const first = kids[i] as Text;
  if (i === j) return text(first.value.slice(a, b));
  const last = kids[j] as Text;
  return [...text(first.value.slice(a)), ...kids.slice(i + 1, j), ...text(last.value.slice(0, b))];
}
function text(value: string): Text[] {
  return value ? [{ type: "text", value }] : [];
}

const CITE_KEY = /(?:^|[\s;])-?@([\w][\w:.#$%&+?<>~/-]*[\w])|(?:^|[\s;])-?@([\w])(?=[\s,;]|$)/g;

/** `[@a; @b, p. 4]`: every `;` part names a key. */
function citationKeys(inner: PhrasingContent[]): string[] | null {
  if (!inner.every((n) => n.type === "text")) return null;
  const src = inner.map((n) => (n as Text).value).join("");
  const parts = src.split(";");
  const keys: string[] = [];
  for (const p of parts) {
    const found = [...p.matchAll(CITE_KEY)].map((m) => m[1] ?? m[2]!);
    if (found.length !== 1) return null;
    keys.push(found[0]!);
  }
  return keys.length ? keys : null;
}

/** Inline footnotes, bracketed spans and citations: `^[…]`, `[…]{…}`, `[@…]`. */
function brackets(parent: PhrasingParent, ctx: Ctx): void {
  const kids = parent.children;
  scan: for (;;) {
    for (let i = 0; i < kids.length; i++) {
      const node = kids[i]!;
      if (node.type !== "text") continue;
      for (let open = node.value.indexOf("["); open >= 0; open = node.value.indexOf("[", open + 1)) {
        const close = findClose(kids, i, open + 1);
        if (!close) continue;
        const { j, k } = close;
        const closer = kids[j] as Text;
        const after = closer.value.slice(k + 1);
        const inner = between(kids, i, open + 1, j, k);
        let replacement: PhrasingContent | null = null;
        let start = open;
        let rest = after;
        if (open > 0 && node.value[open - 1] === "^" && inner.length > 0) {
          const id = `inline-note-${++ctx.noteCount}`;
          const para: Paragraph = { type: "paragraph", children: inner };
          phrasing(para, ctx);
          ctx.footnotes.push({ type: "footnoteDefinition", identifier: id, label: id, children: [para] });
          replacement = { type: "footnoteReference", identifier: id, label: id };
          start = open - 1;
        } else {
          const attrs = /^\{([^{}\n]*)\}/.exec(after);
          const parsed = attrs ? parseAttributes(attrs[1]!) : null;
          if (parsed) {
            replacement = span(inner, parsed);
            rest = after.slice(attrs![0].length);
          } else {
            const keys = citationKeys(inner);
            if (keys) {
              const src = inner.map((n) => (n as Text).value).join("");
              replacement = {
                type: "citation",
                value: `[${src}]`,
                keys,
                data: { hName: "span", hProperties: { className: ["citation"], dataCites: keys.join(" ") }, hChildren: [{ type: "text", value: `[${src}]` }] },
              } satisfies Citation;
            }
          }
        }
        if (!replacement) continue;
        kids.splice(i, j - i + 1, ...text(node.value.slice(0, start)), replacement, ...text(rest));
        continue scan;
      }
    }
    break;
  }
}

const SPAN_KINDS: Record<string, { kind: NonNullable<Span["kind"]>; hName: string; className?: string }> = {
  smallcaps: { kind: "smallcaps", hName: "span", className: "smallcaps" },
  underline: { kind: "underline", hName: "u" },
  ul: { kind: "underline", hName: "u" },
  mark: { kind: "mark", hName: "mark" },
};

function span(children: PhrasingContent[], attrs: PandocAttributes): Span {
  const special = attrs.classes.map((c) => SPAN_KINDS[c]).find(Boolean);
  const props = safeProperties(attrs, { except: Object.keys(SPAN_KINDS) });
  if (special?.className) props.className = [special.className, ...((props.className as string[] | undefined) ?? [])];
  return {
    type: "span",
    ...(special ? { kind: special.kind } : {}),
    children,
    data: { hName: special?.hName ?? "span", hProperties: props },
  };
}

/** `![a](b){width=50%}` / `[a](b){.c}`: attributes right after a link or image. */
function trailingAttributes(parent: PhrasingParent): void {
  const kids = parent.children;
  for (let i = 0; i < kids.length - 1; i++) {
    const node = kids[i]!;
    const next = kids[i + 1]!;
    if ((node.type !== "image" && node.type !== "link") || next.type !== "text") continue;
    const m = /^\{([^{}\n]*)\}/.exec(next.value);
    const parsed = m ? parseAttributes(m[1]!) : null;
    if (!parsed) continue;
    const el = node as Image | Link;
    el.data = { ...el.data, hProperties: { ...(el.data?.hProperties ?? {}), ...safeProperties(parsed, { image: node.type === "image" }) } };
    next.value = next.value.slice(m![0].length);
    if (!next.value) kids.splice(i + 1, 1);
  }
}

const SUPSUB = /\^((?:[^\s^\\]|\\.)+)\^|~((?:[^\s~\\]|\\.)+)~/g;

/** `^x^` and `~x~` inside text nodes (no spaces inside, as in pandoc). */
function supSub(parent: PhrasingParent): void {
  const kids = parent.children;
  for (let i = 0; i < kids.length; i++) {
    const node = kids[i]!;
    if (node.type !== "text" || (!node.value.includes("^") && !node.value.includes("~"))) continue;
    const out: PhrasingContent[] = [];
    let last = 0;
    for (const m of node.value.matchAll(SUPSUB)) {
      out.push(...text(node.value.slice(last, m.index)));
      const sup = m[1] !== undefined;
      const value = (m[1] ?? m[2]!).replace(/\\(.)/g, "$1");
      out.push({ type: sup ? "superscript" : "subscript", children: [{ type: "text", value }], data: { hName: sup ? "sup" : "sub" } });
      last = m.index! + m[0].length;
    }
    if (out.length === 0) continue;
    out.push(...text(node.value.slice(last)));
    kids.splice(i, 1, ...out);
    i += out.length - 1;
  }
}

/* --- paragraphs: figures, line blocks, fancy and example lists */

function paragraphPass(node: Nodes, ctx: Ctx): void {
  if (!("children" in node) || PHRASING_PARENTS.has(node.type)) return;
  const parent = node as BlockParent;
  for (let i = 0; i < parent.children.length; i++) {
    const child = parent.children[i]!;
    if (child.type === "paragraph") {
      const replaced = figure(child) ?? lineBlock(child) ?? fancyList(child, ctx);
      if (replaced) parent.children[i] = replaced;
    } else paragraphPass(child, ctx);
  }
  mergeFancyLists(parent);
}

function figure(p: Paragraph): Figure | null {
  const kids = p.children.filter((c) => !(c.type === "text" && !c.value.trim()));
  const img = kids[0];
  if (kids.length !== 1 || img?.type !== "image" || !img.alt) return null;
  return {
    type: "figure",
    children: [img, { type: "figureCaption", children: [{ type: "text", value: img.alt }], data: { hName: "figcaption" } }],
    data: { hName: "figure" },
  };
}

/** The paragraph's lines: its children split at the line endings inside text and at hard breaks. */
function splitLines(children: PhrasingContent[]): PhrasingContent[][] {
  const lines: PhrasingContent[][] = [[]];
  for (const c of children) {
    if (c.type === "break") {
      lines.push([]);
      continue;
    }
    if (c.type !== "text" || !c.value.includes("\n")) {
      lines[lines.length - 1]!.push(c);
      continue;
    }
    const parts = c.value.split("\n");
    parts.forEach((part, n) => {
      if (n > 0) lines.push([]);
      if (part) lines[lines.length - 1]!.push({ type: "text", value: part });
    });
  }
  return lines;
}

function lineBlock(p: Paragraph): LineBlock | null {
  const lines = splitLines(p.children);
  const LINE = /^\|(?: |$)/;
  if (!lines.every((l) => l[0]?.type === "text" && LINE.test(l[0].value))) return null;
  const children: PhrasingContent[] = [];
  lines.forEach((l, n) => {
    if (n > 0) children.push({ type: "break" });
    const first = l[0] as Text;
    const value = first.value.replace(LINE, "").replace(/^ +/, (s) => " ".repeat(s.length));
    children.push(...text(value), ...l.slice(1));
  });
  return { type: "lineBlock", children, data: { hName: "div", hProperties: { className: ["line-block"] } } };
}

type FancyStyle = "example" | "decimal" | "lower-alpha" | "upper-alpha" | "lower-roman" | "upper-roman";
const FANCY = /^(?:\((@[\w-]*|#|\d{1,9}|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)\)|(@[\w-]*|#|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)([.)]))( +|$)/;
const HTML_TYPE: Record<FancyStyle, string> = {
  example: "1", decimal: "1", "lower-alpha": "a", "upper-alpha": "A", "lower-roman": "i", "upper-roman": "I",
};

function romanValue(s: string): number {
  const v: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };
  let total = 0;
  const t = s.toLowerCase();
  for (let i = 0; i < t.length; i++) {
    const cur = v[t[i]!]!;
    const next = v[t[i + 1] ?? ""] ?? 0;
    total += cur < next ? -cur : cur;
  }
  return total;
}

interface Marker {
  style: FancyStyle;
  delim: string;
  value: number | null;
  label: string | null;
  length: number;
}

function readMarker(line: PhrasingContent[], listStyle: FancyStyle | null): Marker | null {
  const first = line[0];
  if (first?.type !== "text") return null;
  const m = FANCY.exec(first.value);
  if (!m) return null;
  const body = m[1] ?? m[2]!;
  const delim = m[1] !== undefined ? "()" : m[3]!;
  // `A. ` needs two spaces (pandoc), so "B. Russell" stays a sentence.
  if (/^[A-Z]$/.test(body) && delim === "." && m[4]!.length < 2) return null;
  let style: FancyStyle;
  let value: number | null;
  let label: string | null = null;
  if (body.startsWith("@")) {
    style = "example";
    value = null;
    label = body.slice(1) || null;
  } else if (body === "#") {
    style = listStyle ?? "decimal";
    value = null;
  } else if (/^\d+$/.test(body)) {
    style = "decimal";
    value = Number(body);
  } else if (/^[a-z]$/.test(body) && !(body === "i" && listStyle !== "lower-alpha") && listStyle !== "lower-roman") {
    style = "lower-alpha";
    value = body.charCodeAt(0) - 96;
  } else if (/^[A-Z]$/.test(body) && !(body === "I" && listStyle !== "upper-alpha") && listStyle !== "upper-roman") {
    style = "upper-alpha";
    value = body.charCodeAt(0) - 64;
  } else if (/^[ivxlcdm]+$/.test(body)) {
    style = "lower-roman";
    value = romanValue(body);
  } else if (/^[IVXLCDM]+$/.test(body)) {
    style = "upper-roman";
    value = romanValue(body);
  } else return null;
  return { style, delim, value, label, length: m[0].length };
}

function fancyList(p: Paragraph, ctx: Ctx): List | null {
  const lines = splitLines(p.children);
  const head = readMarker(lines[0]!, null);
  if (!head) return null;
  const items: PhrasingContent[][] = [];
  for (const line of lines) {
    const mk = readMarker(line, head.style);
    if (mk && mk.style === head.style && mk.delim === head.delim) {
      const first = line[0] as Text;
      if (mk.style === "example") {
        ctx.exampleCount++;
        if (mk.label) ctx.examples.set(mk.label, ctx.exampleCount);
      }
      items.push([...text(first.value.slice(mk.length)), ...line.slice(1)]);
    } else {
      // A continuation line of the item before.
      const prev = items[items.length - 1]!;
      prev.push({ type: "text", value: "\n" }, ...line);
    }
  }
  const exampleStart = ctx.exampleCount - items.length + 1;
  const start = head.style === "example" ? exampleStart : head.value ?? 1;
  return {
    type: "list",
    ordered: true,
    start,
    spread: false,
    children: items.map(
      (children): ListItem => ({ type: "listItem", spread: false, children: [{ type: "paragraph", children }] }),
    ),
    // Lists of another style or delimiter don't merge (see mergeFancyLists).
    data: { fancy: `${head.style}${head.delim}`, hProperties: { type: HTML_TYPE[head.style] } } as List["data"],
  };
}

function fancyOf(node: RootContent | undefined): string | undefined {
  return node?.type === "list" ? (node.data as { fancy?: string } | undefined)?.fancy : undefined;
}

/** Fancy lists split by blank lines (one paragraph per item) are one loose list. */
function mergeFancyLists(parent: BlockParent): void {
  for (let i = parent.children.length - 1; i > 0; i--) {
    const cur = parent.children[i]!;
    const prev = parent.children[i - 1]!;
    const style = fancyOf(cur);
    if (!style || style !== fancyOf(prev) || style.startsWith("example")) continue;
    const a = prev as List;
    a.children.push(...(cur as List).children);
    a.spread = true;
    for (const item of a.children) item.spread = true;
    parent.children.splice(i, 1);
  }
}

/** `@label` in the text → its example number. */
function exampleRefs(tree: Root, ctx: Ctx): void {
  const re = /(^|[^\w@])@([\w-]+)/g;
  each(tree, (n) => {
    if (n.type !== "text" || !n.value.includes("@")) return;
    n.value = n.value.replace(re, (all, pre: string, label: string) => {
      const num = ctx.examples.get(label);
      return num === undefined ? all : `${pre}${num}`;
    });
  });
}

/* --- smart punctuation */

const OPENS_AFTER = /[\s([{—–“‘-]/;

/** Curly quotes, en/em dashes and ellipses in text, with the context carried across the block's inline nodes. */
function smartPass(node: Nodes): void {
  if (PHRASING_PARENTS.has(node.type)) {
    const state = { prev: "" };
    smartPhrasing(node as PhrasingParent, state);
  } else if ("children" in node) for (const c of node.children as Nodes[]) smartPass(c);
}

function smartPhrasing(parent: PhrasingParent, state: { prev: string }): void {
  for (const c of parent.children) {
    if (c.type === "text") {
      c.value = smartText(c.value, state);
    } else if (c.type === "citation") {
      state.prev = "]";
    } else if ("children" in c) {
      smartPhrasing(c as PhrasingParent, state);
    } else if (c.type === "break") {
      state.prev = "\n";
    } else {
      state.prev = "x";
    }
  }
}

function smartText(s: string, state: { prev: string }): string {
  let out = "";
  const v = s.replace(/---/g, "—").replace(/--/g, "–").replace(/\.\.\./g, "…");
  for (let i = 0; i < v.length; i++) {
    const ch = v[i]!;
    const prev = i > 0 ? v[i - 1]! : state.prev;
    const next = v[i + 1] ?? "";
    if (ch === '"') {
      out += prev === "" || OPENS_AFTER.test(prev) ? "“" : "”";
    } else if (ch === "'") {
      if (/[\p{L}\p{N}]/u.test(prev) && /[\p{L}]/u.test(next)) out += "’";
      else if ((prev === "" || OPENS_AFTER.test(prev)) && /\d/.test(next)) out += "’";
      else out += prev === "" || OPENS_AFTER.test(prev) ? "‘" : "’";
    } else out += ch;
  }
  if (v.length) state.prev = v[v.length - 1]!;
  return out;
}
