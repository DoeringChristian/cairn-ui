/**
 * Pandoc Markdown support: each vector in pandoc-vectors.json (extension,
 * markdown → expected HTML) renders through the real pipeline — the same
 * react-markdown call lib/markdown.tsx makes, minus the theme components and
 * KaTeX — and must match exactly. KaTeX rendering is checked separately.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import type { Root } from "mdast";
import { extractHeadings } from "./headings.ts";
import { mayContainMath, parseMarkdown, prepareMarkdown, rehypeMath, remarkPlugins, remarkRehypeOptions } from "./pipeline.ts";
import { preprocessPandoc } from "./preprocess.ts";

interface Vector {
  extension: string;
  name: string;
  markdown: string;
  html: string;
}

const vectors = JSON.parse(readFileSync(new URL("./pandoc-vectors.json", import.meta.url), "utf8")) as Vector[];

export function render(md: string, opts: { katex?: boolean } = {}): string {
  return renderToStaticMarkup(
    createElement(
      ReactMarkdown,
      {
        remarkPlugins: remarkPlugins({ headingSlugs: new Map(extractHeadings(md).map((h) => [h.line, h.slug])) }),
        remarkRehypeOptions: remarkRehypeOptions("md-"),
        rehypePlugins: opts.katex ? [rehypeMath(rehypeKatex)] : [],
      },
      prepareMarkdown(md),
    ),
  );
}

for (const v of vectors) {
  test(`${v.extension}: ${v.name}`, () => {
    assert.equal(render(v.markdown), v.html);
  });
}

test("the vectors cover every supported extension", () => {
  const covered = new Set(vectors.map((v) => v.extension));
  for (const ext of [
    "tex_math_dollars", "tex_math_single_backslash", "raw_tex", "latex_macros", "footnotes", "inline_notes",
    "definition_lists", "fenced_divs", "bracketed_spans", "header_attributes", "auto_identifiers", "superscript",
    "subscript", "strikeout", "pipe_tables", "task_lists", "smart", "implicit_figures", "link_attributes",
    "line_blocks", "fancy_lists", "example_lists", "citations",
  ]) {
    assert.ok(covered.has(ext), ext);
  }
});

test("KaTeX renders inline, display, macros and environments", () => {
  const html = render(
    [
      "Inline $\\mathbb{R}^n$, $\\operatorname{diag}(x)$ and \\(\\alpha\\).",
      "",
      "$$\\begin{aligned} a &= b \\\\ c &= d \\end{aligned}$$",
      "",
      "\\begin{align}",
      "x &= 1 \\\\",
      "y &= 2",
      "\\end{align}",
      "",
      "\\newcommand{\\RR}{\\mathbb{R}}",
      "\\DeclareMathOperator{\\tr}{tr}",
      "",
      "Then $x \\in \\RR$ and $\\tr A$.",
    ].join("\n"),
    { katex: true },
  );
  assert.ok(!html.includes("katex-error"), html);
  assert.ok(!html.includes("language-math"), "every formula rendered");
  assert.equal(html.match(/class="katex-display"/g)?.length, 2);
  assert.ok(html.includes("mathbb"), "\\mathbb rendered");
  assert.ok(html.includes(">tr<"), "\\DeclareMathOperator → an operator");
});

test("macros do not leak into the next render", () => {
  const md = "\\newcommand{\\RR}{\\mathbb{R}}\n\n$\\RR$";
  render(md, { katex: true });
  assert.ok(!render(md, { katex: true }).includes("katex-error"));
  // A text without the definition doesn't know the macro.
  assert.ok(render("$\\RR$", { katex: true }).includes("\\RR"));
});

test("a KaTeX error renders as an error, not as a thrown exception", () => {
  assert.ok(render("$\\frac{1}{$ and $\\undefinedmacro$", { katex: true }).includes("katex-error"));
});

test("mayContainMath gates the KaTeX chunk", () => {
  for (const md of ["$x$", "\\(x\\)", "\\[x\\]", "\\begin{align}", "\\newcommand{\\a}{b}", "```math\nx\n```"]) {
    assert.ok(mayContainMath(md), md);
  }
  for (const md of ["plain *text*", "# Heading\n\n- list", "a \\* b"]) assert.ok(!mayContainMath(md), md);
});

test("headings: explicit ids are the outline's slugs; attributes are not heading text", () => {
  const hs = extractHeadings("# Results {#res .x}\n\n# Results\n\n## Aside {-}");
  assert.deepEqual(
    hs.map((h) => [h.text, h.slug]),
    [["Results", "res"], ["Results", "results"], ["Aside", "aside"]],
  );
  // An explicit id is claimed: a later automatic slug avoids it.
  assert.deepEqual(extractHeadings("# Intro {#intro}\n\n# Intro").map((h) => h.slug), ["intro", "intro-1"]);
  // An id the renderer would drop (unsafe) falls back to the automatic slug.
  assert.deepEqual(extractHeadings('# T {#"x}').map((h) => h.slug), ["t"]);
});

test("preprocess: pandoc div fences and `~` definitions, never inside code; lines kept", () => {
  const md = "::: {.note #a}\nx\n:::\n\n```\n::: {.note}\n~ code\n```\n\nTerm\n~ def\n\n~ second def\n\n\n~ no term";
  const out = preprocessPandoc(md);
  assert.equal(out.split("\n").length, md.split("\n").length);
  assert.equal(
    out,
    ":::div{.note #a}\nx\n:::\n\n```\n::: {.note}\n~ code\n```\n\nTerm\n: def\n\n: second def\n\n\n~ no term",
  );
});

test("only container directives: `:name` and `::name` stay text", () => {
  const tree = parseMarkdown("Note:this and ::leaf and :x[y]{z}") as Root;
  assert.equal(tree.children[0]!.type, "paragraph");
  assert.deepEqual(
    (tree.children[0] as { children: { type: string }[] }).children.map((c) => c.type),
    ["text"],
  );
});
