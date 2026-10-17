import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useModalBehavior } from "../lib/use-modal-behavior";
import "./card-detail-modal.css";
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
  /** The settings column's heading and phone tab (default "Settings"); the card side's phone tab (default "Card"). */
  settingsLabel?: string;
  cardLabel?: string;
  /** The phone tab it opens on (default settings). */
  initialTab?: "card" | "settings";
  /** Shown in place of the title text (the card editor's inline title edit). */
  titleNode?: ReactNode;
  /** The settings column's header in place of its label (the card editor's tab row); shown on phones too. */
  settingsHeader?: ReactNode;
}

/** Arrow keys belong to a focused control (a slider, a select), not to card navigation. */
function isControl(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || typeof el.tagName !== "string") return false;
  const tag = el.tagName.toUpperCase();
  return isTypingTarget(el) || tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA";
}

/** Shared preview-left/settings-right panel for ordinary cards and published reports.
 * Mobile tabs keep both panes mounted. Promoted viewer overlays are fixed-positioned,
 * so this shell must never create a transformed containing block.
 */
export default function CardDetailModal({
  open,
  onClose,
  children,
  settingsContent,
  title,
  onPrev,
  onNext,
  settingsLabel = "Settings",
  cardLabel = "Card",
  initialTab = "settings",
  titleNode,
  settingsHeader,
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
  const [tab, setTab] = useState<"card" | "settings">(initialTab);
  useEffect(() => {
    if (open) setTab(initialTab);
    // Only on opening: the workspace's card editor stays open from adding a card to editing it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  return createPortal(
    <div className="card-detail-overlay">
      <div className="card-detail-backdrop" onClick={onClose} aria-hidden="true" />
      <div role="dialog" aria-modal="true" aria-label={title} className="card-detail-dialog">
        <header className="card-detail-heading">
          {hasNav && <NavButtons onPrev={onPrev} onNext={onNext} size="h-7 w-7" />}
          <h2>{titleNode ?? title}</h2>
          <button type="button" onClick={onClose} className="card-detail-close" aria-label="Close">×</button>
        </header>
        {hasSettings && <div role="tablist" className="card-detail-mobile-tabs">{tabButton("card", cardLabel)}{tabButton("settings", settingsLabel)}</div>}
        <div className="card-detail-layout">
          <div className={`card-detail-preview ${showSettings ? "" : "mobile-active"}`}>
            <div className="card-detail-preview-content">{children}</div>
          </div>
          {hasSettings && <aside className={`card-detail-settings ${showSettings ? "mobile-active" : ""}`}>
            {settingsHeader && <div className="card-detail-settings-heading">{settingsHeader}</div>}
            <div className="card-detail-settings-content">{settingsContent}</div>
          </aside>}
        </div>
      </div>
    </div>, document.body
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
