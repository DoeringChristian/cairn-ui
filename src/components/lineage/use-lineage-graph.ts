import { useCallback, useMemo, useRef, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { qk } from "../../api/query-keys";
import type { LineageGraph } from "../../api/types";
import { emptyModel, mergeGraphs, type ModelGraph } from "../../lib/lineage/graph-model";

/** A lineage graph's centre: a version or a run. */
export interface LineageCenter {
  kind: "artifact_version" | "run";
  id: string;
}

interface Expansion {
  kind: "artifact_version" | "run";
  id: string;
  direction: "upstream" | "downstream";
}

/**
 * The lineage graph every view of it reads (the project's Lineage page, a
 * version's Lineage tab, a run's Artifacts tab): the project's graph (or one
 * artifact's, `familyId`), or `depth` hops around `center`, plus every
 * one-hop expansion asked for since, merged into one model. Refetches after
 * an edit keep it fresh (every key starts with "lineage", see
 * invalidateArtifacts).
 */
export function useLineageGraph(
  projectId: string,
  { center, familyId, depth }: { center?: LineageCenter | null; familyId?: string | null; depth: number },
) {
  const base = useQuery({
    queryKey: center ? qk.lineageAround(center.kind, center.id, depth, "both") : qk.lineage(projectId, familyId),
    queryFn: () => (center ? api.lineageAround(center, { depth, direction: "both" }) : api.lineage(projectId, familyId)),
  });
  const [expansions, setExpansions] = useState<Expansion[]>([]);
  const expansionQs = useQueries({
    queries: expansions.map((x) => ({
      queryKey: qk.lineageAround(x.kind, x.id, 1, x.direction),
      queryFn: () => api.lineageAround({ kind: x.kind, id: x.id }, { depth: 1, direction: x.direction }),
    })),
  });
  // A fixed-size dependency standing for every expansion's current data.
  const expansionStamp = expansionQs.map((q) => q.dataUpdatedAt).join(",");
  const expansionQsRef = useRef(expansionQs);
  expansionQsRef.current = expansionQs;
  const model: ModelGraph = useMemo(() => {
    let m = emptyModel();
    const all = [base.data, ...expansionQsRef.current.map((q) => q.data)].filter((g): g is LineageGraph => !!g);
    for (const g of all) m = mergeGraphs(m, g);
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base.data, expansionStamp]);
  /** Load one more hop up- or downstream of a node. */
  const expand = useCallback(
    (id: string, direction: "upstream" | "downstream") => {
      const n = model.nodes.get(id);
      if (!n) return;
      setExpansions((xs) =>
        xs.some((x) => x.id === id && x.direction === direction) ? xs : [...xs, { kind: n.kind, id, direction }],
      );
    },
    [model],
  );
  return {
    model,
    isLoading: base.isLoading,
    error: base.isError ? base.error : null,
    expanding: expansionQs.some((q) => q.isFetching && !q.data),
    expand,
  };
}
