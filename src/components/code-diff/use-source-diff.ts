import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { qk } from "../../api/query-keys";
import { fileText, mergeTrees, type FileStatus, type FileText, type MergedFile } from "../../lib/source-diff";

export interface SourceTrees {
  loading: boolean;
  /** Either run has no source snapshot. */
  missing: boolean;
  /** Every path of both trees, with its status. */
  files: MergedFile[];
  /** `files` minus the unchanged ones. */
  changed: MergedFile[];
}

/** Two runs' source trees (`/api/runs/{id}/source/tree`, cached by the server), merged. */
export function useSourceTrees(leftId: string, rightId: string): SourceTrees {
  const tree = (id: string) => ({
    queryKey: qk.sourceTree(id),
    queryFn: () => api.sourceTree(id),
    enabled: !!id,
    staleTime: Infinity,
    retry: false,
  });
  const left = useQuery(tree(leftId));
  const right = useQuery(tree(rightId));
  const files = useMemo(
    () => (left.data && right.data ? mergeTrees(left.data.files, right.data.files) : []),
    [left.data, right.data],
  );
  const changed = useMemo(() => files.filter((f) => f.status !== "unchanged"), [files]);
  const loading = left.isLoading || right.isLoading;
  return { loading, missing: !loading && (!left.data || !right.data), files, changed };
}

export interface SourceFilePair {
  left: FileText;
  right: FileText;
  loading: boolean;
}

/**
 * Both versions of `path` (`/source/file`); the side the file is absent
 * from (by its merged `status`) is not fetched and reads as `null`.
 */
export function useSourceFilePair(leftId: string, rightId: string, path: string | null, status: FileStatus | null): SourceFilePair {
  const file = (id: string, absent: FileStatus) => ({
    queryKey: qk.sourceFile(id, path),
    queryFn: () => api.sourceFile(id, path!),
    enabled: !!path && !!id && status != null && status !== absent,
    staleTime: Infinity,
    retry: false,
  });
  const left = useQuery(file(leftId, "added"));
  const right = useQuery(file(rightId, "removed"));
  return {
    left: status === "added" ? null : fileText(left.data),
    right: status === "removed" ? null : fileText(right.data),
    loading: left.isLoading || right.isLoading,
  };
}
