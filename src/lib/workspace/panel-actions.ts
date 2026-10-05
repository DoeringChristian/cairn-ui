/**
 * Panel-level things a workspace offers each card (the card components
 * themselves know nothing about panels): "duplicate" copies the card right
 * after itself, and `panelId` makes the card's gear open the workspace's
 * card editor (components/workspace/CardEditor.tsx) on that panel — its
 * data, card type and title above the card's own settings. The gear is the
 * one editor of a card.
 */

import { createContext } from "react";

export interface PanelActions {
  onDuplicate?: () => void;
  /** The card's panel (editable: the workspace is not read-only). */
  panelId?: string;
}

export const PanelActionsContext = createContext<PanelActions | null>(null);

/**
 * The default title of a panel whose card would otherwise be titled by its
 * first metric (a multi-metric or regex panel): `a, b` or `/val\..*\/`.
 * A title the user set (settings.title) still wins.
 */
export const PanelTitleContext = createContext<string | null>(null);

