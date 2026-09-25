/**
 * The shape every `cards-settings/<type>.ts` module describes: a card type's
 * built-in defaults, which of its keys take workspace/section defaults (see
 * lib/settings-cascade.ts), and which settings tabs its panel fills.
 * `lib/cards/settings-registry.ts` collects one per `CARD_TYPES` entry.
 */

/** The fixed settings tabs, in display order. */
export const SETTINGS_TABS = ["data", "grouping", "display", "expressions"] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];

export interface CardSettingsMeta<T extends object = Record<string, unknown>> {
  /** Every key the type knows, at its built-in value. */
  builtin: T;
  /** Keys that inherit workspace and section defaults. */
  cascadeKeys: readonly (keyof T & string)[];
  /** Settings tabs the card's panel fills; empty for simple cards. */
  tabs: readonly SettingsTab[];
}
