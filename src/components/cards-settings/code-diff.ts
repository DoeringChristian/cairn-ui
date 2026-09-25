import type { BaseCardSettings } from "../card-kit/base-settings";
import type { CardSettingsMeta } from "./meta";

export type CodeDiffLayout = "split" | "unified";

export interface CodeDiffSettings extends BaseCardSettings {
  /** The "before" run; null: the first of the card's runs. */
  leftRunId: string | null;
  /** The "after" run; null: the second of the card's runs. */
  rightRunId: string | null;
  /** The file shown; null: the first changed file. */
  path: string | null;
  layout: CodeDiffLayout;
  /** List only added, removed and modified files. */
  onlyChanged: boolean;
  /** Unchanged lines kept around each change; null shows the whole file. */
  context: number | null;
}

export const builtin: CodeDiffSettings = {
  version: 1,
  leftRunId: null,
  rightRunId: null,
  path: null,
  layout: "split",
  onlyChanged: true,
  context: 3,
  colSpan: 6,
};

export function instanceDefaults(): Partial<CodeDiffSettings> {
  return {};
}

export const meta: CardSettingsMeta<CodeDiffSettings> = {
  builtin,
  cascadeKeys: ["layout", "onlyChanged", "context"],
  tabs: ["data", "display"],
};
