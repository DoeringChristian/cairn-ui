/**
 * Each card type's settings panel, loaded lazily: the card renders it in
 * its settings pane (`mode="card"`), the defaults editor in `mode="defaults"`
 * (only the type's cascade keys). See components/settings-panels/.
 */
import type { ComponentType } from "react";
import type { CardType } from "./card-spec";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const SETTINGS_PANELS: Partial<Record<CardType, () => Promise<{ default: ComponentType<any> }>>> = {
  histogram: () => import("../../components/settings-panels/HistogramSettingsPanel"),
  scatter: () => import("../../components/settings-panels/ScatterSettingsPanel"),
  bar: () => import("../../components/settings-panels/BarSettingsPanel"),
  parallel: () => import("../../components/settings-panels/ParallelSettingsPanel"),
  tile: () => import("../../components/settings-panels/TileSettingsPanel"),
  importance: () => import("../../components/settings-panels/ImportanceSettingsPanel"),
};
