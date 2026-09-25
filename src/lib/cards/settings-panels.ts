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
  scalar: () => import("../../components/settings-panels/ScalarSettingsPanel"),
  image: () => import("../../components/settings-panels/ImageSettingsPanel"),
  audio: () => import("../../components/settings-panels/AudioSettingsPanel"),
  video: () => import("../../components/settings-panels/VideoSettingsPanel"),
  html: () => import("../../components/settings-panels/HtmlSettingsPanel"),
  markdown: () => import("../../components/settings-panels/MarkdownSettingsPanel"),
  tensor: () => import("../../components/settings-panels/TensorSettingsPanel"),
  figure: () => import("../../components/settings-panels/FigureSettingsPanel"),
  preset: () => import("../../components/settings-panels/PresetSettingsPanel"),
  pointcloud: () => import("../../components/settings-panels/Scene3DSettingsPanel"),
  mesh: () => import("../../components/settings-panels/Scene3DSettingsPanel"),
  boxes3d: () => import("../../components/settings-panels/Scene3DSettingsPanel"),
  volume: () => import("../../components/settings-panels/VolumeSettingsPanel"),
};
