import {
  NumberInput,
  Segmented,
  Select,
  SettingsSection,
  SettingsTabs,
  Switch,
  type SelectOption,
} from "../settings/palette";
import { bind, type SettingsController } from "../../lib/card-settings";
import type { CodeDiffLayout, CodeDiffSettings } from "../cards-settings/code-diff";

export interface PanelCtx {
  /** The card's runs, labelled. */
  runs: SelectOption<string>[];
  /** The effective pair (defaults resolved). */
  leftId: string;
  rightId: string;
}

interface Props {
  ctl: SettingsController<CodeDiffSettings>;
  ctx?: PanelCtx;
  mode: "card" | "defaults";
}

export default function CodeDiffSettingsPanel({ ctl, ctx, mode }: Props) {
  const data = mode === "card" && ctx && (
    <SettingsSection name="Compare">
      <Select<string>
        label="Before"
        options={ctx.runs}
        {...bind(ctl, "leftRunId")}
        value={ctx.leftId}
        onChange={(v) => ctl.set({ leftRunId: v })}
      />
      <Select<string>
        label="After"
        options={ctx.runs}
        {...bind(ctl, "rightRunId")}
        value={ctx.rightId}
        onChange={(v) => ctl.set({ rightRunId: v })}
      />
    </SettingsSection>
  );
  const display = (
    <SettingsSection name="Layout">
      <Segmented<CodeDiffLayout>
        label="Layout"
        options={[
          { value: "split", label: "Side by side" },
          { value: "unified", label: "Unified" },
        ]}
        {...bind(ctl, "layout")}
      />
      <Switch label="Only changed files" description="List added, removed and modified files only" {...bind(ctl, "onlyChanged")} />
      <NumberInput
        label="Context lines"
        info="Unchanged lines kept around each change. Empty shows the whole file."
        min={0}
        max={200}
        integer
        nullable
        placeholder="whole file"
        {...bind(ctl, "context")}
      />
    </SettingsSection>
  );
  return <SettingsTabs tabs={{ data, display }} />;
}
