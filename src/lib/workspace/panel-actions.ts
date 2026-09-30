/**
 * Panel-level actions a workspace offers in each card's header (the card
 * components themselves know nothing about panels): "edit panel" opens the
 * panel dialog (type, metrics, section).
 */

import { createContext } from "react";

export interface PanelActions {
  onEdit: () => void;
}

export const PanelActionsContext = createContext<PanelActions | null>(null);

/**
 * The default title of a panel whose card would otherwise be titled by its
 * first metric (a multi-metric or regex panel): `a, b` or `/val\..*\/`.
 * A title the user set (settings.title) still wins.
 */
export const PanelTitleContext = createContext<string | null>(null);
