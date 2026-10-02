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
  assert.equal(tex("inline $a_1^2$ here"), "inline \\(a_1^2\\) here");
  assert.equal(tex("and \\(x\\) or \\[y\\]"), "and \\(x\\) or \\[y\\]");
  // `$$…$$` is display math wherever it is (pandoc).
  assert.equal(tex("inline $$a_1^2$$ here"), "inline \\[a_1^2\\] here");
  assert.equal(tex("$$\n\\frac{a}{b} + \\% x\n$$"), "\\[\n\\frac{a}{b} + \\% x\n\\]");
  assert.equal(
    tex("$$\n\\begin{align}\na &= b\n\\end{align}\n$$"),
    "\\begin{align}\na &= b\n\\end{align}",
  );
  // A bare math environment (raw TeX) is kept as written, as is any other environment.
  assert.equal(tex("\\begin{align*}\na &= b \\\\\nc &= d\n\\end{align*}"), "\\begin{align*}\na &= b \\\\\nc &= d\n\\end{align*}");
  assert.equal(tex("\\begin{tikzpicture}\n\\draw (0,0);\n\\end{tikzpicture}"), "\\begin{tikzpicture}\n\\draw (0,0);\n\\end{tikzpicture}");
  // Macro blocks stay; `\DeclareMathOperator` (preamble-only) becomes a `\newcommand`.
  assert.equal(
    tex("\\newcommand{\\R}{\\mathbb{R}}\n\\DeclareMathOperator{\\tr}{tr}"),
    "\\newcommand{\\R}{\\mathbb{R}}\n\\newcommand{\\tr}{\\operatorname{tr}}",
  );
  // Dollars that aren't math (pandoc's rules) stay dollar signs.
  assert.equal(tex("$5 and $10"), "\\$5 and \\$10");
  assert.equal(tex("$ x$"), "\\$ x\\$");
});

test("pandoc inline extensions", () => {
  assert.equal(tex("H~2~O and 2^10^"), "H\\textsubscript{2}O and 2\\textsuperscript{10}");
  assert.equal(tex("text^[an *inline* note] end"), "text\\footnote{an \\emph{inline} note} end");
  assert.equal(tex("[Small]{.smallcaps} [u]{.underline} [plain]{.x #y}"), "\\textsc{Small} \\uline{u} plain");
  assert.equal(tex("as shown [@doe99; @roe_2]"), "as shown \\cite{doe99,roe_2}");
  assert.equal(tex("\"Quoted\" -- and --- so..."), "\u201cQuoted\u201d \u2013 and \u2014 so\u2026");
  assert.equal(tex("see [the intro](#intro)"), "see \\hyperref[intro]{the intro}");
});

test("pandoc block extensions", () => {
  assert.equal(tex("# Intro {#intro .x}\n\n## Aside {-}"), "\\section{Intro}\\label{intro}\n\n\\subsection*{Aside}");
  assert.equal(
    tex("Term\n:   Its *definition*\n\nOther\n:   Two"),
    "\\begin{description}\n\\item[Term]\nIts \\emph{definition}\n\\item[Other]\nTwo\n\\end{description}",
  );
  assert.equal(
    tex("::: {.warning title=\"Careful & slow\"}\nBody.\n:::"),
    "\\begin{quote}\n\\textbf{Careful \\& slow}\\par\nBody.\n\\end{quote}",
  );
  assert.equal(tex("::: tip\nT.\n:::"), "\\begin{quote}\n\\textbf{Tip}\\par\nT.\n\\end{quote}");
  assert.equal(tex("::: {.custom}\nJust *content*.\n:::"), "Just \\emph{content}.");
  assert.equal(tex("| one\n|   two"), "\\noindent one\\newline\n\u00a0\u00a0two");
  assert.equal(
    tex("a. first\nb. second"),
    "\\begin{enumerate}\n\\renewcommand{\\labelenumi}{\\alph{enumi}.}\n\\item first\n\\item second\n\\end{enumerate}",
  );
  assert.equal(
    tex("ii. two\niii. three"),
    "\\begin{enumerate}\n\\renewcommand{\\labelenumi}{\\roman{enumi}.}\n\\setcounter{enumi}{1}\n\\item two\n\\item three\n\\end{enumerate}",
  );
  assert.equal(
    tex("(@) one\n(@two) two\n\nAs (@two) shows."),
    "\\begin{enumerate}\n\\item one\n\\item two\n\\end{enumerate}\n\nAs (2) shows.",
  );
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
    markdownToLatex("see ![plot](cairn-asset:ab12cd) and ![web](https://x.org/a.png)", figures),
    "see \\includegraphics[width=\\linewidth,height=0.6\\textheight,keepaspectratio]{assets/ab12cd} and \\href{https://x.org/a.png}{web}",
  );
  assert.deepEqual([...figures.assets], ["ab12cd"]);
});

test("an image alone in its paragraph is a figure captioned by its alt text", () => {
  const figures = emptyFigures();
  assert.equal(
    markdownToLatex("![Loss *curve*](cairn-asset:ab12cd)", figures),
    [
      "\\begin{figure}[htbp]",
      "\\centering",
      "\\includegraphics[width=\\linewidth,height=0.6\\textheight,keepaspectratio]{assets/ab12cd}",
      "\\caption{Loss curve}",
      "\\end{figure}",
    ].join("\n"),
  );
  // Without alt text it stays an image.
  assert.equal(tex("![](cairn-asset:ab12cd)"), "\\includegraphics[width=\\linewidth,height=0.6\\textheight,keepaspectratio]{assets/ab12cd}");
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
  "\\usepackage{amssymb}",
      "\\usepackage{booktabs}",
      "\\usepackage[normalem]{ulem}",
      "\\usepackage{hyperref}",
      "",
      "\\title{My report \\#3}",
      "\\author{}",
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
