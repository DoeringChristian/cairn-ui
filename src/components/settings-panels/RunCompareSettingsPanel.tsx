import {
  CheckList,
  FieldMultiPicker,
  SettingsSection,
  SettingsTabs,
  Switch,
  TextInput,
  type FieldOption,
} from "../settings/palette";
import { bind, type SettingsController } from "../../lib/card-settings";
import type { RunCompareSection, RunCompareSettings } from "../cards-settings/run-compare";

export interface PanelCtx {
  /** Every key of the card's tables (params and metrics), to pin. */
  keys: FieldOption[];
}

interface Props {
  ctl: SettingsController<RunCompareSettings>;
  ctx?: PanelCtx;
  mode: "card" | "defaults";
}

const SECTIONS: { key: RunCompareSection; label: string; description: string }[] = [
  { key: "metrics", label: "Metrics", description: "Final values; best green, worst red" },
  { key: "params", label: "Parameters", description: "Logged params" },
  { key: "env", label: "Environment", description: "Python, platform, CUDA, GPUs" },
];

export default function RunCompareSettingsPanel({ ctl, ctx, mode }: Props) {
  const card = mode === "card";
  const data = (
    <SettingsSection name="Series">
      <CheckList
        label="Tables"
        items={SECTIONS}
        bulk={false}
        {...bind(ctl, "sections")}
        onChange={(v) => ctl.set({ sections: SECTIONS.map((s) => s.key).filter((k) => v.includes(k)) })}
      />
      {card && (
        <TextInput
          label="Filter"
          info="Show only keys containing this text (case-insensitive). Pinned keys always show."
          placeholder="all keys"
          mono
          {...bind(ctl, "filter")}
        />
      )}
      {card && (
        <FieldMultiPicker
          label="Pinned keys"
          info="Shown first in every table, even when they do not differ. Also toggled with the pin on a row."
          options={ctx?.keys ?? []}
          addLabel="Pin"
          {...bind(ctl, "pinnedKeys")}
        />
      )}
    </SettingsSection>
  );
  const display = (
    <SettingsSection name="Compare">
      <Switch label="Only differences" description="Hide rows that are the same in every run" {...bind(ctl, "onlyDiffs")} />
    </SettingsSection>
  );
  return <SettingsTabs tabs={{ data, display }} />;
}
