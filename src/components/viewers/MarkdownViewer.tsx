/**
 * Markdown through the shared pipeline (lib/markdown.tsx: GFM + Pandoc
 * Markdown, KaTeX math): the markdown card's pane, and every markdown file.
 *
 * Raw HTML in the source text is NEVER rendered as markup: react-markdown's
 * default escaping stays on (no rehype-raw plugin), so `<script>` or any
 * other tag in logged markdown renders as inert text. Do not add rehype-raw.
 */

import Markdown from "../../lib/markdown";
import type { ViewerSource } from "../../lib/viewers/source";
import type { MarkdownFontSize } from "../cards-settings/markdown";
import { TruncatedNote, useViewerText } from "./use-viewer-text";

const FONT_SIZE_CLASS: Record<MarkdownFontSize, string> = {
  xs: "text-xs",
  sm: "text-sm",
  base: "text-base",
};

/**
 * One markdown source. While the next source's text loads, the previous one
 * stays (no empty flash); it renders synchronously, so the swap is a single
 * commit. `fill`: grow into a flex column.
 */
export default function MarkdownViewer({
  source,
  fontSize = "sm",
  fill = false,
  maxBytes,
}: {
  source: Pick<ViewerSource, "hash" | "size">;
  fontSize?: MarkdownFontSize;
  fill?: boolean;
  /** Read at most this many bytes (the head of a big file). */
  maxBytes?: number;
}) {
  const t = useViewerText(source, maxBytes);
  const content = t.error ? `*fetch error: ${t.error.message}*` : t.text ?? "";
  return (
    <div className={`${fill ? "flex-1 min-h-0 " : ""}overflow-auto rounded bg-bg p-3 ${FONT_SIZE_CLASS[fontSize]}`} data-viewer="markdown">
      {t.cut && maxBytes != null && <TruncatedNote shown={maxBytes} total={source.size} />}
      <Markdown>{content}</Markdown>
    </div>
  );
}
