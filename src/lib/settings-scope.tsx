/**
 * Where a card's inherited settings come from (see lib/settings-cascade.ts).
 *
 * - `WorkspaceContext`: the project's per-card-type defaults.
 * - `SectionContext`: the enclosing section's per-card-type defaults.
 * - `CascadeScopeContext`: `"builtin-only"` makes cards ignore both, for
 *   surfaces that must look the same to everyone (reports, embeds, share
 *   links).
 *
 * All default to empty: a card outside any provider resolves against its
 * built-in defaults only.
 */

import { createContext, useMemo, type ReactNode } from "react";
import type { CardType } from "./cards/card-spec";

/** Per-card-type default values (cascade keys only are read). */
export type CardDefaults = Partial<Record<CardType, Record<string, unknown>>>;

const EMPTY: CardDefaults = {};

export interface WorkspaceContextValue {
  defaults: CardDefaults;
}

export const WorkspaceContext = createContext<WorkspaceContextValue>({ defaults: EMPTY });

export function WorkspaceDefaultsProvider({ defaults, children }: { defaults: CardDefaults; children: ReactNode }) {
  const value = useMemo(() => ({ defaults }), [defaults]);
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export interface SectionContextValue {
  /** The section's id (its name), or null outside a section. */
  id: string | null;
  defaults: CardDefaults;
}

export const SectionContext = createContext<SectionContextValue>({ id: null, defaults: EMPTY });

export function SectionDefaultsProvider({
  id,
  defaults,
  children,
}: {
  id: string;
  defaults: CardDefaults;
  children: ReactNode;
}) {
  const value = useMemo(() => ({ id, defaults }), [id, defaults]);
  return <SectionContext.Provider value={value}>{children}</SectionContext.Provider>;
}

/** `"full"` reads workspace and section defaults; `"builtin-only"` ignores them. */
export type CascadeScope = "full" | "builtin-only";

export const CascadeScopeContext = createContext<CascadeScope>("full");
