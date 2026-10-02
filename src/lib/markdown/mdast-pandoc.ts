/**
 * The mdast node types the Pandoc extensions add (lib/markdown/remark-pandoc.ts).
 * Each carries `data.hName` / `data.hProperties`, so remark-rehype renders it
 * without a handler of its own; lib/reports/latex.ts converts each one.
 */

import type { Data, Image, Literal, Parent, PhrasingContent } from "mdast";
import type { InlineMath } from "mdast-util-math";

/** An image alone in its paragraph, with a caption from its alt text (`implicit_figures`). */
export interface Figure extends Parent {
  type: "figure";
  children: [Image, FigureCaption];
}
export interface FigureCaption extends Parent {
  type: "figureCaption";
  children: PhrasingContent[];
}

/** `| line` blocks: one line per source line, leading spaces kept (`line_blocks`). */
export interface LineBlock extends Parent {
  type: "lineBlock";
  children: PhrasingContent[];
}

/** `[text]{.class}` (`bracketed_spans`). `kind` marks pandoc's special classes. */
export interface Span extends Parent {
  type: "span";
  kind?: "smallcaps" | "underline" | "mark";
  children: PhrasingContent[];
}

/** `[@key; @other, p. 4]` (`citations`), kept as its source text: there is no bibliography. */
export interface Citation extends Literal {
  type: "citation";
  keys: string[];
}

/** `^x^` (`superscript`). */
export interface Superscript extends Parent {
  type: "superscript";
  children: PhrasingContent[];
}

/** `~x~` (`subscript`). */
export interface Subscript extends Parent {
  type: "subscript";
  children: PhrasingContent[];
}

/** A `\begin{env}…\end{env}` block KaTeX doesn't render (`raw_tex`): shown as code, exported verbatim. */
export interface RawTex extends Literal {
  type: "rawTex";
}

/** `\newcommand…` lines (`latex_macros`): no output; they define macros for the math after them. */
export interface TexMacros extends Literal {
  type: "texMacros";
}

declare module "mdast" {
  interface BlockContentMap {
    figure: Figure;
    lineBlock: LineBlock;
    rawTex: RawTex;
    texMacros: TexMacros;
  }
  interface RootContentMap {
    figure: Figure;
    figureCaption: FigureCaption;
    lineBlock: LineBlock;
    rawTex: RawTex;
    texMacros: TexMacros;
    span: Span;
    citation: Citation;
    superscript: Superscript;
    subscript: Subscript;
  }
  interface PhrasingContentMap {
    span: Span;
    citation: Citation;
    superscript: Superscript;
    subscript: Subscript;
  }
}

/** Display math written inline (`$$…$$`, `\[…\]` in a paragraph). */
export function isDisplayMath(node: InlineMath): boolean {
  return !!(node.data as (Data & { display?: boolean }) | undefined)?.display;
}
