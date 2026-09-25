/**
 * Lazy registry of every card type's settings panel
 * (`components/settings-panels/<Type>SettingsPanel.tsx`), for surfaces that
 * render a panel without its card (the defaults editor). Each panel takes
 * `{ctl, ctx?, mode: "card" | "defaults"}`.
 */

import type { ComponentType } from "react";
import type { CardType } from "./card-spec";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const SETTINGS_PANELS: Partial<Record<CardType, () => Promise<{ default: ComponentType<any> }>>> = {
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
