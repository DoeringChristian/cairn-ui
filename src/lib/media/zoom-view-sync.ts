/**
 * Live zoom/pan sync between the panes of one card (or viewer).
 *
 * A card keeps its panes' shared {@link ZoomView} in React state, but going
 * through that state on every pointer move put the other panes a frame (or
 * more, on a busy card) behind the one being dragged: the dragged pane moves
 * in the event handler, the others only after the card re-renders. So during
 * a gesture the view travels through this bus instead: the pane under the
 * user's hand publishes each view, and every other pane of the bus shows it
 * at once, in the same event handler — the same frame. The card's state is
 * written once the gesture ends (ZoomSplitPane), and anything that sets the
 * state (reset view, a new card) reaches the panes as before, through props.
 *
 * Pure: tested in `zoom-view-sync.test.ts`.
 */

import type { ZoomView } from "./view-geometry.ts";

export interface ZoomViewFollower {
  /** Show `view` now (imperatively; no React render). */
  show(view: ZoomView): void;
}

export class ZoomViewSync {
  private readonly panes = new Set<ZoomViewFollower>();

  /** Add a pane; returns its leave function. */
  join(pane: ZoomViewFollower): () => void {
    this.panes.add(pane);
    return () => {
      this.panes.delete(pane);
    };
  }

  /** `from`'s user moved the view: every other pane shows it now. */
  publish(view: ZoomView, from: ZoomViewFollower): void {
    for (const p of this.panes) if (p !== from) p.show(view);
  }

  get size(): number {
    return this.panes.size;
  }
}

/**
 * When a pane writes its gesture's view back to the card's state: once no
 * pointer gesture (pan, pinch) is in progress and the view has been still
 * for `quietMs` (a wheel burst, the library's release animation). `commit`
 * gets the latest view, once per settled gesture.
 */
export class GestureCommitter {
  private pending: ZoomView | null = null;
  private active = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly commit: (view: ZoomView) => void;
  private readonly quietMs: number;
  private readonly setTimer: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  private readonly clearTimer: (t: ReturnType<typeof setTimeout>) => void;

  constructor(
    commit: (view: ZoomView) => void,
    opts: {
      quietMs?: number;
      setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
      clearTimer?: (t: ReturnType<typeof setTimeout>) => void;
    } = {},
  ) {
    this.commit = commit;
    this.quietMs = opts.quietMs ?? 150;
    this.setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = opts.clearTimer ?? ((t) => clearTimeout(t));
  }

  /** A pointer gesture started (the library's panning / pinching start). */
  start(): void {
    this.active = true;
    this.cancelTimer();
  }

  /** A pointer gesture ended: commit what it did. */
  stop(): void {
    this.active = false;
    this.later();
  }

  /** The view changed (by the user, of this pane). */
  changed(view: ZoomView): void {
    this.pending = view;
    if (!this.active) this.later();
  }

  /** Commit now (e.g. the pane unmounts mid-gesture). */
  flush(): void {
    this.cancelTimer();
    const v = this.pending;
    this.pending = null;
    if (v) this.commit(v);
  }

  private later(): void {
    this.cancelTimer();
    if (!this.pending) return;
    this.timer = this.setTimer(() => {
      this.timer = null;
      this.flush();
    }, this.quietMs);
  }

  private cancelTimer(): void {
    if (this.timer != null) this.clearTimer(this.timer);
    this.timer = null;
  }
}
