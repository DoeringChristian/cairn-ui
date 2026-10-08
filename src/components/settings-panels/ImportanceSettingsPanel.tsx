import { Segmented, Select, SettingsSection, SettingsTabs } from "../settings/palette";
import { bind, type SettingsController } from "../../lib/card-settings";
import type { ImportanceSort } from "../../lib/plot-utils/importance";
import type { ImportanceSettings } from "../cards-settings/importance";

export interface PanelCtx {
  /** The runs' metrics (final values). */
  metrics: string[];
  /** The metric shown (the chosen one, else the default). */
  metric: string | null;
}

interface Props {
  ctl: SettingsController<ImportanceSettings>;
  ctx?: PanelCtx;
  mode: "card" | "defaults";
}

export default function ImportanceSettingsPanel({ ctl, ctx, mode }: Props) {
  if (mode !== "card") return null;
  const metrics = ctx?.metrics ?? [];
  const values = (
    <SettingsSection name="Series">
      <Select<string>
        label="Metric"
        info="Its final value per run (the project's summary rule); the params should explain it."
        value={ctx?.metric ?? ""}
        options={metrics.length ? metrics.map((m) => ({ value: m, label: m })) : [{ value: "", label: "No metric", disabled: true }]}
        onChange={(m) => ctl.set({ metric: m || null })}
        overridden={ctl.isOverridden("metric")}
        onReset={() => ctl.reset("metric")}
        disabled={ctl.locked}
      />
      <Segmented<ImportanceSort>
        label="Sort by"
        options={[
          { value: "importance", label: "Importance" },
          { value: "correlation", label: "Correlation" },
        ]}
        {...bind(ctl, "sort")}
      />
    </SettingsSection>
  );
  return <SettingsTabs tabs={{ values }} />;
}
