import type { ViewerSource } from "../../lib/viewers/source";
import CodeBlock from "./CodeBlock";
import { TruncatedNote, useViewerText } from "./use-viewer-text";

const FONT_SIZE_CLASS = { xs: "text-xs", sm: "text-sm", base: "text-base" } as const;

/** Above this many characters code shows as plain text (highlighting would stall the page). */
const HIGHLIGHT_MAX_CHARS = 100_000;

/**
 * Plain text, or code highlighted when its language is known (`lang`): the
 * text card's pane, a run's source files, every text file.
 */
export function TextView({
  text,
  lang,
  wrap = true,
  fontSize = "xs",
  className = "",
}: {
  text: string;
  lang?: string | null;
  wrap?: boolean;
  fontSize?: keyof typeof FONT_SIZE_CLASS;
  /** Extra classes on the text box (a max height, flex sizing). */
  className?: string;
}) {
  if (lang && text.length <= HIGHLIGHT_MAX_CHARS) return <CodeBlock code={text} lang={lang} className={className} />;
  const wrapClass = wrap ? "whitespace-pre-wrap break-all" : "whitespace-pre overflow-x-auto";
  return (
    <pre className={`mono overflow-auto ${wrapClass} rounded bg-bg p-3 ${FONT_SIZE_CLASS[fontSize]} text-fg-muted ${className}`} data-viewer="text">
      {text}
    </pre>
  );
}

/** A source's text in `TextView`; the previous text stays while the next loads. */
export default function TextViewer({
  source,
  maxBytes,
  ...view
}: {
  source: Pick<ViewerSource, "hash" | "size">;
  /** Read at most this many bytes (the head of a big file). */
  maxBytes?: number;
} & Omit<Parameters<typeof TextView>[0], "text">) {
  const t = useViewerText(source, maxBytes);
  const text = t.error ? `<fetch error: ${t.error.message}>` : t.text ?? "";
  if (!t.cut || maxBytes == null) return <TextView text={text} {...view} />;
  return (
    <div className="flex min-h-0 flex-col gap-1">
      <TruncatedNote shown={maxBytes} total={source.size} />
      <TextView text={text} {...view} />
    </div>
  );
}
