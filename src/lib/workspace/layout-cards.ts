/**
 * A workspace layout's panels as report cards (pure): each panel a card
 * over `runIds` with its settings overrides. A per-metric card draws the
 * runs that log its metrics (none: no card); a multi-run card (value tile,
 * bar, scatter, …) every run. Used by "send section to report" and the
 * report run set list's "⤓ Insert from workspace" (a cell without cards
 * copies the workspace layout's cards).
 */

import { isMultiRunCardType, type ComparisonCard } from "../comparisons/types.ts";
import type { RenderedPanel } from "./layout.ts";

export interface LayoutCard {
  card: ComparisonCard;
  settings: Record<string, unknown>;
}

export function layoutCards(
  panels: readonly RenderedPanel[],
  runIds: readonly string[],
  settingsOf: (panelId: string) => Record<string, unknown>,
): LayoutCard[] {
  return panels.flatMap((rp): LayoutCard[] => {
    const settings = settingsOf(rp.panel.id);
    if (isMultiRunCardType(rp.panel.type)) {
      return [{ card: { id: rp.panel.id, type: rp.panel.type, series: runIds.map((runId) => ({ runId, name: rp.label })) }, settings }];
    }
    const series = rp.metrics.flatMap((m) => {
      const has = new Set(m.runIds);
      return runIds.filter((r) => has.has(r)).map((runId) => ({ runId, name: m.name }));
    });
    return series.length ? [{ card: { id: rp.panel.id, type: rp.panel.type, series }, settings }] : [];
  });
}
