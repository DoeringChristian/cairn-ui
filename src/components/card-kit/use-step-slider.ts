import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSequencesForRuns } from "../../api/hooks";
import {
  STEP_KEY,
  resolveAtValue,
  sliderIndex,
  sliderTrack,
  unionValues,
  type SliderPosition,
} from "../../lib/media/slider-key";
import { stepUnion } from "./resolve-at-step";
import { useMediaSync, useSectionSyncState, type MediaSync } from "./media-sync";

export interface StepSliderState {
  /** Sorted union of steps across all series' points. */
  globalSteps: number[];
  /** Slider positions: the union of every series' key values (the steps themselves for the `step` key). */
  values: number[];
  /** Clamped current index into `values`. */
  safeIdx: number;
  /** The slider's value (a step, or the key metric's value); `0` while there are no positions. */
  currentValue: number;
  /**
   * The first series' step at the current value, defaulting to `0` when there
   * are no steps yet. With the `step` key this is the value itself.
   */
  currentStep: number;
  /**
   * Series `i`'s step at `value` (the current value by default): the value
   * itself for the `step` key, else the step the key metric resolves to in
   * that series' run (`nearest`: its first one when the run reaches the value
   * later). Feed the result to `resolveAtStep`.
   */
  stepFor: (i: number, value?: number, opts?: { nearest?: boolean }) => number | null;
  /** The effective slider key (the section's while following it). */
  keyName: string;
  /** Slider track for `StepSlider`: one point per position, `step` = its value (wall time for the step key). */
  sliderPoints: Array<{ step: number; wall_time?: string | null }>;
  /** Following the section's media sync (its slider drives this card). */
  sync: MediaSync | null;
  /** Slider onChange handler: persists the value at `idx` via `updateSettings({ sliderStep })`, or moves the section. */
  onSliderChange: (idx: number) => void;
  /** Move to a value directly. */
  setValue: (value: number) => void;
}

/**
 * Owns the step-slider machinery shared by the artifact cards: the slider's
 * positions (every series' steps, or the values of a scalar slider key looked
 * up as of each step, see lib/media/slider-key.ts), the live slider value
 * (seeded from the persisted `sliderStep` setting, which holds a VALUE, not an
 * index), and persisting changes back under that key.
 *
 * Under a section `MediaSyncProvider` with `sync.follow` on, the section's
 * key and value drive the card instead and nothing is persisted per card.
 */
export function useStepSlider(args: {
  /** Points per series, from the card's sequence queries (pre-filtered as needed). */
  seriesPoints: Array<Array<{ step: number }>>;
  /** Persisted slider VALUE (settings.sliderStep): a step, or the slider key's value. */
  persistedIdx: number | undefined;
  updateSettings: (patch: { sliderStep?: number }, opts?: { mergeKey?: string }) => void;
  /** `step` (default) or a scalar metric such as `epoch`. */
  sliderKey?: string;
  /** Run id of each series; needed for a metric key (each run has its own key series). */
  seriesRunIds?: readonly string[];
  /** Follow the section's media sync when there is one. */
  sync?: { cardId: string; follow: boolean };
}): StepSliderState {
  const { seriesPoints, persistedIdx, updateSettings, sliderKey, seriesRunIds, sync: syncOpt } = args;

  const follow = syncOpt?.follow ?? false;
  const section = useSectionSyncState(follow);
  const keyName = section?.key ?? (sliderKey || STEP_KEY);
  const metricKey = keyName !== STEP_KEY;

  const globalSteps = useMemo(() => stepUnion(seriesPoints), [seriesPoints]);

  // The key metric, once per run.
  const runsSig = (seriesRunIds ?? []).join("|");
  const keyRuns = useMemo(
    () => (metricKey ? [...new Set(seriesRunIds ?? [])] : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [metricKey, runsSig],
  );
  const keyQueries = useSequencesForRuns(keyRuns.map((runId) => ({ runId, name: keyName })));
  const keyDataSig = keyQueries.map((q) => q.dataUpdatedAt).join("|");
  const tracks = useMemo<SliderPosition[][] | null>(() => {
    if (!metricKey) return null;
    const byRun = new Map(keyRuns.map((r, i) => [r, keyQueries[i]?.data?.points ?? null]));
    return seriesPoints.map((pts, i) =>
      sliderTrack(
        pts.map((p) => p.step),
        keyName,
        byRun.get(seriesRunIds?.[i] ?? "") ?? null,
      ),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metricKey, keyName, seriesPoints, keyRuns, keyDataSig]);

  const values = useMemo(() => (tracks ? unionValues(tracks) : globalSteps), [tracks, globalSteps]);

  const sync = useMediaSync(syncOpt?.cardId ?? "", values, follow);

  const [local, setLocal] = useState<number | undefined>(persistedIdx);
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPersistRef = useRef<number | null>(null);
  const updateSettingsRef = useRef(updateSettings);
  updateSettingsRef.current = updateSettings;
  const valuesRef = useRef(values);
  valuesRef.current = values;
  const syncRef = useRef(sync);
  syncRef.current = sync;

  const moveTo = useCallback((value: number) => {
    const s = syncRef.current;
    if (s) {
      s.setValue(value);
      return;
    }
    // Read-only cards move too: their settings writes land in the session layer.
    setLocal(value);
    pendingPersistRef.current = value;
    if (persistTimerRef.current != null) clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(() => {
      persistTimerRef.current = null;
      const pending = pendingPersistRef.current;
      pendingPersistRef.current = null;
      if (pending != null) updateSettingsRef.current({ sliderStep: pending }, { mergeKey: "sliderStep" });
    }, 150);
  }, []);
  const onSliderChange = useCallback((idx: number) => {
    const v = valuesRef.current[idx];
    if (v != null) moveTo(v);
  }, [moveTo]);
  useEffect(() => () => {
    if (persistTimerRef.current != null) clearTimeout(persistTimerRef.current);
    const pending = pendingPersistRef.current;
    if (pending != null) updateSettingsRef.current({ sliderStep: pending }, { mergeKey: "sliderStep" });
  }, []);

  const wanted = sync ? sync.value : local;
  const safeIdx = sliderIndex(values, wanted);
  const currentValue = values[safeIdx] ?? 0;

  const stepFor = useCallback(
    (i: number, value?: number, opts?: { nearest?: boolean }) => {
      const v = value ?? currentValue;
      if (!tracks) return v;
      return resolveAtValue(tracks[i] ?? [], v, opts);
    },
    [tracks, currentValue],
  );
  const currentStep = tracks ? (stepFor(0, currentValue, { nearest: true }) ?? 0) : currentValue;

  const sliderPoints = useMemo(() => {
    if (metricKey) return values.map((step) => ({ step }));
    const wall = new Map<number, string | null>();
    for (const pts of seriesPoints) {
      for (const p of pts as Array<{ step: number; wall_time?: string | null }>) {
        if (!wall.has(p.step) && p.wall_time != null) wall.set(p.step, p.wall_time);
      }
    }
    return values.map((step) => ({ step, wall_time: wall.get(step) ?? null }));
  }, [metricKey, values, seriesPoints]);

  return {
    globalSteps,
    values,
    safeIdx,
    currentValue,
    currentStep,
    stepFor,
    keyName,
    sliderPoints,
    sync,
    onSliderChange,
    setValue: moveTo,
  };
}
