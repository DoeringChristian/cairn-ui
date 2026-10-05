/**
 * Custom viewer frames in the page's WebGL budget (charts/gl-budget-manager.ts):
 * a WebGL viewer's frame counts as one context (its canvas lives in the
 * frame's document, out of the manager's reach, so this is the declared
 * weight, not a measurement); a 2D viewer is not budgeted.
 */
export function frameWeight(manifest: { webgl: boolean }): number {
  return manifest.webgl ? 1 : 0;
}
