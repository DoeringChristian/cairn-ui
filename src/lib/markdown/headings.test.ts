import { test } from "node:test";
import assert from "node:assert/strict";
import { createSlugger, extractHeadings, githubSlug, inlinePlainText } from "./headings.ts";

test("githubSlug lower-cases, drops punctuation, hyphenates spaces", () => {
  assert.equal(githubSlug("Hello, World!"), "hello-world");
  assert.equal(githubSlug("Loss vs. step (log)"), "loss-vs-step-log");
  assert.equal(githubSlug("snake_case & kebab-case"), "snake_case--kebab-case");
  assert.equal(githubSlug("Überblick 2"), "überblick-2");
});

test("the slugger de-duplicates like github-slugger", () => {
  const s = createSlugger();
  assert.deepEqual(["A", "A", "A", "a-1"].map((t) => s.slug(t)), ["a", "a-1", "a-2", "a-1-1"]);
});

test("extractHeadings finds top-level ATX headings with levels and lines", () => {
  const md = "# Title\n\ntext\n\n## Sub section ##\n###NoSpace\n    # indented code\n> # quoted\n####### seven";
  assert.deepEqual(
    extractHeadings(md).map((h) => [h.level, h.text, h.line, h.slug]),
    [
      [1, "Title", 0, "title"],
      [2, "Sub section", 4, "sub-section"],
    ],
  );
});

test("extractHeadings skips fenced code, including longer and tilde fences", () => {
  const md = "# A\n```py\n# not a heading\n```\n````\n```\n# still code\n````\n~~~\n# code\n~~~\n## B";
  assert.deepEqual(extractHeadings(md).map((h) => h.text), ["A", "B"]);
});

test("an unclosed fence hides the rest", () => {
  assert.deepEqual(extractHeadings("# A\n```\n# B").map((h) => h.text), ["A"]);
});

test("heading text is plain: links, code, emphasis stripped", () => {
  const [h] = extractHeadings("## **Bold** [link](http://x) `code` _em_ snake_case");
  assert.equal(h!.text, "Bold link code em snake_case");
  assert.equal(h!.slug, "bold-link-code-em-snake_case");
  assert.equal(inlinePlainText("![alt](a.png) ~~gone~~"), "alt gone");
});

test("a shared slugger de-duplicates across texts", () => {
  const s = createSlugger();
  extractHeadings("# Results", s);
  assert.equal(extractHeadings("# Results", s)[0]!.slug, "results-1");
});
