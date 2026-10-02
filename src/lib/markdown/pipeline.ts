/**
 * THE markdown pipeline: every markdown surface (lib/markdown.tsx — cards,
 * report cells, run notes) and the report LaTeX export (lib/reports/latex.ts)
 * parse with exactly these plugins, so they agree on what the text means.
 *
 * Flavour: GFM + Pandoc Markdown (remark-pandoc.ts; support matrix in
 * docs/guides/media.md). Math renders with KaTeX, whose rehype plugin is
 * the one heavy piece: lib/markdown.tsx loads it lazily, only for text that
 * `mayContainMath`. Until it arrives math shows as its TeX source.
 *
 * Sanitization contract (unchanged by the extensions):
 * - Raw HTML is never rendered as markup (no rehype-raw): `<script>` is text.
 * - URLs go through react-markdown's safe-protocol `urlTransform`
 *   (`javascript:` and friends are dropped).
 * - Attribute blocks pass only an allowlist (attributes.ts); classes are
 *   `md-` prefixed.
 * - KaTeX runs with `trust: false` (`\href`, `\url`, `\includegraphics`,
 *   `\htmlClass`… render as errors, never as links or markup).
 */

import type { Root as HastRoot } from "hast";
import type { Root } from "mdast";
import type rehypeKatex from "rehype-katex";
import type { VFile } from "vfile";
import type { Options as RemarkRehypeOptions } from "remark-rehype";
import type { PluggableList } from "unified";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { remarkDefinitionList, defListHastHandlers } from "remark-definition-list";
import remarkCallouts from "./remark-callouts.ts";
import remarkHeadingIds from "./heading-ids.ts";
import remarkPandoc from "./remark-pandoc.ts";
import { preprocessPandoc } from "./preprocess.ts";

export interface PipelineOptions {
  /** 0-based source line → anchor id for the text's headings (lib/markdown/headings.ts). */
  headingSlugs?: ReadonlyMap<number, string>;
}

/** The remark plugins, in order. `singleTilde: false` leaves `~x~` to subscript; `~~x~~` strikes. */
export function remarkPlugins(opts: PipelineOptions = {}): PluggableList {
  return [
    [remarkGfm, { singleTilde: false }],
    remarkDefinitionList,
    remarkPandoc,
    remarkCallouts,
    ...(opts.headingSlugs?.size ? [[remarkHeadingIds, opts.headingSlugs] as PluggableList[number]] : []),
  ];
}

/**
 * mdast → hast options. `idPrefix` keeps footnote ids unique when several
 * markdown texts share a page (cards, report cells).
 */
export function remarkRehypeOptions(idPrefix = "user-content-"): RemarkRehypeOptions {
  return { handlers: defListHastHandlers, clobberPrefix: idPrefix };
}

/**
 * Options for rehype-katex. `macros` is per text (pass a fresh object):
 * with `globalGroup`, a `\newcommand` in one formula — or a macro block,
 * see micromark-pandoc.ts — applies to the formulas after it in that text.
 */
export function katexOptions(macros: Record<string, string> = {}) {
  return { throwOnError: false, strict: "ignore" as const, trust: false, globalGroup: true, macros };
}

/**
 * The rehype step rendering math: `katex` is rehype-katex (passed in, so
 * this module never imports KaTeX itself). Each run gets fresh macros — a
 * re-render must not see the `\newcommand`s of the run before (KaTeX would
 * call them redefinitions).
 */
export function rehypeMath(katex: typeof rehypeKatex) {
  return function attacher() {
    return (tree: HastRoot, file: VFile) => katex(katexOptions())(tree, file);
  };
}

/** Whether `md` may contain math (any delimiter); text without one never loads KaTeX. */
export function mayContainMath(md: string): boolean {
  return /\$|\\\(|\\\[|\\begin\{|\\newcommand|\\renewcommand|\\def\\|\\DeclareMathOperator|```math/.test(md);
}

/** The source as the parser sees it (pandoc fence spellings normalized, see preprocess.ts). */
export const prepareMarkdown = preprocessPandoc;

/** Parse (and transform) markdown to mdast exactly as the renderer does. */
export function parseMarkdown(md: string): Root {
  const processor = unified().use(remarkParse).use(remarkPlugins());
  return processor.runSync(processor.parse(prepareMarkdown(md))) as Root;
}
