// ---------------------------------------------------------------------------
// 3D scenes in user figures: interaction defaults and live camera sync.
//
// Pure module (no plotly.js): runs under `node --test`.
// ---------------------------------------------------------------------------

import { GL_3D_TYPES } from "./gl-budget.ts";

/** The 3D scene ids (`scene`, `scene2`, …) a figure's traces draw into. */
export function sceneIds(data: ReadonlyArray<Record<string, unknown>>): string[] {
  const ids = new Set<string>();
  for (const t of data) {
    if (typeof t.type === "string" && GL_3D_TYPES.has(t.type)) ids.add((t.scene as string | undefined) ?? "scene");
  }
  return [...ids];
}

/**
 * 3D defaults on a themed figure layout (never mutated):
 *  - a drag rotates a 3D scene (Plotly's turntable) whatever the card's 2D
 *    drag mode is — `zoom`/`pan`/`select` mean nothing useful in 3D, and
 *    Plotly would otherwise inherit `layout.dragmode` into every scene. A
 *    card set to no dragging (`false`) leaves 3D scenes still too. A
 *    `dragmode` the figure's author set on a scene wins.
 *  - a figure with only 3D scenes and no authored margin gets thin margins,
 *    so a scene fills a small gallery cell instead of Plotly's 80–100 px
 *    defaults squeezing it to a sliver (room is kept for a title).
 */
export function scene3dLayout(
  layout: Record<string, unknown>,
  data: ReadonlyArray<Record<string, unknown>>,
  dragEnabled: boolean,
): Record<string, unknown> {
  const ids = sceneIds(data);
  if (ids.length === 0) return layout;
  const out: Record<string, unknown> = { ...layout };
  for (const id of ids) {
    const scene = { ...((layout[id] as Record<string, unknown> | undefined) ?? {}) };
    if (scene.dragmode === undefined) scene.dragmode = dragEnabled ? "turntable" : false;
    out[id] = scene;
  }
  const only3d = data.every((t) => typeof t.type === "string" && GL_3D_TYPES.has(t.type));
  if (only3d && layout.margin === undefined) {
    const title = layout.title as { text?: unknown } | string | undefined;
    const hasTitle = typeof title === "string" ? title !== "" : !!title?.text;
    out.margin = { l: 0, r: 0, b: 0, t: hasTitle ? 32 : 0, pad: 0 };
    // A legend left where Plotly puts it (right of the plot) would push the
    // margin back out and squeeze the scene: lay it over the scene's corner.
    const legend = layout.legend as Record<string, unknown> | undefined;
    if (legend?.x === undefined && legend?.y === undefined) {
      out.legend = { ...legend, x: 1, xanchor: "right", y: 1, yanchor: "top" };
    }
  }
  return out;
}

/** Scene cameras carried by a Plotly relayout(ing) event: `[sceneId, camera]` pairs. */
export function cameraUpdates(event: Record<string, unknown>): Array<[string, Record<string, unknown>]> {
  const out: Array<[string, Record<string, unknown>]> = [];
  for (const [k, v] of Object.entries(event)) {
    const m = k.match(/^(scene\d*)\.camera$/);
    if (m && v && typeof v === "object") out.push([m[1]!, v as Record<string, unknown>]);
  }
  return out;
}

/** A plot in a camera link: shows a camera without emitting any event. */
export interface CameraFollower {
  showCamera(sceneId: string, camera: Record<string, unknown>): void;
}

/**
 * The plots of one card that share a 3D camera. While a user drags one
 * plot's scene, every other plot follows it frame by frame through
 * `showCamera` — straight to the plots, not through host state: re-rendering
 * the dragged plot mid-drag would reset its scene to a stale camera (the
 * rotation snapping back and stalling). The host learns the final camera
 * from the drag's end (`plotly_relayout`) as usual.
 */
export interface CameraLink {
  /** Join the link; returns the leave function. */
  join(follower: CameraFollower): () => void;
  /** A camera moved on `from`'s plot: show it on every other plot. */
  moved(from: CameraFollower, event: Record<string, unknown>): void;
}

export function createCameraLink(): CameraLink {
  const members = new Set<CameraFollower>();
  return {
    join(f) {
      members.add(f);
      return () => { members.delete(f); };
    },
    moved(from, event) {
      const cams = cameraUpdates(event);
      if (cams.length === 0) return;
      for (const m of members) {
        if (m === from) continue;
        for (const [id, cam] of cams) m.showCamera(id, cam);
      }
    },
  };
}
