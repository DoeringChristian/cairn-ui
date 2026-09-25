/**
 * True while a report export is capturing the page: everything that would
 * normally hide content renders it instead, so every card is on the page to
 * be captured. Collapsed cards (CardShell) and collapsed report headings
 * read it and show their content; nothing is saved, the collapsed state
 * comes back when the export ends.
 */

import { createContext, useContext } from "react";

export const ReportExportContext = createContext(false);

export function useReportExporting(): boolean {
  return useContext(ReportExportContext);
}
