import { test } from "node:test";
import assert from "node:assert/strict";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import type { Blockquote, Root } from "mdast";
import { transformCallouts } from "./remark-callouts.ts";

function parse(md: string): Root {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(md) as Root;
  transformCallouts(tree);
  return tree;
}
const props = (n: unknown) => (n as Blockquote).data?.hProperties as Record<string, unknown> | undefined;
const text = (n: unknown): string => {
  const x = n as { value?: string; children?: unknown[] };
  return x.value ?? (x.children ?? []).map(text).join("");
};

test("each kind becomes a callout and the marker is removed", () => {
  for (const kind of ["NOTE", "TIP", "IMPORTANT", "WARNING", "CAUTION"]) {
    const [bq] = parse(`> [!${kind}]\n> Body text`).children;
    assert.deepEqual(props(bq), { dataCallout: kind.toLowerCase(), dataFold: "", dataTitle: "" });
    assert.equal(text(bq), "Body text");
  }
});

test("fold markers and a title on the marker line", () => {
  const [a, b] = parse("> [!note]- My title\n> Body **x**\n\n> [!Tip]+\n> y").children;
  assert.deepEqual(props(a), { dataCallout: "note", dataFold: "-", dataTitle: "My title" });
  assert.equal(text(a), "Body x");
  assert.equal(props(b)!.dataFold, "+");
});

test("a marker alone in its paragraph drops the empty paragraph", () => {
  const [bq] = parse("> [!WARNING]\n>\n> Second paragraph").children;
  assert.equal((bq as Blockquote).children.length, 1);
  assert.equal(text(bq), "Second paragraph");
});

test("plain blockquotes and unknown kinds are left alone; nested callouts work", () => {
  const [plain, unknown, list] = parse("> just a quote\n\n> [!FOO]\n> x\n\n- item\n\n  > [!TIP]\n  > nested").children;
  assert.equal(props(plain), undefined);
  assert.equal(props(unknown), undefined);
  assert.equal(text(unknown), "[!FOO]\nx");
  const nested = (list as { children: Array<{ children: unknown[] }> }).children[0]!.children[1];
  assert.equal(props(nested)!.dataCallout, "tip");
});

test("works on a hand-built tree", () => {
  const tree: Root = {
    type: "root",
    children: [{ type: "blockquote", children: [{ type: "paragraph", children: [{ type: "text", value: "[!CAUTION] Careful\nHot" }] }] }],
  };
  transformCallouts(tree);
  assert.deepEqual(props(tree.children[0]), { dataCallout: "caution", dataFold: "", dataTitle: "Careful" });
  assert.equal(text(tree.children[0]), "Hot");
});
