/**
 * The settings palette: every card's settings panel is built from these.
 * Controls take `Bound<V>` (`value`, `onChange`, `overridden`, `onReset`,
 * `disabled`) plus the row props (`label`, `description`, `info`, `error`,
 * `layout`) and render through `SettingRow`. The `/_ui` page shows them all.
 */
export type { Bound, ControlProps, RowLayout, RowProps } from "./types";
export {
  SECTION_NAMES,
  SETTINGS_TABS,
  type FieldKind,
  type FieldOption,
  type RangeValue,
  type SectionName,
  type SettingsTabId,
} from "./logic";
export { default as SettingRow } from "./SettingRow";
export { default as SettingsSection } from "./SettingsSection";
export { default as SettingsTabs } from "./SettingsTabs";
export { default as SettingsAction } from "./SettingsAction";
export { default as Switch } from "./Switch";
export { default as Select, type SelectOption } from "./Select";
export { default as Segmented, type SegmentedOption } from "./Segmented";
export { default as Slider } from "./Slider";
export { default as SliderInput } from "./SliderInput";
export { default as NumberInput } from "./NumberInput";
export { default as Stepper } from "./Stepper";
export { default as RangeInput } from "./RangeInput";
export { default as TextInput } from "./TextInput";
export { default as ColormapSelect } from "./ColormapSelect";
export { default as CheckList, type CheckItem } from "./CheckList";
export { default as FieldPicker } from "./FieldPicker";
export { default as FieldMultiPicker } from "./FieldMultiPicker";
