import type { SettingsController } from "../../lib/card-settings";
import type { MarkdownFontSize, MarkdownSettings } from "../cards-settings/markdown";
import type { SteppedMediaPanelCtx } from "../media/SteppedMediaCard";
import { Segmented, SettingsSection, SettingsTabs } from "../settings/palette";
import { LayoutSection, SliderSection, bind, type PanelSurface } from "./media-panel-kit";

const FONT_SIZES = [
  { value: "xs", label: "XS" },
  { value: "sm", label: "S" },
  { value: "base", label: "M" },
] as const satisfies ReadonlyArray<{ value: MarkdownFontSize; label: string }>;

/** Markdown: the slider under Values, the layout and appearance under Display. */
export default function MarkdownSettingsPanel({
  ctl,
  ctx,
  mode,
}: {
  ctl: SettingsController<MarkdownSettings>;
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
        <Segmented<MarkdownFontSize> {...bind(ctl, "fontSize")} options={FONT_SIZES} label="Font size" />
      </SettingsSection>
          </>
        ),
      }}
    />
  );
}
