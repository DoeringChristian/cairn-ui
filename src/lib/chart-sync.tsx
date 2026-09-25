/**
 * Sync zoom across charts: cards sharing an x-axis key (their `x`
 * expression) share one ephemeral view. A card that zooms publishes its view;
 * every other card in the group shows it without saving it (only the card
 * that zoomed keeps its own viewport). With sync on, charts also share their
 * hover cursor (uPlot `cursor.sync`, keyed by `cursorSyncKey`).
 *
 * The workspace mounts `ChartSyncProvider` from its sync-zoom setting;
 * without a provider `useSyncedView` never returns a view and `publish` does
 * nothing, so a card works unchanged.
 */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";

export interface SyncedView {
  xMin: number | null;
  xMax: number | null;
  yMin: number | null;
  yMax: number | null;
}

interface Entry {
  view: SyncedView;
  /** The card that published it. */
  from: string;
}

class SyncStore {
  private entries = new Map<string, Entry>();
  private listeners = new Map<string, Set<() => void>>();

  get(group: string): Entry | undefined {
    return this.entries.get(group);
  }

  set(group: string, entry: Entry): void {
    this.entries.set(group, entry);
    for (const fn of this.listeners.get(group) ?? []) fn();
  }

  subscribe(group: string, fn: () => void): () => void {
    let set = this.listeners.get(group);
    if (!set) this.listeners.set(group, (set = new Set()));
    set.add(fn);
    return () => {
      set.delete(fn);
    };
  }
}

const ChartSyncContext = createContext<SyncStore | null>(null);

/** Share zoom (and the hover cursor) between the charts below while `enabled`. */
export function ChartSyncProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const storeRef = useRef<SyncStore | null>(null);
  if (enabled && !storeRef.current) storeRef.current = new SyncStore();
  // Turning sync off drops every shared view.
  if (!enabled) storeRef.current = null;
  return <ChartSyncContext.Provider value={storeRef.current}>{children}</ChartSyncContext.Provider>;
}

/** Whether a sync provider is on above this component. */
export function useChartSyncEnabled(): boolean {
  return useContext(ChartSyncContext) != null;
}

/** The uPlot `cursor.sync.key` for an x-axis group. */
export function cursorSyncKey(groupKey: string): string {
  return `cairn-x:${groupKey}`;
}

const noopSubscribe = () => () => {};

/**
 * The view another card of `groupKey` last zoomed to (null when none, when
 * this card zoomed last, or without a provider), and `publish` for this
 * card's own zoom.
 */
export function useSyncedView(
  groupKey: string,
  cardId: string,
): { view: SyncedView | null; publish: (view: SyncedView) => void } {
  const store = useContext(ChartSyncContext);
  const subscribe = useCallback(
    (fn: () => void) => (store ? store.subscribe(groupKey, fn) : noopSubscribe()),
    [store, groupKey],
  );
  const entry = useSyncExternalStore(subscribe, () => store?.get(groupKey));
  const publish = useCallback(
    (view: SyncedView) => store?.set(groupKey, { view, from: cardId }),
    [store, groupKey, cardId],
  );
  const view = entry && entry.from !== cardId ? entry.view : null;
  return useMemo(() => ({ view, publish }), [view, publish]);
}
