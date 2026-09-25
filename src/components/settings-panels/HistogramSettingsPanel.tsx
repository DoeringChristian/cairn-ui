import { ColormapSelect, Segmented, SettingsSection, SettingsTabs, Switch } from "../settings/palette";
import { bind, type SettingsController } from "../../lib/card-settings";
import { formatNum } from "../../lib/plot-utils/types";
import type { HistogramSettings } from "../cards-settings/histogram";

export interface PanelCtx {
  /** The heatmap needs more than 3 logged steps. */
  heatmapAvailable: boolean;
  /** The shown step's histogram summary. */
  meta: { num_bins: number; min: number; max: number; count: number; mean: number } | null;
}

interface Props {
  ctl: SettingsController<HistogramSettings>;
  ctx?: PanelCtx;
  mode: "card" | "defaults";
}

export default function HistogramSettingsPanel({ ctl, ctx, mode }: Props) {
  const s = ctl.value;
  const card = mode === "card";
  const heatmap = s.viewMode === "heatmap";
  const meta = card ? ctx?.meta : null;

  const data = meta && (
    <SettingsSection name="Series">
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 py-1.5 text-xs text-fg-muted">
        <dt>min</dt>
        <dd className="mono num">{formatNum(meta.min)}</dd>
        <dt>max</dt>
        <dd className="mono num">{formatNum(meta.max)}</dd>
        <dt>mean</dt>
        <dd className="mono num">{formatNum(meta.mean)}</dd>
        <dt>count</dt>
        <dd className="mono num">{meta.count}</dd>
        <dt>num_bins</dt>
        <dd className="mono num">{meta.num_bins}</dd>
      </dl>
    </SettingsSection>
  );

  const display = (
    <SettingsSection name="Appearance">
      <Segmented<HistogramSettings["viewMode"]>
        label="View"
        options={[
          { value: "bars", label: "Bars (per step)" },
          { value: "heatmap", label: "Heatmap (over steps)" },
        ]}
        description={card && ctx && !ctx.heatmapAvailable ? "Heatmap needs more than 3 logged steps." : undefined}
        {...bind(ctl, "viewMode")}
      />
      <Switch label={heatmap ? "Log colour scale" : "Log Y axis"} {...bind(ctl, "logY")} />
      {(!card || heatmap) && <ColormapSelect label="Colormap" {...bind(ctl, "colormap")} />}
    </SettingsSection>
  );

  return <SettingsTabs tabs={{ data, display }} />;
}
