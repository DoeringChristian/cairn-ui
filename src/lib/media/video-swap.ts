/**
 * Stepping a video card without blank or mismatched frames.
 *
 * A step change does not replace a pane's `<video>`s in place (that would
 * blank the pane until the new stream loads, show the poster's first frame
 * while the clock sits elsewhere, and let a video and its reference change
 * at different moments). Each pane mounts the new videos hidden next to the
 * shown ones, steers them onto the shared clock like any other, and swaps
 * once every new video holds the clock's frame (`videoFrameReady`). The
 * card's panes swap together: each waits at the card's `SwapBarrier` until
 * every pane with a pending swap is ready, then all flip in one commit.
 *
 * Pure (no DOM): tested in `video-swap.test.ts`.
 */

/** The parts of an `HTMLMediaElement` readiness depends on. */
export interface MediaState {
  readyState: number;
  seeking: boolean;
  currentTime: number;
  /** Seconds; NaN/Infinity/0 while unknown. */
  duration: number;
}

/** `HTMLMediaElement.HAVE_CURRENT_DATA`: the frame at `currentTime` is decoded. */
const HAVE_CURRENT_DATA = 2;

/**
 * The element shows the frame the clock asks for: its current frame is
 * decoded, no seek is in flight, and it sits within `tolerance` seconds of
 * the clock's position (clamped to its own duration, as the steering does).
 * Both tolerances stay under two frames at 30 fps: a swapped-in video starts
 * (nearly) frame-aligned with its neighbours, not several frames off.
 *
 * `presentedTime`: the media time of the last frame the compositor got from
 * the element (`requestVideoFrameCallback`), where the browser reports it.
 * Given, the element is ready only once that frame is (about) its current
 * one: a decoded frame the compositor has not received yet would paint a
 * frame late, and the swap would show an empty pane for that frame.
 */
export function videoFrameReady(
  media: MediaState,
  clockPosition: number,
  playing: boolean,
  {
    pausedTolerance = 0.05,
    playingTolerance = 0.05,
    presentedTime,
  }: { pausedTolerance?: number; playingTolerance?: number; presentedTime?: number | null } = {},
): boolean {
  if (media.readyState < HAVE_CURRENT_DATA || media.seeking) return false;
  const d = Number.isFinite(media.duration) && media.duration > 0 ? media.duration : null;
  const target = d == null ? clockPosition : Math.min(clockPosition, d);
  const tolerance = playing ? playingTolerance : pausedTolerance;
  if (Math.abs(media.currentTime - target) > tolerance) return false;
  // A frame's media time is its start: the current frame's starts up to a frame (≤ 0.1 s) before currentTime.
  if (presentedTime === undefined) return true;
  return presentedTime != null && presentedTime <= media.currentTime + tolerance && presentedTime >= media.currentTime - 0.1 - tolerance;
}

/**
 * Where a card's panes meet before swapping to a new step. A pane `wait`s
 * with a pending swap, reports `ready` once its new videos hold the clock's
 * frame, and swaps (then calls `done`) when `open`: every waiting pane is
 * ready. Listeners hear every change.
 */
export class SwapBarrier {
  private readonly waiting = new Map<string, boolean>();
  private readonly listeners = new Set<() => void>();

  /** `id` has a pending swap that is not ready yet. */
  wait(id: string): void {
    if (this.waiting.get(id) === false) return;
    this.waiting.set(id, false);
    this.emit();
  }

  /** `id`'s pending swap is ready. */
  ready(id: string): void {
    if (this.waiting.get(id) !== false) return;
    this.waiting.set(id, true);
    this.emit();
  }

  /** `id` swapped, dropped its pending swap, or went away. */
  done(id: string): void {
    if (!this.waiting.delete(id)) return;
    this.emit();
  }

  /** Every waiting pane is ready (vacuously true with none waiting). */
  get open(): boolean {
    for (const ready of this.waiting.values()) if (!ready) return false;
    return true;
  }

