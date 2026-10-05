/**
 * Custom viewers: where each manifest setting shows in the card's settings
 * (pure; tested in placement.test.ts). Every setting gets exactly one
 * place: its tab (default display) and section (default Appearance). A
 * section the card already renders in that tab (the viewer picker's Series,
 * the slider's Axes, Compare, Layout) takes the viewer's settings of that
 * name inside it; every other section is added, in manifest order.
 */

import type { ViewerManifest, ViewerSettingSection, ViewerSettingTab } from "./manifest.ts";

/** The sections the card's own settings fill, per tab. */
export const CARD_SECTIONS: Record<ViewerSettingTab, readonly ViewerSettingSection[]> = {
  values: ["Series", "Axes", "Compare"],
  grouping: [],
  display: ["Layout"],
  expressions: [],
};

export interface SectionPlacement {
  section: ViewerSettingSection;
  /** Setting keys, in manifest order. */
  keys: string[];
  /** Rendered inside the card's own section of this name. */
  merged: boolean;
}

export type Placement = Record<ViewerSettingTab, SectionPlacement[]>;

export function placeSettings(manifest: Pick<ViewerManifest, "settings">, cardSections = CARD_SECTIONS): Placement {
  const out: Placement = { values: [], grouping: [], display: [], expressions: [] };
  for (const s of manifest.settings) {
    const list = out[s.tab];
    let p = list.find((x) => x.section === s.section);
    if (!p) {
      p = { section: s.section, keys: [], merged: cardSections[s.tab].includes(s.section) };
      list.push(p);
    }
    p.keys.push(s.key);
  }
  return out;
}

/** The tab the settings open on: where the viewer's settings are (display first), else values. */
export function initialTab(placement: Placement): ViewerSettingTab {
  if (placement.display.length) return "display";
  if (placement.values.length) return "values";
  if (placement.grouping.length) return "grouping";
  if (placement.expressions.length) return "expressions";
  return "values";
}
