/**
 * One page's colours (lib/run-color.ts `assignPageColors`): the project
 * workspace (components/workspace-runs/RunsWorkspace.tsx: its visible runs
 * and innermost groups), the run page (WorkspaceView over its run) and a
 * report cell (ReportCardsBlock over its runs) compute them once and
 * provide them here; the sidebar's dots and every card read them
 * (lib/run-view.tsx `useRunColors`), so a run or group has one colour
 * everywhere on the page. Null outside a page: a card assigns over its own
 * runs.
 */

import { createContext } from "react";
import type { PageColors } from "./run-color.ts";

export const PageColorsContext = createContext<PageColors | null>(null);
