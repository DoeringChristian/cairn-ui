import { useCallback, useEffect, useRef } from "react";

interface Props {
  id?: string;
  value: number;
  onChange: (next: number) => void;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  invalid?: boolean;
  label?: string;
}

/**
 * A native range input whose changes are coalesced to one per animation
 * frame, so dragging does not re-render a heavy card on every pointer move.
 */
export default function RangeTrack({ id, value, onChange, min, max, step, disabled, invalid, label }: Props) {
  const onChangeRef = useRef(onChange);
  const frameRef = useRef(0);
  const pendingRef = useRef<number | null>(null);
  onChangeRef.current = onChange;

  const queue = useCallback((next: number) => {
    pendingRef.current = next;
    if (frameRef.current) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = 0;
      const pending = pendingRef.current;
      pendingRef.current = null;
      if (pending != null) onChangeRef.current(pending);
    });
  }, []);

  useEffect(() => () => {
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
  }, []);

  return (
    <input
      id={id}
      type="range"
      min={min}
      max={max}
      step={step}
      value={Math.min(max, Math.max(min, value))}
      disabled={disabled}
      aria-label={label}
      aria-invalid={invalid}
      onChange={(e) => queue(Number(e.target.value))}
      className={`h-5 w-full min-w-0 cursor-pointer disabled:cursor-not-allowed touch:h-10 ${invalid ? "accent-status-failed" : "accent-accent"}`}
    />
  );
}
