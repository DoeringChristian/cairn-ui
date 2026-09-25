/**
 * Inline run ID display with copy-to-clipboard.
 * Shows first 6 chars (git-style short hash) with a copy icon on hover.
 */

import { useState } from "react";
import { copyText } from "../lib/clipboard";

interface Props {
  id: string;
  className?: string;
}

export default function CopyId({ id, className }: Props) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    void copyText(id);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <button
      type="button"
      onClick={copy}
      className={`group/copy mono inline-flex items-center gap-0.5 text-fg-subtle hover:text-fg ${className ?? "text-xs"}`}
      title={`${id}\nClick to copy`}
    >
      {id.slice(0, 6)}
      <span className="text-[9px] opacity-60 transition-opacity can-hover:opacity-0 can-hover:group-hover/copy:opacity-60">
        {copied ? "ok" : "\u2398"}
      </span>
    </button>
  );
}
