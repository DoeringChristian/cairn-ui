import type * as THREE from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

/** One viewer's camera as seen by a `CameraLink`. */
export interface LinkedView {
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  /** Has this viewer framed content yet? Unfitted viewers never lead. */
  fitted: () => boolean;
  render: () => void;
}

/**
 * Mirrors orbit/zoom/pan between the panes of ONE card. The card owns one link
 * for its lifetime; every pane's viewer joins it and publishes on user change.
 */
export class CameraLink {
  private views = new Set<LinkedView>();
  private syncing = false;

  join(view: LinkedView): () => void {
    this.views.add(view);
    return () => { this.views.delete(view); };
  }

  /** A fitted peer of `self` to copy on first load, so a late pane joins the shared view instead of refitting. */
  leader(self: LinkedView): LinkedView | null {
    for (const v of this.views) if (v !== self && v.fitted()) return v;
    return null;
  }

  publish(from: LinkedView): void {
    if (this.syncing) return;
    this.syncing = true;
    try {
      for (const v of this.views) if (v !== from) copyCamera(from, v);
    } finally {
      this.syncing = false;
    }
  }
}

export function copyCamera(from: LinkedView, to: LinkedView): void {
  to.camera.position.copy(from.camera.position);
  to.camera.quaternion.copy(from.camera.quaternion);
  to.camera.near = from.camera.near;
  to.camera.far = from.camera.far;
  to.camera.updateProjectionMatrix();
  to.controls.target.copy(from.controls.target);
  to.controls.update();
  to.render();
}
