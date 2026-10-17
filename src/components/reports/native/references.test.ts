import test from "node:test";
import assert from "node:assert/strict";
import { resolveReferences, repairAnchorTargets } from "./references.ts";
test("references resolve grouped citations and figure labels without rewriting code or existing links", () => {
  const tree = {type: "root", children: [{type: "paragraph", children: [{type: "text", value: "See [@first; @second] and @fig-result"}, {type: "inlineCode", value: "[@first]"}, {type: "link", url: "https://example.org", children: [{type: "text", value: "@first"}]}]}]};
  resolveReferences(tree, {first: {}, second: {}}, [{label: "fig-result", caption: "Result"}]);
  const output = JSON.stringify(tree);
  assert.match(output, /#ref-first/); assert.match(output, /#ref-second/); assert.match(output, /#fig-result/);
  assert.match(output, /"inlineCode","value":"\[@first\]"/);
  assert.equal(tree.children[0]!.children.at(-1)!.children![0]!.value, "@first");
});

test("sanitized footnote and back-reference targets remain navigable", () => {
  const tree = {children: [{properties: {id: "user-content-user-content-fn-note"}}, {properties: {href: "#user-content-fn-note"}}, {properties: {href: "#fig-result"}}]};
  repairAnchorTargets(tree);
  assert.equal(tree.children[1]!.properties.href, "#user-content-user-content-fn-note");
  assert.equal(tree.children[2]!.properties.href, "#fig-result");
});
