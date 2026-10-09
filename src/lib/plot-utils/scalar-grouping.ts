/**
 * Which grouping a scalar card draws. The card's `groupMode`:
 *
 * - `workspace` (default): follow the workspace sidebar's grouping (the
 *   `WorkspaceGroupingContext`): grouped, one line per innermost sidebar group
 *   (mean, a min–max band, the group's colour, its `group: exp-44, jobType:
 *   train` label); not grouped, one line per run.
 *   A report cell provides its run sets' grouping the same way (follow the
 *   run set). Without a context (the run page) the card's own grouping
 *   settings apply.
 * - `off`: one line per run, even in a grouped workspace.
 * - `key`: the card's own `groupBy` with its own agg / band / hideMembers /
 *   latestPerGroup, everywhere — an explicit card setting wins over the
 *   workspace's grouping.
 *
 * Pure (the run lookups come in as functions), so every combination is
 * unit-tested.
 */
import type { AggKind, BandKind } from "./aggregate.ts";
import type { WorkspaceGrouping } from "../workspace-runs/grouping-context.ts";

export type ScalarGroupMode = "workspace" | "off" | "key";

export interface ScalarGroupingSettings<By> {
  groupMode: ScalarGroupMode;
  groupBy: By;
  agg: AggKind;
  band: BandKind;
  hideMembers: boolean;
  latestPerGroup: boolean;
}

export interface ScalarGroupingPlan {
  /** Whose grouping draws: the workspace's, the card's, or none (a line per run). */
  source: "workspace" | "card" | null;
  /** A run's group (null: its own line); null when nothing is grouped. */
  groupOf: ((runId: string) => string | null) | null;
  /** Keep only the newest run of each group (`latestGroupOf`) before drawing. */
  latestPerGroup: boolean;
  latestGroupOf: (runId: string) => string | null;
  /** How groups draw. */
  agg: AggKind;
  band: BandKind;
  hideMembers: boolean;
  /** Group colours: the workspace's (`WorkspaceGrouping.colorOf`) or a palette slot per sorted group. */
  palette: "workspace" | "card";
  countInLabel: boolean;
}

export function planScalarGrouping<By>(
  settings: ScalarGroupingSettings<By>,
  ws: WorkspaceGrouping | null | undefined,
  lookups: {
    /** The run's value for the card's `groupBy` (null: ungrouped). */
    cardGroupOf: (by: By, runId: string) => string | null;
    /** The run's own group (latest-per-group without a card grouping). */
    runGroupOf: (runId: string) => string | null;
  },
): ScalarGroupingPlan {
  const mode = settings.groupMode;
  const own = (rid: string) => lookups.cardGroupOf(settings.groupBy, rid);
  const cardStyle = {
    agg: settings.agg,
    band: settings.band,
    hideMembers: settings.hideMembers,
    palette: "card" as const,
    countInLabel: true,
  };
  if (mode === "workspace" && ws !== undefined) {
    // In a workspace, following it: its grouping (or none) replaces the card's.
    if (ws === null) {
      return { source: null, groupOf: null, latestPerGroup: false, latestGroupOf: lookups.runGroupOf, ...cardStyle };
    }
    const groupOf = (rid: string) => ws.groupOf.get(rid) ?? null;
    return {
      source: "workspace",
      groupOf,
      latestPerGroup: false,
      latestGroupOf: groupOf,
      agg: "mean",
      band: "minmax",
      hideMembers: true,
      palette: "workspace",
      countInLabel: false,
    };
  }
  if (mode === "off") {
    return {
      source: null,
      groupOf: null,
      latestPerGroup: settings.latestPerGroup,
      latestGroupOf: lookups.runGroupOf,
      ...cardStyle,
    };
  }
  // `key`, or `workspace` outside a workspace: the card's own grouping.
  return { source: "card", groupOf: own, latestPerGroup: settings.latestPerGroup, latestGroupOf: own, ...cardStyle };
}
