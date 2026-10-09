/**
 * Text card — `cairn.Text` values, one per step (or a list of them), each in
 * the shared text viewer, on the stepped media base (slider key, Index,
 * gallery / grid / compare, several runs).
 */

import { artifactTextQuery } from "../lib/viewers/source";
import SteppedMediaCard, { type SteppedMediaCardProps } from "./media/SteppedMediaCard";
import type { TextSettings } from "./cards-settings/text";
import TextSettingsPanel from "./settings-panels/TextSettingsPanel";
import TextViewer from "./viewers/TextViewer";

export default function TextViewerCard(props: SteppedMediaCardProps) {
  return (
    <SteppedMediaCard<TextSettings>
      {...props}
      kind="text"
      noun="text"
      defaultMime="text/plain"
      defaultHeight={250}
      nearest
      settingsPanel={(ctl, ctx) => <TextSettingsPanel ctl={ctl} ctx={ctx} mode="card" />}
      prefetch={(qc, point) => qc.prefetchQuery(artifactTextQuery(point.artifact_hash!))}
      peek={(qc, point) => qc.getQueryData(artifactTextQuery(point.artifact_hash!).queryKey) !== undefined}
      renderArtifact={({ point, hash, settings, single }) => (
        <TextViewer
          source={{ hash, size: point.artifact_size ?? null }}
          wrap={settings.wordWrap}
          fontSize={settings.fontSize}
          className={single ? "flex-1 min-h-0" : "max-h-64"}
        />
      )}
    />
  );
}
