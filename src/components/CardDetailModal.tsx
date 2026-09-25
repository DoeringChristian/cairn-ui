import { useEffect, useRef, useState, type ReactNode } from "react";
import { useModalBehavior } from "../lib/use-modal-behavior";
import { isTypingTarget } from "../lib/shortcuts";

interface Props {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  settingsContent: ReactNode;
  title: string;
  /** Step to the previous / next card (lib/card-nav.tsx); omitted at either end. */
  onPrev?: () => void;
  onNext?: () => void;
}

/** Arrow keys belong to a focused control (a slider, a select), not to card navigation. */
function isControl(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || typeof el.tagName !== "string") return false;
  const tag = el.tagName.toUpperCase();
  return isTypingTarget(el) || tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA";
}

/**
 * The card at full size beside its settings panel. Below `md` it fills the
 * screen instead: a sticky header (title, close, Card / Settings tabs) over
 * one of the two panels. The inactive panel is hidden, not unmounted, so the
 * card's content keeps its state across tab switches.
 *
 * Content promoted into this modal by `card-kit/use-overlay-slot` is
 * positioned `fixed`; nothing here may set `transform` (or anything else that
 * makes a containing block for fixed elements) on the content's ancestors.
 */
export default function CardDetailModal({
  open,
  onClose,
  children,
  settingsContent,
  title,
  onPrev,
  onNext,
}: Props) {
  useModalBehavior(open, onClose);
  const hasNav = !!onPrev || !!onNext;
  const navRef = useRef({ onPrev, onNext });
  navRef.current = { onPrev, onNext };
  useEffect(() => {
    if (!open || !hasNav) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      if (isControl(e.target)) return;
      const step = e.key === "ArrowLeft" ? navRef.current.onPrev : navRef.current.onNext;
      if (!step) return;
      e.preventDefault();
      step();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, hasNav]);
  const [tab, setTab] = useState<"card" | "settings">("card");
  useEffect(() => {
    if (open) setTab("card");
  }, [open]);

  if (!open) return null;

  const hasSettings = settingsContent != null && settingsContent !== false;
  const showSettings = hasSettings && tab === "settings";
  const tabButton = (value: "card" | "settings", label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === value}
      onClick={() => setTab(value)}
      className={`h-11 flex-1 border-b-2 text-sm ${
        tab === value ? "border-accent font-semibold text-fg" : "border-transparent text-fg-muted"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal content */}
      <div className="relative z-10 flex flex-1 flex-col overflow-hidden bg-bg md:m-4 md:flex-row md:rounded-lg md:border md:border-border">
        {/* Phone header: title, close, tabs */}
        <div className="sticky top-0 z-10 shrink-0 border-b border-border bg-bg md:hidden">
          <div className="flex items-center gap-2 pl-4 pr-1">
            <h2 className="mono min-w-0 flex-1 truncate text-base font-semibold">{title}</h2>
          {hasNav && <NavButtons onPrev={onPrev} onNext={onNext} size="h-11 w-11" />}
            <button
              type="button"
              onClick={onClose}
              className="h-11 w-11 shrink-0 inline-flex items-center justify-center rounded text-2xl text-fg-muted hover:bg-bg-hover hover:text-fg"
              aria-label="Close"
            >
              {"×"}
            </button>
          </div>
          {hasSettings && (
            <div role="tablist" className="flex">
              {tabButton("card", "Card")}
              {tabButton("settings", "Settings")}
            </div>
          )}
        </div>

        {/* Card at full size */}
        <div
          className={`min-h-0 min-w-0 flex-1 flex-col overflow-auto p-3 md:flex md:p-6 ${
            showSettings ? "hidden" : "flex"
          }`}
        >
          <div className="mb-4 hidden shrink-0 items-center gap-2 md:flex">
            <h2 className="mono min-w-0 flex-1 truncate text-lg font-semibold">{title}</h2>
            {hasNav && <NavButtons onPrev={onPrev} onNext={onNext} size="h-7 w-7" />}
          </div>
          <div className="flex-1 min-h-0">{children}</div>
        </div>

        {/* Settings panel */}
        <div
          className={`min-h-0 flex-1 overflow-y-auto bg-bg-elevated p-4 md:block md:w-96 md:flex-none md:shrink-0 md:border-l md:border-border ${
            showSettings ? "block" : "hidden"
          }`}
        >
          <div className="mb-4 hidden items-center justify-between md:flex">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
              Settings
            </h3>
            <button
              type="button"
              onClick={onClose}
              className="h-6 w-6 inline-flex items-center justify-center rounded hover:bg-bg-hover text-fg-muted hover:text-fg text-lg"
              aria-label="Close"
            >
              {"×"}
            </button>
          </div>
          {settingsContent}
        </div>
      </div>
    </div>
  );
}

function NavButtons({ onPrev, onNext, size }: { onPrev?: () => void; onNext?: () => void; size: string }) {
  const cls = `${size} shrink-0 inline-flex items-center justify-center rounded text-fg-muted hover:bg-bg-hover hover:text-fg disabled:opacity-30 disabled:hover:bg-transparent`;
  return (
    <span className="inline-flex shrink-0 items-center">
      <button type="button" onClick={onPrev} disabled={!onPrev} className={cls} aria-label="Previous card" title="Previous card (←)">
        <i className="fa-solid fa-chevron-left" aria-hidden="true" />
      </button>
      <button type="button" onClick={onNext} disabled={!onNext} className={cls} aria-label="Next card" title="Next card (→)">
        <i className="fa-solid fa-chevron-right" aria-hidden="true" />
      </button>
    </span>
  );
}
