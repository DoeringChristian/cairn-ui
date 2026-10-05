/**
 * A live, read-only card on the bound runs that writes nothing: the real
 * card component (PanelCard → CardRenderer) over a draft settings store.
 * The add panel's card-type step shows one per type as a thumbnail
 * (`scale` shrinks it; it takes no pointer or keyboard input then).
 */

import { useMemo, useRef } from "react";
import PanelCard from "./PanelCard";
import { CardMutationContext, CardSettingsStoreContext, type CardOverrides, type CardSettingsKey, type CardSettingsStore } from "../../lib/card-settings";
import type { CardType } from "../../lib/cards/card-spec";
import { CardNavProvider } from "../../lib/card-nav";
import { ChartSyncProvider } from "../../lib/chart-sync";
import { NoUndo } from "../../lib/undo-context";
import type { MetricSelector, Panel } from "../../lib/workspace/doc";
import { panelLabel, resolvePanelMetrics, type MetricInfo, type RenderedPanel } from "../../lib/workspace/layout";
import { PanelActionsContext } from "../../lib/workspace/panel-actions";

export default function CardPreview({
  draftKey,
  type,
  selector,
  settings,
  metrics,
  runIds,
  scale = 1,
}: {
  draftKey: string;
  type: CardType;
  selector: MetricSelector;
  settings: Record<string, unknown>;
  metrics: readonly MetricInfo[];
  runIds: readonly string[];
  /** Shrink the card: it lays out at 1/scale its box and is drawn at `scale`. */
  scale?: number;
}) {
  const settingsRef = useRef<CardOverrides>(settings);
  settingsRef.current = settings;
  const store = useMemo<CardSettingsStore>(
    () => ({
      read: () => settingsRef.current,
      subscribe: () => () => {},
      write: () => {},
    }),
    [],
  );
  const settingsKey = useMemo<CardSettingsKey>(() => ({ runId: "card-preview", metricName: draftKey }), [draftKey]);
  const rendered = useMemo<RenderedPanel>(() => {
    const panel: Panel = { id: draftKey, type, selector, settings };
    const byName = new Map(metrics.map((m) => [m.name, m]));
    return { panel, auto: false, section: "", metrics: resolvePanelMetrics(panel, byName), label: panelLabel(panel) };
  }, [draftKey, type, selector, settings, metrics]);

  const card = (
    <NoUndo>
      <CardMutationContext.Provider value={false}>
        <CardSettingsStoreContext.Provider value={store}>
          <PanelActionsContext.Provider value={null}>
            <ChartSyncProvider enabled={false}>
              <CardNavProvider>
                {/* A one-column grid, so a card's `grid-column: span N` is harmless. */}
                <div className="grid grid-cols-1" data-testid="card-preview">
                  <PanelCard rendered={rendered} runIds={runIds} settingsKey={settingsKey} />
                </div>
              </CardNavProvider>
            </ChartSyncProvider>
          </PanelActionsContext.Provider>
        </CardSettingsStoreContext.Provider>
      </CardMutationContext.Provider>
    </NoUndo>
  );
  if (scale === 1) return card;
  return (
    <div className="pointer-events-none h-full w-full overflow-hidden" aria-hidden="true" ref={(el) => el?.setAttribute("inert", "")}>
      <div style={{ width: `${100 / scale}%`, height: `${100 / scale}%`, transform: `scale(${scale})`, transformOrigin: "0 0" }}>{card}</div>
    </div>
  );
}
