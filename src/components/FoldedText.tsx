import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

/**
 * A value folded to one line of the space it has, ending in "…", with a
 * "more" toggle that appears only when the line actually cuts it; expanded,
 * it wraps. Width-driven rather than a character count, so a wide column
 * shows more. Copying copies the full value (the folded part is only hidden).
 */
export default function FoldedText({ children, className = "" }: { children: ReactNode; className?: string }) {
  const textRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [cut, setCut] = useState(false);

  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el || open) return;
    const measure = () => setCut(el.scrollWidth > el.clientWidth + 1);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [open, children]);

  return (
    <span className="flex min-w-0 items-baseline gap-1.5">
      <span
        ref={textRef}
        className={`min-w-0 ${open ? "whitespace-pre-wrap break-all" : "truncate"} ${className}`}
      >
        {children}
      </span>
      {(cut || open) && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="shrink-0 font-sans text-xs text-fg-subtle hover:text-fg"
          aria-expanded={open}
        >
          {open ? "less" : "more"}
        </button>
      )}
    </span>
  );
}
