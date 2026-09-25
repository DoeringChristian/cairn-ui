/**
 * Lazy registry of card settings panels
 * (`components/settings-panels/<Type>SettingsPanel.tsx`). Each panel's
 * default export takes `{ctl, ctx?, mode: "card" | "defaults"}`; in
 * `"defaults"` mode it shows only the type's cascade keys (the defaults
 * editor, components/DefaultsEditor.tsx, renders it that way).
 *
 * One line per card type; a type without a line has no defaults editor yet.
 */

import type { ComponentType } from "react";
import type { CardType } from "./card-spec";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const SETTINGS_PANELS: Partial<Record<CardType, () => Promise<{ default: ComponentType<any> }>>> = {
  table: () => import("../../components/settings-panels/TableSettingsPanel"),
  text: () => import("../../components/settings-panels/TextSettingsPanel"),
  artifact: () => import("../../components/settings-panels/ArtifactSettingsPanel"),
  histogram: () => import("../../components/settings-panels/HistogramSettingsPanel"),
  scatter: () => import("../../components/settings-panels/ScatterSettingsPanel"),
  bar: () => import("../../components/settings-panels/BarSettingsPanel"),
  parallel: () => import("../../components/settings-panels/ParallelSettingsPanel"),
  tile: () => import("../../components/settings-panels/TileSettingsPanel"),
  importance: () => import("../../components/settings-panels/ImportanceSettingsPanel"),
};
