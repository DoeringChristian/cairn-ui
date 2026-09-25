/**
 * GitHub-style alerts ("callouts"):
 *
 *   > [!NOTE]
 *   > Useful information.
 *
 * Kinds: NOTE, TIP, IMPORTANT, WARNING, CAUTION (any case). Obsidian's
 * extensions are supported too: text after the marker is the title
 * (`> [!TIP] Faster training`), and `[!NOTE]-` / `[!NOTE]+` makes the callout
 * collapsible, starting closed / open.
 *
 * The blockquote stays a blockquote in the tree; the marker is removed and
 * the kind, fold and title go on its hast properties (`data-callout`,
 * `data-fold`, `data-title`), which the `blockquote` renderer in
 * lib/markdown.tsx turns into a styled callout. Anything else is untouched.
 */

import type { Blockquote, Paragraph, Parent, Root, RootContent } from "mdast";

export const CALLOUT_KINDS = ["note", "tip", "important", "warning", "caution"] as const;
export type CalloutKind = (typeof CALLOUT_KINDS)[number];

const MARKER = /^\[!(note|tip|important|warning|caution)\]([+-]?)[ \t]*([^\n]*)(?:\n|$)/i;

export interface CalloutData {
  kind: CalloutKind;
  /** "" = not collapsible, "-" = starts closed, "+" = starts open. */
  fold: "" | "-" | "+";
  title: string;
}

/** Read and strip the marker of one blockquote; null when it isn't a callout. */
function takeMarker(node: Blockquote): CalloutData | null {
  const first = node.children[0];
  if (!first || first.type !== "paragraph") return null;
  const para = first as Paragraph;
  const text = para.children[0];
  if (!text || text.type !== "text") return null;
  const m = MARKER.exec(text.value);
  if (!m) return null;
  text.value = text.value.slice(m[0].length);
  if (text.value === "") para.children.shift();
  // A soft break right after the marker line would open the body with a blank.
  if (para.children[0]?.type === "break") para.children.shift();
  if (para.children.length === 0) node.children.shift();
  return { kind: m[1]!.toLowerCase() as CalloutKind, fold: m[2] as CalloutData["fold"], title: m[3]!.trim() };
}

/** Turn every callout blockquote in `tree` (at any depth) into a callout, in place. */
export function transformCallouts(tree: Root | Parent): void {
  for (const child of tree.children as RootContent[]) {
    if (child.type === "blockquote") {
      const data = takeMarker(child);
      if (data) {
        child.data = {
          ...child.data,
          hProperties: {
            ...(child.data?.hProperties ?? {}),
            dataCallout: data.kind,
            dataFold: data.fold,
            dataTitle: data.title,
          },
        };
      }
    }
    if ("children" in child) transformCallouts(child as Parent);
  }
}

/** The remark plugin. */
export default function remarkCallouts() {
  return (tree: Root) => transformCallouts(tree);
}
