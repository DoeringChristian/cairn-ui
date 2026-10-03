import { useEffect, useState } from "react";
import { copyText } from "../../lib/clipboard";
import { getHighlighter } from "../../lib/syntax-highlight";

/**
 * Code with a copy button, highlighted with the shared shiki highlighter
 * once it loads (lazy; plain text until then): usage snippets, a run's
 * source files, and every code / JSON / text file with a known language.
 */
export default function CodeBlock({
  code,
  lang = "python",
  testId,
  className = "",
}: {
  code: string;
  lang?: string;
  testId?: string;
  /** Extra classes on the scroll box, e.g. a max height. */
  className?: string;
}) {
  const [html, setHtml] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let live = true;
    getHighlighter()
      .then((h) => {
        if (live) setHtml(h.codeToHtml(code, { lang, theme: "github-dark" }));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [code, lang]);
  return (
    <div className="group relative overflow-hidden rounded-md border border-border bg-[#0d1117]" data-testid={testId} data-viewer="code">
      <button
        type="button"
        className="absolute right-1.5 top-1.5 z-10 rounded border border-white/20 bg-white/10 px-2 py-0.5 text-[11px] text-white/80 hover:bg-white/20"
        onClick={async () => {
          if (await copyText(code)) {
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          }
        }}
        aria-label="copy code"
      >
        {copied ? "Copied" : "Copy"}
      </button>
      {html ? (
        <div
          className={`overflow-auto text-[12.5px] leading-relaxed [&_pre]:!bg-transparent [&_pre]:px-3 [&_pre]:py-2.5 ${className}`}
          // shiki escapes the code it is given.
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <pre className={`overflow-auto px-3 py-2.5 text-[12.5px] leading-relaxed text-[#e6edf3] ${className}`}>
          <code>{code}</code>
        </pre>
      )}
    </div>
  );
}
