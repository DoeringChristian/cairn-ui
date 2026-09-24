import * as THREE from "three";
import { extractProperties, type ArtifactArrays, type Scene3DMeta } from "./artifact-arrays";
import { SOLID_COLOR, categoriesToColors, valuesToColors } from "./colors";

/** "auto" | "rgb" | "category" | "height" | "solid" | a property name. */
export type PointColorBy = string;

export interface PointCloudView {
  pointSize: number;
  colorBy: PointColorBy;
}

export interface PointCloudMeta extends Scene3DMeta {
  n_points: number;
  channels: "xyz" | "xyzc" | "xyzrgb";
  original_count: number;
  downsampled: boolean;
}

/** The color modes the cloud's layout supports, "auto" first. */
export function pointColorOptions(meta: PointCloudMeta | null, properties: string[]): Array<{ value: string; label: string }> {
  const opts = [{ value: "auto", label: "Automatic" }];
  if (meta?.channels === "xyzrgb") opts.push({ value: "rgb", label: "RGB" });
  if (meta?.channels === "xyzc") opts.push({ value: "category", label: "Category" });
  for (const p of properties) opts.push({ value: p, label: p });
  opts.push({ value: "height", label: "Height (y)" }, { value: "solid", label: "Solid" });
  return opts;
}

/** `points` is `(N, 3|4|6)` float32: xyz, xyz+category, or xyz+rgb (0..1). */
export function buildPointCloud(arrays: ArtifactArrays, view: PointCloudView): THREE.Object3D {
  const pts = arrays.points!;
  const n = pts.shape[0] ?? 0;
  const stride = pts.shape[1] ?? 3;
  const src = pts.data;

  const positions = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    positions[i * 3] = src[i * stride]!;
    positions[i * 3 + 1] = src[i * stride + 1]!;
    positions[i * 3 + 2] = src[i * stride + 2]!;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));

  const properties = extractProperties(arrays);
  let mode = view.colorBy;
  if (mode === "auto") {
    mode = stride === 6 ? "rgb" : stride === 4 ? "category" : Object.keys(properties)[0] ?? "height";
  }

  let colors: Float32Array | null = null;
  if (mode === "rgb" && stride === 6) {
    colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      colors[i * 3] = src[i * 6 + 3]!;
      colors[i * 3 + 1] = src[i * 6 + 4]!;
      colors[i * 3 + 2] = src[i * 6 + 5]!;
    }
  } else if (mode === "category" && stride === 4) {
    colors = categoriesToColors(src, n, 4, 3);
  } else if (properties[mode]) {
    colors = valuesToColors(properties[mode]!, n);
  } else if (mode === "height") {
    colors = valuesToColors(positions, n, 3, 1);
  }
  if (colors) geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

  const material = new THREE.PointsMaterial({
    // gl_PointSize is in framebuffer pixels; the setting is in CSS pixels.
    size: view.pointSize * window.devicePixelRatio,
    sizeAttenuation: false,
    vertexColors: colors !== null,
    color: colors ? 0xffffff : SOLID_COLOR,
  });
  return new THREE.Points(geometry, material);
}

export function pointCloudCaption(meta: PointCloudMeta): string {
  const n = meta.n_points.toLocaleString();
  return meta.downsampled
    ? `${n} of ${meta.original_count.toLocaleString()} points (downsampled)`
    : `${n} points`;
}
