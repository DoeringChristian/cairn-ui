import { api } from "../api/client";
import type { SequencePoint } from "../api/types";
import { safeJsonParse } from "../lib/format";
import { artifactFilename } from "../lib/download";
import type { VolumeSettings } from "./cards-settings/volume";
import { plotCardPolicy } from "./card-kit/plot-card-policy";
import SteppedMediaCard, { type SteppedMediaCardProps } from "./media/SteppedMediaCard";
import UnsupportedArtifact from "./UnsupportedArtifact";
import VolumeSettingsPanel from "./settings-panels/VolumeSettingsPanel";

interface VolumeMeta {
  shape: [number, number, number];
  dtype: string;
  vmin: number;
  vmax: number;
}

function VolumePlaceholder({ name, point }: { name: string; point: SequencePoint }) {
  const meta = safeJsonParse<VolumeMeta>(point.artifact_metadata);
  const detail = meta
    ? `${meta.shape.join("×")} · ${meta.dtype} · [${meta.vmin.toPrecision(3)}, ${meta.vmax.toPrecision(3)}]`
    : undefined;
  return (
    <UnsupportedArtifact
      label="Volume — not viewable in the browser"
      detail={detail}
      downloadUrl={api.artifactUrl(point.artifact_hash!)}
      filename={artifactFilename(name, point.step, point.artifact_mime, ".npz")}
    />
  );
}

/**
 * A volume card's own renderer: a placeholder per tile with the step's
 * `.npz` to download, on the stepped media shell (Index, gallery / grid /
 * compare, media limit — placeholders are cheap, so every layout applies).
 * Volumes show in their default viewer (the built-in `cairn.volume`
 * ray-marcher, CardRenderer's DefaultViewerGate); this is what is left where
 * that cannot run (no WebGL2).
 */
export default function VolumeCard(props: SteppedMediaCardProps) {
  return (
    <SteppedMediaCard<VolumeSettings>
      {...props}
      kind="volume"
      noun="volume"
      defaultMime="application/octet-stream"
      defaultHeight={plotCardPolicy("volume").defaultHeight}
      nearest
      settingsPanel={(ctl, ctx) => <VolumeSettingsPanel ctl={ctl} ctx={ctx} mode="card" />}
      renderArtifact={({ point, name }) => <VolumePlaceholder name={name} point={point} />}
    />
  );
}
