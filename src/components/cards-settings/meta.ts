/**
 * The shape every `cards-settings/<type>.ts` module describes: a card type's
 * built-in defaults, which of its keys take workspace/section defaults (see
 * lib/settings-cascade.ts), and which settings tabs its panel fills.
 * `lib/cards/settings-registry.ts` collects one per `CARD_TYPES` entry.
 */

import { SETTINGS_TABS as TAB_DEFS, type SettingsTabId } from "../settings/palette/logic.ts";

/** The fixed settings tabs, in display order (defined by the settings palette). */
export type SettingsTab = SettingsTabId;
export const SETTINGS_TABS: readonly SettingsTab[] = TAB_DEFS.map((t) => t.id);

export interface CardSettingsMeta<T extends object = Record<string, unknown>> {
  /** Every key the type knows, at its built-in value. */
  builtin: T;
  /** Keys that inherit workspace and section defaults. */
  cascadeKeys: readonly (keyof T & string)[];
  /** Settings tabs the card's panel fills; empty for simple cards. */
  tabs: readonly SettingsTab[];
}
