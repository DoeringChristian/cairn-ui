/**
 * A shared playback clock: several `<video>`s (the panes of one card, or every
 * video card of a section) follow one position, so they play, pause and seek
 * together. The clock never touches media itself; `useClockedVideo` steers
 * each element toward it with `driftCorrection`.
 *
 * Time is in seconds. `now` is injectable so tests drive a fake clock.
 *
 * Pure (no DOM): tested in `shared-clock.test.ts`.
 */

export interface ClockSnapshot {
  playing: boolean;
  /** Position at the time of the snapshot, seconds. */
  position: number;
  /** Longest registered media duration; 0 while none is known. */
  duration: number;
  rate: number;
  loop: boolean;
}

export class SharedClock {
  private readonly now: () => number;
  private anchorPos = 0;
  private anchorTime = 0;
  private playingFlag = false;
  private rateValue = 1;
  private loopFlag = false;
  private readonly durations = new Map<string, number>();
  private readonly listeners = new Set<() => void>();
  /** Bumped on every state change; lets React subscribers tell changes apart. */
  version = 0;

  constructor(now: () => number = () => performance.now() / 1000) {
    this.now = now;
    this.anchorTime = now();
  }

  get playing(): boolean {
    return this.playingFlag;
  }

  get rate(): number {
    return this.rateValue;
  }

  get loop(): boolean {
    return this.loopFlag;
  }

  /** Longest registered duration (0 while none is known). */
  get duration(): number {
    let d = 0;
    for (const v of this.durations.values()) d = Math.max(d, v);
    return d;
  }

  /** Current position: advances with wall time × rate while playing, wraps (loop) or holds at the end. */
  position(): number {
    const raw = this.playingFlag ? this.anchorPos + (this.now() - this.anchorTime) * this.rateValue : this.anchorPos;
    const d = this.duration;
    if (d <= 0 || raw < d) return Math.max(0, raw);
    return this.loopFlag ? raw % d : d;
  }

  /**
   * Settle the end of playback: without loop, a clock that ran past the
   * longest media stops there. Call once per frame while playing.
   */
  tick(): void {
    if (!this.playingFlag || this.loopFlag) return;
    const d = this.duration;
    if (d > 0 && this.anchorPos + (this.now() - this.anchorTime) * this.rateValue >= d) {
      this.reanchor(d);
      this.playingFlag = false;
      this.emit();
    }
  }

  play(): void {
    if (this.playingFlag) return;
    const d = this.duration;
    // Play from the start again once the end was reached.
    const from = d > 0 && this.position() >= d ? 0 : this.position();
    this.reanchor(from);
    this.playingFlag = true;
    this.emit();
  }

  pause(): void {
    if (!this.playingFlag) return;
    this.reanchor(this.position());
    this.playingFlag = false;
    this.emit();
  }

  toggle(): void {
    if (this.playingFlag) this.pause();
    else this.play();
  }

  seek(position: number): void {
    const d = this.duration;
    const clamped = Math.max(0, d > 0 ? Math.min(d, position) : position);
    this.reanchor(clamped);
    this.emit();
  }

  setRate(rate: number): void {
    if (!(rate > 0) || rate === this.rateValue) return;
    this.reanchor(this.position());
    this.rateValue = rate;
    this.emit();
  }

  setLoop(loop: boolean): void {
    if (loop === this.loopFlag) return;
    this.reanchor(this.position());
    this.loopFlag = loop;
    this.emit();
  }

  /** Register (or with `null`, drop) one media element's duration. */
  setDuration(id: string, seconds: number | null): void {
    const prev = this.durations.get(id);
    if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) {
      if (prev === undefined) return;
      this.durations.delete(id);
    } else {
      if (prev === seconds) return;
      this.durations.set(id, seconds);
    }
    this.emit();
  }

  snapshot(): ClockSnapshot {
    return {
      playing: this.playingFlag,
      position: this.position(),
      duration: this.duration,
      rate: this.rateValue,
      loop: this.loopFlag,
    };
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private reanchor(position: number): void {
    this.anchorPos = position;
    this.anchorTime = this.now();
  }

  private emit(): void {
    this.version++;
    for (const fn of [...this.listeners]) fn();
  }
}

/** What to do with one media element so it tracks the clock. */
export type DriftAction =
  | { kind: "none"; rate: number }
  | { kind: "rate"; rate: number }
  | { kind: "seek"; to: number; rate: number };

export interface DriftOptions {
  /** Beyond this drift (s) the element seeks. */
  seekAbove?: number;
  /** Within this drift (s) the element plays at the clock's rate. */
  tolerance?: number;
  /** Rate nudge per second of drift, capped at ±`maxNudge`. */
  gain?: number;
  maxNudge?: number;
}

/**
 * Steer one element: `mediaTime` is where it is, `clockTime` where it should
 * be (already clamped to the element's own duration by the caller).
 *
 * - Paused: seek whenever it is off by more than the tolerance.
 * - Playing, far off (> `seekAbove`): seek.
 * - Playing, slightly off: nudge the playback rate so it catches up (or
 *   waits) smoothly, without the stutter a seek causes.
 * - Otherwise: the clock's rate.
 */
export function driftCorrection(
  mediaTime: number,
  clockTime: number,
  playing: boolean,
  rate: number,
  options: DriftOptions = {},
): DriftAction {
  const { seekAbove = 0.3, tolerance = 0.04, gain = 0.5, maxNudge = 0.1 } = options;
  const drift = mediaTime - clockTime; // > 0: the element is ahead
  const off = Math.abs(drift);
  if (!playing) return off > tolerance ? { kind: "seek", to: clockTime, rate } : { kind: "none", rate };
  if (off > seekAbove) return { kind: "seek", to: clockTime, rate };
  if (off > tolerance) {
    const nudge = Math.max(-maxNudge, Math.min(maxNudge, -drift * gain));
    return { kind: "rate", rate: rate * (1 + nudge) };
  }
  return { kind: "none", rate };
}

/** Clock time for one element: its duration caps it (a shorter clip rests on its last frame). */
export function mediaTargetTime(clockTime: number, mediaDuration: number | null | undefined): number {
  if (mediaDuration == null || !Number.isFinite(mediaDuration) || mediaDuration <= 0) return clockTime;
  return Math.min(clockTime, mediaDuration);
}

/** `m:ss` (or `h:mm:ss`) for a transport readout. */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}
