/**
 * Markdown card — renders `cairn.Markdown` blobs with GitHub-flavored
 * markdown (tables, task lists, strikethrough, ...).
 *
 * Raw HTML in the source text is NEVER rendered as markup: react-markdown's
 * default escaping stays on (no rehype-raw plugin), so `<script>` or any
 * other tag in logged markdown renders as inert text. Do not add rehype-raw.
 */

import { useEffect, useState } from "react";
import Markdown from "../lib/markdown";
import { api } from "../api/client";
import SteppedMediaCard, { type SteppedMediaCardProps, type SteppedMediaSettings } from "./media/SteppedMediaCard";
import Select from "./settings/Select";

type FontSize = "xs" | "sm" | "base";

interface MarkdownSettings extends SteppedMediaSettings {
  fontSize: FontSize;
}

const FONT_SIZE_CLASS: Record<FontSize, string> = {
  xs: "text-xs",
  sm: "text-sm",
  base: "text-base",
};

/** Fetches one markdown artifact and renders it. */
function MarkdownBody({ hash, fontSize, fill }: { hash: string; fontSize: FontSize; fill: boolean }) {
  const [content, setContent] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch(api.artifactUrl(hash))
      .then((r) => r.text())
      .then((text) => { if (!cancelled) setContent(text); })
      .catch((e) => { if (!cancelled) setContent(`*fetch error: ${e.message}*`); });
    return () => { cancelled = true; };
  }, [hash]);

  return (
    <div className={`${fill ? "flex-1 min-h-0 " : ""}overflow-auto rounded bg-bg p-3 ${FONT_SIZE_CLASS[fontSize]}`}>
      <Markdown>{content}</Markdown>
    </div>
  );
}

export default function MarkdownCard(props: SteppedMediaCardProps) {
  return (
    <SteppedMediaCard<MarkdownSettings>
      {...props}
      kind="markdown"
      noun="markdown"
      defaultMime="text/markdown"
      defaultHeight={300}
      defaults={{ fontSize: "sm" }}
      nearest
      settingsPanel={(settings, updateSettings) => (
        <Select
          label="Font size"
          value={settings.fontSize}
          onChange={(v) => updateSettings({ fontSize: v as FontSize })}
          options={[
            { value: "xs", label: "Extra small" },
            { value: "sm", label: "Small" },
            { value: "base", label: "Base" },
          ]}
        />
      )}
      renderArtifact={({ hash, settings, single }) => (
        <MarkdownBody hash={hash} fontSize={settings.fontSize} fill={single} />
      )}
    />
  );
}
