import type { SettingsController } from "../../lib/card-settings";
import { HTML_MAX_HEIGHT, HTML_MIN_HEIGHT, type HtmlSettings } from "../cards-settings/html";
import type { SteppedMediaPanelCtx } from "../media/SteppedMediaCard";
import { SettingsSection, Slider, Switch, SettingsTabs } from "../settings/palette";
import { LayoutSection, SliderSection, bind, type PanelSurface } from "./media-panel-kit";

/** HTML: the slider under Values, the layout and appearance under Display. */
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
    <SettingsTabs
      tabs={{
        values: <SliderSection ctl={ctl} ctx={ctx} />,
        display: (
          <>
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
        ),
      }}
    />
  );
}
