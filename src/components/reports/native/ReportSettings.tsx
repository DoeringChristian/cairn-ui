import { useState } from "react";
import type { SettingsController } from "../../../lib/card-settings";

export function useSessionSettings<T extends object>(defaults: T): SettingsController<T> {
  const [patch, setPatch] = useState<Partial<T>>({});
  return {value: {...defaults, ...patch}, level: "card", readOnly: true, locked: false,
    set: value => setPatch(previous => ({...previous, ...value})),
    reset: key => setPatch(previous => {const next = {...previous}; delete next[key]; return next;}),
    resetAll: () => setPatch({}), isOverridden: key => key in patch, parent: key => defaults[key]};
}
