import type { SettingsController } from "../../lib/card-settings";
import type { ArtifactSettings } from "../cards-settings/artifact";
import { Segmented } from "../settings/palette";

interface Props {
  ctl: SettingsController<ArtifactSettings>;
  ctx?: undefined;
  mode: "card" | "defaults";
}

/**
 * Settings of the artifact card (a simple card: no tabs). It has no
 * cascading settings, so the defaults editor shows nothing.
 */
export default function ArtifactSettingsPanel({ ctl, mode }: Props) {
  if (mode === "defaults") return null;
  return (
    <div>
      <Segmented
        label="Slider axis"
        description="What the step slider shows."
        value={ctl.value.xAxis ?? "step"}
        onChange={(xAxis) => ctl.set({ xAxis })}
        overridden={ctl.isOverridden("xAxis")}
        onReset={() => ctl.reset("xAxis")}
        disabled={ctl.locked}
        options={[
          { value: "step", label: "Step" },
          { value: "relative_time", label: "Relative" },
          { value: "wall_time", label: "Wall" },
        ]}
      />
    </div>
  );
}
