/**
 * Custom viewer frames in report exports. A viewer draws inside its own
 * sandboxed frame, out of reach of the page's capture code (LaTeX export's
 * `renderChartPng`, the browser's print for PDF), so each frame registers
 * here how to picture it: its viewer's `snapshot()` while it runs, else the
 * last snapshot it shows while paused.
 *
 * Frames are keyed by their box element (`[data-viewer="custom"]`).
 */

export interface FrameExport {
  /** A data URL of what the frame shows now; null when there is none. */
  snapshot: () => Promise<string | null>;
  /** Show `url` in place of the frame when printing (null: the frame again). */
  setPrint: (url: string | null) => void;
}

const frames = new Map<Element, FrameExport>();

export function registerFrameExport(box: Element, f: FrameExport): () => void {
  frames.set(box, f);
  return () => {
    if (frames.get(box) === f) frames.delete(box);
  };
}

/** The picture of the frame whose box is `box`; null when it is not a registered frame or has none. */
export async function snapshotFrame(box: Element): Promise<string | null> {
  const f = frames.get(box);
  return f ? f.snapshot().catch(() => null) : null;
}

/** True while some custom viewer frame under `root` is still loading or rendering. */
export function framesBusy(root: ParentNode): boolean {
  return root.querySelector('[data-viewer="custom"][data-viewer-busy="true"]') != null;
}

/**
 * Before printing: every frame under `root` shows its snapshot instead of
 * itself (a frame's WebGL canvas may print blank). Returns the undo.
 */
export async function freezeFramesForPrint(root: ParentNode = document): Promise<() => void> {
  const shown: FrameExport[] = [];
  await Promise.all(
    [...frames.entries()].map(async ([box, f]) => {
      if (!root.contains(box)) return;
      const url = await f.snapshot().catch(() => null);
      if (url) {
        f.setPrint(url);
        shown.push(f);
      }
    }),
  );
  return () => shown.forEach((f) => f.setPrint(null));
}
