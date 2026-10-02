/**
 * Panel-level actions a workspace offers in each card's header (the card
 * components themselves know nothing about panels): "edit card" opens the
 * card builder on the card (data, type, settings, section); "duplicate"
 * copies it right after itself.
 */

import { createContext } from "react";

export interface PanelActions {
  onEdit: () => void;
  onDuplicate?: () => void;
}

export const PanelActionsContext = createContext<PanelActions | null>(null);

/**
 * The default title of a panel whose card would otherwise be titled by its
 * first metric (a multi-metric or regex panel): `a, b` or `/val\..*\/`.
 * A title the user set (settings.title) still wins.
 */
export const PanelTitleContext = createContext<string | null>(null);

/**
 * Where a card renders its settings panel instead of its detail modal: the
 * card builder's configure step provides an element, and `CardShell`
 * portals the card's own settings panel (the one its gear opens) into it.
 */
export const CardSettingsSlotContext = createContext<HTMLElement | null>(null);
