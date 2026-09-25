import type { SettingsController } from "../../lib/card-settings";
import type { MarkdownFontSize, MarkdownSettings } from "../cards-settings/markdown";
import type { SteppedMediaPanelCtx } from "../media/SteppedMediaCard";
import { Segmented, SettingsSection } from "../settings/palette";
import { LayoutSection, SliderSection, bind, type PanelSurface } from "./media-panel-kit";

const FONT_SIZES = [
  { value: "xs", label: "XS" },
  { value: "sm", label: "S" },
  { value: "base", label: "M" },
] as const satisfies ReadonlyArray<{ value: MarkdownFontSize; label: string }>;

/** Markdown is a simple card: its sections without tabs. */
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
    <>
      <SliderSection ctl={ctl} ctx={ctx} />
      <LayoutSection ctl={ctl} modes ctx={ctx} mode={mode} paneKeys={ctx?.paneKeys} />
      <SettingsSection name="Appearance">
        <Segmented<MarkdownFontSize> {...bind(ctl, "fontSize")} options={FONT_SIZES} label="Font size" />
      </SettingsSection>
    </>
  );
}
