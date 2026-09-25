import {
  Segmented,
  Select,
  SettingsSection,
  SettingsTabs,
  Switch,
  type FieldOption,
} from "../settings/palette";
import { bind, type SettingsController } from "../../lib/card-settings";
import type { BarCompareMode } from "../../charts/BarChart";
import type { BarGroupPlot, BarSettings, BarSortBy } from "../cards-settings/bar";
import ExprField from "./ExprField";

export interface PanelCtx {
  options: FieldOption[];
  /** Runs on the card: comparing runs needs more than one. */
  runCount: number;
  errors: { metric: string | null; groupBy: string | null };
}

interface Props {
  ctl: SettingsController<BarSettings>;
  ctx?: PanelCtx;
  mode: "card" | "defaults";
}

const GROUP_PLOTS = [
  { value: "bar" as const, label: "Bar", icon: "fa-chart-bar" },
  { value: "box" as const, label: "Box", icon: "fa-box" },
  { value: "violin" as const, label: "Violin", icon: "fa-guitar" },
  { value: "strip" as const, label: "Strip", icon: "fa-ellipsis-vertical" },
];

export default function BarSettingsPanel({ ctl, ctx, mode }: Props) {
  const s = ctl.value;
  const card = mode === "card";
  const ro = ctl.readOnly;
  const options = ctx?.options ?? [];
  const compare = s.compareMode ?? "grouped";
  const distribution = s.groupPlot !== "bar";

  const exprBind = (k: "metric" | "groupBy") => ({
    value: s[k]?.src ?? null,
    onChange: (src: string | null) => ctl.set({ [k]: src == null ? null : { src } } as Partial<BarSettings>),
    overridden: ctl.isOverridden(k),
    onReset: () => ctl.reset(k),
    disabled: ro,
    options,
    error: ctx?.errors[k],
  });

  const data = card && (
    <SettingsSection name="Axes">
      <ExprField label="Value" info="One number per run, e.g. last(acc), min(val.loss) or config.lr." {...exprBind("metric")} />
      <Switch label="Log value axis" {...bind(ctl, "logX")} value={!!s.logX} />
    </SettingsSection>
  );

  const grouping = (
    <>
      <SettingsSection name="Series">
        {card && (
          <ExprField
            label="Group runs by"
            info="Runs with the same value form a group, e.g. run.group or config.optimizer. Empty: one bar per run."
            placeholder="none: one bar per run"
            clearable
            {...exprBind("groupBy")}
          />
        )}
        <Segmented<BarGroupPlot>
          label="Plot"
          description={
            s.groupPlot === "bar"
              ? "Each group's mean, with ± one standard deviation."
              : "Each group's spread, every run as a point."
          }
          options={GROUP_PLOTS}
          {...bind(ctl, "groupPlot")}
        />
      </SettingsSection>
      {card && !s.groupBy && !distribution && (ctx?.runCount ?? 0) > 1 && (
        <SettingsSection name="Compare">
          <Select<BarCompareMode>
            label="Compare runs"
            layout="stacked"
            value={compare}
            onChange={(v) => ctl.set({ compareMode: v })}
            overridden={ctl.isOverridden("compareMode")}
            onReset={() => ctl.reset("compareMode")}
            disabled={ro}
            options={[
              { value: "grouped", label: "Grouped (one row per run)" },
              { value: "stacked", label: "Stacked (summed total)", disabled: !!s.logX },
              { value: "overlay", label: "Overlay (translucent, superimposed)" },
            ]}
            description={
              s.logX
                ? "Stacked totals are misleading on a log axis, so it's disabled while log axis is on."
                : compare === "stacked"
                  ? "Bars stack in run order (not the sort setting); tooltip shows each run's share of the total."
                  : compare === "overlay"
                    ? "Bars are superimposed with transparency, drawn in sorted order (last drawn is on top)."
                    : undefined
            }
          />
        </SettingsSection>
      )}
    </>
  );

  const display = (
    <SettingsSection name="Layout">
      <Segmented<BarSortBy>
        label="Sort by"
        options={[
          { value: "value", label: "Value" },
          { value: "name", label: "Name" },
        ]}
        {...bind(ctl, "sortBy")}
      />
      <Switch
        label="Descending"
        value={s.sortDesc ?? true}
        onChange={(v) => ctl.set({ sortDesc: v })}
        overridden={ctl.isOverridden("sortDesc")}
        onReset={() => ctl.reset("sortDesc")}
        disabled={ro}
      />
    </SettingsSection>
  );

  return <SettingsTabs tabs={{ data, grouping, display }} />;
}
