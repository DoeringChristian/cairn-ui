/**
 * Per-card settings persisted to localStorage.
 *
 * Each card type owns its own TS interface (ScalarSettings, ImageSettings, …),
 * all carrying a `version: 1` discriminator. Settings are keyed by
 * (runId, metricName).
 */

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { loadJson, saveJson, storageKeys } from "./storage";

/**
 * Whether the cards under this context may write their persisted settings.
 * Every settings write goes through `useCardSettings`, so gating it here
 * freezes a whole card at once. Defaults to `true`; reports provide `false`
 * in view mode. `card-kit/use-step-slider.ts` and ArtifactCard's slider also
 * read it, to freeze their local mirror state in lockstep.
 */
export const CardMutationContext = createContext<boolean>(true);

/**
 * Called after each settings write that lands. A report autosaves when its
 * `blocks[]` change, but a settings-only edit lives in localStorage; the
 * report's cards block provides this in edit mode to touch its block and so
 * schedule a save. Undefined (a no-op) everywhere else.
 */
export const CardSettingsChangeContext = createContext<(() => void) | undefined>(undefined);

export type CardSettingsKey = {
  runId: string;
  metricName: string;
};

export function cardSettingsStorageKey(key: CardSettingsKey): string {
  return storageKeys.cardSettings(key.runId, key.metricName);
}

/** Load persisted card settings, or null when none are stored. */
export function loadCardSettings<T>(key: CardSettingsKey): T | null {
  return loadJson<T>(localStorage, cardSettingsStorageKey(key));
}

export function saveCardSettings<T>(key: CardSettingsKey, value: T): void {
  saveJson(localStorage, cardSettingsStorageKey(key), value);
}

function resetCardSettings(key: CardSettingsKey): void {
  try {
    localStorage.removeItem(cardSettingsStorageKey(key));
  } catch {
    /* ignore */
  }
}

/**
 * Hook that synchronizes a card's settings with localStorage.
 *
 * Returns:
 *   [settings, updateSettings, resetSettings]
 *
 * - settings: current merged settings (defaults + persisted overrides).
 * - updateSettings(patch): shallow merge the patch over current settings and save.
 * - resetSettings(): clear localStorage and revert to defaults.
 *
 * Re-renders when the settings change. The returned updater/resetter have
 * stable identity across renders (only change when the storage key or the
 * mutation gate changes — see `CardMutationContext`).
 *
 * When `CardMutationContext` reads `false` (a report card in VIEW mode),
 * `updateSettings`/`reset` become no-ops: they neither touch localStorage
 * nor update local state, so the card stays visually fixed at its loaded
 * settings regardless of what an interactive control tries to write.
 */
export function useCardSettings<T extends { version: number }>(
  key: CardSettingsKey,
  defaults: T,
): [T, (patch: Partial<T>) => void, () => void] {
  const storageKey = cardSettingsStorageKey(key);
  const mutable = useContext(CardMutationContext);
  const notifyChange = useContext(CardSettingsChangeContext);

  // Keep the latest `defaults` in a ref so we can merge on load without
  // adding `defaults` as an effect dep (which would thrash on every render
  // given most callers pass a fresh object literal).
  const defaultsRef = useRef(defaults);
  defaultsRef.current = defaults;

  // Keep the latest `settings` in a ref so the updater can shallow-merge
  // against it without listing it as a dep.
  const settingsRef = useRef<T>({
    ...defaults,
    ...(loadCardSettings<Partial<T>>(key) ?? {}),
  });

  const [settings, setSettings] = useState<T>(() => settingsRef.current);

  // Reload from storage whenever the storage key changes (e.g. the card
  // switched metrics). Don't include `defaults` in deps — only a key change
  // should trigger a reload.
  useEffect(() => {
    const loaded = loadCardSettings<Partial<T>>(key);
    const merged = { ...defaultsRef.current, ...(loaded ?? {}) } as T;
    settingsRef.current = merged;
    setSettings(merged);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  const updateSettings = useCallback(
    (patch: Partial<T>) => {
      if (!mutable) return;
      const next = { ...settingsRef.current, ...patch } as T;
      settingsRef.current = next;
      setSettings(next);
      saveCardSettings<T>(key, next);
      notifyChange?.();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [storageKey, mutable, notifyChange],
  );

  const reset = useCallback(
    () => {
      if (!mutable) return;
      resetCardSettings(key);
      const fresh = { ...defaultsRef.current } as T;
      settingsRef.current = fresh;
      setSettings(fresh);
      notifyChange?.();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [storageKey, mutable, notifyChange],
  );

  return [settings, updateSettings, reset];
}

/**
 * Resolve the effective card height: the persisted `height`, else `fallback`.
 *
 * @param settings  - card settings object
 * @param fallback  - default height when nothing is set (e.g. 300, 350, undefined)
 * @param minHeight - optional per-card-type minimum; when given, a resolved
 *   (non-undefined) height is clamped up to it. This is the SINGLE own-min
 *   read-time clamp — CardShell (outer box) and any inner content that reads
 *   the same height must pass the same value so they agree (guards a stale /
 *   undersized persisted height). Callers get the min from
 *   card-kit/card-min-sizes::cardMinSize; this module stays kind-agnostic.
 */
export function resolveCardHeight(
  settings: { height?: number; collapsed?: boolean },
  fallback?: number,
  minHeight?: number,
): number | undefined {
  if (settings.collapsed) return undefined;
  const resolved = settings.height ?? fallback;
  if (resolved == null) return undefined;
  return minHeight != null ? Math.max(resolved, minHeight) : resolved;
}

