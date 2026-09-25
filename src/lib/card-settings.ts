/**
 * Card settings: a `SettingsController` per card over the settings cascade.
 *
 * A card's effective settings resolve through lib/settings-cascade.ts:
 * card overrides → instance defaults → section → workspace → builtin, where
 * the builtin defaults and cascade keys come from the card type's registry
 * entry (lib/cards/settings-registry.ts). Only the card's OVERRIDES are
 * stored, in localStorage under `cairn:card-overrides:<runId>:<metricName>`;
 * a value equal to what the card would inherit is never stored.
 *
 * Read-only cards (`CardMutationContext` false: report viewers, embeds) can
 * still be explored: their writes land in an in-memory session layer that
 * replaces the stored overrides for this page load and is never persisted.
 *
 * Every `set` / `reset` pushes an undo entry onto the project's stack
 * (lib/undo-context.tsx).
 */

import { createContext, useCallback, useContext, useMemo, useRef, useSyncExternalStore } from "react";
import { loadJson, storageKeys } from "./storage";
import type { CardType } from "./cards/card-spec";
import { metaFor } from "./cards/settings-registry";
import {
  isOverridden as layerIsOverridden,
  jsonEqual,
  parentValue,
  removeOverride,
  resolveSettings,
  setOverride,
  type SettingsLayers,
} from "./settings-cascade";
import { CascadeScopeContext, SectionContext, WorkspaceContext } from "./settings-scope";
import { usePushUndo } from "./undo-context";

/**
 * Whether the cards under this context may persist anything. Defaults to
 * `true`; read-only surfaces (a report in view mode, embeds, share pages)
 * provide `false`. In that mode settings writes go to the session layer,
 * and `CardHeader`, `CardShell` and `ReorderableCardGrid` drop their editing
 * affordances (rename, remove, add-to, resize, drag).
 */
export const CardMutationContext = createContext<boolean>(true);

/**
 * Called after each persisted settings write. A report autosaves when its
 * `blocks[]` change, but a settings-only edit lives in localStorage; the
 * report's cards block provides this to touch its block and so schedule a
 * save. Undefined (a no-op) everywhere else.
 */
export const CardSettingsChangeContext = createContext<(() => void) | undefined>(undefined);

export type CardSettingsKey = {
  runId: string;
  metricName: string;
};

/** A card's stored overrides: top-level settings keys it sets itself. */
export type CardOverrides = Record<string, unknown>;

export function cardOverridesStorageKey(key: CardSettingsKey): string {
  return storageKeys.cardOverrides(key.runId, key.metricName);
}

// ---------------------------------------------------------------------------
// The overrides store: localStorage plus an in-memory session layer, with
// per-key subscribers so every mounted card on a key (and undo/redo, which
// may run after the card unmounted) stays in sync.
// ---------------------------------------------------------------------------

const EMPTY: CardOverrides = Object.freeze({}) as CardOverrides;
const listeners = new Map<string, Set<() => void>>();
const snapshots = new Map<string, { raw: string | null; value: CardOverrides }>();
const session = new Map<string, CardOverrides>();

function notify(storageKey: string): void {
  for (const fn of listeners.get(storageKey) ?? []) fn();
}

function subscribe(storageKey: string, fn: () => void): () => void {
  let set = listeners.get(storageKey);
  if (!set) listeners.set(storageKey, (set = new Set()));
  set.add(fn);
  return () => {
    set!.delete(fn);
    if (set!.size === 0) listeners.delete(storageKey);
  };
}

/** The stored overrides; a stable object while the stored JSON is unchanged. */
function readPersisted(storageKey: string): CardOverrides {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(storageKey);
  } catch {
    /* disabled storage */
  }
  const cached = snapshots.get(storageKey);
  if (cached && cached.raw === raw) return cached.value;
  let value = EMPTY;
  if (raw != null) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) value = parsed as CardOverrides;
    } catch {
      /* a corrupt entry reads as no overrides */
    }
  }
  snapshots.set(storageKey, { raw, value });
  return value;
}

/** Load a card's stored overrides, or null when it has none. */
export function loadCardOverrides(key: CardSettingsKey): CardOverrides | null {
  const v = loadJson<CardOverrides>(localStorage, cardOverridesStorageKey(key));
  return v && typeof v === "object" && Object.keys(v).length > 0 ? v : null;
}

/** Store a card's overrides (null or empty removes them) and update mounted cards. */
export function saveCardOverrides(key: CardSettingsKey, overrides: CardOverrides | null): void {
  writePersisted(cardOverridesStorageKey(key), overrides);
}

function writePersisted(storageKey: string, overrides: CardOverrides | null): void {
  try {
    if (!overrides || Object.keys(overrides).length === 0) localStorage.removeItem(storageKey);
    else localStorage.setItem(storageKey, JSON.stringify(overrides));
  } catch {
    /* quota exceeded or disabled storage; silently drop */
  }
  notify(storageKey);
}

function writeSession(storageKey: string, overrides: CardOverrides): void {
  session.set(storageKey, overrides);
  notify(storageKey);
}

// ---------------------------------------------------------------------------
// The controller
// ---------------------------------------------------------------------------

