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
