/**
 * The state behind section media sync (`card-kit/media-sync.tsx`): one slider
 * value and key for every media card of a section that follows it, plus the
 * union of the values those cards register (the section bar's positions).
 *
 * Changing the key drops the value: a step number means nothing as an epoch.
 *
 * Pure (storage is injected): tested in `section-sync.test.ts`.
 */

import { STEP_KEY, unionValues } from "./slider-key.ts";

export interface SectionSyncState {
  /** The section's slider value; `null` until someone moves it (cards then show their first position). */
  value: number | null;
  key: string;
  /** Union of every registered card's values, ascending. */
  values: number[];
}

/** What is persisted per scope. */
export interface PersistedSectionSync {
  value: number | null;
  key: string;
}

export interface SectionSyncStorage {
  load(): PersistedSectionSync | null;
  save(state: PersistedSectionSync): void;
}

export function parsePersisted(raw: unknown): PersistedSectionSync | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const key = typeof r.key === "string" && r.key ? r.key : STEP_KEY;
  const value = typeof r.value === "number" && Number.isFinite(r.value) ? r.value : null;
  return { key, value };
}

export class SectionSyncStore {
  private readonly storage?: SectionSyncStorage;
  private readonly cards = new Map<string, number[]>();
  private readonly listeners = new Set<() => void>();
  private state: SectionSyncState;

  constructor(storage?: SectionSyncStorage) {
    this.storage = storage;
    const saved = storage?.load() ?? null;
    this.state = { value: saved?.value ?? null, key: saved?.key ?? STEP_KEY, values: [] };
  }

  /** Stable until something changes (fit for `useSyncExternalStore`). */
  getSnapshot = (): SectionSyncState => this.state;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  /** A card's slider values (in the section's key); re-registering replaces them. */
  register(cardId: string, values: readonly number[]): void {
    const prev = this.cards.get(cardId);
    if (prev && prev.length === values.length && prev.every((v, i) => v === values[i])) return;
    this.cards.set(cardId, [...values]);
    this.recompute();
  }

  unregister(cardId: string): void {
    if (!this.cards.delete(cardId)) return;
    this.recompute();
  }

  /** How many cards follow the section. */
  get size(): number {
    return this.cards.size;
  }

  setValue(value: number | null): void {
    if (value === this.state.value) return;
    this.state = { ...this.state, value };
    this.persist();
    this.emit();
  }

  setKey(key: string): void {
    const k = key || STEP_KEY;
    if (k === this.state.key) return;
    this.state = { ...this.state, key: k, value: null };
    this.persist();
    this.emit();
  }

  private recompute(): void {
    const values = unionValues([...this.cards.values()]);
    const prev = this.state.values;
    if (prev.length === values.length && prev.every((v, i) => v === values[i])) return;
    this.state = { ...this.state, values };
    this.emit();
  }

  private persist(): void {
    this.storage?.save({ value: this.state.value, key: this.state.key });
  }

  private emit(): void {
    for (const fn of [...this.listeners]) fn();
  }
}