/** Which layer a controller edits. Cards edit their own; the defaults editor edits the others. */
export type SettingsLevel = "workspace" | "section" | "card";

export interface SetOptions {
  /** Consecutive sets sharing a merge key within 600 ms are one undo step (a slider drag). */
  mergeKey?: string;
  /** Undo entry label; defaults to the patched keys. */
  label?: string;
}

export interface SettingsController<T> {
  /** Effective settings: every layer resolved. */
  value: T;
  level: SettingsLevel;
  /** Writes go to the session layer and are never persisted. */
  readOnly: boolean;
  /** Override keys; a value equal to the inherited one drops the override. */
  set: (patch: Partial<T>, opts?: SetOptions) => void;
  /** Drop the override of one key. */
  reset: (key: keyof T & string) => void;
  /** Drop every override. */
  resetAll: () => void;
  isOverridden: (key: keyof T & string) => boolean;
  /** The value `key` would have without this card's override. */
  parent: <K extends keyof T & string>(key: K) => T[K];
}

/**
 * The settings controller for one card.
 *
 * @param key              where the card's overrides are stored
 * @param type             the card type (its builtin defaults and cascade keys)
 * @param instanceDefaults what this card instance starts from (seed metrics, a
 *                         sweep's axes, …); a fresh object per render is fine
 *
 * `value` keeps its identity until a layer changes; `set` and friends are
 * stable per storage key and mode.
 */
export function useCardSettings<T extends object>(
  key: CardSettingsKey,
  type: CardType,
  instanceDefaults?: Partial<T>,
): SettingsController<T> {
  const storageKey = cardOverridesStorageKey(key);
  const readOnly = !useContext(CardMutationContext);
  const notifyChange = useContext(CardSettingsChangeContext);
  const scope = useContext(CascadeScopeContext);
  const workspace = useContext(WorkspaceContext);
  const section = useContext(SectionContext);
  const pushUndo = usePushUndo();

  const meta = metaFor(type);
  const cascadeKeys = meta.cascadeKeys as readonly string[];
  const instanceJson = JSON.stringify(instanceDefaults ?? {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const instance = useMemo(() => (instanceDefaults ?? {}) as Partial<T>, [instanceJson]);
  const full = scope === "full";
  const wsDefaults = full ? workspace.defaults[type] : undefined;
  const secDefaults = full ? section.defaults[type] : undefined;
  const layers = useMemo<SettingsLayers<T>>(
    () => ({
      builtin: meta.builtin as T,
      workspace: wsDefaults as Partial<T> | undefined,
      section: secDefaults as Partial<T> | undefined,
      instance,
    }),
    [meta.builtin, wsDefaults, secDefaults, instance],
  );
  const layersRef = useRef(layers);
  layersRef.current = layers;

  const read = useCallback(
    (): CardOverrides => (readOnly ? (session.get(storageKey) ?? readPersisted(storageKey)) : readPersisted(storageKey)),
    [storageKey, readOnly],
  );
  const sub = useCallback((fn: () => void) => subscribe(storageKey, fn), [storageKey]);
  const overrides = useSyncExternalStore(sub, read);

  const value = useMemo(
    () => resolveSettings<T>({ ...layers, card: overrides as Partial<T> }, cascadeKeys),
    [layers, overrides, cascadeKeys],
  );

  const write = useCallback(
    (next: CardOverrides) => {
      if (readOnly) {
        writeSession(storageKey, next);
      } else {
        writePersisted(storageKey, next);
        notifyChange?.();
      }
    },
    [storageKey, readOnly, notifyChange],
  );

  const commit = useCallback(
    (next: CardOverrides, label: string, mergeKey?: string) => {
      const prev = read();
      if (jsonEqual(prev, next)) return;
      write(next);
      pushUndo({
        label,
        undo: () => write(prev),
        redo: () => write(next),
        mergeKey: mergeKey !== undefined ? `${storageKey}|${mergeKey}` : undefined,
      });
    },
    [read, write, pushUndo, storageKey],
  );

  const parentOf = useCallback(
    (k: string) => parentValue(layersRef.current, k, cascadeKeys),
    [cascadeKeys],
  );

  const set = useCallback(
    (patch: Partial<T>, opts?: SetOptions) => {
      const next = setOverride(read(), patch as CardOverrides, parentOf);
      commit(next, opts?.label ?? `Change ${Object.keys(patch).join(", ")}`, opts?.mergeKey);
    },
    [read, parentOf, commit],
  );
  const reset = useCallback(
    (k: keyof T & string) => commit(removeOverride(read(), k), `Reset ${k}`),
    [read, commit],
  );
  const resetAll = useCallback(() => commit({}, "Reset card settings"), [commit]);

  return useMemo<SettingsController<T>>(
    () => ({
      value,
      level: "card",
      readOnly,
      set,
      reset,
      resetAll,
      isOverridden: (k) => layerIsOverridden(overrides, k),
      parent: <K extends keyof T & string>(k: K) => parentOf(k) as T[K],
    }),
    [value, readOnly, set, reset, resetAll, overrides, parentOf],
  );
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
