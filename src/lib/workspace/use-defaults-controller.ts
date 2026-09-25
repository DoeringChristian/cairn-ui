/**
 * A `SettingsController` over the workspace's (or one section's) defaults
 * for a card type, so the defaults editor renders a card type's own settings
 * panel (in `mode="defaults"`) unchanged.
 *
 * The edited layer plays the card layer's part: `isOverridden` / ↺ are about
 * this level's own values, and `parent` is what the level inherits (the
 * builtin for workspace defaults; workspace, then builtin for a section).
 * Only the type's cascade keys are stored.
 */

import { useCallback, useMemo, useRef } from "react";
import type { CardType } from "../cards/card-spec";
import { metaFor } from "../cards/settings-registry";
import type { SetOptions, SettingsController } from "../card-settings";
import {
  isOverridden as layerIsOverridden,
  parentValue,
  removeOverride,
  resolveSettings,
  setOverride,
  type SettingsLayers,
} from "../settings-cascade";
import { ops } from "./doc";
import { useWorkspace } from "./use-workspace";

export type DefaultsLevel = { level: "workspace" } | { level: "section"; section: string };

const EMPTY: Record<string, unknown> = Object.freeze({}) as Record<string, unknown>;

export function useDefaultsController<T extends object = Record<string, unknown>>(
  projectId: string | null,
  type: CardType,
  where: DefaultsLevel,
): SettingsController<T> {
  const ws = useWorkspace(projectId);
  const meta = metaFor(type);
  const cascadeKeys = meta.cascadeKeys as readonly string[];
  const section = where.level === "section" ? where.section : null;

  const own = (section == null ? ws.doc.defaults[type] : ws.doc.sectionDefaults[section]?.[type]) ?? EMPTY;
  const inherited = section == null ? undefined : ws.doc.defaults[type];

  const layers = useMemo<SettingsLayers<T>>(
    () => ({ builtin: meta.builtin as T, workspace: inherited as Partial<T> | undefined }),
    [meta.builtin, inherited],
  );
  const value = useMemo(
    () => resolveSettings<T>({ ...layers, card: own as Partial<T> }, cascadeKeys),
    [layers, own, cascadeKeys],
  );

  const ref = useRef({ own, layers });
  ref.current = { own, layers };
  const parentOf = useCallback((k: string) => parentValue(ref.current.layers, k, cascadeKeys), [cascadeKeys]);

  const { update } = ws;
  const write = useCallback(
    (next: Record<string, unknown>, label: string, mergeKey?: string) => {
      const op = section == null ? ops.setDefaults(type, next) : ops.setSectionDefaults(section, type, next);
      update(op, { label, mergeKey: mergeKey !== undefined ? `defaults|${type}|${section ?? ""}|${mergeKey}` : undefined });
    },
    [update, type, section],
  );

  const set = useCallback(
    (patch: Partial<T>, opts?: SetOptions) => {
      const cascading = Object.fromEntries(
        Object.entries(patch).filter(([k]) => cascadeKeys.includes(k)),
      ) as Partial<T>;
      if (Object.keys(cascading).length === 0) return;
      const next = setOverride(ref.current.own, cascading as Record<string, unknown>, parentOf);
      write(next, opts?.label ?? `Change ${type} defaults`, opts?.mergeKey);
    },
    [cascadeKeys, parentOf, write, type],
  );
  const reset = useCallback(
    (k: keyof T & string) => write(removeOverride(ref.current.own, k), `Reset ${type} default ${k}`),
    [write, type],
  );
  const resetAll = useCallback(() => write({}, `Reset ${type} defaults`), [write, type]);

  return useMemo<SettingsController<T>>(
    () => ({
      value,
      level: section == null ? "workspace" : "section",
      readOnly: ws.readOnly,
      locked: ws.readOnly,
      set,
      reset,
      resetAll,
      isOverridden: (k) => layerIsOverridden(own, k),
      parent: <K extends keyof T & string>(k: K) => parentOf(k) as T[K],
    }),
    [value, section, ws.readOnly, set, reset, resetAll, own, parentOf],
  );
}
