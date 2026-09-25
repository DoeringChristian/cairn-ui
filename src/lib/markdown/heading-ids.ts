/**
 * A remark plugin giving top-level headings their anchor ids, looked up by
 * source line (0-based) in `slugs` — the lines `extractHeadings` found, so
 * the rendered ids are exactly the outline's slugs (see headings.ts).
 */

import type { Root } from "mdast";

export default function remarkHeadingIds(slugs: ReadonlyMap<number, string>) {
  return (tree: Root) => {
    for (const node of tree.children) {
      if (node.type !== "heading" || !node.position) continue;
      const slug = slugs.get(node.position.start.line - 1);
      if (slug === undefined) continue;
      node.data = { ...node.data, hProperties: { ...(node.data?.hProperties ?? {}), id: slug } };
    }
  };
}
