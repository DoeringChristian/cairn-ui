/**
 * Section media sync: one slider (and one playback clock) for every media
 * card of a section.
 *
 * - `MediaSyncProvider` wraps a section (a workspace section, a report
 *   cell's cards). It holds the section's slider value and key, persisted
 *   per `scopeKey` in localStorage, and a `SharedClock` for synced video
 *   playback (the clock itself is not persisted).
 * - Media cards whose `followSection` setting is on (the default) and that
 *   sit under a provider follow it: they build their slider over the
 *   section's key, register their values, and show the section's value.
 *   Without a provider every card keeps its own slider.
 * - `SectionMediaBar` is the section's slider over the union of every
 *   following card's values, with a key field and, once a clocked video is
 *   registered, a play/pause transport. It renders nothing while no card
 *   follows the section.
 *
 * State lives in `lib/media/section-sync.ts` (pure, tested).
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { loadJson, saveJson, storageKeys } from "../../lib/storage";
import { SectionSyncStore, parsePersisted, type SectionSyncState } from "../../lib/media/section-sync";
import { SharedClock } from "../../lib/media/shared-clock";
import { STEP_KEY, formatKeyValue, sliderIndex } from "../../lib/media/slider-key";
import StepSlider from "../StepSlider";
import ClockTransport from "../media/ClockTransport";

export interface MediaSyncContextValue {
  scopeKey: string;
  store: SectionSyncStore;
  clock: SharedClock;
}

export const MediaSyncContext = createContext<MediaSyncContextValue | null>(null);

export function MediaSyncProvider({ scopeKey, children }: { scopeKey: string; children?: ReactNode }) {
  const value = useMemo<MediaSyncContextValue>(() => {
    const key = storageKeys.mediaSync(scopeKey);
    const store = new SectionSyncStore({
      load: () => parsePersisted(loadJson<unknown>(localStorage, key)),
      save: (s) => saveJson(localStorage, key, s),
    });
    return { scopeKey, store, clock: new SharedClock() };
  }, [scopeKey]);
  useEffect(() => () => value.clock.pause(), [value]);
  return <MediaSyncContext.Provider value={value}>{children}</MediaSyncContext.Provider>;
}

/** The section's sync, or `null` outside a `MediaSyncProvider`. */
export function useMediaSyncContext(): MediaSyncContextValue | null {
  return useContext(MediaSyncContext);
}

const NO_STATE = () => null;
const NO_SUBSCRIBE = () => () => {};

/** The section's live state while `enabled` and under a provider, else `null`. */
export function useSectionSyncState(enabled = true): SectionSyncState | null {
  const ctx = useContext(MediaSyncContext);
  const on = enabled && ctx != null;
  return useSyncExternalStore(
    on ? ctx.store.subscribe : NO_SUBSCRIBE,
    on ? ctx.store.getSnapshot : NO_STATE,
  );
}

export interface MediaSync {
  /** The section's value; `null` until the section slider moved. */
  value: number | null;
  /** The section's slider key (`step` or a scalar metric). */
  key: string;
  setValue: (value: number | null) => void;
  clock: SharedClock;
}

/**
 * Follow the section: register this card's slider values (in the section's
 * key) and read the section's value. `null` outside a provider or when
 * `enabled` is false; the card then keeps its own slider.
 */
export function useMediaSync(cardId: string, keys: readonly number[], enabled = true): MediaSync | null {
  const ctx = useContext(MediaSyncContext);
  const state = useSectionSyncState(enabled);
  const on = enabled && ctx != null;
  const keysSig = keys.join(",");
  useEffect(() => {
    if (!on) return;
    ctx.store.register(cardId, keys);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, ctx, cardId, keysSig]);
  useEffect(() => {
    if (!on) return;
    return () => ctx.store.unregister(cardId);
  }, [on, ctx, cardId]);
  return useMemo(
    () =>
      on && state
        ? {
            value: state.value,
            key: state.key,
            setValue: (v: number | null) => ctx.store.setValue(v),
            clock: ctx.clock,
          }
        : null,
    [on, state, ctx],
  );
}

/** The section's slider: one bar driving every media card that follows it. */
export function SectionMediaBar({ className }: { className?: string }) {
  const ctx = useContext(MediaSyncContext);
  const state = useSectionSyncState();
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const points = useMemo(() => (state?.values ?? []).map((step) => ({ step })), [state?.values]);
  if (!ctx || !state || ctx.store.size === 0) return null;
  const idx = sliderIndex(state.values, state.value);
  const commitKey = () => {
    if (editingKey != null) ctx.store.setKey(editingKey.trim() || STEP_KEY);
    setEditingKey(null);
  };
  return (
    <div
      className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded border border-border bg-bg-elevated px-2 py-1 ${className ?? ""}`}
      aria-label="Section media slider"
    >
      <span className="flex items-center gap-1 text-[11px] text-fg-muted">
        <i className="fa-solid fa-link text-[10px]" aria-hidden="true" />
        {editingKey != null ? (
          <input
            autoFocus
            aria-label="Slider key"
            className="input mono w-24 py-0 text-[11px]"
            value={editingKey}
            placeholder={STEP_KEY}
            onChange={(e) => setEditingKey(e.target.value)}
            onBlur={commitKey}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitKey();
              if (e.key === "Escape") setEditingKey(null);
            }}
          />
        ) : (
          <button
            type="button"
            className="mono rounded px-1 hover:bg-bg-hover hover:text-fg"
            title="Slider key: step, or a scalar metric such as epoch"
            onClick={() => setEditingKey(state.key)}
          >
            {state.key}
          </button>
        )}
      </span>
      {points.length > 1 ? (
        <StepSlider
          points={points}
          currentIndex={idx}
          keyName={state.key}
          onChange={(i) => ctx.store.setValue(state.values[i] ?? null)}
          className="min-w-[12rem] flex-1"
        />
      ) : (
        <span className="mono text-[11px] text-fg-subtle">
          {points.length === 1 ? `${state.key} ${formatKeyValue(points[0]!.step)}` : "no media yet"}
        </span>
      )}
      <ClockTransport clock={ctx.clock} hideWithoutMedia />
    </div>
  );
}
