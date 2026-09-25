import { Segmented, SettingsSection, SettingsTabs, type FieldOption } from "../settings/palette";
import { bind, type SettingsController } from "../../lib/card-settings";
import type { ImportanceMethod, ImportanceSettings } from "../cards-settings/importance";
import ExprField from "./ExprField";

export interface PanelCtx {
  /** Target options: metrics and summary keys (params are the inputs). */
  options: FieldOption[];
  error: string | null;
}

interface Props {
  ctl: SettingsController<ImportanceSettings>;
  ctx?: PanelCtx;
  mode: "card" | "defaults";
}

export default function ImportanceSettingsPanel({ ctl, ctx, mode }: Props) {
  const s = ctl.value;
  const data = (
    <SettingsSection name="Series">
      {mode === "card" && (
        <ExprField
          label="Target"
          info="The value the params should explain, one number per run: min(val.loss), last(acc), …"
          value={s.metric?.src ?? null}
          onChange={(src) => ctl.set({ metric: src == null ? null : { src } })}
          overridden={ctl.isOverridden("metric")}
          onReset={() => ctl.reset("metric")}
          disabled={ctl.readOnly}
          options={ctx?.options ?? []}
          error={ctx?.error}
        />
      )}
      <Segmented<ImportanceMethod>
        label="Method"
        layout="stacked"
        options={[
          { value: "importance", label: "Importance (forest)" },
          { value: "correlation", label: "Correlation (r)" },
        ]}
        description={
          s.method === "importance"
            ? "Out-of-bag permutation importance of a 50-tree forest, relative to the target's variance. Colour: sign of the correlation."
            : "Linear correlation with the target; numeric params only."
        }
        {...bind(ctl, "method")}
      />
    </SettingsSection>
  );
  return <SettingsTabs tabs={{ data }} />;
}
