import { useState } from "react";
import { copyText } from "../../lib/clipboard";

/** An icon button that copies `text` (the explorer's full names, digests, URIs). */
export default function CopyButton({ text, label = "copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="inline-flex h-5 w-5 items-center justify-center rounded align-middle text-[11px] text-fg-subtle hover:bg-bg-hover hover:text-fg"
      title={copied ? "copied" : `copy ${text}`}
      aria-label={label}
      onClick={async () => {
        if (await copyText(text)) {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }
      }}
    >
      <i className={`fa-${copied ? "solid fa-check" : "regular fa-copy"}`} aria-hidden="true" />
    </button>
  );
}
