import { SettingsSection, SettingsTabs, Switch } from "../settings/palette";
import { bind, type SettingsController } from "../../lib/card-settings";
import type { ConfigSettings } from "../cards-settings/config";

interface Props {
  ctl: SettingsController<ConfigSettings>;
  mode: "card" | "defaults";
}

export default function ConfigSettingsPanel({ ctl }: Props) {
  const display = (
    <SettingsSection name="Compare">
      <Switch label="Only diffs" description="Hide the keys that are the same in every column" {...bind(ctl, "onlyDiffs")} />
    </SettingsSection>
  );
  return <SettingsTabs tabs={{ display }} />;
}
