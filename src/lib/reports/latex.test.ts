import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLatexDocument, emptyFigures, escapeLatex, markdownToLatex } from "./latex.ts";
import type { ReportBlock } from "./types.ts";

const tex = (md: string) => markdownToLatex(md, emptyFigures());

test("escapes every special character", () => {
  assert.equal(escapeLatex("a\\b{c}$d&e#f^g_h%i~j"), "a\\textbackslash{}b\\{c\\}\\$d\\&e\\#f\\textasciicircum{}g\\_h\\%i\\textasciitilde{}j");
  assert.equal(tex("50% of loss_total & more #1"), "50\\% of loss\\_total \\& more \\#1");
  assert.equal(tex("costs \\$5 or $4"), "costs \\$5 or \\$4");
});

test("headings map to sectioning commands", () => {
  assert.equal(
    tex("# One\n\n## Two\n\n### Three\n\n#### Four\n\n##### Five"),
    "\\section{One}\n\n\\subsection{Two}\n\n\\subsubsection{Three}\n\n\\paragraph{Four}\n\n\\subparagraph{Five}",
  );
  assert.equal(tex("## a_b"), "\\subsection{a\\_b}");
});

test("math passes through verbatim", () => {
  assert.equal(tex("inline $$a_1^2$$ here"), "inline \\(a_1^2\\) here");
  assert.equal(tex("$$\n\\frac{a}{b} + \\% x\n$$"), "\\[\n\\frac{a}{b} + \\% x\n\\]");
  assert.equal(
    tex("$$\n\\begin{align}\na &= b\n\\end{align}\n$$"),
    "\\begin{align}\na &= b\n\\end{align}",
  );
  // A single dollar is a dollar sign, as in the app.
  assert.equal(tex("$x$"), "\\$x\\$");
});

test("emphasis, strong, strikethrough, inline code", () => {
  assert.equal(tex("*a* **b** ~~c~~ `d_e{}`"), "\\emph{a} \\textbf{b} \\sout{c} \\texttt{d\\_e\\{\\}}");
});

test("links, autolinks and hard breaks", () => {
  assert.equal(tex("[the docs](https://x.org/a_b#c%20d)"), "\\href{https://x.org/a_b\\#c\\%20d}{the docs}");
  assert.equal(tex("see https://x.org"), "see \\href{https://x.org}{https://x.org}");
  assert.equal(tex("[ref][r]\n\n[r]: https://r.org"), "\\href{https://r.org}{ref}");
  assert.equal(tex("a  \nb"), "a\\newline\nb");
});

test("lists: bullets, numbered with a start, tasks, nesting", () => {
  assert.equal(tex("- a\n- b"), "\\begin{itemize}\n\\item a\n\\item b\n\\end{itemize}");
  assert.equal(tex("3. a\n4. b"), "\\begin{enumerate}\n\\setcounter{enumi}{2}\n\\item a\n\\item b\n\\end{enumerate}");
  assert.equal(tex("- [x] done\n- [ ] todo"), "\\begin{itemize}\n\\item[{[x]}] done\n\\item[{[ ]}] todo\n\\end{itemize}");
  assert.equal(
    tex("- a\n  - b"),
    "\\begin{itemize}\n\\item a\n\n\\begin{itemize}\n\\item b\n\\end{itemize}\n\\end{itemize}",
  );
});

test("tables become booktabs tabulars with column alignment", () => {
  assert.equal(
    tex("| name | acc | n |\n|:--|:-:|--:|\n| a_1 | **0.9** | 3 |\n| b | 0.8 | 4 |"),
    [
      "\\begin{center}",
      "\\begin{tabular}{lcr}",
      "\\toprule",
      "name & acc & n \\\\",
      "\\midrule",
      "a\\_1 & \\textbf{0.9} & 3 \\\\",
      "b & 0.8 & 4 \\\\",
      "\\bottomrule",
      "\\end{tabular}",
      "\\end{center}",
    ].join("\n"),
  );
});

test("fenced code is verbatim, unescaped", () => {
  assert.equal(tex("```python\nx = {'a': 1}  # 50%\n```"), "\\begin{verbatim}\nx = {'a': 1}  # 50%\n\\end{verbatim}");
});

test("blockquotes and callouts become quotes; a callout keeps its title", () => {
  assert.equal(tex("> quoted _text_"), "\\begin{quote}\nquoted \\emph{text}\n\\end{quote}");
  assert.equal(tex("> [!NOTE]\n> Mind the gap."), "\\begin{quote}\n\\textbf{Note}\\par\nMind the gap.\n\\end{quote}");
  assert.equal(
    tex("> [!warning] Heads up & more\n> Body.\n>\n> Second."),
    "\\begin{quote}\n\\textbf{Heads up \\& more}\\par\nBody.\n\nSecond.\n\\end{quote}",
  );
  assert.equal(tex("> [!TIP]"), "\\begin{quote}\n\\textbf{Tip}\n\\end{quote}");
});

test("cairn-asset images are recorded for the zip; other images become links", () => {
  const figures = emptyFigures();
  assert.equal(
    markdownToLatex("![plot](cairn-asset:ab12cd)\n\n![web](https://x.org/a.png)", figures),
    "\\includegraphics[width=\\linewidth,height=0.6\\textheight,keepaspectratio]{assets/ab12cd}\n\n\\href{https://x.org/a.png}{web}",
  );
  assert.deepEqual([...figures.assets], ["ab12cd"]);
});

test("thematic break, footnote and raw html", () => {
  assert.equal(tex("---"), "\\begin{center}\\rule{0.5\\linewidth}{0.4pt}\\end{center}");
  assert.equal(tex("a[^1]\n\n[^1]: note_x"), "a\\footnote{note\\_x}");
  assert.equal(tex("<b>x</b>"), "<b>x</b>");
});

test("buildLatexDocument: preamble, title, prose and one figure per card", () => {
  const blocks: ReportBlock[] = [
    { id: "m1", type: "markdown", text: "# Results" },
    {
      id: "c1",
      type: "cards",
      runIds: ["r1"],
      cards: [
        { id: "k1", type: "scalar", series: [] },
        { id: "k2", type: "scalar", series: [] },
      ],
    },
  ];
  const figures = emptyFigures();
  figures.cards.set("k1", { path: "figures/card-1.png", caption: "train/loss_avg" });
  const doc = buildLatexDocument(blocks, figures, { title: "My report #3" });
  assert.equal(
    doc,
    [
      "\\documentclass{article}",
      "\\usepackage[utf8]{inputenc}",
      "\\usepackage[T1]{fontenc}",
      "\\usepackage{graphicx}",
      "\\usepackage{amsmath}",
      "\\usepackage{booktabs}",
      "\\usepackage[normalem]{ulem}",
      "\\usepackage{hyperref}",
      "",
      "\\title{My report \\#3}",
      "\\date{}",
      "",
      "\\begin{document}",
      "\\maketitle",
      "",
      "\\section{Results}",
      "",
      "\\begin{figure}[htbp]",
      "\\centering",
      "\\includegraphics[width=\\linewidth,height=0.45\\textheight,keepaspectratio]{figures/card-1.png}",
      "\\caption{train/loss\\_avg}",
      "\\end{figure}",
      "",
      "% card k2: no image captured",
      "",
      "\\end{document}",
      "",
    ].join("\n"),
  );
});
