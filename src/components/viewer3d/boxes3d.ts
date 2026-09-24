import * as THREE from "three";
import { extractProperties, type ArtifactArrays, type Scene3DMeta } from "./artifact-arrays";
import { SOLID_COLOR, valuesToColors } from "./colors";

export interface BoxesView {
  /** "depth" | "solid" | a property name. */
  colorBy: string;
}

export interface Boxes3DMeta extends Scene3DMeta {
  n_boxes: number;
  max_depth: number;
  kind: "boxes" | "octree" | "bvh";
}

export function boxesColorOptions(properties: string[]): Array<{ value: string; label: string }> {
  return [
    { value: "depth", label: "Depth" },
    ...properties.map((p) => ({ value: p, label: p })),
    { value: "solid", label: "Solid" },
  ];
}

// The 12 edges of a box as corner-index pairs; corner bit 0/1/2 picks max x/y/z.
const EDGES = [0, 1, 2, 3, 4, 5, 6, 7, 0, 2, 1, 3, 4, 6, 5, 7, 0, 4, 1, 5, 2, 6, 3, 7];

/** `mins`/`maxs` (N,3) f4, `depth` (N,) u2, optional `values_<name>` (N,) → one merged LineSegments. */
export function buildBoxes(arrays: ArtifactArrays, view: BoxesView): THREE.Object3D {
  const mins = arrays.mins!.data;
  const maxs = arrays.maxs!.data;
  const n = arrays.mins!.shape[0] ?? 0;
  const properties = extractProperties(arrays);

  let boxColors: Float32Array | null = null;
  if (properties[view.colorBy]) boxColors = valuesToColors(properties[view.colorBy]!, n);
  else if (view.colorBy === "depth" && arrays.depth) boxColors = valuesToColors(arrays.depth.data, n);

  const positions = new Float32Array(n * 24 * 3);
  const colors = boxColors ? new Float32Array(n * 24 * 3) : null;
  for (let b = 0; b < n; b++) {
    for (let e = 0; e < 24; e++) {
      const c = EDGES[e]!;
      const o = (b * 24 + e) * 3;
      positions[o] = (c & 1 ? maxs : mins)[b * 3]!;
      positions[o + 1] = (c & 2 ? maxs : mins)[b * 3 + 1]!;
      positions[o + 2] = (c & 4 ? maxs : mins)[b * 3 + 2]!;
      if (colors) {
        colors[o] = boxColors![b * 3]!;
        colors[o + 1] = boxColors![b * 3 + 1]!;
        colors[o + 2] = boxColors![b * 3 + 2]!;
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  if (colors) geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({
    vertexColors: colors !== null,
    color: colors ? 0xffffff : SOLID_COLOR,
  }));
}

export function boxesCaption(meta: Boxes3DMeta): string {
  return `${meta.n_boxes.toLocaleString()} boxes · ${meta.kind} · depth ≤ ${meta.max_depth}`;
}
