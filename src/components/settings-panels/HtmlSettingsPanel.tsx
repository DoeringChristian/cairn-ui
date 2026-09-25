import type { SettingsController } from "../../lib/card-settings";
import type { HtmlSettings } from "../cards-settings/html";
import type { SteppedMediaPanelCtx } from "../media/SteppedMediaCard";
import { SettingsSection, Slider, Switch } from "../settings/palette";
import { LayoutSection, SliderSection, bind, type PanelSurface } from "./media-panel-kit";

export const HTML_MIN_HEIGHT = 80;
export const HTML_MAX_HEIGHT = 2000;

/** HTML is a simple card: its sections without tabs. */
export default function HtmlSettingsPanel({
  ctl,
  ctx,
  mode,
}: {
  ctl: SettingsController<HtmlSettings>;
  ctx?: SteppedMediaPanelCtx;
  mode: PanelSurface;
}) {
  return (
    <>
      <SliderSection ctl={ctl} ctx={ctx} />
      <LayoutSection ctl={ctl} modes ctx={ctx} mode={mode} paneKeys={ctx?.paneKeys} />
      <SettingsSection name="Appearance">
        <Switch
          {...bind(ctl, "autoHeight")}
          label="Auto-height"
          description={'Resize to the document’s content height via the "cairn:resize" postMessage shim. Falls back to a fixed height if the document never posts a size.'}
        />
        <Slider
          {...bind(ctl, "fixedHeight", { mergeKey: true })}
          label="Fixed height"
          min={HTML_MIN_HEIGHT}
          max={HTML_MAX_HEIGHT}
          step={20}
          format={(v) => `${v}px`}
        />
      </SettingsSection>
    </>
  );
}
