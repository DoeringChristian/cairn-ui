/**
 * What "add to report" copies of the card being rendered: its type, its
 * series and where its settings live. Provided where a card's data is known
 * (a workspace panel, a report / embed card); CardShell's shared header
 * action reads it (components/card-header/CardHeaderActions.tsx).
 */

import { createContext } from "react";
import type { CardSettingsKey } from "./card-settings";
import type { CardType } from "./cards/card-spec";
import type { ComparisonSeriesRef } from "./comparisons";

export interface CardReportCopy {
  cardType: CardType;
  series: ComparisonSeriesRef[];
  settingsKey: CardSettingsKey;
}

export const CardReportContext = createContext<CardReportCopy | null>(null);
