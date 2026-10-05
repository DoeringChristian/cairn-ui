/**
 * Panel-level things a workspace offers each card (the card components
 * themselves know nothing about panels): "duplicate" copies the card right
 * after itself, and `editor` lets the card's settings modal (the gear) edit
 * the panel itself — its data, card type and title — beside the
 * card's own settings. The gear is the one editor of a card.
 */

import { createContext } from "react";
import type { Panel } from "./doc";
import type { MetricInfo } from "./layout";
import type { PanelChange } from "./card-builder";

export interface PanelEditor {
  panel: Panel;
  /** The series of the bound runs (what the card can show). */
  metrics: readonly MetricInfo[];
  runCount: number;
  change: (change: PanelChange) => void;
}

export interface PanelActions {
  onDuplicate?: () => void;
  editor?: PanelEditor;
}

export const PanelActionsContext = createContext<PanelActions | null>(null);

/**
 * The default title of a panel whose card would otherwise be titled by its
 * first metric (a multi-metric or regex panel): `a, b` or `/val\..*\/`.
 * A title the user set (settings.title) still wins.
 */
export const PanelTitleContext = createContext<string | null>(null);

