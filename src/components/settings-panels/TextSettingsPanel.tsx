import type { SettingsController } from "../../lib/card-settings";
import type { TextSettings } from "../cards-settings/text";
import { Segmented, Switch, type Bound } from "../settings/palette";

interface Props {
  ctl: SettingsController<TextSettings>;
  ctx?: undefined;
  mode: "card" | "defaults";
}

function bind<K extends keyof TextSettings & string>(ctl: SettingsController<TextSettings>, k: K): Bound<TextSettings[K]> {
  return {
    value: ctl.value[k],
    onChange: (v) => ctl.set({ [k]: v } as Partial<TextSettings>),
    overridden: ctl.isOverridden(k),
    onReset: () => ctl.reset(k),
    disabled: ctl.readOnly,
  };
}

/** Settings of the text card (a simple card: no tabs). */
export default function TextSettingsPanel({ ctl }: Props) {
  return (
    <div>
      <Segmented
        label="Font size"
        {...bind(ctl, "fontSize")}
        options={[
          { value: "xs", label: "XS" },
          { value: "sm", label: "S" },
          { value: "base", label: "M" },
        ]}
      />
      <Switch
        label="Word wrap"
        description="Wrap long lines to the card's width; off scrolls sideways."
        {...bind(ctl, "wordWrap")}
      />
    </div>
  );
}
