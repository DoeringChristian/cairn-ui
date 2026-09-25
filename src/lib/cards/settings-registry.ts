/**
 * Settings metadata for every card type: its built-in defaults, the keys that
 * inherit workspace/section defaults, and the tabs its settings panel fills.
 * Each type's metadata lives beside its settings interface in
 * `components/cards-settings/<type>.ts`; see lib/settings-cascade.ts for how
 * the layers resolve.
 */

import type { CardType } from "./card-spec";
import type { CardSettingsMeta } from "../../components/cards-settings/meta";
import { meta as artifact } from "../../components/cards-settings/artifact.ts";
import { meta as audio } from "../../components/cards-settings/audio.ts";
import { meta as bar } from "../../components/cards-settings/bar.ts";
import { meta as boxes3d } from "../../components/cards-settings/boxes3d.ts";
import { meta as figure } from "../../components/cards-settings/figure.ts";
import { meta as histogram } from "../../components/cards-settings/histogram.ts";
import { meta as html } from "../../components/cards-settings/html.ts";
import { meta as image } from "../../components/cards-settings/image.ts";
import { meta as importance } from "../../components/cards-settings/importance.ts";
import { meta as runCompare } from "../../components/cards-settings/run-compare.ts";
import { meta as codeDiff } from "../../components/cards-settings/code-diff.ts";
import { meta as markdown } from "../../components/cards-settings/markdown.ts";
import { meta as mesh } from "../../components/cards-settings/mesh.ts";
import { meta as parallel } from "../../components/cards-settings/parallel.ts";
import { meta as pointcloud } from "../../components/cards-settings/pointcloud.ts";
import { meta as preset } from "../../components/cards-settings/preset.ts";
import { meta as scalar } from "../../components/cards-settings/scalar.ts";
import { meta as scatter } from "../../components/cards-settings/scatter.ts";
import { meta as table } from "../../components/cards-settings/table.ts";
import { meta as tensor } from "../../components/cards-settings/tensor.ts";
import { meta as text } from "../../components/cards-settings/text.ts";
import { meta as tile } from "../../components/cards-settings/tile.ts";
import { meta as video } from "../../components/cards-settings/video.ts";
import { meta as volume } from "../../components/cards-settings/volume.ts";

export type { CardSettingsMeta, SettingsTab } from "../../components/cards-settings/meta";
export { SETTINGS_TABS } from "../../components/cards-settings/meta.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const REGISTRY: Record<CardType, CardSettingsMeta<any>> = {
  scalar,
  image,
  figure,
  audio,
  video,
  histogram,
  tensor,
  text,
  pointcloud,
  mesh,
  boxes3d,
  volume,
  preset,
  parallel,
  scatter,
  bar,
  tile,
  importance,
  "run-compare": runCompare,
  "code-diff": codeDiff,
  table,
  html,
  markdown,
  artifact,
};

/** A card type's settings metadata. */
export function metaFor(type: CardType): CardSettingsMeta<Record<string, unknown>> {
  return REGISTRY[type];
}
