/** A group's lineage graph (`GET /api/projects/{pid}/groups/{group}/graph`) */

import type { RunStatus } from "../../api/types.ts";

/** A run of a group's lineage graph. */
export interface GroupGraphRun {
  id: string;
  name: string | null;
  display_name: string | null;
  version: number | null;
  status: RunStatus;
  created_at: string;
  ended_at: string | null;
}

/** `from` (upstream) was used by `to` (downstream); both inside the group. */
export interface GroupGraphEdge {
  from: string;
  to: string;
  via: "artifact" | "run";
  /** `via: "artifact"`: the artifact versions passed along. */
  artifacts?: Array<{ artifact_version_id: string; artifact: string; role: string | null }>;
  /** `via: "run"`: the role `to` used `from` in. */
  role?: string | null;
}

export interface GroupGraph {
  group: string;
  runs: GroupGraphRun[];
  edges: GroupGraphEdge[];
}

/** The series a run belongs to inside its group: its name, or the run itself when unnamed. */
export function nameKey(run: Pick<GroupGraphRun, "id" | "name">): string {
  return run.name != null ? `n:${run.name}` : `u:${run.id}`;
}

/** What a series is called in the UI. */
export function nameLabel(run: Pick<GroupGraphRun, "id" | "name" | "display_name">): string {
  return run.name ?? run.display_name ?? run.id.slice(0, 6);
}
