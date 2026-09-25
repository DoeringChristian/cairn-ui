import type { ComponentType } from "react";
import type { CardType } from "./card-spec";

/** Each card type's settings panel (`components/settings-panels/`), loaded on demand. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const SETTINGS_PANELS: Partial<Record<CardType, () => Promise<{ default: ComponentType<any> }>>> = {
  scalar: () => import("../../components/settings-panels/ScalarSettingsPanel"),
};
