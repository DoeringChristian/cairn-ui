/**
 * Each card type's settings panel, loaded lazily: the card renders it in its
 * detail modal (`mode="card"`), the defaults editor with `mode="defaults"`.
 */
import type { ComponentType } from "react";
import type { CardType } from "./card-spec";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const SETTINGS_PANELS: Partial<Record<CardType, () => Promise<{ default: ComponentType<any> }>>> = {
  table: () => import("../../components/settings-panels/TableSettingsPanel"),
  text: () => import("../../components/settings-panels/TextSettingsPanel"),
  artifact: () => import("../../components/settings-panels/ArtifactSettingsPanel"),
};
