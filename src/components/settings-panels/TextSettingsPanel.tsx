import type { SettingsController } from "../../lib/card-settings";
import type { TextSettings } from "../cards-settings/text";
import type { SteppedMediaPanelCtx } from "../media/SteppedMediaCard";
import { Segmented, SettingsSection, SettingsTabs, Switch } from "../settings/palette";
import { LayoutSection, SliderSection, bind, type PanelSurface } from "./media-panel-kit";

/** Text: the slider (and Index) under Values; the layout and the text's look under Display. */
export default function TextSettingsPanel({
  ctl,
  ctx,
  mode,
}: {
  ctl: SettingsController<TextSettings>;
  ctx?: SteppedMediaPanelCtx;
  mode: PanelSurface;
}) {
  return (
    <SettingsTabs
      tabs={{
        values: <SliderSection ctl={ctl} ctx={ctx} />,
        display: (
          <>
            <LayoutSection ctl={ctl} modes ctx={ctx} mode={mode} paneKeys={ctx?.paneKeys} />
            <SettingsSection name="Appearance">
              <Segmented
                label="Font size"
                {...bind(ctl, "fontSize")}
                options={[
                  { value: "xs", label: "XS" },
                  { value: "sm", label: "S" },
                  { value: "base", label: "M" },
                ]}
              />
              <Switch
                label="Word wrap"
                description="Wrap long lines to the card's width; off scrolls sideways."
                {...bind(ctl, "wordWrap")}
              />
            </SettingsSection>
          </>
        ),
      }}
    />
  );
}
