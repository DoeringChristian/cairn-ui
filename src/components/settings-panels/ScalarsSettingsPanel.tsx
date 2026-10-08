import { SettingsAction, SettingsSection, SettingsTabs, Switch } from "../settings/palette";
import { bind, type SettingsController } from "../../lib/card-settings";
import type { ScalarsSettings } from "../cards-settings/scalars";

interface Props {
  ctl: SettingsController<ScalarsSettings>;
  mode: "card" | "defaults";
}

export default function ScalarsSettingsPanel({ ctl }: Props) {
  const display = (
    <SettingsSection name="Layout">
      <Switch label="Show run info" description="Status, duration, created, user and host first" {...bind(ctl, "showRunInfo")} />
      {(ctl.value.hidden ?? []).length > 0 && (
        <SettingsAction
          label={`Show hidden columns (${ctl.value.hidden.length})`}
          icon="fa-eye"
          disabled={ctl.locked}
          onClick={() => ctl.set({ hidden: [] })}
        />
      )}
    </SettingsSection>
  );
  return <SettingsTabs tabs={{ display }} />;
}
