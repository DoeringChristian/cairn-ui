/**
 * "⤓ Insert from workspace" in a report cell's run set list: a run set
 * copying the project workspace's current view's run state (filter,
 * group-by, latest versions only, sort, eyes; lib/run-sets.ts
 * `insertRunSetFromWorkspace`), named after the view. A cell without cards
 * also gets the workspace layout's cards (lib/workspace/layout-cards.ts),
 * over the runs its sets then resolve to, each with its settings overrides
 * copied into the report's scope.
 */

import { api } from "../../api/client";
import type { Run } from "../../api/types";
import { saveCardOverrides } from "../card-settings";
import type { ComparisonCard } from "../comparisons";
import { insertRunSetFromWorkspace, resolveRunSets, type RunSet } from "../run-sets";
import { summaryPresenceOf } from "../summary-tables";
import { findPanel } from "../workspace/doc";
import { deriveLayout } from "../workspace/layout";
import { layoutCards } from "../workspace/layout-cards";
import { mergeRunMetrics } from "../workspace/metrics";
import { refKey, viewRef } from "../workspace/ref";
import { getWorkspace } from "../workspace/store";
import { summaryMetrics } from "../workspace/summary-cards";
import { fetchWorkspace } from "../workspace/sync";
import { cardSettingsKeyForReport } from "./scope";
import { newId } from "./ids";

export async function insertFromWorkspace(opts: {
  projectId: string;
  reportId: string;
  sets: readonly RunSet[];
  /** The cell has no cards yet: copy the workspace layout's. */
  copyCards: boolean;
  /** The project's runs the sets resolve over (lib/run-sets.ts `RUN_SET_POOL`). */
  pool: readonly Run[];
}): Promise<{ runSets: RunSet[]; cards: ComparisonCard[] | null }> {
  const { projectId, reportId, sets, copyCards, pool } = opts;
  const { views, current } = await api.views(projectId);
  const ref = viewRef(projectId, current);
  await fetchWorkspace(ref, { force: true });
  const doc = getWorkspace(refKey(ref));
  const runSets = insertRunSetFromWorkspace(sets, doc.runState, views.find((v) => v.id === current)?.name ?? "Workspace");
  if (!copyCards) return { runSets, cards: null };

  const runIds = resolveRunSets(runSets, pool).runIds;
  const [details, seqs, outputs] = await Promise.all([
    Promise.all(runIds.map((id) => api.run(id))),
    Promise.all(runIds.map((id) => api.sequences(id))),
    Promise.all(runIds.map((id) => api.runOutputArtifacts(id))),
  ]);
  const metrics = mergeRunMetrics(
    runIds.map((runId, i) => ({
      runId,
      sequences: seqs[i]!.sequences,
      // A custom viewer the run published is code for cards, not an output (as the workspace).
      artifactNames: outputs[i]!.outputs.filter((a) => a.type !== "cairn-viewer").map((a) => a.name),
    })),
  );
  const layoutMetrics = [...metrics, ...summaryMetrics(metrics, details.map(summaryPresenceOf))];
  const panels = deriveLayout(doc, layoutMetrics).flatMap((s) => s.panels);
  const cards = layoutCards(panels, runIds, (id) => findPanel(doc, id)?.panel.settings ?? {}).map(({ card, settings }) => {
    const copy = { ...card, id: newId() };
    if (Object.keys(settings).length > 0) saveCardOverrides(cardSettingsKeyForReport(reportId, copy), settings);
    return copy;
  });
  return { runSets, cards };
}
