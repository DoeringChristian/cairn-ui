import * as THREE from "three";
import { extractProperties, type ArtifactArrays, type Scene3DMeta } from "./artifact-arrays";
import { SOLID_COLOR, valuesToColors } from "./colors";

export interface MeshView {
  /** "auto" | "face" | "vertex" | "solid" | a property name. */
  colorBy: string;
  wireframe: boolean;
}

export interface MeshMeta extends Scene3DMeta {
  n_vertices: number;
  n_faces: number;
  has_colors: boolean;
  has_face_colors: boolean;
  has_normals: boolean;
}

export function meshColorOptions(meta: MeshMeta | null, properties: string[]): Array<{ value: string; label: string }> {
  const opts = [{ value: "auto", label: "Automatic" }];
  if (meta?.has_face_colors) opts.push({ value: "face", label: "Face colors" });
  if (meta?.has_colors) opts.push({ value: "vertex", label: "Vertex colors" });
  for (const p of properties) opts.push({ value: p, label: p });
  opts.push({ value: "solid", label: "Solid" });
  return opts;
}

/**
 * `positions` (N,3) f4, `faces` (M,3) u4, optional `colors` (N,3), `face_colors`
 * (M,3|4), `normals` (N,3), `values_<name>` (N,). Face colors need one flat color
 * per triangle, so that path expands the indexed mesh to 3 unique verts per face.
 */
export function buildMesh(arrays: ArtifactArrays, view: MeshView): THREE.Object3D {
  const pos = arrays.positions!.data;
  const faces = arrays.faces!.data;
  const nFaces = arrays.faces!.shape[0] ?? 0;
  const properties = extractProperties(arrays);

  let mode = view.colorBy;
  if (mode === "auto") {
    mode = arrays.face_colors ? "face" : arrays.colors ? "vertex" : Object.keys(properties)[0] ?? "solid";
  }

  const geometry = new THREE.BufferGeometry();
  let vertexColors = false;
  if (mode === "face" && arrays.face_colors) {
    const fc = arrays.face_colors.data;
    const fcStride = arrays.face_colors.shape[1] ?? 3;
    const positions = new Float32Array(nFaces * 9);
    const colors = new Float32Array(nFaces * 9);
    for (let f = 0; f < nFaces; f++) {
      for (let k = 0; k < 3; k++) {
        const v = faces[f * 3 + k]!;
        const o = f * 9 + k * 3;
        positions[o] = pos[v * 3]!;
        positions[o + 1] = pos[v * 3 + 1]!;
        positions[o + 2] = pos[v * 3 + 2]!;
        colors[o] = fc[f * fcStride]!;
        colors[o + 1] = fc[f * fcStride + 1]!;
        colors[o + 2] = fc[f * fcStride + 2]!;
      }
    }
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    vertexColors = true;
  } else {
    const nVerts = arrays.positions!.shape[0] ?? 0;
    geometry.setAttribute("position", new THREE.BufferAttribute(Float32Array.from(pos), 3));
    geometry.setIndex(new THREE.BufferAttribute(Uint32Array.from(faces), 1));
    if (arrays.normals) geometry.setAttribute("normal", new THREE.BufferAttribute(Float32Array.from(arrays.normals.data), 3));
    else geometry.computeVertexNormals();
    let colors: Float32Array | null = null;
    if (mode === "vertex" && arrays.colors) colors = Float32Array.from(arrays.colors.data);
    else if (properties[mode]) colors = valuesToColors(properties[mode]!, nVerts);
    if (colors) {
      geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      vertexColors = true;
    }
  }

  const group = new THREE.Group();
  group.add(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
    vertexColors,
    color: vertexColors ? 0xffffff : SOLID_COLOR,
    roughness: 0.85,
    metalness: 0,
    side: THREE.DoubleSide,
    // Keep the fill behind the wireframe overlay.
    polygonOffset: view.wireframe,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  })));
  if (view.wireframe) {
    group.add(new THREE.LineSegments(
      new THREE.WireframeGeometry(geometry),
      new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35 }),
    ));
  }
  return group;
}

export function meshCaption(meta: MeshMeta): string {
  return `${meta.n_vertices.toLocaleString()} vertices · ${meta.n_faces.toLocaleString()} faces`;
}
