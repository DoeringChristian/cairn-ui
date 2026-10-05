/**
 * HTML card — `cairn.Html` blobs, one per step, each in the shared HTML
 * viewer (components/viewers/HtmlViewer.tsx: a sandboxed iframe; read its
 * security contract before touching either).
 */

import { htmlDocumentQuery } from "../lib/viewers/source";
import SteppedMediaCard, { type SteppedMediaCardProps } from "./media/SteppedMediaCard";
import type { HtmlSettings } from "./cards-settings/html";
import HtmlSettingsPanel from "./settings-panels/HtmlSettingsPanel";
import HtmlViewer from "./viewers/HtmlViewer";

export default function HtmlCard(props: SteppedMediaCardProps) {
  return (
    <SteppedMediaCard<HtmlSettings>
      {...props}
      kind="html"
      noun="HTML"
      defaultMime="text/html"
      defaultHeight={360}
      nearest
      settingsPanel={(ctl, ctx) => <HtmlSettingsPanel ctl={ctl} ctx={ctx} mode="card" />}
      prefetch={(qc, point) => qc.prefetchQuery(htmlDocumentQuery(point.artifact_hash!))}
      peek={(qc, point) => qc.getQueryData(htmlDocumentQuery(point.artifact_hash!).queryKey) !== undefined}
      renderArtifact={({ point, hash, name, settings, single }) => {
        const frame = (
          <HtmlViewer
            source={{ hash, size: point.artifact_size ?? null }}
            name={name}
            autoHeight={settings.autoHeight}
            fixedHeight={settings.fixedHeight}
          />
        );
        return single ? <div className="flex-1 min-h-0 overflow-auto">{frame}</div> : frame;
      }}
    />
  );
}
