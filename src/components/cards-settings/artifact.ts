import type { BaseCardSettings } from "../card-kit/base-settings";
import type { CardSettingsMeta } from "./meta";

export interface ArtifactSettings extends BaseCardSettings {
  sliderStep?: number;
  xAxis?: "step" | "relative_time" | "wall_time";
}

export const builtin: ArtifactSettings = { version: 1 };

export function instanceDefaults(_seed: { name: string }): Partial<ArtifactSettings> {
  return {};
}

export const meta: CardSettingsMeta<ArtifactSettings> = { builtin, cascadeKeys: [], tabs: [] };
