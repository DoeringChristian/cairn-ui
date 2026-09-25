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
};
