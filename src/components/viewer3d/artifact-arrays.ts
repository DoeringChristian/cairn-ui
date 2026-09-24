import { keepPreviousData, useQuery } from "@tanstack/react-query";
import * as THREE from "three";
import { api } from "../../api/client";
import { parseNpy, type NpyArray } from "../../lib/parse-npy";
import { parseNpz } from "../../lib/parse-npz";

/** A 3D artifact's arrays by npz member name. A bare `.npy` blob (a point cloud without properties) lands under `points`. */
export type ArtifactArrays = Record<string, NpyArray>;

/** Metadata the 3D handlers record next to each blob (`artifact_metadata`); fields vary per kind. */
export interface Scene3DMeta {
  properties?: Array<{ name: string; min: number; max: number; mean: number }>;
  [key: string]: unknown;
}

async function fetchArtifactArrays(hash: string): Promise<ArtifactArrays> {
  const res = await fetch(api.artifactUrl(hash));
  if (!res.ok) throw new Error(`artifact ${hash}: HTTP ${res.status}`);
  const buffer = await res.arrayBuffer();
  const head = new Uint8Array(buffer, 0, Math.min(2, buffer.byteLength));
  // ZIP magic "PK" → npz archive; otherwise a plain .npy array.
  if (head[0] === 0x50 && head[1] === 0x4b) return parseNpz(buffer);
  return { points: parseNpy(buffer) };
}

/**
 * Fetch + parse one artifact blob. The previous step's arrays stay visible while
 * the next step loads, so scrubbing never flashes an empty scene.
 */
export function useArtifactArrays(hash: string | null) {
  return useQuery({
    queryKey: ["artifact-arrays", hash],
    queryFn: () => fetchArtifactArrays(hash!),
    enabled: !!hash,
    staleTime: Infinity,
    gcTime: 60_000,
    placeholderData: keepPreviousData,
  });
}

/** Named per-element properties: the `values_<name>` members. */
export function extractProperties(arrays: ArtifactArrays): Record<string, Float64Array> {
  const out: Record<string, Float64Array> = {};
  for (const key of Object.keys(arrays)) {
    if (key.startsWith("values_")) out[key.slice("values_".length)] = arrays[key]!.data;
  }
  return out;
}

/** Property names recorded in the metadata, available before the blob loads. */
export function propertyNames(meta: Scene3DMeta | null): string[] {
  return meta?.properties?.map((p) => p.name) ?? [];
}

/** Release every geometry and material under `root`. */
export function disposeObject(root: THREE.Object3D): void {
  root.traverse((node) => {
    const o = node as THREE.Object3D & { geometry?: THREE.BufferGeometry; material?: THREE.Material | THREE.Material[] };
    o.geometry?.dispose();
    if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
    else o.material?.dispose();
  });
}
