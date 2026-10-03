/**
 * Markdown card — `cairn.Markdown` blobs, one per step, each in the shared
 * markdown viewer (components/viewers/MarkdownViewer.tsx).
 */

import { artifactTextQuery } from "../lib/viewers/source";
import SteppedMediaCard, { type SteppedMediaCardProps } from "./media/SteppedMediaCard";
import type { MarkdownSettings } from "./cards-settings/markdown";
import MarkdownSettingsPanel from "./settings-panels/MarkdownSettingsPanel";
import MarkdownViewer from "./viewers/MarkdownViewer";

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
      peek={(qc, point) => qc.getQueryData(artifactTextQuery(point.artifact_hash!).queryKey) !== undefined}
      renderArtifact={({ point, hash, settings, single }) => (
        <MarkdownViewer source={{ hash, size: point.artifact_size ?? null }} fontSize={settings.fontSize} fill={single} />
      )}
    />
  );
}
