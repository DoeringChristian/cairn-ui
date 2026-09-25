import type { BaseCardSettings } from "../card-kit/base-settings";
import type { ScalarExprDef } from "../../lib/scalar-exprs";
import type { CardSettingsMeta } from "./meta";

export type TileReduce = "best" | "mean" | "latest";
export type TileBestDir = "max" | "min";

export interface TileSettings extends BaseCardSettings {
  /** One scalar per run (`last(acc)`, `config.lr`, …), reduced across runs. */
  metric: ScalarExprDef | null;
  reduce: TileReduce;
  bestDir: TileBestDir;
}

export const builtin: TileSettings = {
  version: 1,
  metric: null,
  reduce: "best",
  bestDir: "max",
  colSpan: 1,
};

export function instanceDefaults(): Partial<TileSettings> {
  return {};
}

export const meta: CardSettingsMeta<TileSettings> = {
  builtin,
  cascadeKeys: ["reduce", "bestDir"],
  tabs: ["data"],
};
