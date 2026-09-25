/**
 * Markdown card — renders `cairn.Markdown` blobs with GitHub-flavored
 * markdown (tables, task lists, strikethrough, ...).
 *
 * Raw HTML in the source text is NEVER rendered as markup: react-markdown's
 * default escaping stays on (no rehype-raw plugin), so `<script>` or any
 * other tag in logged markdown renders as inert text. Do not add rehype-raw.
 */

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import Markdown from "../lib/markdown";
import { artifactTextQuery } from "../lib/media/artifact-text";
import SteppedMediaCard, { type SteppedMediaCardProps } from "./media/SteppedMediaCard";
import type { MarkdownFontSize as FontSize, MarkdownSettings } from "./cards-settings/markdown";
import MarkdownSettingsPanel from "./settings-panels/MarkdownSettingsPanel";

const FONT_SIZE_CLASS: Record<FontSize, string> = {
  xs: "text-xs",
  sm: "text-sm",
  base: "text-base",
};

/**
 * Fetches one markdown artifact and renders it. While the next step's text
 * loads, the previous one stays (no empty flash); it renders synchronously,
 * so the swap is a single commit.
 */
function MarkdownBody({ hash, fontSize, fill }: { hash: string; fontSize: FontSize; fill: boolean }) {
  const q = useQuery({ ...artifactTextQuery(hash), placeholderData: keepPreviousData });
  const content = q.isError && !q.isPlaceholderData ? `*fetch error: ${(q.error as Error).message}*` : q.data ?? "";

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
      nearest
      settingsPanel={(ctl, ctx) => <MarkdownSettingsPanel ctl={ctl} ctx={ctx} mode="card" />}
      prefetch={(qc, point) => qc.prefetchQuery(artifactTextQuery(point.artifact_hash!))}
      renderArtifact={({ hash, settings, single }) => (
        <MarkdownBody hash={hash} fontSize={settings.fontSize} fill={single} />
      )}
    />
  );
}
