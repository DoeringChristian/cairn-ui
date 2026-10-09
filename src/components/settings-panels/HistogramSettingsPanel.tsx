import { ColormapSelect, Segmented, SettingsSection, SettingsTabs, Switch } from "../settings/palette";
import { bind, type SettingsController } from "../../lib/card-settings";
import { formatNum } from "../../lib/plot-utils/format";
import type { HistogramSettings } from "../cards-settings/histogram";
import type { MediaLayoutSettings } from "../cards-settings/media";
import { IndexControls } from "./media-panel-kit";

export interface PanelCtx {
  /** The shown step's histogram summary (the first run's). */
  meta: { num_bins: number; min: number; max: number; count: number; mean: number } | null;
  /** The card's points are lists (several histograms per step): the Index shows. */
  lists?: boolean;
}

interface Props {
  ctl: SettingsController<HistogramSettings>;
  ctx?: PanelCtx;
  mode: "card" | "defaults";
}

export default function HistogramSettingsPanel({ ctl, ctx, mode }: Props) {
  const s = ctl.value;
  const card = mode === "card";
  const heatmap = s.viewMode !== "bars";
  const meta = card ? ctx?.meta : null;

  const summary = meta && (
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
  );

  const data = (summary || (card && ctx?.lists)) && (
    <SettingsSection name="Series">
      {summary}
      {card && ctx?.lists && (
        <IndexControls ctl={ctl as unknown as SettingsController<MediaLayoutSettings>} />
      )}
    </SettingsSection>
  );

  const display = (
    <SettingsSection name="Appearance">
      <Segmented<HistogramSettings["viewMode"]>
        label="View"
        layout="stacked"
        options={[
          { value: "heatmap", label: "Heatmap (over steps)" },
          { value: "bars", label: "Bars (per step)" },
        ]}
        info="Heatmap: one strip per run (per group when the workspace is grouped), x = the x axis, y = value, colour = the share of the step's samples in each bin; hover a step for its histogram. Bars: one step's histograms, picked with the slider."
        {...bind(ctl, "viewMode")}
      />
      <Segmented<NonNullable<HistogramSettings["xAxis"]>>
        label="X axis"
        layout="stacked"
        options={[
          { value: "step", label: "Step" },
          { value: "relative_time", label: "Relative time" },
          { value: "wall_time", label: "Wall time" },
        ]}
        value={s.xAxis ?? "step"}
        onChange={(v) => ctl.set({ xAxis: v })}
        overridden={ctl.isOverridden("xAxis")}
        onReset={() => ctl.reset("xAxis")}
        disabled={ctl.locked}
      />
      <Switch label={heatmap ? "Log colour scale" : "Log Y axis"} {...bind(ctl, "logY")} />
      {(!card || heatmap) && <ColormapSelect label="Colormap" {...bind(ctl, "colormap")} />}
    </SettingsSection>
  );

  return <SettingsTabs tabs={{ values: data || null, display }} />;
}