  isWaiting(id: string): boolean {
    return this.waiting.has(id);
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private emit(): void {
    for (const fn of [...this.listeners]) fn();
  }
}

/** One pane's videos: its own and (comparing) the reference, by artifact hash. */
export interface VideoPair {
  fg: string;
  ref: string | null;
}

export const pairKey = (p: VideoPair): string => `${p.fg}|${p.ref ?? ""}`;

/** The pane's swap state: the pair on screen, and the one loading hidden behind it. */
export interface SwapState<P extends VideoPair> {
  shown: P;
  pending: P | null;
}

/**
 * The swap state after the pane is asked for `want`: nothing to do when it
 * is on screen already (a pending swap is dropped) or already pending;
 * otherwise `want` becomes the pending pair (replacing an older pending one).
 */
export function requestPair<P extends VideoPair>(state: SwapState<P>, want: P): SwapState<P> {
  if (pairKey(want) === pairKey(state.shown)) return state.pending ? { shown: state.shown, pending: null } : state;
  if (state.pending && pairKey(want) === pairKey(state.pending)) return state;
  return { shown: state.shown, pending: want };
}

/**
 * The elements a slot (the pane's own side, or the reference side) renders:
 * the shown hash (visible) and the pending one (hidden), once each, in a
 * stable order (shown first). A hash
 * both shown and pending renders once, visible (it is ready already).
 */
export function slotElements(shown: string | null, pending: string | null): Array<{ hash: string; visible: boolean }> {
  const out: Array<{ hash: string; visible: boolean }> = [];
  if (shown) out.push({ hash: shown, visible: true });
  if (pending && pending !== shown) out.push({ hash: pending, visible: false });
  return out;
}

/**
 * Keeps the videos of a card on the same PRESENTED frame while they play.
 *
 * Steering every video onto one clock aligns their `currentTime`s to
 * milliseconds, yet two `<video>`s can still present frames one apart for as
 * long as they keep playing: each renderer picks the frame to show against
 * its own cadence, which a start or a swap can leave out of phase. A split
 * view (a video beside its reference) shows that at once.
 *
 * Every shown video feeds each frame it presents in here
 * (`requestVideoFrameCallback`: the frame's media time and when it is
 * displayed), with a `group`: videos on one clock at one frame rate (the
 * rate learned from the frames themselves; clips at other rates are not
 * frame-comparable). At each display time every playing video of a group
 * has reported up to, the frames on screen are compared; when they spread
 * over more than half a frame for `persist` comparisons in a row, the group
 * is returned: seek all of it to the clock together, which restarts every
 * renderer in phase. A video that stopped reporting (paused, resting on its
 * last frame, swapped out) leaves the comparison; a cooldown keeps a stream
 * that cannot be aligned from seeking over and over.
 */
export class FrameLock {
  private readonly sides = new Map<string, { group: string; hist: Array<[number, number]>; frameDuration: number }>();
  private readonly groups = new Map<string, { evaluated: number; streak: number; coolUntil: number }>();
  private readonly persist: number;
  private readonly cooldown: number;
  /** A video whose last frame is older than this (s) than the group's newest is not playing along. */
  private readonly stale: number;

  constructor({ persist = 4, cooldown = 1, stale = 0.25 }: { persist?: number; cooldown?: number; stale?: number } = {}) {
    this.persist = persist;
    this.cooldown = cooldown;
    this.stale = stale;
  }

  /**
   * Video `id` (on clock `clockKey`) presents the frame at `mediaTime`,
   * displayed at `displayTime` (seconds, one time base for all). `playing`:
   * its clock runs. Returns the ids to resync now, or null.
   */
  presented(id: string, clockKey: string, mediaTime: number, displayTime: number, playing: boolean): string[] | null {
    let side = this.sides.get(id);
    if (!side) {
      side = { group: "", hist: [], frameDuration: 1 };
      this.sides.set(id, side);
    }
    const prev = side.hist[side.hist.length - 1];
    if (prev && mediaTime - prev[1] > 1e-4 && mediaTime - prev[1] < side.frameDuration) side.frameDuration = mediaTime - prev[1];
    side.hist.push([displayTime, mediaTime]);
    if (side.hist.length > 8) side.hist.shift();
    // Frame rates within 1 % count as one (30 vs 29.97 fps).
    side.group = `${clockKey}@${Math.round(Math.log(side.frameDuration) * 100)}`;
    const g = this.groups.get(side.group) ?? { evaluated: -Infinity, streak: 0, coolUntil: -Infinity };
    this.groups.set(side.group, g);
    if (!playing) {
      g.streak = 0;
      return null;
    }
    const members = [...this.sides.entries()].filter(([, s]) => s.group === side!.group && s.hist.length);
    const newest = Math.max(...members.map(([, s]) => s.hist[s.hist.length - 1]![0]));
    const live = members.filter(([, s]) => s.hist[s.hist.length - 1]![0] >= newest - this.stale);
    if (live.length < 2) return null;
    // The latest moment every live member has reported up to; each shows its last frame displayed by then.
    const at = Math.min(...live.map(([, s]) => s.hist[s.hist.length - 1]![0]));
    if (at <= g.evaluated) return null;
    g.evaluated = at;
    const shown = live.map(([, s]) => {
      let m: number | null = null;
      for (const [d, t] of s.hist) if (d <= at + 1e-3) m = t;
      return m;
    });
    if (shown.some((m) => m == null)) return null;
    const spread = Math.max(...(shown as number[])) - Math.min(...(shown as number[]));
    if (spread <= side.frameDuration / 2) {
      g.streak = 0;
      return null;
    }
    if (++g.streak < this.persist || at < g.coolUntil) return null;
    g.streak = 0;
    g.coolUntil = at + this.cooldown;
    for (const [, s] of live) s.hist.length = 0;
    return live.map(([k]) => k);
  }

  /** Video `id` went away (or was seeked): forget its frames. */
  remove(id: string): void {
    this.sides.delete(id);
  }
}
