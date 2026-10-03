/**
 * Artifact registry queries and mutations (explorer, lineage viewer, run
 * Artifacts tab). Every mutation invalidates every artifact / lineage query:
 * an alias move or a delete changes families, versions and graphs at once.
 */

import { useContext } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { api } from "./client";
import { qk } from "./query-keys";
import { useSession } from "./hooks";
import { CardMutationContext } from "../lib/card-settings";

const ARTIFACT_KEY_PREFIXES = ["artifact-", "lineage", "run-input-artifacts", "run-output-artifacts"];

/**
 * Refetch every artifact / lineage query, except those naming one of `gone`
 * (deleted versions' ids, a deleted artifact's name: they would only 404).
 */
export function invalidateArtifacts(qc: QueryClient, gone: readonly string[] = []): Promise<void> {
  return qc.invalidateQueries({
    predicate: (q) => {
      const head = q.queryKey[0];
      if (gone.some((g) => q.queryKey.includes(g))) return false;
      return typeof head === "string" && ARTIFACT_KEY_PREFIXES.some((p) => head.startsWith(p));
    },
  });
}

/**
 * Whether this viewer may edit: not a read-only session, and not inside a
 * read-only surface (`CardMutationContext` false: embeds, share pages).
 */
export function useCanEdit(): boolean {
  const mutable = useContext(CardMutationContext);
  const role = useSession().data?.role;
  return mutable && role !== "read";
}

export function useArtifactFamilies(projectId: string) {
  return useQuery({
    queryKey: qk.artifactFamilies(projectId),
    queryFn: () => api.artifactFamilies(projectId),
    enabled: !!projectId,
  });
}

/** One artifact (by name) with its versions, newest first. */
export function useArtifactFamilyByName(projectId: string, name: string | null | undefined) {
  return useQuery({
    queryKey: qk.artifactFamilyByName(projectId, name ?? ""),
    queryFn: () => api.artifactFamilyByName(projectId, name!),
    enabled: !!projectId && !!name,
    retry: false,
  });
}

export function useArtifactVersion(versionId: string | null | undefined) {
  return useQuery({
    queryKey: qk.artifactVersion(versionId ?? ""),
    queryFn: () => api.artifactVersion(versionId!),
    enabled: !!versionId,
  });
}

export function useArtifactVersionFiles(versionId: string | null | undefined) {
  return useQuery({
    queryKey: qk.artifactVersionFiles(versionId ?? ""),
    queryFn: () => api.artifactVersionFiles(versionId!),
    enabled: !!versionId,
    // A version's entries never change.
    staleTime: Infinity,
  });
}

export function useArtifactVersionConsumers(versionId: string | null | undefined) {
  return useQuery({
    queryKey: qk.artifactVersionConsumers(versionId ?? ""),
    queryFn: () => api.artifactVersionConsumers(versionId!),
    enabled: !!versionId,
  });
}

/** The first `bytes` of an entry as text (immutable). */
export function useArtifactFileText(versionId: string, path: string, bytes: number, enabled = true) {
  return useQuery({
    queryKey: qk.artifactFileText(versionId, path),
    queryFn: () => api.artifactVersionFileText(versionId, path, bytes),
    enabled,
    staleTime: Infinity,
  });
}

/** Alias / tag / description / metadata edits of one version; each resolves to the updated version. */
export function useVersionEdits(versionId: string) {
  const qc = useQueryClient();
  const done = () => invalidateArtifacts(qc);
  const addAlias = useMutation({ mutationFn: (a: string) => api.addArtifactAlias(versionId, a), onSuccess: done });
  const removeAlias = useMutation({ mutationFn: (a: string) => api.removeArtifactAlias(versionId, a), onSuccess: done });
  const addTag = useMutation({ mutationFn: (t: string) => api.addArtifactTag(versionId, t), onSuccess: done });
  const removeTag = useMutation({ mutationFn: (t: string) => api.removeArtifactTag(versionId, t), onSuccess: done });
  const update = useMutation({
    mutationFn: (body: { description?: string; metadata?: Record<string, unknown> }) =>
      api.updateArtifactVersion(versionId, body),
    onSuccess: done,
  });
  return { addAlias, removeAlias, addTag, removeTag, update };
}

export function useDeleteArtifactVersion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, force }: { id: string; force: boolean }) => api.deleteArtifactVersion(id, force),
    // Not awaited: the caller's onSuccess (navigating away) runs before the
    // refetches land, so the dialog is not unmounted under it.
    onSuccess: (_data, { id }) => {
      void invalidateArtifacts(qc, [id]);
    },
  });
}

export function useDeleteArtifactFamily() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string; name: string; versionIds: string[] }) => api.deleteArtifactFamily(id),
    onSuccess: (_data, { name, versionIds }) => {
      void invalidateArtifacts(qc, [name, ...versionIds]);
    },
  });
}

export function useUpdateArtifactFamily(familyId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (description: string) => api.updateArtifactFamily(familyId, { description }),
    onSuccess: () => invalidateArtifacts(qc),
  });
}

export function useProjectLineage(projectId: string, familyId?: string | null) {
  return useQuery({
    queryKey: qk.lineage(projectId, familyId),
    queryFn: () => api.lineage(projectId, familyId),
    enabled: !!projectId,
  });
}
