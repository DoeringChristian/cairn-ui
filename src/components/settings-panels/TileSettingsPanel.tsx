import { Segmented, SettingsSection, SettingsTabs, type FieldOption } from "../settings/palette";
import { bind, type SettingsController } from "../../lib/card-settings";
import type { TileBestDir, TileReduce, TileSettings } from "../cards-settings/tile";
import ExprField from "./ExprField";

export interface PanelCtx {
  options: FieldOption[];
  error: string | null;
}

interface Props {
  ctl: SettingsController<TileSettings>;
  ctx?: PanelCtx;
  mode: "card" | "defaults";
}

export default function TileSettingsPanel({ ctl, ctx, mode }: Props) {
  const s = ctl.value;
  const card = mode === "card";
  const data = (
    <SettingsSection name="Series">
      {card && (
        <ExprField
          label="Value"
          info="One number per run, e.g. last(acc), max(val.acc) or config.lr."
          value={s.metric?.src ?? null}
          onChange={(src) => ctl.set({ metric: src == null ? null : { src } })}
          overridden={ctl.isOverridden("metric")}
          onReset={() => ctl.reset("metric")}
          disabled={ctl.readOnly}
          options={ctx?.options ?? []}
          error={ctx?.error}
        />
      )}
      <Segmented<TileReduce>
        label="Across runs"
          layout="stacked"
        options={[
          { value: "best", label: "Best" },
          { value: "mean", label: "Mean" },
          { value: "latest", label: "Latest run" },
        ]}
        {...bind(ctl, "reduce")}
      />
      {(!card || s.reduce === "best") && (
        <Segmented<TileBestDir>
          label="Best is"
          options={[
            { value: "max", label: "Maximum" },
            { value: "min", label: "Minimum" },
          ]}
          {...bind(ctl, "bestDir")}
        />
      )}
    </SettingsSection>
  );
  return <SettingsTabs tabs={{ data }} />;
}
