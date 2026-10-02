import { useEffect, useReducer } from "react";
import { formatClock, type SharedClock } from "../../lib/media/shared-clock";

/**
 * One play/pause + scrub bar + loop toggle for a `SharedClock`: every video
 * on the clock follows it (see `useClockedVideo` in VideoPlayerCard).
 * Re-renders each frame while playing, and settles the clock's end (`tick`).
 *
 * Loop: with `onLoopChange` the owner keeps the state (a card persists it as
 * its `loop` setting and sets the clock from it); without, the toggle flips
 * the clock directly (the section's bar: per session).
 */
export default function ClockTransport({
  clock,
  hideWithoutMedia = false,
  className,
  onLoopChange,
}: {
  clock: SharedClock;
  /** Persist a loop toggle (the owner then sets the clock); omitted: toggle the clock itself. */
  onLoopChange?: (loop: boolean) => void;
  /** Render nothing until a clocked media element reported its duration. */
  hideWithoutMedia?: boolean;
  className?: string;
}) {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => clock.subscribe(rerender), [clock]);
  const playing = clock.playing;
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const loop = () => {
      clock.tick();
      rerender();
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [clock, playing]);

  const duration = clock.duration;
  if (hideWithoutMedia && duration <= 0) return null;
  const position = clock.position();
  return (
    <div className={`flex items-center gap-2 ${className ?? ""}`}>
      <button
        type="button"
        onClick={() => clock.toggle()}
        aria-label={playing ? "Pause all" : "Play all"}
        title={playing ? "Pause all" : "Play all"}
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-xs text-fg-muted hover:bg-bg-hover hover:text-fg touch:h-10 touch:w-10"
      >
        <i className={`fa-solid ${playing ? "fa-pause" : "fa-play"}`} aria-hidden="true" />
      </button>
      <input
        type="range"
        aria-label="Playback position"
        min={0}
        max={duration > 0 ? duration : 1}
        step={0.01}
        value={Math.min(position, duration > 0 ? duration : 1)}
        disabled={duration <= 0}
        onChange={(e) => clock.seek(Number(e.target.value))}
        className="min-w-0 flex-1 accent-accent"
      />
      <span className="mono shrink-0 text-[10px] text-fg-muted">
        {formatClock(position)} / {formatClock(duration)}
      </span>
      <button
        type="button"
        onClick={() => (onLoopChange ? onLoopChange(!clock.loop) : clock.setLoop(!clock.loop))}
        aria-label={clock.loop ? "Loop on" : "Loop off"}
        aria-pressed={clock.loop}
        title={clock.loop ? "Looping — click to play once" : "Play once — click to loop"}
        className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-xs hover:bg-bg-hover touch:h-10 touch:w-10 ${
          clock.loop ? "text-accent" : "text-fg-subtle hover:text-fg"
        }`}
      >
        <i className="fa-solid fa-repeat" aria-hidden="true" />
      </button>
    </div>
  );
}
