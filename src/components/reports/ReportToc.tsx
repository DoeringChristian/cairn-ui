/**
 * A report's table of contents: its headings, indented by level; a click
 * scrolls to the heading (expanding any collapsed section hiding it first).
 * Desktop: a sticky column beside the notebook. Phones: a floating
 * "Contents" button opening it in a popover (a bottom sheet).
 */

import { useEffect, useRef, useState } from "react";
import type { OutlineHeading } from "../../lib/reports/outline";
import Popover from "../ui/Popover";

interface Props {
  outline: OutlineHeading[];
  /** Scroll to a heading, revealing it first if a collapsed section hides it. */
  onNavigate: (h: OutlineHeading) => void;
}

function TocList({ outline, onNavigate, active }: Props & { active: string | null }) {
  const minLevel = Math.min(...outline.map((h) => h.level));
  return (
    <ul className="flex flex-col gap-0.5 text-xs">
      {outline.map((h) => (
        <li key={h.slug} style={{ paddingLeft: `${(h.level - minLevel) * 0.75}rem` }}>
          <a
            href={`#${h.slug}`}
            onClick={(e) => {
              e.preventDefault();
              onNavigate(h);
            }}
            className={`block truncate rounded px-1.5 py-0.5 touch:py-2 hover:bg-bg-hover hover:text-fg ${
              active === h.slug ? "text-accent" : h.level === minLevel ? "text-fg-muted" : "text-fg-subtle"
            }`}
            title={h.text}
          >
            {h.text}
          </a>
        </li>
      ))}
    </ul>
  );
}

/** The heading last scrolled past the top of the viewport. */
function useActiveHeading(outline: OutlineHeading[]): string | null {
  const [active, setActive] = useState<string | null>(null);
  const key = outline.map((h) => h.slug).join("|");
  useEffect(() => {
    const onScroll = () => {
      let current: string | null = null;
      for (const h of outline) {
        const el = document.getElementById(h.slug);
        if (!el) continue;
        if (el.getBoundingClientRect().top <= 80) current = h.slug;
        else break;
      }
      setActive(current);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return active;
}

export default function ReportToc({ outline, onNavigate }: Props) {
  const active = useActiveHeading(outline);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  if (outline.length === 0) return null;
  return (
    <>
      <nav aria-label="Contents" className="hidden lg:block print:hidden w-48 shrink-0">
        <div className="sticky top-4 max-h-[calc(100vh-2rem)] overflow-y-auto pr-1">
          <p className="mb-1 px-1.5 text-[10px] uppercase tracking-wide text-fg-subtle">Contents</p>
          <TocList outline={outline} onNavigate={onNavigate} active={active} />
        </div>
      </nav>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="lg:hidden print:hidden fixed bottom-20 right-4 md:bottom-4 z-20 inline-flex h-10 items-center gap-1.5 rounded-full border border-border bg-bg-elevated px-3 text-xs text-fg-muted shadow-md hover:text-fg"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <i className="fa-solid fa-list" aria-hidden="true" /> Contents
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={btnRef} title="Contents" width={280} align="end" bodyClassName="p-2">
        <TocList
          outline={outline}
          active={active}
          onNavigate={(h) => {
            setOpen(false);
            onNavigate(h);
          }}
        />
      </Popover>
    </>
  );
}
