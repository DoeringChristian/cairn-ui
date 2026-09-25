import type { ReactNode } from "react";
import type { SettingsController } from "../../lib/card-settings";
import type { TensorSettings, TensorViewMode } from "../cards-settings/tensor";
import { ColormapSelect, Segmented, SettingsSection, SettingsTabs, Slider, Switch } from "../settings/palette";
import { SliderSection, bind, type MediaPanelCtx, type PanelSurface } from "./media-panel-kit";

export interface TensorPanelCtx extends MediaPanelCtx {
  /** Sizes of the leading (all but the last two) dimensions: one slice slider each. */
  leadingDims: readonly number[];
  /** The tensor is below 2D (a heatmap falls back to a histogram). */
  below2d: boolean;
  /** Shape, dtype and value stats of the shown tensor. */
  stats?: ReactNode;
}

const VIEWS = [
  { value: "stats", label: "Stats", icon: "fa-list" },
  { value: "histogram", label: "Histogram", icon: "fa-chart-column" },
  { value: "heatmap", label: "Heatmap", icon: "fa-table-cells" },
] as const satisfies ReadonlyArray<{ value: TensorViewMode; label: string; icon: string }>;

export default function TensorSettingsPanel({
  ctl,
  ctx,
  mode,
}: {
  ctl: SettingsController<TensorSettings>;
  ctx?: TensorPanelCtx;
  mode: PanelSurface;
}) {
  const s = ctl.value;
  const card = mode === "card";
  const view = s.viewMode;
  const leading = card ? (ctx?.leadingDims ?? []) : [];

  const data = (
    <SliderSection ctl={ctl} ctx={ctx}>
      {view === "heatmap" &&
        leading.map((dim, k) => (
          <Slider
            key={k}
            label={`Slice dim ${k} (0–${dim - 1})`}
            value={Math.min(dim - 1, s.sliceIndices?.[k] ?? 0)}
            onChange={(v) => {
              const next = [...(s.sliceIndices ?? leading.map(() => 0))];
              next[k] = Math.round(v);
              ctl.set({ sliceIndices: next }, { mergeKey: `slice${k}` });
            }}
            overridden={ctl.isOverridden("sliceIndices")}
            onReset={() => ctl.reset("sliceIndices")}
            min={0}
            max={dim - 1}
            step={1}
          />
        ))}
    </SliderSection>
  );

  const display = (
    <>
      <SettingsSection name="Appearance">
        <Segmented<TensorViewMode>
          {...bind(ctl, "viewMode")}
          options={VIEWS}
          layout="stacked"
          label="View"
          description={card && ctx?.below2d && view === "heatmap" ? "Heatmap needs a 2D+ tensor; showing histogram." : undefined}
        />
        {(!card || view === "histogram") && (
          <Slider {...bind(ctl, "bins", { mergeKey: true })} label="Bins" min={8} max={256} step={8} />
        )}
        {(!card || view !== "stats") && (
          <Switch {...bind(ctl, "logY")} label={view === "heatmap" ? "Log color scale" : "Log Y axis"} />
        )}
        {(!card || view === "heatmap") && <ColormapSelect {...bind(ctl, "colormap")} label="Colormap" />}
      </SettingsSection>
      {card && ctx?.stats && <div className="mt-2">{ctx.stats}</div>}
    </>
  );

  return <SettingsTabs tabs={{ data, display }} />;
}
