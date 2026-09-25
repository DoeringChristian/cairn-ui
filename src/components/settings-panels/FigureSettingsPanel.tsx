import type { SettingsController } from "../../lib/card-settings";
import type { FigureMergeabilityResult } from "../../lib/plot-utils/figure-merge";
import type { DragMode, FigureCompareMode, FigureSettings, HoverMode } from "../cards-settings/figure";
import { Segmented, Select, SettingsSection, SettingsTabs, Switch } from "../settings/palette";
import { LayoutSection, SliderSection, bind, type MediaPanelCtx, type PanelSurface } from "./media-panel-kit";

export interface FigurePanelCtx extends MediaPanelCtx {
  /** Whether the shown figures can be overlaid (multi-run cards). */
  merge?: FigureMergeabilityResult;
}

const COMPARE_OPTIONS = [
  { value: "panes", label: "Panes" },
  { value: "overlay", label: "Overlay" },
] as const satisfies ReadonlyArray<{ value: FigureCompareMode; label: string }>;

const HOVER_OPTIONS = [
  { value: "closest", label: "Closest" },
  { value: "x unified", label: "X unified" },
  { value: "y unified", label: "Y unified" },
  { value: "none", label: "None" },
] as const satisfies ReadonlyArray<{ value: HoverMode; label: string }>;

const DRAG_OPTIONS = [
  { value: "zoom", label: "Zoom" },
  { value: "pan", label: "Pan" },
  { value: "select", label: "Select" },
  { value: "lasso", label: "Lasso" },
  { value: "none", label: "None" },
] as const satisfies ReadonlyArray<{ value: DragMode; label: string }>;

export default function FigureSettingsPanel({
  ctl,
  ctx,
  mode,
}: {
  ctl: SettingsController<FigureSettings>;
  ctx?: FigurePanelCtx;
  mode: PanelSurface;
}) {
  const s = ctl.value;
  const compare = s.figureCompare ?? "panes";
  const data = <SliderSection ctl={ctl} ctx={ctx} />;
  const display = (
    <>
      {mode === "card" && ctx?.multi && (
        <SettingsSection name="Compare">
          <Segmented<FigureCompareMode>
            value={compare}
            onChange={(v) => ctl.set({ figureCompare: v })}
            overridden={ctl.isOverridden("figureCompare")}
            onReset={() => ctl.reset("figureCompare")}
            options={COMPARE_OPTIONS}
            label="Runs"
            description={
              compare === "overlay" && ctx.merge && !ctx.merge.mergeable
                ? `Overlay unavailable for this figure type${ctx.merge.reason ? ` (${ctx.merge.reason})` : ""}; showing panes.`
                : "Overlay merges every run's figure into one plot, coloured by run; panes show them side by side."
            }
          />
        </SettingsSection>
      )}
      <LayoutSection ctl={ctl} ctx={ctx} mode={mode} />
      <SettingsSection name="Appearance">
        <Switch {...bind(ctl, "displayModeBar")} label="Show modebar" description="Plotly's zoom/pan/camera/save toolbar" />
        <Switch {...bind(ctl, "scrollZoom")} label="Scroll to zoom" />
        <Select<HoverMode> {...bind(ctl, "hoverMode")} options={HOVER_OPTIONS} label="Hover mode" />
        <Select<DragMode> {...bind(ctl, "dragMode")} options={DRAG_OPTIONS} label="Drag mode" />
        <Switch {...bind(ctl, "showLegend")} label="Show legend" />
      </SettingsSection>
    </>
  );
  return <SettingsTabs tabs={{ data, display }} />;
}
