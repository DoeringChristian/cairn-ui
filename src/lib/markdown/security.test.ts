/**
 * The sanitization contract (lib/markdown.tsx, lib/markdown/pipeline.ts)
 * holds with every Pandoc extension on: no raw HTML, no unsafe URLs, no
 * attribute beyond the allowlist, no KaTeX links. Rendered through the real
 * pipeline with KaTeX and react-markdown's default `urlTransform` (the one
 * lib/markdown.tsx's `makeUrlTransform` delegates to).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import { prepareMarkdown, rehypeMath, remarkPlugins, remarkRehypeOptions } from "./pipeline.ts";
import { parseAttributes, safeProperties } from "./attributes.ts";

function render(md: string): string {
  return renderToStaticMarkup(
    createElement(
      ReactMarkdown,
      { remarkPlugins: remarkPlugins(), remarkRehypeOptions: remarkRehypeOptions("md-"), rehypePlugins: [rehypeMath(rehypeKatex)] },
      prepareMarkdown(md),
    ),
  );
}

/** No element in `html` carries an event handler, a style we didn't build, or a script URL. */
function assertInert(html: string): void {
  assert.ok(!/<script/i.test(html), `script element in ${html}`);
  assert.ok(!/<(?:iframe|object|embed|style)\b/i.test(html), `active element in ${html}`);
  assert.ok(!/<[^>]*\son[a-z]+=/i.test(html), `event handler attribute in ${html}`);
  assert.ok(!/(?:href|src|action|formaction|xlink:href)="\s*(?:javascript|vbscript|data):/i.test(html), `script URL in ${html}`);
}

test("raw HTML stays text, in every context", () => {
  for (const md of [
    "<script>alert(1)</script>",
    "x <img src=x onerror=alert(1)> y",
    "::: note\n<script>alert(1)</script>\n:::",
    "Term\n:   <iframe src=javascript:alert(1)></iframe>",
    "text^[<img src=x onerror=alert(1)>]",
    "[<b onclick=alert(1)>x</b>]{.a}",
    "| <script>x</script>\n| y",
    "a. <script>x</script>\nb. y",
  ]) {
    const html = render(md);
    assertInert(html);
    assert.ok(html.includes("&lt;"), `escaped: ${html}`);
  }
});

test("javascript: URLs are dropped from links, images, footnotes and attributed links", () => {
  for (const md of [
    "[x](javascript:alert(1))",
    "![x](javascript:alert(1))",
    "![cap](javascript:alert(1))", // an implicit figure
    "[x](JaVaScRiPt:alert(1)){.a}",
    "text^[[x](javascript:alert(1))]",
    "[x][r]\n\n[r]: javascript:alert(1)",
    "<javascript:alert(1)>",
  ]) {
    const html = render(md);
    assertInert(html);
    assert.ok(!/javascript:/i.test(html.replace(/>[^<]*</g, "><")), `URL survived in an attribute: ${html}`);
  }
});

test("KaTeX: \\href, \\url and other trust-gated commands never become links or markup", () => {
  for (const md of [
    "$\\href{javascript:alert(1)}{x}$",
    "$$\\url{javascript:alert(1)}$$",
    "\\(\\href{https://e.com}{x}\\)",
    "$\\includegraphics{javascript:alert(1)}$",
    "$\\htmlClass{fixed inset-0}{x}$",
    "$\\htmlStyle{color:red}{x}$",
    "$\\htmlId{evil}{x}$",
    "$\\htmlData{foo=bar}{x}$",
    "\\begin{align}\n\\href{javascript:alert(1)}{x}\n\\end{align}",
    "\\newcommand{\\evil}{\\href{javascript:alert(1)}{x}}\n\n$\\evil$",
  ]) {
    const html = render(md);
    assertInert(html);
    assert.ok(!/<a\b/.test(html), `link from KaTeX: ${html}`);
    assert.ok(!/class="[^"]*\b(?:fixed|inset-0)\b/.test(html) && !/id="evil"/.test(html) && !/data-foo/.test(html), html);
    assert.ok(!/style="[^"]*color:\s*red/.test(html), html);
  }
});

test("math content is text: markup inside formulas is escaped", () => {
  for (const md of ["$</code><script>alert(1)</script>$", "\\[<img src=x onerror=alert(1)>\\]", "\\begin{tikzpicture}\n<script>x</script>\n\\end{tikzpicture}"]) {
    assertInert(render(md));
  }
});

test("attribute blocks pass only id, md- classes and the allowlist", () => {
  const cases: [string, RegExp][] = [
    ['[t]{onclick="alert(1)" style="color:red" .fixed .inset-0 #ok href=javascript:x}', /<span id="ok" class="md-fixed md-inset-0">t<\/span>/],
    ["# Head {onmouseover=alert(1) #h1 .x}", /<h1 id="h1" class="md-x">Head<\/h1>/],
    ["::: {.note onclick=alert(1) #n}\nx\n:::", /<blockquote id="n" data-callout="note"/],
    ["::: {.box style=position:fixed onclick=x}\ny\n:::", /<div class="md-box"><p>y<\/p><\/div>/],
    ["![a](i.png){onerror=alert(1) src=javascript:x width=10}", /<img src="i.png" alt="a" style="width:10px"\/>/],
    ['![a](i.png){width="100px;background:url(javascript:x)"}', /<img src="i.png" alt="a"\/>/],
    ["[l](https://e.com){href=javascript:x target=_top}", /<a href="https:\/\/e.com">l<\/a>/],
    ['[t]{#a"b .a}', /<span class="md-a">t<\/span>/],
    ["[t]{#\"><script> .a}", /^<p>\[t\]\{#\u201d&gt;&lt;script&gt; \.a\}<\/p>$/],
    ['[t]{title="hi there" lang=en dir=rtl data-x=1}', /<span title="hi there" lang="en" dir="rtl">t<\/span>/],
  ];
  for (const [md, expected] of cases) {
    const html = render(md);
    assertInert(html);
    assert.match(html, expected, md);
  }
});

test("safeProperties: the allowlist itself", () => {
  const a = parseAttributes('#good .ok .bad:class onclick=x style=y title="t" width=50% height=2em src=z')!;
  assert.deepEqual(safeProperties(a, { image: true }), {
    id: "good",
    className: ["md-ok"],
    title: "t",
    style: "width:50%;height:2em",
  });
  assert.deepEqual(safeProperties(a), { id: "good", className: ["md-ok"], title: "t" });
  assert.equal(parseAttributes(""), null);
  assert.equal(parseAttributes("not attributes"), null);
});
